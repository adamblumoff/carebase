import crypto from 'crypto';
import type { Appointment, Bill } from '@carebase/shared';
import {
  deleteGoogleSyncLink,
  getAppointmentByItemId,
  getBillByItemId,
  getItemOwnerUserId,
  markGoogleSyncSuccess,
  updateAppointment,
  updateBill
} from '../../db/queries.js';
import { formatDateTimeWithTimeZone, formatInstantWithZone } from '../../utils/timezone.js';
import { logWarn } from './logger.js';
import type { GoogleEventResource, GoogleSyncSummary } from './types.js';

const OFFSET_TIME_ZONE_FALLBACKS: Record<string, string> = {
  '+00:00': 'UTC',
  '-04:00': 'America/New_York',
  '-05:00': 'America/New_York',
  '-06:00': 'America/Chicago',
  '-07:00': 'America/Denver',
  '-08:00': 'America/Los_Angeles',
  '-09:00': 'America/Anchorage',
  '-10:00': 'Pacific/Honolulu',
  '+01:00': 'Europe/Paris',
  '+02:00': 'Europe/Athens',
  '+03:00': 'Europe/Moscow',
  '+05:30': 'Asia/Kolkata',
  '+08:00': 'Asia/Shanghai',
  '+09:00': 'Asia/Tokyo',
  '+10:00': 'Australia/Sydney'
};

function hashContent(parts: Array<string | number | null | undefined | Date>): string {
  const normalized = parts.map((value) => {
    if (value === null || value === undefined) return '';
    if (value instanceof Date) return value.toISOString();
    return String(value).trim();
  });
  return crypto.createHash('sha256').update(normalized.join('|')).digest('hex');
}

export function calculateAppointmentHash(appointment: Appointment): string {
  return hashContent([
    appointment.summary,
    appointment.startLocal,
    appointment.endLocal,
    appointment.startTimeZone,
    appointment.endTimeZone,
    appointment.startOffset,
    appointment.endOffset,
    appointment.location,
    appointment.prepNote,
    appointment.assignedCollaboratorId
  ]);
}

export function calculateBillHash(bill: Bill): string {
  return hashContent([
    bill.amount,
    bill.dueDate,
    bill.statementDate,
    bill.status,
    bill.payUrl,
    bill.taskKey
  ]);
}

function buildDateTimeForGoogle(date: Date, preferredTimeZone: string): { dateTime: string; timeZone: string } {
  try {
    return formatInstantWithZone(date, preferredTimeZone);
  } catch (error) {
    logWarn(
      'Failed to format appointment time with preferred timezone; falling back to UTC',
      error instanceof Error ? error.message : String(error)
    );
    return formatInstantWithZone(date, 'UTC');
  }
}

function formatDateOnly(date: Date): string {
  return new Date(date).toISOString().split('T')[0];
}

function extractEventTimeZone(
  eventDate: GoogleEventResource['start'] | GoogleEventResource['end'] | undefined,
  fallback?: string | null
): string | null {
  if (eventDate?.timeZone && eventDate.timeZone.trim().length > 0) {
    return eventDate.timeZone;
  }
  return fallback ?? null;
}

function extractOffsetFromDateTime(dateTime?: string): string | null {
  if (!dateTime) {
    return null;
  }
  const match = dateTime.match(/([+-]\d{2}:\d{2}|Z)$/);
  return match ? match[1] : null;
}

function inferTimeZoneFromOffset(offset: string | null, reference: Date, defaultTimeZone: string): string | null {
  if (!offset) {
    return null;
  }

  const normalized = offset === 'Z' ? '+00:00' : offset;

  try {
    if (formatInstantWithZone(reference, defaultTimeZone).dateTime.endsWith(normalized)) {
      return defaultTimeZone;
    }
  } catch {
    // ignore default timezone errors
  }

  const mapped = OFFSET_TIME_ZONE_FALLBACKS[normalized];
  if (mapped && mapped !== 'UTC') {
    return mapped;
  }

  const match = normalized.match(/^([+-])(\d{2}):(\d{2})$/);
  if (!match) {
    return mapped ?? null;
  }
  const [, sign, hoursRaw, minutesRaw] = match;
  const minutes = Number.parseInt(minutesRaw, 10);
  if (!Number.isFinite(minutes) || minutes !== 0) {
    return mapped ?? null;
  }
  const hours = Number.parseInt(hoursRaw, 10);
  if (!Number.isFinite(hours) || hours < 0 || hours > 14) {
    return mapped ?? null;
  }
  if (hours === 0) {
    return 'UTC';
  }
  const etcSign = sign === '+' ? '-' : '+';
  return mapped ?? `Etc/GMT${etcSign}${hours}`;
}

