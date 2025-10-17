import type {
  Appointment,
  AppointmentCreateRequest,
  AppointmentUpdateRequest
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

interface AppointmentRow {
  id: number;
  item_id: number;
  start_local: Date;
  end_local: Date;
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
    location: row.location,
    prepNote: row.prep_note,
    summary: row.summary,
    icsToken: row.ics_token,
    assignedCollaboratorId: row.assigned_collaborator_id ?? null,
    createdAt: row.created_at,
    googleSync: projectGoogleSyncMetadata(row)
  };
}

export async function createAppointment(itemId: number, data: AppointmentCreateRequest): Promise<Appointment> {
  const { startLocal, endLocal, location, prepNote, summary } = data;
  const icsToken = generateToken(32);

  const result = await db.query(
    `INSERT INTO appointments (item_id, start_local, end_local, location, prep_note, summary, ics_token)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [itemId, startLocal, endLocal, location, prepNote, summary, icsToken]
  );
  const appointment = appointmentRowToAppointment(result.rows[0] as AppointmentRow);
  await touchPlanForItem(appointment.itemId);
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
  options?: { queueGoogleSync?: boolean }
): Promise<Appointment> {
  await ensureCollaboratorSchema();
  const { startLocal, endLocal, location, prepNote, summary, assignedCollaboratorId } = data;
  const result = await db.query(
    `UPDATE appointments AS a
     SET start_local = $1, end_local = $2, location = $3, prep_note = $4, summary = $5,
         assigned_collaborator_id = $6
     FROM items i
     JOIN recipients r ON i.recipient_id = r.id
     WHERE a.id = $7
       AND a.item_id = i.id
       AND r.user_id = $8
     RETURNING a.*`,
    [startLocal, endLocal, location, prepNote, summary, assignedCollaboratorId ?? null, id, userId]
  );
  if (result.rows.length === 0) {
    throw new Error('Appointment not found');
  }
  const appointment = appointmentRowToAppointment(result.rows[0] as AppointmentRow);
  await touchPlanForItem(appointment.itemId, { queueGoogleSync: options?.queueGoogleSync !== false });
  return hydrateAppointmentWithGoogleSync(appointment);
}

export async function updateAppointmentForRecipient(
  id: number,
  recipientId: number,
  data: AppointmentUpdateRequest,
  options?: { queueGoogleSync?: boolean }
): Promise<Appointment> {
  await ensureCollaboratorSchema();
  const { startLocal, endLocal, location, prepNote, summary, assignedCollaboratorId } = data;
  const result = await db.query(
    `UPDATE appointments AS a
     SET start_local = $1, end_local = $2, location = $3, prep_note = $4, summary = $5,
         assigned_collaborator_id = $6
     FROM items i
     WHERE a.id = $7
       AND a.item_id = i.id
       AND i.recipient_id = $8
     RETURNING a.*`,
    [startLocal, endLocal, location, prepNote, summary, assignedCollaboratorId ?? null, id, recipientId]
  );
  if (result.rows.length === 0) {
    throw new Error('Appointment not found');
  }
  const appointment = appointmentRowToAppointment(result.rows[0] as AppointmentRow);
  await touchPlanForItem(appointment.itemId, { queueGoogleSync: options?.queueGoogleSync !== false });
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

export async function deleteAppointment(id: number, userId: number): Promise<void> {
  const result = await db.query(
    `DELETE FROM appointments a
     USING items i
     JOIN recipients r ON i.recipient_id = r.id
     WHERE a.id = $1
       AND a.item_id = i.id
       AND r.user_id = $2
     RETURNING a.item_id`,
    [id, userId]
  );
  if (result.rowCount === 0) {
    throw new Error('Appointment not found');
  }
  await touchPlanForItem(result.rows[0].item_id as number);
}
