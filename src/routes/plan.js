import express from 'express';
import { ensureAuthenticated, ensureRecipient } from '../middleware/auth.js';
import { getUpcomingAppointments, getUpcomingBills, findUserById, findRecipientById } from '../db/queries.js';
import db from '../db/client.js';

const router = express.Router();

/**
 * Get plan page - authenticated or via secret token
 */
router.get('/', async (req, res) => {
  try {
    let recipient = null;
    let user = null;

    // Check if authenticated user
    if (req.isAuthenticated()) {
      user = req.user;
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

export default router;
