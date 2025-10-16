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
import type {
  Appointment,
  AppointmentPayload,
  Bill,
  BillPayload,
  Collaborator,
  CollaboratorPayload,
  PlanPayload,
  User
} from '@carebase/shared';

function toCollaboratorPayload(collaborator: Collaborator): CollaboratorPayload {
  return {
    ...collaborator,
    invitedAt: collaborator.invitedAt instanceof Date
      ? collaborator.invitedAt.toISOString()
      : new Date(collaborator.invitedAt).toISOString(),
    acceptedAt: collaborator.acceptedAt
      ? collaborator.acceptedAt instanceof Date
        ? collaborator.acceptedAt.toISOString()
        : new Date(collaborator.acceptedAt).toISOString()
      : null,
  };
}

function toAppointmentPayload(appointment: Appointment): AppointmentPayload {
  return {
    ...appointment,
    startLocal: appointment.startLocal instanceof Date
      ? appointment.startLocal.toISOString()
      : new Date(appointment.startLocal).toISOString(),
    endLocal: appointment.endLocal instanceof Date
      ? appointment.endLocal.toISOString()
      : new Date(appointment.endLocal).toISOString(),
    createdAt: appointment.createdAt instanceof Date
      ? appointment.createdAt.toISOString()
      : new Date(appointment.createdAt).toISOString()
  };
}

function toBillPayload(bill: Bill): BillPayload {
  return {
    ...bill,
    statementDate: bill.statementDate
      ? bill.statementDate instanceof Date
        ? bill.statementDate.toISOString()
        : new Date(bill.statementDate).toISOString()
      : null,
    dueDate: bill.dueDate
      ? bill.dueDate instanceof Date
        ? bill.dueDate.toISOString()
        : new Date(bill.dueDate).toISOString()
      : null,
    createdAt: bill.createdAt instanceof Date
      ? bill.createdAt.toISOString()
      : new Date(bill.createdAt).toISOString()
  };
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

    const collaboratorPayloads = collaborators.map(toCollaboratorPayload);
    const appointmentPayloads = appointments.map(toAppointmentPayload);
    const billPayloads = bills.map(toBillPayload);
    const sanitizedCollaborators = collaboratorPayloads.map((collaborator) => ({
      ...collaborator,
      inviteToken:
        !collaboratorView && collaborator.status === 'pending'
          ? collaborator.inviteToken
          : ''
    }));

    const payload: PlanPayload = {
      recipient: {
        id: recipient.id,
        displayName: recipient.displayName,
      },
      dateRange: {
        start: startDate.toISOString(),
        end: endDate.toISOString(),
      },
      appointments: appointmentPayloads,
      bills: billPayloads,
      planVersion,
      planUpdatedAt: planUpdatedAt ? new Date(planUpdatedAt).toISOString() : null,
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

    let ownerUserId = user.id;

    const recipients = await findRecipientsByUserId(user.id);
    if (recipients.length === 0) {
      const collaboratorRecipient = await findRecipientForCollaborator(user.id);
      if (!collaboratorRecipient) {
        res.status(404).json({ error: 'No recipient found' });
        return;
      }
      ownerUserId = collaboratorRecipient.userId;
    } else {
      ownerUserId = recipients[0].userId;
    }

    const { planVersion, planUpdatedAt } = await getPlanVersion(ownerUserId);
    const normalizedPlanUpdatedAt = planUpdatedAt ? new Date(planUpdatedAt).toISOString() : null;
    res.json({ planVersion, planUpdatedAt: normalizedPlanUpdatedAt });
  } catch (error) {
    console.error('Get plan version error:', error);
    res.status(500).json({ error: 'Failed to fetch plan version' });
  }
}
