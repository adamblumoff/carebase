import type { PlanPayload, User } from '@carebase/shared';
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
import { toAppointmentPayload, toBillPayload, toCollaboratorPayload } from '../utils/planPayload.js';

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