function parseEventDate(event: GoogleEventResource['start'] | undefined): Date | null {
  if (!event) {
    return null;
  }
  if (event.dateTime) {
    return new Date(event.dateTime);
  }
  if (event.date) {
    return new Date(`${event.date}T00:00:00.000Z`);
  }
  return null;
}

export function buildAppointmentEventPayload(
  appointment: Appointment,
  defaultTimeZone: string
): Record<string, unknown> {
  const descriptionParts: string[] = [];
  if (appointment.prepNote) {
    descriptionParts.push(appointment.prepNote);
  }

  const startPreferredTimeZone = appointment.startTimeZone ?? defaultTimeZone;
  const endPreferredTimeZone = appointment.endTimeZone ?? startPreferredTimeZone;
  const startDateTime = buildDateTimeForGoogle(appointment.startLocal, startPreferredTimeZone);
  const endDateTime = buildDateTimeForGoogle(appointment.endLocal, endPreferredTimeZone);

  return {
    summary: appointment.summary,
    description: descriptionParts.length > 0 ? descriptionParts.join('\n\n') : undefined,
    location: appointment.location ?? undefined,
    start: {
      dateTime: startDateTime.dateTime,
      timeZone: startDateTime.timeZone
    },
    end: {
      dateTime: endDateTime.dateTime,
      timeZone: endDateTime.timeZone
    },
    extendedProperties: {
      private: {
        carebaseItemId: String(appointment.itemId),
        carebaseType: 'appointment'
      }
    },
    source: {
      title: 'Carebase',
      url: process.env.CAREBASE_APP_BASE_URL || 'https://carebase.app'
    },
    conferenceDataVersion: 0
  };
}

export function buildBillEventPayload(bill: Bill): Record<string, unknown> {
  const dueDate = bill.dueDate ?? bill.statementDate ?? new Date();
  const dueDateStr = formatDateOnly(dueDate);
  const endDate = new Date(dueDate);
  endDate.setDate(endDate.getDate() + 1);

  const summaryParts: string[] = ['Bill'];
  if (bill.amount !== null) {
    summaryParts.push(`$${bill.amount.toFixed(2)}`);
  }
  if (bill.status === 'overdue') {
    summaryParts.push('(Overdue)');
  }

  const descriptionLines: string[] = [];
  if (bill.payUrl) {
    descriptionLines.push(`Pay online: ${bill.payUrl}`);
  }
  descriptionLines.push(`Status: ${bill.status}`);

  return {
    summary: summaryParts.join(' '),
    description: descriptionLines.join('\n'),
    start: {
      date: dueDateStr
    },
    end: {
      date: formatDateOnly(endDate)
    },
    extendedProperties: {
      private: {
        carebaseItemId: String(bill.itemId),
        carebaseType: 'bill'
      }
    },
    source: {
      title: 'Carebase',
      url: process.env.CAREBASE_APP_BASE_URL || 'https://carebase.app'
    }
  };
}

