import express from 'express';
import { getLowConfidenceItems, reclassifyItem, findItemById, findSourceById } from '../db/queries.js';
import { parseSource } from '../services/parser.js';
import { createAppointment, createBill, createAuditLog } from '../db/queries.js';

const router = express.Router();

// Middleware to require authentication
function requireAuth(req, res, next) {
  if (!req.user) {
    return res.redirect('/auth/google');
  }
  next();
}

/**
 * GET /review - Show items needing review
 */
router.get('/', requireAuth, async (req, res) => {
  try {
    const items = await getLowConfidenceItems();

    res.render('review', {
      user: req.user,
      items
    });
  } catch (error) {
    console.error('Review page error:', error);
    res.status(500).send('Error loading review page');
  }
});

/**
 * POST /review/:itemId/reclassify - Reclassify an item
 */
router.post('/:itemId/reclassify', requireAuth, async (req, res) => {
  try {
    const { itemId } = req.params;
    const { newType } = req.body; // 'appointment', 'bill', or 'noise'

    if (!['appointment', 'bill', 'noise'].includes(newType)) {
      return res.status(400).json({ error: 'Invalid type' });
    }

    // Get item and source
    const item = await findItemById(itemId);
    if (!item) {
      return res.status(404).json({ error: 'Item not found' });
    }

    const source = await findSourceById(item.source_id);

    // Reclassify item (deletes old appointment/bill)
    await reclassifyItem(itemId, newType);

    // Recreate appointment or bill based on new type
    if (newType === 'appointment') {
      const parsed = parseSource(source);
      if (parsed.appointmentData) {
        await createAppointment(itemId, parsed.appointmentData);
      }
    } else if (newType === 'bill') {
      const parsed = parseSource(source);
      if (parsed.billData) {
        await createBill(itemId, parsed.billData);
      }
    }

    // Log manual reclassification
    await createAuditLog(itemId, 'manual_reclassify', {
      oldType: item.detected_type,
      newType,
      userId: req.user.id
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Reclassify error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
