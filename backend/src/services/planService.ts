import type {
  PlanPayload,
  User,
  Appointment,
  AppointmentPayload,
  Bill,
  BillPayload,
  Collaborator,
  CollaboratorPayload
} from '@carebase/shared';
import {
  findRecipientsByUserId,
  findRecipientForCollaborator,
  ensureOwnerCollaborator,
  getUpcomingAppointments,
  getUpcomingBills,
  getPlanVersion,
  listCollaborators
} from '../db/queries.js';
import { NotFoundError } from '../utils/errors.js';
import { formatDateTimeWithTimeZone, getDefaultTimeZone } from '../utils/timezone.js';

function toCollaboratorPayload(collaborator: Collaborator): CollaboratorPayload {
  return {
    ...collaborator,
    invitedAt:
      collaborator.invitedAt instanceof Date
        ? collaborator.invitedAt.toISOString()
        : new Date(collaborator.invitedAt).toISOString(),
    acceptedAt: collaborator.acceptedAt
      ? collaborator.acceptedAt instanceof Date
        ? collaborator.acceptedAt.toISOString()
        : new Date(collaborator.acceptedAt).toISOString()
      : null
  };
}

function toAppointmentPayload(appointment: Appointment): AppointmentPayload {
  const defaultTimeZone = getDefaultTimeZone();
  const startDate =
    appointment.startLocal instanceof Date ? appointment.startLocal : new Date(appointment.startLocal);
  const endDate = appointment.endLocal instanceof Date ? appointment.endLocal : new Date(appointment.endLocal);
  const startZoned = formatDateTimeWithTimeZone(startDate, defaultTimeZone);
  const endZoned = formatDateTimeWithTimeZone(endDate, defaultTimeZone);

  return {
    ...appointment,
    startLocal: `${startZoned.local}${startZoned.offset}`,
    endLocal: `${endZoned.local}${endZoned.offset}`,
    createdAt:
      appointment.createdAt instanceof Date
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
    createdAt:
      bill.createdAt instanceof Date
        ? bill.createdAt.toISOString()
        : new Date(bill.createdAt).toISOString()
  };
}

export async function buildPlanPayload(user: User, days: number = 7): Promise<PlanPayload> {
  const recipients = await findRecipientsByUserId(user.id);
  let recipient = recipients[0];
  let collaboratorView = false;

  if (!recipient) {
    const collaboratorRecipient = await findRecipientForCollaborator(user.id);
    if (!collaboratorRecipient) {
      throw new NotFoundError('No recipient found');
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
    listCollaborators(recipient.id)
  ]);

  const collaboratorPayloads = collaborators.map(toCollaboratorPayload);
  const appointmentPayloads = appointments.map(toAppointmentPayload);
  const billPayloads = bills.map(toBillPayload);
  const sanitizedCollaborators = collaboratorPayloads.map((collaborator) => ({
    ...collaborator,
    inviteToken:
      !collaboratorView && collaborator.status === 'pending' ? collaborator.inviteToken : ''
  }));

  return {
    recipient: {
      id: recipient.id,
      displayName: recipient.displayName
    },
    dateRange: {
      start: startDate.toISOString(),
      end: endDate.toISOString()
    },
    appointments: appointmentPayloads,
    bills: billPayloads,
    planVersion,
    planUpdatedAt: planUpdatedAt ? new Date(planUpdatedAt).toISOString() : null,
    collaborators: sanitizedCollaborators.filter((collab) =>
      collaboratorView ? collab.status === 'accepted' : true
    )
  };
}

export async function resolvePlanVersionOwner(userId: number): Promise<number> {
  const recipients = await findRecipientsByUserId(userId);
  if (recipients.length === 0) {
    const collaboratorRecipient = await findRecipientForCollaborator(userId);
    if (!collaboratorRecipient) {
      throw new NotFoundError('No recipient found');
    }
    return collaboratorRecipient.userId;
  }
  return recipients[0].userId;
}

export async function getPlanVersionForUser(user: User): Promise<{ planVersion: number; planUpdatedAt: string | null }> {
  const ownerUserId = await resolvePlanVersionOwner(user.id);
  const { planVersion, planUpdatedAt } = await getPlanVersion(ownerUserId);
  return {
    planVersion,
    planUpdatedAt: planUpdatedAt ? new Date(planUpdatedAt).toISOString() : null
  };
}
