/**
 * Mobile API: Appointment CRUD endpoints
 */
import express, { Request, Response } from 'express';
import {
  getAppointmentById,
  updateAppointment,
  deleteAppointment
} from '../../db/queries.js';
import type { AppointmentUpdateRequest, User } from '@carebase/shared';

const router = express.Router();

function formatTimestampForDb(date: Date): string {
  const pad = (value: number) => value.toString().padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(
    date.getMinutes()
  )}:${pad(date.getSeconds())}`;
}

/**
 * GET /api/appointments/:id
 * Get a specific appointment
 */
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const user = req.user as User | undefined;
    if (!user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { id } = req.params;
    const appointment = await getAppointmentById(parseInt(id), user.id);

    if (!appointment) {
      return res.status(404).json({ error: 'Appointment not found' });
    }

    res.json(appointment);
  } catch (error) {
    console.error('Get appointment error:', error);
    res.status(500).json({ error: 'Failed to fetch appointment' });
  }
});

/**
 * PATCH /api/appointments/:id
 * Update an appointment
 */
router.patch('/:id', async (req: Request, res: Response) => {
  try {
    const user = req.user as User | undefined;
    if (!user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { id } = req.params;
    const { summary, startLocal, endLocal, location, prepNote } = req.body;

    const existing = await getAppointmentById(parseInt(id), user.id);
    if (!existing) {
      return res.status(404).json({ error: 'Appointment not found' });
    }

    const updateData: AppointmentUpdateRequest = {
      summary: summary ?? existing.summary,
      startLocal: startLocal ?? formatTimestampForDb(existing.startLocal),
      endLocal: endLocal ?? formatTimestampForDb(existing.endLocal),
      location: location !== undefined ? location : existing.location ?? undefined,
      prepNote: prepNote !== undefined ? prepNote : existing.prepNote ?? undefined,
    };

    const updated = await updateAppointment(parseInt(id), user.id, updateData);

    res.json(updated);
  } catch (error) {
    if (error instanceof Error && error.message === 'Appointment not found') {
      return res.status(404).json({ error: 'Appointment not found' });
    }
    console.error('Update appointment error:', error);
    res.status(500).json({ error: 'Failed to update appointment' });
  }
});

/**
 * DELETE /api/appointments/:id
 * Delete an appointment
 */
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const user = req.user as User | undefined;
    if (!user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { id } = req.params;
    await deleteAppointment(parseInt(id), user.id);

    res.json({ success: true });
  } catch (error) {
    if (error instanceof Error && error.message === 'Appointment not found') {
      return res.status(404).json({ error: 'Appointment not found' });
    }
    console.error('Delete appointment error:', error);
    res.status(500).json({ error: 'Failed to delete appointment' });
  }
});

export default router;
