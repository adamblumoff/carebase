import type {
  Appointment,
  AppointmentCreateRequest,
  AppointmentUpdateRequest,
  PlanItemMutationSource
} from '@carebase/shared';
import { db } from './shared.js';
import { generateToken } from './shared.js';
import { ensureCollaboratorSchema } from './collaborators.js';
import {
  GOOGLE_SYNC_PROJECTION,
  ensureGoogleIntegrationSchema,
  hydrateAppointmentWithGoogleSync,
  projectGoogleSyncMetadata
} from './google.js';
import { touchPlanForItem } from './plan.js';
import { toAppointmentPayload } from '../../utils/planPayload.js';

interface AppointmentMutationOptions {
  queueGoogleSync?: boolean;
  mutationSource?: PlanItemMutationSource;
}
import { formatInstantWithZone, getDefaultTimeZone, toUtcDateFromLocalTime } from '../../utils/timezone.js';

function computeOffsetForZone(date: Date, timeZone: string): string {
  return formatInstantWithZone(date, timeZone).dateTime.slice(-6);
}

interface AppointmentRow {
  id: number;
  item_id: number;
  start_local: Date;
  end_local: Date;
  start_time_zone: string | null;
  end_time_zone: string | null;
  start_offset: string | null;
  end_offset: string | null;
  location: string | null;
  prep_note: string | null;
  summary: string;
  ics_token: string;
  assigned_collaborator_id: number | null;
  created_at: Date;
  google_sync_id?: number | null;
  google_calendar_id?: string | null;
  google_event_id?: string | null;
  google_etag?: string | null;
  google_last_synced_at?: Date | null;
  google_last_sync_direction?: string | null;
  google_local_hash?: string | null;
  google_remote_updated_at?: Date | null;
  google_sync_status?: string | null;
  google_last_error?: string | null;
}

export function appointmentRowToAppointment(row: AppointmentRow): Appointment {
  return {
    id: row.id,
    itemId: row.item_id,
    startLocal: row.start_local,
    endLocal: row.end_local,
    startTimeZone: row.start_time_zone,
    endTimeZone: row.end_time_zone,
    startOffset: row.start_offset,
    endOffset: row.end_offset,
    location: row.location,
    prepNote: row.prep_note,
    summary: row.summary,
    icsToken: row.ics_token,
    assignedCollaboratorId: row.assigned_collaborator_id ?? null,
    createdAt: row.created_at,
    googleSync: projectGoogleSyncMetadata(row)
  };
}

