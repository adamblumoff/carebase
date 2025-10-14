import express, { Request, Response } from 'express';
import {
  getUpcomingAppointments,
  getUpcomingBills,
  updateAppointment,
  updateBill,
  deleteAppointment,
  deleteBill,
  findUserById,
  findRecipientsByUserId,
  getPlanVersion
} from '../db/queries.js';
import db from '../db/client.js';
import type { BillStatus, User } from '@carebase/shared';

const router = express.Router();

interface PlanRecipientView {
  id: number;
  displayName: string;
  display_name: string;
}

interface PlanContext {
  user: User;
  recipient: PlanRecipientView;
  token?: string | null;
}

async function resolvePlanContext(req: Request): Promise<PlanContext | null> {
  if (req.isAuthenticated()) {
    const user = req.user as User;
    const recipients = await findRecipientsByUserId(user.id);
    if (recipients.length === 0) {
      return null;
    }
    const recipient = recipients[0];
    const recipientView: PlanRecipientView = {
      id: recipient.id,
      displayName: recipient.displayName,
      display_name: recipient.displayName
    };

    return {
      user,
      recipient: recipientView,
      token: null
    };
  }

  if (req.query.token) {
    const token = String(req.query.token);
    const result = await db.query(
      `SELECT u.id, r.id as recipient_id, r.display_name
       FROM users u
       JOIN recipients r ON u.id = r.user_id
       WHERE u.plan_secret = $1
       LIMIT 1`,
      [token]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    const user = await findUserById(row.id);
    if (!user) {
      return null;
    }

    const recipientView: PlanRecipientView = {
      id: row.recipient_id,
      displayName: row.display_name,
      display_name: row.display_name
    };

    return {
      user,
      recipient: recipientView,
      token
    };
  }

  return null;
}

/**
 * Get plan page - authenticated or via secret token
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const context = await resolvePlanContext(req);

    if (!context) {
      if (req.query.token) {
        return res.status(403).send('Invalid token');
      }
      return res.redirect('/');
    }

    const { user, recipient, token } = context;

    // Get next 7 days
    const startDate = new Date();
    startDate.setHours(0, 0, 0, 0);

    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + 7);

    const appointments = await getUpcomingAppointments(recipient.id, startDate.toISOString(), endDate.toISOString());
    const bills = await getUpcomingBills(recipient.id, startDate.toISOString(), endDate.toISOString());
    const { planVersion } = await getPlanVersion(user.id);

    res.render('plan', {
      user,
      recipient,
      appointments,
      bills,
      baseUrl: process.env.BASE_URL,
      planVersion,
      planToken: token ?? null
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

router.get('/version', async (req: Request, res: Response) => {
  try {
    const context = await resolvePlanContext(req);
    if (!context) {
      return res.status(401).json({ error: 'Not authorized' });
    }

    const { planVersion, planUpdatedAt } = await getPlanVersion(context.user.id);
    res.json({ planVersion, planUpdatedAt });
  } catch (error) {
    console.error('Plan version error:', error);
    res.status(500).json({ error: 'Failed to fetch plan version' });
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
