import type { Request, Response } from 'express';
import {
  getUpcomingAppointments,
  getUpcomingBills,
  findRecipientsByUserId,
  getPlanVersion,
  ensureOwnerCollaborator,
  listCollaborators,
  findRecipientForCollaborator,
} from '../../db/queries.js';
import type { Appointment, Bill, Collaborator, User } from '@carebase/shared';

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
  collaborators: Collaborator[];
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
    let recipient = recipients[0];
    let collaboratorView = false;

    if (!recipient) {
      const collaboratorRecipient = await findRecipientForCollaborator(user.id);
      if (!collaboratorRecipient) {
        res.status(404).json({ error: 'No recipient found' });
        return;
      }
      recipient = collaboratorRecipient;
      collaboratorView = true;
    } else {
      await ensureOwnerCollaborator(recipient.id, user);
    }

    const startDate = new Date();
    startDate.setHours(0, 0, 0, 0);

    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + days);

    const ownerUserId = recipient.userId;

    const [appointments, bills, { planVersion, planUpdatedAt }, collaborators] = await Promise.all([
      getUpcomingAppointments(recipient.id, startDate.toISOString(), endDate.toISOString()),
      getUpcomingBills(recipient.id, startDate.toISOString(), endDate.toISOString()),
      getPlanVersion(ownerUserId),
      listCollaborators(recipient.id),
    ]);

    const sanitizedCollaborators = collaborators.map((collaborator) => ({
      ...collaborator,
      inviteToken:
        !collaboratorView && collaborator.status === 'pending'
          ? collaborator.inviteToken
          : ''
    }));

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
      collaborators: sanitizedCollaborators.filter((collab) =>
        collaboratorView ? collab.status === 'accepted' : true
      ),
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