export async function createAppointment(
  itemId: number,
  data: AppointmentCreateRequest,
  options?: { mutationSource?: PlanItemMutationSource }
): Promise<Appointment> {
  const { startLocal, endLocal, startTimeZone, endTimeZone, location, prepNote, summary } = data;
  const icsToken = generateToken(32);
  const defaultTimeZone = getDefaultTimeZone();
  const resolvedStartTimeZone = startTimeZone ?? defaultTimeZone;
  const resolvedEndTimeZone = endTimeZone ?? resolvedStartTimeZone;
  const startInstant = toUtcDateFromLocalTime(startLocal, resolvedStartTimeZone);
  const endInstant = toUtcDateFromLocalTime(endLocal, resolvedEndTimeZone);
  const startOffset = computeOffsetForZone(startInstant, resolvedStartTimeZone);
  const endOffset = computeOffsetForZone(endInstant, resolvedEndTimeZone);

  const result = await db.query(
    `INSERT INTO appointments (item_id, start_local, end_local, start_time_zone, end_time_zone, start_offset, end_offset, location, prep_note, summary, ics_token)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
    [
      itemId,
      startInstant,
      endInstant,
      resolvedStartTimeZone,
      resolvedEndTimeZone,
      startOffset,
      endOffset,
      location,
      prepNote,
      summary,
      icsToken
    ]
  );
  const appointment = appointmentRowToAppointment(result.rows[0] as AppointmentRow);
  const source = options?.mutationSource ?? 'rest';

  await touchPlanForItem(appointment.itemId, {
    delta: {
      itemType: 'appointment',
      entityId: appointment.id,
      planItemId: appointment.itemId,
      action: 'created',
      source,
      data: {
        appointment: toAppointmentPayload(appointment)
      }
    }
  });
  return hydrateAppointmentWithGoogleSync(appointment);
}

export async function findAppointmentByIcsToken(icsToken: string): Promise<Appointment | undefined> {
  await ensureGoogleIntegrationSchema();
  const result = await db.query(
    `SELECT a.*, ${GOOGLE_SYNC_PROJECTION}
     FROM appointments a
     LEFT JOIN google_sync_links gsl ON gsl.item_id = a.item_id
     WHERE a.ics_token = $1`,
    [icsToken]
  );
  return result.rows[0] ? appointmentRowToAppointment(result.rows[0] as AppointmentRow) : undefined;
}

export async function getUpcomingAppointments(recipientId: number, startDate: Date, endDate: Date): Promise<Appointment[]> {
  await ensureGoogleIntegrationSchema();
  const result = await db.query(
    `SELECT a.*, ${GOOGLE_SYNC_PROJECTION}
     FROM appointments a
     JOIN items i ON a.item_id = i.id
     LEFT JOIN google_sync_links gsl ON gsl.item_id = a.item_id
     WHERE i.recipient_id = $1
       AND a.start_local >= $2
       AND a.start_local < $3
     ORDER BY a.start_local ASC`,
    [recipientId, startDate, endDate]
  );
  return result.rows.map((row) => appointmentRowToAppointment(row as AppointmentRow));
}

export async function updateAppointment(
  id: number,
  userId: number,
  data: AppointmentUpdateRequest,
  options?: AppointmentMutationOptions
): Promise<Appointment> {
  await ensureCollaboratorSchema();
  const {
    startLocal,
    endLocal,
    startTimeZone,
    endTimeZone,
    location,
    prepNote,
    summary,
    assignedCollaboratorId
  } = data;
  if (startLocal === undefined || endLocal === undefined) {
    throw new Error('startLocal and endLocal are required');
  }
  const startZone = startTimeZone ?? getDefaultTimeZone();
  const endZone = endTimeZone ?? startZone;
  const startInstant = toUtcDateFromLocalTime(startLocal, startZone);
  const endInstant = toUtcDateFromLocalTime(endLocal, endZone);
  const startOffset = computeOffsetForZone(startInstant, startZone);
  const endOffset = computeOffsetForZone(endInstant, endZone);
  const result = await db.query(
    `UPDATE appointments AS a
     SET start_local = $1,
         end_local = $2,
         start_time_zone = $3,
         end_time_zone = $4,
         start_offset = $5,
         end_offset = $6,
         location = $7,
         prep_note = $8,
         summary = $9,
         assigned_collaborator_id = $10
     FROM items i
     JOIN recipients r ON i.recipient_id = r.id
     WHERE a.id = $11
       AND a.item_id = i.id
       AND r.user_id = $12
     RETURNING a.*`,
    [
      startInstant,
      endInstant,
      startZone ?? null,
      endZone ?? null,
      startOffset,
      endOffset,
      location,
      prepNote,
      summary,
      assignedCollaboratorId ?? null,
      id,
      userId
    ]
  );
  if (result.rows.length === 0) {
    throw new Error('Appointment not found');
  }
  const appointment = appointmentRowToAppointment(result.rows[0] as AppointmentRow);
  const source = options?.mutationSource ?? 'rest';

  await touchPlanForItem(appointment.itemId, {
    queueGoogleSync: options?.queueGoogleSync !== false,
    delta: {
      itemType: 'appointment',
      entityId: appointment.id,
      planItemId: appointment.itemId,
      action: 'updated',
      source,
      data: {
        appointment: toAppointmentPayload(appointment)
      }
    }
  });
  return hydrateAppointmentWithGoogleSync(appointment);
}

export async function updateAppointmentForRecipient(
  id: number,
  recipientId: number,
  data: AppointmentUpdateRequest,
  options?: AppointmentMutationOptions
): Promise<Appointment> {
  await ensureCollaboratorSchema();
  const {
    startLocal,
    endLocal,
    startTimeZone,
    endTimeZone,
    location,
    prepNote,
    summary,
    assignedCollaboratorId
  } = data;
  if (startLocal === undefined || endLocal === undefined) {
    throw new Error('startLocal and endLocal are required');
  }
  const startZone = startTimeZone ?? getDefaultTimeZone();
  const endZone = endTimeZone ?? startZone;
  const startInstant = toUtcDateFromLocalTime(startLocal, startZone);
  const endInstant = toUtcDateFromLocalTime(endLocal, endZone);
  const startOffset = computeOffsetForZone(startInstant, startZone);
  const endOffset = computeOffsetForZone(endInstant, endZone);
  const result = await db.query(
    `UPDATE appointments AS a
     SET start_local = $1,
         end_local = $2,
         start_time_zone = $3,
         end_time_zone = $4,
         start_offset = $5,
         end_offset = $6,
         location = $7,
         prep_note = $8,
         summary = $9,
         assigned_collaborator_id = $10
     FROM items i
     WHERE a.id = $11
       AND a.item_id = i.id
       AND i.recipient_id = $12
     RETURNING a.*`,
    [
      startInstant,
      endInstant,
      startZone ?? null,
      endZone ?? null,
      startOffset,
      endOffset,
      location,
      prepNote,
      summary,
      assignedCollaboratorId ?? null,
      id,
      recipientId
    ]
  );
  if (result.rows.length === 0) {
    throw new Error('Appointment not found');
  }
  const appointment = appointmentRowToAppointment(result.rows[0] as AppointmentRow);
  const source = options?.mutationSource ?? 'collaborator';

  await touchPlanForItem(appointment.itemId, {
    queueGoogleSync: options?.queueGoogleSync !== false,
    delta: {
      itemType: 'appointment',
      entityId: appointment.id,
      planItemId: appointment.itemId,
      action: 'updated',
      source,
      data: {
        appointment: toAppointmentPayload(appointment)
      }
    }
  });
  return hydrateAppointmentWithGoogleSync(appointment);
}

export async function getAppointmentById(id: number, userId: number): Promise<Appointment | undefined> {
  await ensureGoogleIntegrationSchema();
  const result = await db.query(
    `SELECT a.*, ${GOOGLE_SYNC_PROJECTION}
     FROM appointments a
     JOIN items i ON a.item_id = i.id
     JOIN recipients r ON i.recipient_id = r.id
     LEFT JOIN google_sync_links gsl ON gsl.item_id = a.item_id
     WHERE a.id = $1 AND r.user_id = $2`,
    [id, userId]
  );
  return result.rows[0] ? appointmentRowToAppointment(result.rows[0] as AppointmentRow) : undefined;
}

export async function getAppointmentByIdForRecipient(id: number, recipientId: number): Promise<Appointment | undefined> {
  await ensureGoogleIntegrationSchema();
  const result = await db.query(
    `SELECT a.*, ${GOOGLE_SYNC_PROJECTION}
     FROM appointments a
     JOIN items i ON a.item_id = i.id
     LEFT JOIN google_sync_links gsl ON gsl.item_id = a.item_id
     WHERE a.id = $1 AND i.recipient_id = $2`,
    [id, recipientId]
  );
  return result.rows[0] ? appointmentRowToAppointment(result.rows[0] as AppointmentRow) : undefined;
}

export async function getAppointmentByItemId(itemId: number): Promise<Appointment | undefined> {
  await ensureGoogleIntegrationSchema();
  const result = await db.query(
    `SELECT a.*, ${GOOGLE_SYNC_PROJECTION}
     FROM appointments a
     LEFT JOIN google_sync_links gsl ON gsl.item_id = a.item_id
     WHERE a.item_id = $1
     LIMIT 1`,
    [itemId]
  );
  return result.rows[0] ? appointmentRowToAppointment(result.rows[0] as AppointmentRow) : undefined;
}

export async function deleteAppointment(
  id: number,
  userId: number,
  options?: { mutationSource?: PlanItemMutationSource }
): Promise<void> {
  const result = await db.query(
    `DELETE FROM appointments a
     USING items i
     JOIN recipients r ON i.recipient_id = r.id
     WHERE a.id = $1
       AND a.item_id = i.id
       AND r.user_id = $2
     RETURNING a.item_id, a.id`,
    [id, userId]
  );
  if (result.rowCount === 0) {
    throw new Error('Appointment not found');
  }
  const source = options?.mutationSource ?? 'rest';

  await touchPlanForItem(result.rows[0].item_id as number, {
    delta: {
      itemType: 'appointment',
      entityId: id,
      planItemId: result.rows[0].item_id as number,
      action: 'deleted',
      source
    }
  });
}
