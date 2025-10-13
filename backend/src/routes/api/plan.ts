/**
 * Mobile API: Plan endpoints (appointments + bills)
 */
import express, { Request, Response } from 'express';
import { getUpcomingAppointments, getUpcomingBills, findRecipientsByUserId } from '../../db/queries.js';
import type { Appointment, Bill, User } from '@carebase/shared';

const router = express.Router();

/**
 * GET /api/plan
 * Get user's upcoming appointments and bills
 * Query params:
 *   - days: number of days to look ahead (default: 7)
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const user = req.user as User | undefined;
    if (!user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    const days = parseInt(req.query.days as string) || 7;

    // Get recipient
    const recipients = await findRecipientsByUserId(user.id);
    if (recipients.length === 0) {
      return res.status(404).json({ error: 'No recipient found' });
    }
    const recipient = recipients[0];

    // Calculate date range
    const startDate = new Date();
    startDate.setHours(0, 0, 0, 0);

    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + days);

    // Fetch appointments and bills
    const appointments = await getUpcomingAppointments(
      recipient.id,
      startDate.toISOString(),
      endDate.toISOString()
    );

    const bills = await getUpcomingBills(
      recipient.id,
      startDate.toISOString(),
      endDate.toISOString()
    );

    res.json({
      recipient: {
        id: recipient.id,
        displayName: recipient.displayName
      },
      dateRange: {
        start: startDate.toISOString(),
        end: endDate.toISOString()
      },
      appointments,
      bills
    });
  } catch (error) {
    console.error('Get plan error:', error);
    res.status(500).json({ error: 'Failed to fetch plan' });
  }
});

export default router;
