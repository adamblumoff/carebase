import type { Request, Response } from 'express';
import {
  getUpcomingAppointments,
  getUpcomingBills,
  findRecipientsByUserId,
  getPlanVersion,
} from '../../db/queries.js';
import type { Appointment, Bill, User } from '@carebase/shared';

interface PlanResponse {
  recipient: {
    id: number;
    displayName: string | null;
  };
  dateRange: {
    start: string;
    end: string;
  };
  appointments: Appointment[];
  bills: Bill[];
  planVersion: number;
  planUpdatedAt: string | null;
}

export async function getPlan(req: Request, res: Response): Promise<void> {
  try {
    const user = req.user as User | undefined;
    if (!user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const days = Number.parseInt(req.query.days as string, 10) || 7;

    const recipients = await findRecipientsByUserId(user.id);
    if (recipients.length === 0) {
      res.status(404).json({ error: 'No recipient found' });
      return;
    }
    const recipient = recipients[0];

    const startDate = new Date();
    startDate.setHours(0, 0, 0, 0);

    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + days);

    const [appointments, bills, { planVersion, planUpdatedAt }] = await Promise.all([
      getUpcomingAppointments(recipient.id, startDate.toISOString(), endDate.toISOString()),
      getUpcomingBills(recipient.id, startDate.toISOString(), endDate.toISOString()),
      getPlanVersion(user.id),
    ]);

    const payload: PlanResponse = {
      recipient: {
        id: recipient.id,
        displayName: recipient.displayName,
      },
      dateRange: {
        start: startDate.toISOString(),
        end: endDate.toISOString(),
      },
      appointments,
      bills,
      planVersion,
      planUpdatedAt,
    };

    res.json(payload);
  } catch (error) {
    console.error('Get plan error:', error);
    res.status(500).json({ error: 'Failed to fetch plan' });
  }
}

export async function getPlanVersionHandler(req: Request, res: Response): Promise<void> {
  try {
    const user = req.user as User | undefined;
    if (!user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const { planVersion, planUpdatedAt } = await getPlanVersion(user.id);
    res.json({ planVersion, planUpdatedAt });
  } catch (error) {
    console.error('Get plan version error:', error);
    res.status(500).json({ error: 'Failed to fetch plan version' });
  }
}
