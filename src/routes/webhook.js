import express from 'express';
import { createSource, createItem, createAppointment, createBill, createAuditLog, findUserById } from '../db/queries.js';
import { parseSource } from '../services/parser.js';
import { storeText } from '../services/storage.js';

const router = express.Router();

/**
 * Resend inbound email webhook
 * Expects: { from, to, subject, text, html, messageId }
 */
router.post('/inbound-email', async (req, res) => {
  try {
    const { from, to, subject, text, messageId } = req.body;

    console.log('Inbound email webhook:', { from, to, subject });

    // Find user by forwarding address
    const userResult = await import('../db/client.js').then(m => m.default.query(
      'SELECT u.*, r.id as recipient_id FROM users u JOIN recipients r ON u.id = r.user_id WHERE u.forwarding_address = $1 LIMIT 1',
      [to]
    ));

    if (userResult.rows.length === 0) {
      console.log('No user found for forwarding address:', to);
      return res.status(404).json({ error: 'User not found' });
    }

    const { recipient_id } = userResult.rows[0];

    // Extract short excerpt (first 500 chars)
    const shortExcerpt = text ? text.substring(0, 500) : '';

    // Store full text if longer
    let storageKey = null;
    if (text && text.length > 500) {
      storageKey = await storeText(text);
    }

    // Create source record
    const source = await createSource(recipient_id, 'email', {
      externalId: messageId,
      sender: from,
      subject,
      shortExcerpt,
      storageKey
    });

    // Parse source to create item
    await processSource(source);

    res.json({ success: true, sourceId: source.id });
  } catch (error) {
    console.error('Inbound email webhook error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Process source and create item
 * @param {Object} source - Source record
 */
async function processSource(source) {
  const parsed = parseSource(source);
  const { classification, appointmentData, billData } = parsed;

  // Create item
  const item = await createItem(
    source.recipient_id,
    source.id,
    classification.type,
    classification.confidence
  );

  // Create appointment or bill based on classification
  if (classification.type === 'appointment' && appointmentData) {
    await createAppointment(item.id, appointmentData);
  } else if (classification.type === 'bill' && billData) {
    await createBill(item.id, billData);
  }

  // Log audit entry
  await createAuditLog(item.id, 'auto_classified', {
    type: classification.type,
    confidence: classification.confidence,
    sender: source.sender,
    subject: source.subject
  });

  console.log(`Created ${classification.type} item with confidence ${classification.confidence}`);
}

export default router;
