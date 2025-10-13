import express, { Request, Response } from 'express';
import { ensureAuthenticated, ensureRecipient } from '../middleware/auth.js';
import {
  getUpcomingAppointments,
  getUpcomingBills,
  updateAppointment,
  updateBill,
  deleteAppointment,
  deleteBill,
  findUserById,
  findRecipientById
} from '../db/queries.js';
import db from '../db/client.js';
import type { BillStatus, User } from '@carebase/shared';

const router = express.Router();

/**
 * Get plan page - authenticated or via secret token
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    let recipient = null;
    let user: User | null = null;

    // Check if authenticated user
    if (req.isAuthenticated()) {
      user = req.user as User;
      const { findRecipientsByUserId } = await import('../db/queries.js');
      const recipients = await findRecipientsByUserId(user.id);
      recipient = recipients[0];
    }
    // Check for secret token in query
    else if (req.query.token) {
      const result = await db.query(
        `SELECT u.*, r.id as recipient_id, r.display_name as recipient_name
         FROM users u
         JOIN recipients r ON u.id = r.user_id
         WHERE u.plan_secret = $1
         LIMIT 1`,
        [req.query.token]
      );

      if (result.rows.length === 0) {
        return res.status(403).send('Invalid token');
      }

      const row = result.rows[0];
      user = { id: row.id, email: row.email };
      recipient = { id: row.recipient_id, display_name: row.recipient_name };
    }
    else {
      return res.redirect('/');
    }

    if (!recipient) {
      return res.status(404).send('No recipient found');
    }

    // Get next 7 days
    const startDate = new Date();
    startDate.setHours(0, 0, 0, 0);

    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + 7);

    // Fetch appointments and bills
    const appointments = await getUpcomingAppointments(recipient.id, startDate.toISOString(), endDate.toISOString());
    const bills = await getUpcomingBills(recipient.id, startDate.toISOString(), endDate.toISOString());

    res.render('plan', {
      user,
      recipient,
      appointments,
      bills,
      baseUrl: process.env.BASE_URL
    });
  } catch (error) {
    console.error('Plan page error:', error);
    res.status(500).send('Error loading plan');
  }
});

/**
 * Update appointment
 */
router.post('/appointment/:id/update', async (req: Request, res: Response) => {
  try {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { id } = req.params;
    const { summary, startLocal, endLocal, location, prepNote } = req.body;

    const user = req.user as User | undefined;
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    await updateAppointment(parseInt(id), user.id, {
      summary,
      startLocal,
      endLocal,
      location,
      prepNote
    });

    res.redirect('/plan');
  } catch (error) {
    console.error('Update appointment error:', error);
    res.status(500).send('Error updating appointment');
  }
});

/**
 * Delete appointment
 */
router.post('/appointment/:id/delete', async (req: Request, res: Response) => {
  try {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { id } = req.params;
    const user = req.user as User | undefined;
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    await deleteAppointment(parseInt(id), user.id);

    res.redirect('/plan');
  } catch (error) {
    console.error('Delete appointment error:', error);
    res.status(500).send('Error deleting appointment');
  }
});

/**
 * Update bill
 */
router.post('/bill/:id/update', async (req: Request, res: Response) => {
  try {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { id } = req.params;
    const { amount, dueDate, statementDate, payUrl, status } = req.body;

    const user = req.user as User | undefined;
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    await updateBill(parseInt(id), user.id, {
      amount: amount ? parseFloat(amount) : undefined,
      dueDate: dueDate || undefined,
      statementDate: statementDate || undefined,
      payUrl: payUrl || undefined,
      status: (status as BillStatus) || 'todo'
    });

    res.redirect('/plan');
  } catch (error) {
    console.error('Update bill error:', error);
    res.status(500).send('Error updating bill');
  }
});

/**
 * Delete bill
 */
router.post('/bill/:id/delete', async (req: Request, res: Response) => {
  try {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { id } = req.params;
    const user = req.user as User | undefined;
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    await deleteBill(parseInt(id), user.id);

    res.redirect('/plan');
  } catch (error) {
    console.error('Delete bill error:', error);
    res.status(500).send('Error deleting bill');
  }
});

export default router;
