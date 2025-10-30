import { db } from './shared.js';

export type MedicationReminderEventKind = 'initial' | 'nag' | 'final' | 'follow_up';
export type MedicationReminderEventStatus = 'pending' | 'sent' | 'cancelled';

interface MedicationReminderEventRow {
  id: number;
  medication_id: number;
  dose_id: number | null;
  intake_id: number | null;
  recipient_id: number;
  event_kind: MedicationReminderEventKind;
  status: MedicationReminderEventStatus;
  scheduled_for: Date;
  sent_at: Date | null;
  attempt: number;
  context: Record<string, unknown> | null;
  created_at: Date;
  updated_at: Date;
}

export interface MedicationReminderEvent {
  id: number;
  medicationId: number;
  doseId: number | null;
  intakeId: number | null;
  recipientId: number;
  eventKind: MedicationReminderEventKind;
  status: MedicationReminderEventStatus;
  scheduledFor: Date;
  sentAt: Date | null;
  attempt: number;
  context: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface MedicationReminderEventWriteData {
  medicationId: number;
  doseId?: number | null;
  intakeId?: number | null;
  recipientId: number;
  eventKind: MedicationReminderEventKind;
  status?: MedicationReminderEventStatus;
  scheduledFor: Date;
  sentAt?: Date | null;
  attempt?: number;
  context?: Record<string, unknown> | null;
}

function toReminderEvent(row: MedicationReminderEventRow): MedicationReminderEvent {
  return {
    id: row.id,
    medicationId: row.medication_id,
    doseId: row.dose_id,
    intakeId: row.intake_id,
    recipientId: row.recipient_id,
    eventKind: row.event_kind,
    status: row.status,
    scheduledFor: row.scheduled_for,
    sentAt: row.sent_at,
    attempt: row.attempt,
    context: row.context,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export async function createMedicationReminderEvent(
  data: MedicationReminderEventWriteData
): Promise<MedicationReminderEvent> {
  const result = await db.query<MedicationReminderEventRow>(
    `INSERT INTO medication_reminder_events (
        medication_id,
        dose_id,
        intake_id,
        recipient_id,
        event_kind,
        status,
        scheduled_for,
        sent_at,
        attempt,
        context
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING
       id,
       medication_id,
       dose_id,
       intake_id,
       recipient_id,
       event_kind,
       status,
       scheduled_for,
       sent_at,
       attempt,
       context,
       created_at,
       updated_at`,
    [
      data.medicationId,
      data.doseId ?? null,
      data.intakeId ?? null,
      data.recipientId,
      data.eventKind,
      data.status ?? 'pending',
      data.scheduledFor,
      data.sentAt ?? null,
      data.attempt ?? 0,
      data.context ?? null
    ]
  );

  return toReminderEvent(result.rows[0]!);
}

export async function cancelPendingMedicationRemindersForIntake(intakeId: number): Promise<number> {
  const result = await db.query(
    `UPDATE medication_reminder_events
     SET status = 'cancelled', updated_at = NOW()
     WHERE intake_id = $1 AND status = 'pending'`,
    [intakeId]
  );
  return result.rowCount ?? 0;
}

export async function getPendingMedicationReminderForIntake(
  intakeId: number
): Promise<MedicationReminderEvent | null> {
  const result = await db.query<MedicationReminderEventRow>(
    `SELECT
        id,
        medication_id,
        dose_id,
        intake_id,
        recipient_id,
        event_kind,
        status,
        scheduled_for,
        sent_at,
        attempt,
        context,
        created_at,
        updated_at
     FROM medication_reminder_events
     WHERE intake_id = $1 AND status = 'pending'
     ORDER BY scheduled_for ASC
     LIMIT 1`,
    [intakeId]
  );

  return result.rows[0] ? toReminderEvent(result.rows[0]) : null;
}

