import type { Request, Response } from 'express';
import type { User } from '@carebase/shared';
import {
  deleteAppointmentAsOwner,
  fetchAppointmentForUser,
  getAppointmentContext,
  updateAppointmentAsCollaborator,
  updateAppointmentAsOwner
} from '../../services/appointmentService.js';
import { appointmentContributorUpdateSchema, appointmentIdParamsSchema, appointmentOwnerUpdateSchema } from '../../validators/appointments.js';
import { validateBody, validateParams } from '../../utils/validation.js';
import { route } from '../../utils/httpHandler.js';
import { UnauthorizedError } from '../../utils/errors.js';

export const getAppointment = route(async (req: Request, res: Response) => {
  const user = req.user as User | undefined;
  if (!user) {
    throw new UnauthorizedError();
  }

  const { id } = validateParams(req, appointmentIdParamsSchema);
  const appointment = await fetchAppointmentForUser(user, id);
  res.json(appointment);
});

export const patchAppointment = route(async (req: Request, res: Response) => {
  const user = req.user as User | undefined;
  if (!user) {
    throw new UnauthorizedError();
  }

  const { id } = validateParams(req, appointmentIdParamsSchema);
  const context = await getAppointmentContext(user);

  if (context.role === 'owner') {
    const body = validateBody(req, appointmentOwnerUpdateSchema);
    const updated = await updateAppointmentAsOwner(user, id, body);
    res.json(updated);
    return;
  }

  const body = validateBody(req, appointmentContributorUpdateSchema);
  const updated = await updateAppointmentAsCollaborator(user, id, body.prepNote);
  res.json(updated);
});

export const removeAppointment = route(async (req: Request, res: Response) => {
  const user = req.user as User | undefined;
  if (!user) {
    throw new UnauthorizedError();
  }

  const { id } = validateParams(req, appointmentIdParamsSchema);

  await deleteAppointmentAsOwner(user, id);
  res.json({ success: true });
});
