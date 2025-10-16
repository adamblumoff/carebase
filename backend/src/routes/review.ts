import express, { Request, Response, NextFunction } from 'express';
import { getLowConfidenceItems, reclassifyItem, findItemById, findSourceById } from '../db/queries.js';
import { parseSource } from '../services/parser.js';
import { createAppointment, createBill, createAuditLog, markGoogleSyncPending } from '../db/queries.js';
import type { ItemType } from '@carebase/shared';

const router = express.Router();

// Middleware to require authentication
function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.redirect('/auth/google');
    return;
  }
  next();
}

/**
 * GET /review - Show items needing review
 */
router.get('/', requireAuth, async (req: Request, res: Response) => {
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
router.post('/:itemId/reclassify', requireAuth, async (req: Request, res: Response) => {
  try {
    const { itemId } = req.params;
    const { newType } = req.body; // 'appointment', 'bill', or 'noise'

    if (!['appointment', 'bill', 'noise'].includes(newType)) {
      return res.status(400).json({ error: 'Invalid type' });
    }

    // Get item and source
    const item = await findItemById(parseInt(itemId));
    if (!item) {
      return res.status(404).json({ error: 'Item not found' });
    }

    const source = await findSourceById(item.sourceId);
    if (!source) {
      return res.status(404).json({ error: 'Source not found' });
    }

    // Reclassify item (deletes old appointment/bill)
    await reclassifyItem(parseInt(itemId), newType as ItemType);

    // Recreate appointment or bill based on new type
    if (newType === 'appointment') {
      const parsed = parseSource(source);
      // Force create appointment even if parser couldn't extract all fields
      const appointmentData = parsed.appointmentData || {
        startLocal: new Date().toISOString(),
        endLocal: new Date(Date.now() + 3600000).toISOString(), // 1 hour later
        location: undefined,
        prepNote: undefined,
        summary: source.subject || 'Appointment (needs review)'
      };
      const appointment = await createAppointment(parseInt(itemId), appointmentData);
      await markGoogleSyncPending(appointment.itemId);
    } else if (newType === 'bill') {
      const parsed = parseSource(source);
      // Force create bill even if parser couldn't extract all fields
      const billData = parsed.billData || {
        statementDate: undefined,
        amount: undefined,
        dueDate: undefined,
        payUrl: undefined,
        status: 'todo' as const
      };
      const bill = await createBill(parseInt(itemId), billData);
      await markGoogleSyncPending(bill.itemId);
    }

    // Log manual reclassification
    await createAuditLog(parseInt(itemId), 'manual_reclassify', {
      oldType: item.detectedType,
      newType,
      userId: req.user!.id
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Reclassify error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