export async function applyGoogleAppointmentUpdate(
  calendarId: string,
  event: GoogleEventResource,
  summary: GoogleSyncSummary,
  defaultTimeZone: string,
  existingAppointment?: Appointment
): Promise<void> {
  const privateProps = event.extendedProperties?.private ?? {};
  const fallbackItemId = existingAppointment?.itemId;
  const itemIdCandidate = privateProps.carebaseItemId ? Number(privateProps.carebaseItemId) : fallbackItemId ?? NaN;
  if (!Number.isFinite(itemIdCandidate)) {
    return;
  }
  const itemId = Number(itemIdCandidate);

  if (event.status === 'cancelled') {
    await deleteGoogleSyncLink(itemId);
    summary.deleted += 1;
    return;
  }

  const appointment = existingAppointment ?? await getAppointmentByItemId(itemId);
  if (!appointment) {
    await deleteGoogleSyncLink(itemId);
    return;
  }

  const remoteUpdatedAt = event.updated ? new Date(event.updated) : null;
  const previousRemoteUpdatedAt = appointment.googleSync?.remoteUpdatedAt
    ? new Date(appointment.googleSync.remoteUpdatedAt)
    : null;
  if (
    remoteUpdatedAt &&
    previousRemoteUpdatedAt &&
    remoteUpdatedAt.getTime() <= previousRemoteUpdatedAt.getTime()
  ) {
    return;
  }

  const start = parseEventDate(event.start);
  const end = parseEventDate(event.end);
  if (!start || !end) {
    const message = 'Google event missing start/end time';
    summary.errors.push({ itemId, message });
    logWarn(message, {
      calendarId,
      eventId: event.id,
      itemId,
      userId: await getItemOwnerUserId(itemId)
    });
    return;
  }
  const startOffset = extractOffsetFromDateTime(event.start?.dateTime);
  const endOffset = extractOffsetFromDateTime(event.end?.dateTime);
  const fallbackStartZone =
    appointment.startTimeZone ??
    inferTimeZoneFromOffset(startOffset, start, defaultTimeZone) ??
    defaultTimeZone;
  const startTimeZone =
    extractEventTimeZone(event.start, fallbackStartZone) ?? fallbackStartZone;
  const fallbackEndZone =
    appointment.endTimeZone ??
    appointment.startTimeZone ??
    inferTimeZoneFromOffset(endOffset, end, startTimeZone) ??
    startTimeZone;
  const endTimeZone =
    extractEventTimeZone(event.end, fallbackEndZone) ?? fallbackEndZone;

  const startLocalStr = formatDateTimeWithTimeZone(start, startTimeZone).local;
  const endLocalStr = formatDateTimeWithTimeZone(end, endTimeZone).local;

  const ownerUserId = await getItemOwnerUserId(itemId);
  if (!ownerUserId) {
    return;
  }

  const updated = await updateAppointment(
    appointment.id,
    ownerUserId,
    {
      summary: event.summary ?? appointment.summary,
      startLocal: startLocalStr,
      endLocal: endLocalStr,
      startTimeZone,
      endTimeZone,
      location: event.location ?? appointment.location ?? undefined,
      prepNote: event.description ?? appointment.prepNote ?? undefined,
      assignedCollaboratorId: appointment.assignedCollaboratorId ?? null
    },
    { queueGoogleSync: false, mutationSource: 'google' }
  );

  const localHash = calculateAppointmentHash(updated);
  await markGoogleSyncSuccess(updated.itemId, {
    calendarId,
    eventId: event.id,
    etag: event.etag ?? null,
    lastSyncedAt: new Date(),
    lastSyncDirection: 'pull',
    localHash,
    remoteUpdatedAt: event.updated ? new Date(event.updated) : null
  });

  summary.pulled += 1;
}

export async function applyGoogleBillUpdate(
  calendarId: string,
  event: GoogleEventResource,
  summary: GoogleSyncSummary,
  existingBill?: Bill
): Promise<void> {
  const privateProps = event.extendedProperties?.private ?? {};
  const fallbackItemId = existingBill?.itemId;
  const itemIdCandidate = privateProps.carebaseItemId ? Number(privateProps.carebaseItemId) : fallbackItemId ?? NaN;
  if (!Number.isFinite(itemIdCandidate)) {
    return;
  }
  const itemId = Number(itemIdCandidate);

  if (event.status === 'cancelled') {
    await deleteGoogleSyncLink(itemId);
    summary.deleted += 1;
    return;
  }

  const bill = existingBill ?? await getBillByItemId(itemId);
  if (!bill) {
    await deleteGoogleSyncLink(itemId);
    return;
  }

  const remoteUpdatedAt = event.updated ? new Date(event.updated) : null;
  const previousRemoteUpdatedAt = bill.googleSync?.remoteUpdatedAt
    ? new Date(bill.googleSync.remoteUpdatedAt)
    : null;
  if (
    remoteUpdatedAt &&
    previousRemoteUpdatedAt &&
    remoteUpdatedAt.getTime() <= previousRemoteUpdatedAt.getTime()
  ) {
    return;
  }

  const start = parseEventDate(event.start);
  const ownerUserId = await getItemOwnerUserId(itemId);
  if (!ownerUserId) {
    return;
  }

  const nextDueDate = start ? formatDateOnly(start) : undefined;

  const updated = await updateBill(
    bill.id,
    ownerUserId,
    {
      statementDate: bill.statementDate ? formatDateOnly(bill.statementDate) : undefined,
      amount: bill.amount ?? undefined,
      dueDate: nextDueDate ?? (bill.dueDate ? formatDateOnly(bill.dueDate) : undefined),
      payUrl: bill.payUrl ?? undefined,
      status: bill.status,
      assignedCollaboratorId: bill.assignedCollaboratorId ?? null
    },
    { queueGoogleSync: false, mutationSource: 'google' }
  );

  const localHash = calculateBillHash(updated);
  await markGoogleSyncSuccess(updated.itemId, {
    calendarId,
    eventId: event.id,
    etag: event.etag ?? null,
    lastSyncedAt: new Date(),
    lastSyncDirection: 'pull',
    localHash,
    remoteUpdatedAt: event.updated ? new Date(event.updated) : null
  });

  summary.pulled += 1;
}
