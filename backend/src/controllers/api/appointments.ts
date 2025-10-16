import type { Request, Response } from 'express';
import {
  getAppointmentById,
  getAppointmentByIdForRecipient,
  updateAppointment,
  updateAppointmentForRecipient,
  deleteAppointment,
  findCollaboratorForRecipient,
  resolveRecipientContextForUser,
  markGoogleSyncPending,
} from '../../db/queries.js';
import type { AppointmentUpdateRequest, User } from '@carebase/shared';

function formatTimestampForDb(date: Date): string {
  const pad = (value: number) => value.toString().padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export async function getAppointment(req: Request, res: Response): Promise<void> {
  try {
    const user = req.user as User | undefined;
    if (!user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const { id } = req.params;
    const context = await resolveRecipientContextForUser(user);
    if (!context) {
      res.status(404).json({ error: 'No recipient found' });
      return;
    }

    const appointmentId = Number.parseInt(id, 10);
    const appointment =
      context.role === 'owner'
        ? await getAppointmentById(appointmentId, user.id)
        : await getAppointmentByIdForRecipient(appointmentId, context.recipient.id);

    if (!appointment) {
      res.status(404).json({ error: 'Appointment not found' });
      return;
    }

    res.json(appointment);
  } catch (error) {
    console.error('Get appointment error:', error);
    res.status(500).json({ error: 'Failed to fetch appointment' });
  }
}

export async function patchAppointment(req: Request, res: Response): Promise<void> {
  try {
    const user = req.user as User | undefined;
    if (!user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const { id } = req.params;
    const context = await resolveRecipientContextForUser(user);
    if (!context) {
      res.status(404).json({ error: 'No recipient found' });
      return;
    }

    const appointmentId = Number.parseInt(id, 10);

    if (context.role === 'owner') {
      const existing = await getAppointmentById(appointmentId, user.id);
      if (!existing) {
        res.status(404).json({ error: 'Appointment not found' });
        return;
      }

      const {
        summary,
        startLocal,
        endLocal,
        location,
        prepNote,
        assignedCollaboratorId,
      } = req.body as AppointmentUpdateRequest & { assignedCollaboratorId?: number | null };

      const updates: AppointmentUpdateRequest = {};
      if (summary !== undefined) updates.summary = summary;
      if (startLocal !== undefined) updates.startLocal = startLocal;
      if (endLocal !== undefined) updates.endLocal = endLocal;
      if (location !== undefined) updates.location = location;
      if (prepNote !== undefined) updates.prepNote = prepNote;

      let nextAssignedCollaboratorId = existing.assignedCollaboratorId;
      if (assignedCollaboratorId !== undefined) {
        if (assignedCollaboratorId === null || assignedCollaboratorId === '') {
          nextAssignedCollaboratorId = null;
        } else {
          const collaboratorId = Number.parseInt(String(assignedCollaboratorId), 10);
          if (Number.isNaN(collaboratorId)) {
            res.status(400).json({ error: 'Invalid collaborator id' });
            return;
          }
          const collaborator = await findCollaboratorForRecipient(context.recipient.id, collaboratorId);
          if (!collaborator) {
            res.status(404).json({ error: 'Collaborator not found' });
            return;
          }
          nextAssignedCollaboratorId = collaborator.id;
        }
      }

      const updated = await updateAppointment(appointmentId, user.id, {
        summary: updates.summary ?? existing.summary,
        startLocal: updates.startLocal ?? formatTimestampForDb(existing.startLocal),
        endLocal: updates.endLocal ?? formatTimestampForDb(existing.endLocal),
        location: updates.location ?? existing.location ?? undefined,
        prepNote: updates.prepNote ?? existing.prepNote ?? undefined,
        assignedCollaboratorId: nextAssignedCollaboratorId ?? null,
      });

      await markGoogleSyncPending(updated.itemId);
      res.json(updated);
      return;
    }

    const existing = await getAppointmentByIdForRecipient(appointmentId, context.recipient.id);
    if (!existing) {
      res.status(404).json({ error: 'Appointment not found' });
      return;
    }

    const { prepNote } = req.body as AppointmentUpdateRequest;
    if (prepNote === undefined) {
      res.status(403).json({ error: 'Contributors can only update prep notes' });
      return;
    }

    const updated = await updateAppointmentForRecipient(appointmentId, context.recipient.id, {
      summary: existing.summary,
      startLocal: formatTimestampForDb(existing.startLocal),
      endLocal: formatTimestampForDb(existing.endLocal),
      location: existing.location ?? undefined,
      prepNote: typeof prepNote === 'string' ? prepNote : existing.prepNote ?? undefined,
      assignedCollaboratorId: existing.assignedCollaboratorId ?? null,
    });

    await markGoogleSyncPending(updated.itemId);
    res.json(updated);
  } catch (error) {
    if (error instanceof Error && error.message === 'Appointment not found') {
      res.status(404).json({ error: 'Appointment not found' });
      return;
    }
    console.error('Update appointment error:', error);
    res.status(500).json({ error: 'Failed to update appointment' });
  }
}

export async function removeAppointment(req: Request, res: Response): Promise<void> {
  try {
    const user = req.user as User | undefined;
    if (!user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const { id } = req.params;
    const context = await resolveRecipientContextForUser(user);
    if (!context) {
      res.status(404).json({ error: 'No recipient found' });
      return;
    }

    if (context.role !== 'owner') {
      res.status(403).json({ error: 'Only the owner can delete appointments' });
      return;
    }

    await deleteAppointment(Number.parseInt(id, 10), user.id);

    res.json({ success: true });
  } catch (error) {
    if (error instanceof Error && error.message === 'Appointment not found') {
      res.status(404).json({ error: 'Appointment not found' });
      return;
    }
    console.error('Delete appointment error:', error);
    res.status(500).json({ error: 'Failed to delete appointment' });
  }
}
