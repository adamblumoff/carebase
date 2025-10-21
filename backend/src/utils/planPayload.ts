import type {
  Appointment,
  AppointmentPayload,
  Bill,
  BillPayload,
  Collaborator,
  CollaboratorPayload
} from '@carebase/shared';
import { formatDateTimeWithTimeZone, getDefaultTimeZone } from './timezone.js';

export function toCollaboratorPayload(collaborator: Collaborator): CollaboratorPayload {
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

export function toAppointmentPayload(appointment: Appointment): AppointmentPayload {
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

export function toBillPayload(bill: Bill): BillPayload {
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
