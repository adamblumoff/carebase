import type {
  Medication,
  MedicationDose,
  MedicationIntake,
  MedicationIntakeStatus,
  MedicationRefillProjection
} from '@carebase/shared';
import { db } from './shared.js';

interface MedicationRow {
  id: number;
  recipient_id: number;
  owner_id: number;
  name: string;
  strength_value: string | number | null;
  strength_unit: string | null;
  form: string | null;
  instructions: string | null;
  notes: string | null;
  prescribing_provider: string | null;
  start_date: Date | null;
  end_date: Date | null;
  quantity_on_hand: number | null;
  refill_threshold: number | null;
  preferred_pharmacy: string | null;
  created_at: Date;
  updated_at: Date;
  archived_at: Date | null;
}

interface MedicationDoseRow {
  id: number;
  medication_id: number;
  label: string | null;
  time_of_day: string;
  timezone: string;
  reminder_window_minutes: number;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

interface MedicationIntakeRow {
  id: number;
  medication_id: number;
  dose_id: number | null;
  scheduled_for: Date;
  acknowledged_at: Date | null;
  status: MedicationIntakeStatus;
  actor_user_id: number | null;
  occurrence_date: Date;
  override_count: number;
  created_at: Date;
  updated_at: Date;
}

interface MedicationOccurrenceRow {
  id: number;
  medication_id: number;
  dose_id: number | null;
  occurrence_date: Date;
  status: MedicationIntakeStatus;
  acknowledged_at: Date | null;
  actor_user_id: number | null;
  override_count: number;
}

interface MedicationIntakeEventRow {
  id: number;
  intake_id: number;
  medication_id: number;
  dose_id: number | null;
  event_type: 'taken' | 'skipped' | 'undo' | 'override';
  occurred_at: Date;
  actor_user_id: number | null;
}

interface MedicationRefillProjectionRow {
  medication_id: number;
  expected_run_out_on: Date | null;
  calculated_at: Date;
}

export interface MedicationWriteData {
  name: string;
  strengthValue?: number | null;
  strengthUnit?: string | null;
  form?: string | null;
  instructions?: string | null;
  notes?: string | null;
  prescribingProvider?: string | null;
  startDate?: Date | null;
  endDate?: Date | null;
  quantityOnHand?: number | null;
  refillThreshold?: number | null;
  preferredPharmacy?: string | null;
}

export interface MedicationDoseWriteData {
  label?: string | null;
  timeOfDay: string;
  timezone: string;
  reminderWindowMinutes?: number;
  isActive?: boolean;
}

export interface MedicationDoseUpdateData {
  label?: string | null;
  timeOfDay?: string;
  timezone?: string;
  reminderWindowMinutes?: number;
  isActive?: boolean;
}

export interface MedicationIntakeWriteData {
  doseId?: number | null;
  scheduledFor: Date;
  acknowledgedAt?: Date | null;
  status: MedicationIntakeStatus;
  actorUserId?: number | null;
  occurrenceDate?: Date;
  overrideCount?: number;
}

export interface MedicationIntakeUpdateData {
  acknowledgedAt?: Date | null;
  status?: MedicationIntakeStatus;
  actorUserId?: number | null;
  overrideCount?: number;
}

function normalizeOptionalText(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function normalizeNumber(value: number | null | undefined): number | null {
  if (value == null) return null;
  return Number.isFinite(value) ? Number(value) : null;
}

function normalizeRequiredText(value: string | null | undefined, field: string): string {
  const normalized = normalizeOptionalText(value);
  if (!normalized) {
    throw new Error(`${field} is required`);
  }
  return normalized;
}

function toMedication(row: MedicationRow): Medication {
  return {
    id: row.id,
    recipientId: row.recipient_id,
    ownerId: row.owner_id,
    name: row.name,
    strengthValue: row.strength_value == null ? null : Number(row.strength_value),
    strengthUnit: row.strength_unit,
    form: row.form,
    instructions: row.instructions,
    notes: row.notes,
    prescribingProvider: row.prescribing_provider,
    startDate: row.start_date,
    endDate: row.end_date,
    quantityOnHand: row.quantity_on_hand,
    refillThreshold: row.refill_threshold,
    preferredPharmacy: row.preferred_pharmacy,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at
  };
}

export function medicationRowToMedication(row: MedicationRow): Medication {
  return toMedication(row);
}

function toDose(row: MedicationDoseRow): MedicationDose {
  return {
    id: row.id,
    medicationId: row.medication_id,
    label: row.label,
    timeOfDay: row.time_of_day,
    timezone: row.timezone,
    reminderWindowMinutes: row.reminder_window_minutes,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function medicationDoseRowToMedicationDose(row: MedicationDoseRow): MedicationDose {
  return toDose(row);
}

function toIntake(row: MedicationIntakeRow): MedicationIntake {
  return {
    id: row.id,
    medicationId: row.medication_id,
    doseId: row.dose_id,
    scheduledFor: row.scheduled_for,
    acknowledgedAt: row.acknowledged_at,
    status: row.status,
    actorUserId: row.actor_user_id,
    occurrenceDate: row.occurrence_date,
    overrideCount: row.override_count ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function medicationIntakeRowToMedicationIntake(row: MedicationIntakeRow): MedicationIntake {
  return toIntake(row);
}

function toOccurrenceSummary(row: MedicationOccurrenceRow): MedicationOccurrenceSummary {
  return {
    intakeId: row.id,
    medicationId: row.medication_id,
    doseId: row.dose_id,
    occurrenceDate: row.occurrence_date,
    status: row.status,
    acknowledgedAt: row.acknowledged_at,
    acknowledgedByUserId: row.actor_user_id,
    overrideCount: row.override_count
  };
}

function toIntakeEvent(row: MedicationIntakeEventRow): MedicationIntakeEvent {
  return {
    id: row.id,
    intakeId: row.intake_id,
    medicationId: row.medication_id,
    doseId: row.dose_id,
    eventType: row.event_type,
    occurredAt: row.occurred_at,
    actorUserId: row.actor_user_id
  };
}

function toProjection(row: MedicationRefillProjectionRow): MedicationRefillProjection {
  return {
    medicationId: row.medication_id,
    expectedRunOutOn: row.expected_run_out_on,
    calculatedAt: row.calculated_at
  };
}

export function medicationProjectionRowToProjection(row: MedicationRefillProjectionRow): MedicationRefillProjection {
  return toProjection(row);
}

const MEDICATION_FIELD_ORDER: Array<keyof MedicationWriteData> = [
  'name',
  'strengthValue',
  'strengthUnit',
  'form',
  'instructions',
  'notes',
  'prescribingProvider',
  'startDate',
  'endDate',
  'quantityOnHand',
  'refillThreshold',
  'preferredPharmacy'
];

const MEDICATION_COLUMN_MAP: Record<keyof MedicationWriteData, keyof MedicationRow> = {
  name: 'name',
  strengthValue: 'strength_value',
  strengthUnit: 'strength_unit',
  form: 'form',
  instructions: 'instructions',
  notes: 'notes',
  prescribingProvider: 'prescribing_provider',
  startDate: 'start_date',
  endDate: 'end_date',
  quantityOnHand: 'quantity_on_hand',
  refillThreshold: 'refill_threshold',
  preferredPharmacy: 'preferred_pharmacy'
};

function transformMedicationField(
  key: keyof MedicationWriteData,
  value: MedicationWriteData[keyof MedicationWriteData] | null | undefined
): unknown {
  switch (key) {
    case 'name':
      return normalizeRequiredText(value as string | null | undefined, 'Medication name');
    case 'strengthValue':
      return normalizeNumber(value as number | null | undefined);
    case 'strengthUnit':
    case 'form':
    case 'instructions':
    case 'notes':
    case 'prescribingProvider':
    case 'preferredPharmacy':
      return normalizeOptionalText(value as string | null | undefined);
    case 'startDate':
    case 'endDate':
      return value ?? null;
    case 'quantityOnHand':
    case 'refillThreshold':
      return normalizeNumber(value as number | null | undefined);
    default:
      return value ?? null;
  }
}

function buildMedicationInsert(data: MedicationWriteData) {
  const columns: string[] = [];
  const values: unknown[] = [];

  for (const key of MEDICATION_FIELD_ORDER) {
    const column = MEDICATION_COLUMN_MAP[key] as string;
    const value = transformMedicationField(key, data[key]);
    columns.push(column);
    values.push(value);
  }

  return { columns, values };
}

function buildMedicationUpdate(data: Partial<MedicationWriteData>) {
  const sets: string[] = [];
  const values: unknown[] = [];

  for (const key of MEDICATION_FIELD_ORDER) {
    if (data[key] === undefined) continue;
    const column = MEDICATION_COLUMN_MAP[key] as string;
    const value = transformMedicationField(key, data[key] ?? null);
    sets.push(`${column} = $${sets.length + 1}`);
    values.push(value);
  }

  return { sets, values };
}

export async function createMedication(
  recipientId: number,
  ownerId: number,
  data: MedicationWriteData
): Promise<Medication> {
  const { columns, values } = buildMedicationInsert(data);
  const placeholders = columns.map((_, index) => `$${index + 3}`);
  const result = await db.query<MedicationRow>(
    `INSERT INTO medications (recipient_id, owner_id, ${columns.join(', ')})
     VALUES ($1, $2, ${placeholders.join(', ')})
     RETURNING *`,
    [recipientId, ownerId, ...values]
  );
  return toMedication(result.rows[0]!);
}

export async function updateMedication(
  id: number,
  recipientId: number,
  ownerId: number,
  data: Partial<MedicationWriteData>
): Promise<Medication | null> {
  const { sets, values } = buildMedicationUpdate(data);

  if (sets.length === 0) {
    const existing = await db.query<MedicationRow>(
      `SELECT * FROM medications WHERE id = $1 AND recipient_id = $2 AND owner_id = $3`,
      [id, recipientId, ownerId]
    );
    return existing.rows[0] ? toMedication(existing.rows[0]) : null;
  }

  const params = [...values, id, recipientId, ownerId];

  const result = await db.query<MedicationRow>(
    `UPDATE medications
     SET ${sets.join(', ')}, updated_at = NOW()
     WHERE id = $${params.length - 2}
       AND recipient_id = $${params.length - 1}
       AND owner_id = $${params.length}
     RETURNING *`,
    params
  );

  return result.rows[0] ? toMedication(result.rows[0]) : null;
}

export async function archiveMedication(
  id: number,
  recipientId: number,
  ownerId: number
): Promise<Medication | null> {
  const result = await db.query<MedicationRow>(
    `UPDATE medications
     SET archived_at = NOW(), updated_at = NOW()
     WHERE id = $1 AND recipient_id = $2 AND owner_id = $3 AND archived_at IS NULL
     RETURNING *`,
    [id, recipientId, ownerId]
  );
  return result.rows[0] ? toMedication(result.rows[0]) : null;
}

export async function unarchiveMedication(
  id: number,
  recipientId: number,
  ownerId: number
): Promise<Medication | null> {
  const result = await db.query<MedicationRow>(
    `UPDATE medications
     SET archived_at = NULL, updated_at = NOW()
     WHERE id = $1 AND recipient_id = $2 AND owner_id = $3 AND archived_at IS NOT NULL
     RETURNING *`,
    [id, recipientId, ownerId]
  );
  return result.rows[0] ? toMedication(result.rows[0]) : null;
}

export async function deleteMedication(id: number, recipientId: number, ownerId: number): Promise<Medication | null> {
  const result = await db.query<MedicationRow>(
    `DELETE FROM medications
     WHERE id = $1 AND recipient_id = $2 AND owner_id = $3
     RETURNING *`,
    [id, recipientId, ownerId]
  );
  return result.rows[0] ? toMedication(result.rows[0]) : null;
}

export async function getMedicationById(id: number): Promise<Medication | null> {
  const result = await db.query<MedicationRow>(
    `SELECT * FROM medications WHERE id = $1`,
    [id]
  );
  return result.rows[0] ? toMedication(result.rows[0]) : null;
}

export async function getMedicationForRecipient(id: number, recipientId: number): Promise<Medication | null> {
  const result = await db.query<MedicationRow>(
    `SELECT * FROM medications WHERE id = $1 AND recipient_id = $2`,
    [id, recipientId]
  );
  return result.rows[0] ? toMedication(result.rows[0]) : null;
}

export async function listMedicationsForRecipient(
  recipientId: number,
  options: { includeArchived?: boolean } = {}
): Promise<Medication[]> {
  const conditions = ['recipient_id = $1'];
  if (!options.includeArchived) {
    conditions.push('archived_at IS NULL');
  }
  const result = await db.query<MedicationRow>(
    `SELECT * FROM medications
     WHERE ${conditions.join(' AND ')}
     ORDER BY created_at ASC`,
    [recipientId]
  );
  return result.rows.map((row) => toMedication(row));
}

interface MedicationHeader {
  id: number;
  recipientId: number;
  ownerId: number;
}

export async function listActiveMedications(): Promise<MedicationHeader[]> {
  const result = await db.query<MedicationRow>(
    `SELECT id, recipient_id, owner_id
       FROM medications
      WHERE archived_at IS NULL`
  );
  return result.rows.map((row) => ({
    id: row.id,
    recipientId: row.recipient_id,
    ownerId: row.owner_id
  }));
}

export async function createMedicationDose(
  medicationId: number,
  data: MedicationDoseWriteData
): Promise<MedicationDose> {
  const result = await db.query<MedicationDoseRow>(
    `INSERT INTO medication_doses (medication_id, label, time_of_day, timezone, reminder_window_minutes, is_active)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      medicationId,
      normalizeOptionalText(data.label ?? null),
      data.timeOfDay,
      data.timezone,
      data.reminderWindowMinutes ?? 120,
      data.isActive ?? true
    ]
  );
  return toDose(result.rows[0]!);
}

export async function updateMedicationDose(
  doseId: number,
  medicationId: number,
  data: MedicationDoseUpdateData
): Promise<MedicationDose | null> {
  const updates: string[] = [];
  const params: unknown[] = [];

  if (data.label !== undefined) {
    updates.push(`label = $${updates.length + 1}`);
    params.push(normalizeOptionalText(data.label ?? null));
  }
  if (data.timeOfDay !== undefined) {
    updates.push(`time_of_day = $${updates.length + 1}`);
    params.push(data.timeOfDay);
  }
  if (data.timezone !== undefined) {
    updates.push(`timezone = $${updates.length + 1}`);
    params.push(data.timezone);
  }
  if (data.reminderWindowMinutes !== undefined) {
    updates.push(`reminder_window_minutes = $${updates.length + 1}`);
    params.push(data.reminderWindowMinutes);
  }
  if (data.isActive !== undefined) {
    updates.push(`is_active = $${updates.length + 1}`);
    params.push(data.isActive);
  }

  if (updates.length === 0) {
    const existing = await db.query<MedicationDoseRow>(
      `SELECT * FROM medication_doses WHERE id = $1 AND medication_id = $2`,
      [doseId, medicationId]
    );
    return existing.rows[0] ? toDose(existing.rows[0]) : null;
  }

  params.push(doseId, medicationId);

  const result = await db.query<MedicationDoseRow>(
    `UPDATE medication_doses
     SET ${updates.join(', ')}, updated_at = NOW()
     WHERE id = $${params.length - 1} AND medication_id = $${params.length}
     RETURNING *`,
    params
  );
  return result.rows[0] ? toDose(result.rows[0]) : null;
}

export async function getMedicationDoseById(
  doseId: number,
  medicationId: number
): Promise<MedicationDose | null> {
  const result = await db.query<MedicationDoseRow>(
    `SELECT *
     FROM medication_doses
     WHERE id = $1 AND medication_id = $2`,
    [doseId, medicationId]
  );
  return result.rows[0] ? toDose(result.rows[0]) : null;
}

export async function deleteMedicationDose(doseId: number, medicationId: number): Promise<boolean> {
  const result = await db.query(
    `DELETE FROM medication_doses WHERE id = $1 AND medication_id = $2`,
    [doseId, medicationId]
  );
  return result.rowCount > 0;
}

export async function listMedicationDoses(medicationId: number): Promise<MedicationDose[]> {
  const result = await db.query<MedicationDoseRow>(
    `SELECT * FROM medication_doses WHERE medication_id = $1 ORDER BY time_of_day ASC`,
    [medicationId]
  );
  return result.rows.map((row) => toDose(row));
}

export async function createMedicationIntake(
  medicationId: number,
  data: MedicationIntakeWriteData
): Promise<MedicationIntake> {
  const result = await db.query<MedicationIntakeRow>(
    `INSERT INTO medication_intakes (
        medication_id,
        dose_id,
        scheduled_for,
        acknowledged_at,
        status,
        actor_user_id,
        occurrence_date,
        override_count
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      medicationId,
      data.doseId ?? null,
      data.scheduledFor,
      data.acknowledgedAt ?? null,
      data.status,
      data.actorUserId ?? null,
      (data.occurrenceDate ?? data.scheduledFor),
      data.overrideCount ?? 0
    ]
  );
  return toIntake(result.rows[0]!);
}

export async function updateMedicationIntake(
  intakeId: number,
  medicationId: number,
  data: MedicationIntakeUpdateData
): Promise<MedicationIntake | null> {
  const updates: string[] = [];
  const params: unknown[] = [];

  if (data.acknowledgedAt !== undefined) {
    updates.push(`acknowledged_at = $${updates.length + 1}`);
    params.push(data.acknowledgedAt);
  }
  if (data.status !== undefined) {
    updates.push(`status = $${updates.length + 1}`);
    params.push(data.status);
  }
  if (data.actorUserId !== undefined) {
    updates.push(`actor_user_id = $${updates.length + 1}`);
    params.push(data.actorUserId);
  }
  if (data.overrideCount !== undefined) {
    updates.push(`override_count = $${updates.length + 1}`);
    params.push(data.overrideCount);
  }

  if (updates.length === 0) {
    const existing = await db.query<MedicationIntakeRow>(
      `SELECT * FROM medication_intakes WHERE id = $1 AND medication_id = $2`,
      [intakeId, medicationId]
    );
    return existing.rows[0] ? toIntake(existing.rows[0]) : null;
  }

  params.push(intakeId, medicationId);

  const result = await db.query<MedicationIntakeRow>(
    `UPDATE medication_intakes
     SET ${updates.join(', ')}, updated_at = NOW()
     WHERE id = $${params.length - 1} AND medication_id = $${params.length}
     RETURNING *`,
    params
  );
  return result.rows[0] ? toIntake(result.rows[0]) : null;
}

export async function listMedicationIntakes(
  medicationId: number,
  options: { since?: Date; until?: Date; statuses?: MedicationIntakeStatus[]; limit?: number } = {}
): Promise<MedicationIntake[]> {
  const conditions = ['medication_id = $1'];
  const params: unknown[] = [medicationId];

  if (options.since) {
    conditions.push(`scheduled_for >= $${params.length + 1}`);
    params.push(options.since);
  }
  if (options.until) {
    conditions.push(`scheduled_for < $${params.length + 1}`);
    params.push(options.until);
  }
  if (options.statuses && options.statuses.length > 0) {
    conditions.push(`status = ANY($${params.length + 1})`);
    params.push(options.statuses);
  }

  const limitSql = options.limit ? `LIMIT ${options.limit}` : '';

  const result = await db.query<MedicationIntakeRow>(
    `SELECT *
     FROM medication_intakes
     WHERE ${conditions.join(' AND ')}
     ORDER BY scheduled_for DESC
     ${limitSql}`,
    params
  );
  return result.rows.map((row) => toIntake(row));
}

export async function listMedicationOccurrences(
  medicationId: number,
  options: { since?: Date; until?: Date } = {}
): Promise<MedicationOccurrenceSummary[]> {
  const conditions = ['medication_id = $1'];
  const params: unknown[] = [medicationId];

  if (options.since) {
    conditions.push(`occurrence_date >= $${params.length + 1}`);
    params.push(options.since);
  }

  if (options.until) {
    conditions.push(`occurrence_date <= $${params.length + 1}`);
    params.push(options.until);
  }

  const sql = `SELECT id, medication_id, dose_id, occurrence_date, status, acknowledged_at, actor_user_id, override_count
               FROM medication_intakes
               WHERE ${conditions.join(' AND ')}
               ORDER BY occurrence_date DESC, id DESC`;

  const result = await db.query<MedicationOccurrenceRow>(sql, params);
  return result.rows.map((row) => toOccurrenceSummary(row));
}

export async function listMedicationIntakeEvents(intakeIds: number[]): Promise<MedicationIntakeEvent[]> {
  if (intakeIds.length === 0) {
    return [];
  }

  const result = await db.query<MedicationIntakeEventRow>(
    `SELECT id, intake_id, medication_id, dose_id, event_type, occurred_at, actor_user_id
       FROM medication_intake_events
       WHERE intake_id = ANY($1::int[])
       ORDER BY occurred_at ASC, id ASC`,
    [intakeIds]
  );

  return result.rows.map((row) => toIntakeEvent(row));
}

export async function insertMedicationIntakeEvent(
  intakeId: number,
  medicationId: number,
  doseId: number | null,
  eventType: 'taken' | 'skipped' | 'undo' | 'override',
  actorUserId: number | null
): Promise<MedicationIntakeEvent> {
  const result = await db.query<MedicationIntakeEventRow>(
    `INSERT INTO medication_intake_events (intake_id, medication_id, dose_id, event_type, actor_user_id)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, intake_id, medication_id, dose_id, event_type, occurred_at, actor_user_id`,
    [intakeId, medicationId, doseId, eventType, actorUserId]
  );

  return toIntakeEvent(result.rows[0]!);
}

export async function getMedicationIntake(intakeId: number, medicationId: number): Promise<MedicationIntake | null> {
  const result = await db.query<MedicationIntakeRow>(
    `SELECT *
     FROM medication_intakes
     WHERE id = $1 AND medication_id = $2`,
    [intakeId, medicationId]
  );
  return result.rows[0] ? toIntake(result.rows[0]) : null;
}

export async function countMedicationIntakesByOccurrence(
  medicationId: number,
  doseId: number | null,
  occurrenceDate: Date
): Promise<number> {
  if (doseId == null) {
    const result = await db.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count
         FROM medication_intakes
        WHERE medication_id = $1
          AND dose_id IS NULL
          AND occurrence_date = $2`,
      [medicationId, occurrenceDate]
    );
    return result.rows[0]?.count ?? 0;
  }

  const result = await db.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count
       FROM medication_intakes
      WHERE medication_id = $1
        AND dose_id = $2
        AND occurrence_date = $3`,
    [medicationId, doseId, occurrenceDate]
  );
  return result.rows[0]?.count ?? 0;
}

export async function deleteMedicationIntake(intakeId: number, medicationId: number): Promise<MedicationIntake | null> {
  const result = await db.query<MedicationIntakeRow>(
    `DELETE FROM medication_intakes
     WHERE id = $1 AND medication_id = $2
     RETURNING *`,
    [intakeId, medicationId]
  );
  return result.rows[0] ? toIntake(result.rows[0]) : null;
}

export async function upsertMedicationRefillProjection(
  medicationId: number,
  expectedRunOutOn: Date | null,
  calculatedAt: Date = new Date()
): Promise<MedicationRefillProjection> {
  const result = await db.query<MedicationRefillProjectionRow>(
    `INSERT INTO medication_refill_forecasts (medication_id, expected_run_out_on, calculated_at)
     VALUES ($1, $2, $3)
     ON CONFLICT (medication_id)
     DO UPDATE SET expected_run_out_on = EXCLUDED.expected_run_out_on,
                   calculated_at = EXCLUDED.calculated_at
     RETURNING *`,
    [medicationId, expectedRunOutOn, calculatedAt]
  );
  return toProjection(result.rows[0]!);
}

export async function getMedicationRefillProjection(medicationId: number): Promise<MedicationRefillProjection | null> {
  const result = await db.query<MedicationRefillProjectionRow>(
    `SELECT * FROM medication_refill_forecasts WHERE medication_id = $1`,
    [medicationId]
  );
  return result.rows[0] ? toProjection(result.rows[0]) : null;
}

export async function deleteMedicationRefillProjection(medicationId: number): Promise<boolean> {
  const result = await db.query(
    `DELETE FROM medication_refill_forecasts WHERE medication_id = $1`,
    [medicationId]
  );
  return result.rowCount > 0;
}
