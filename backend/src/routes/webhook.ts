import express, { Request, Response } from 'express';
import {
  createSource,
  createItem,
  createAppointment,
  createBill,
  createAuditLog,
  findUserById,
  markGoogleSyncPending
} from '../db/queries.js';
import { parseSource } from '../services/parser.js';
import { storeText } from '../services/storage.js';
import type { Source } from '@carebase/shared';

const router = express.Router();

/**
 * Postmark inbound email webhook
 * Expects: { From, To, Subject, TextBody, MessageID }
 * Also supports Resend format for backward compatibility
 */
router.post('/inbound-email', async (req: Request, res: Response) => {
  try {
    // Handle both Postmark (capitalized) and Resend (lowercase) formats
    const from = req.body.From || req.body.from;
    const to = req.body.To || req.body.to;
    const subject = req.body.Subject || req.body.subject;
    const text = req.body.TextBody || req.body.text;
    const messageId = req.body.MessageID || req.body.messageId;

    console.log('Inbound email webhook:', { from, to, subject, provider: req.body.From ? 'Postmark' : 'Resend' });

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
 * @param source - Source record
 */
async function processSource(source: Source): Promise<void> {
  const parsed = parseSource(source);
  const { classification, appointmentData, billData } = parsed;

  // Create item
    const item = await createItem(
      source.recipientId,
      source.id,
      classification.type,
      classification.confidence
    );

  // Create appointment or bill based on classification
  if (classification.type === 'appointment' && appointmentData) {
    const appointment = await createAppointment(item.id, appointmentData);
    await markGoogleSyncPending(appointment.itemId);
  } else if (classification.type === 'bill' && billData) {
    const bill = await createBill(item.id, billData);
    await markGoogleSyncPending(bill.itemId);
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
