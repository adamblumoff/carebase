import type { Appointment, AppointmentUpdateRequest, User } from '@carebase/shared';
import {
  getAppointmentById,
  getAppointmentByIdForRecipient,
  updateAppointment,
  updateAppointmentForRecipient,
  deleteAppointment,
  findCollaboratorForRecipient,
  resolveRecipientContextForUser,
  markGoogleSyncPending
} from '../db/queries.js';
import { formatForPayload } from '../utils/dateFormatting.js';
import { ForbiddenError, NotFoundError } from '../utils/errors.js';

interface AppointmentContext {
  recipientId: number;
  role: 'owner' | 'collaborator';
}

async function resolveContext(user: User): Promise<AppointmentContext> {
  const context = await resolveRecipientContextForUser(user.id);
  if (!context || !context.recipient) {
    throw new NotFoundError('No recipient found');
  }

  if (!context.collaborator) {
    return { recipientId: context.recipient.id, role: 'owner' };
  }
  return { recipientId: context.recipient.id, role: 'collaborator' };
}

export async function fetchAppointmentForUser(user: User, appointmentId: number): Promise<Appointment> {
  const { recipientId, role } = await resolveContext(user);

  const appointment =
    role === 'owner'
      ? await getAppointmentById(appointmentId, user.id)
      : await getAppointmentByIdForRecipient(appointmentId, recipientId);

  if (!appointment) {
    throw new NotFoundError('Appointment not found');
  }

  return appointment;
}

function normalizeDate(value: string | Date): Date {
  return value instanceof Date ? value : new Date(value);
}

export async function updateAppointmentAsOwner(
  user: User,
  appointmentId: number,
  updates: AppointmentUpdateRequest & { assignedCollaboratorId?: number | null | '' }
): Promise<Appointment> {
  const appointment = await getAppointmentById(appointmentId, user.id);
  if (!appointment) {
    throw new NotFoundError('Appointment not found');
  }

  const context = await resolveContext(user);

  let nextAssignedCollaboratorId = appointment.assignedCollaboratorId;
  if (updates.assignedCollaboratorId !== undefined) {
    if (updates.assignedCollaboratorId === null || updates.assignedCollaboratorId === '') {
      nextAssignedCollaboratorId = null;
    } else {
      const collaboratorId = Number(updates.assignedCollaboratorId);
      if (!Number.isFinite(collaboratorId) || collaboratorId <= 0) {
        throw new ForbiddenError('Invalid collaborator id');
      }
      const collaborator = await findCollaboratorForRecipient(
        context.recipientId,
        collaboratorId
      );
      if (!collaborator) {
        throw new NotFoundError('Collaborator not found');
      }
      nextAssignedCollaboratorId = collaborator.id;
    }
  }

  const updated = await updateAppointment(appointmentId, user.id, {
    summary: updates.summary ?? appointment.summary,
    startLocal: updates.startLocal ?? formatForPayload(normalizeDate(appointment.startLocal)),
    endLocal: updates.endLocal ?? formatForPayload(normalizeDate(appointment.endLocal)),
    location: updates.location ?? appointment.location ?? undefined,
    prepNote: updates.prepNote ?? appointment.prepNote ?? undefined,
    assignedCollaboratorId: nextAssignedCollaboratorId ?? null
  });

  await markGoogleSyncPending(updated.itemId);
  return updated;
}

export async function updateAppointmentAsCollaborator(
  user: User,
  appointmentId: number,
  prepNote: string
): Promise<Appointment> {
  const context = await resolveContext(user);
  if (context.role !== 'collaborator') {
    throw new ForbiddenError('Only collaborators can use this endpoint');
  }

  const existing = await getAppointmentByIdForRecipient(appointmentId, context.recipientId);
  if (!existing) {
    throw new NotFoundError('Appointment not found');
  }

  const updated = await updateAppointmentForRecipient(appointmentId, context.recipientId, {
    summary: existing.summary,
    startLocal: formatForPayload(normalizeDate(existing.startLocal)),
    endLocal: formatForPayload(normalizeDate(existing.endLocal)),
    location: existing.location ?? undefined,
    prepNote,
    assignedCollaboratorId: existing.assignedCollaboratorId ?? null
  });

  await markGoogleSyncPending(updated.itemId);
  return updated;
}

export async function deleteAppointmentAsOwner(user: User, appointmentId: number): Promise<void> {
  const context = await resolveContext(user);
  if (context.role !== 'owner') {
    throw new ForbiddenError('Only the owner can delete appointments');
  }

  await deleteAppointment(appointmentId, user.id);
}

export async function getAppointmentContext(user: User): Promise<AppointmentContext> {
  return resolveContext(user);
}
