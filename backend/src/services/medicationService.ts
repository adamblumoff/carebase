import type {
  MedicationCreateRequest,
  MedicationDoseInput,
  MedicationDoseUpdateInput,
  MedicationIntakeRecordRequest,
  MedicationIntakeStatus,
  MedicationUpdateRequest,
  MedicationWithDetails,
  User
} from '@carebase/shared';
import {
  archiveMedication,
  createMedication,
  createMedicationDose,
  createMedicationIntake,
  deleteMedication,
  deleteMedicationDose,
  deleteMedicationRefillProjection,
  getMedicationForRecipient,
  getMedicationRefillProjection,
  listMedicationDoses,
  listMedicationIntakes,
  listMedicationsForRecipient,
  resolveRecipientContextForUser,
  touchPlanForUser,
  unarchiveMedication,
  updateMedication,
  updateMedicationDose,
  updateMedicationIntake,
  upsertMedicationRefillProjection
} from '../db/queries.js';
import type {
  MedicationDoseUpdateData,
  MedicationDoseWriteData,
  MedicationIntakeUpdateData,
  MedicationIntakeWriteData,
  MedicationWriteData
} from '../db/queries.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../utils/errors.js';

const DAY_IN_MS = 24 * 60 * 60 * 1000;
const DEFAULT_INTAKE_LOOKBACK_DAYS = 7;
const DEFAULT_INTAKE_LIMIT = 10;
const MAX_INTAKE_LIMIT = 50;

interface MedicationContext {
  recipientId: number;
  ownerId: number;
  role: 'owner' | 'collaborator';
}

interface MedicationListOptions {
  includeArchived?: boolean;
  intakeLimit?: number;
  intakeLookbackDays?: number;
  statuses?: MedicationIntakeStatus[];
}

interface MedicationDetailOptions extends MedicationListOptions {}

const ALLOWED_STATUSES: MedicationIntakeStatus[] = ['taken', 'skipped', 'expired'];

async function resolveContext(user: User): Promise<MedicationContext> {
  const context = await resolveRecipientContextForUser(user.id);
  if (!context.recipient) {
    throw new NotFoundError('No recipient found');
  }
  return {
    recipientId: context.recipient.id,
    ownerId: context.recipient.userId,
    role: context.collaborator ? 'collaborator' : 'owner'
  };
}

function ensureOwner(context: MedicationContext): void {
  if (context.role !== 'owner') {
    throw new ForbiddenError('Only the owner can modify medications');
  }
}

function clampIntakeLimit(limit?: number): number {
  if (!limit || Number.isNaN(limit) || limit <= 0) {
    return DEFAULT_INTAKE_LIMIT;
  }
  return Math.min(Math.floor(limit), MAX_INTAKE_LIMIT);
}

function normalizeStatuses(statuses?: MedicationIntakeStatus[]): MedicationIntakeStatus[] | undefined {
  if (!statuses) return undefined;
  const unique = Array.from(new Set(statuses));
  for (const status of unique) {
    if (!ALLOWED_STATUSES.includes(status)) {
      throw new ValidationError({ field: 'status', issue: 'unsupported' });
    }
  }
  return unique;
}

function parseOptionalDate(value: string | null | undefined, field: string): Date | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null || value === '') {
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new ValidationError({ field, issue: 'invalid_date' });
  }
  return parsed;
}

function parseOptionalDecimal(value: number | null | undefined, field: string): number | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (typeof value !== 'number' || Number.isNaN(value)) {
    throw new ValidationError({ field, issue: 'invalid_number' });
  }
  return value;
}

function parseOptionalInteger(value: number | null | undefined, field: string): number | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (!Number.isInteger(value) || value < 0) {
    throw new ValidationError({ field, issue: 'invalid_integer' });
  }
  return value;
}

function normalizeOptionalText(value: string | null | undefined): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function ensureCreateName(name: string | undefined): string {
  if (!name || !name.trim()) {
    throw new ValidationError({ field: 'name', issue: 'required' });
  }
  return name;
}

function mapCreatePayload(payload: MedicationCreateRequest): MedicationWriteData {
  return {
    name: ensureCreateName(payload.name),
    strengthValue: parseOptionalDecimal(payload.strengthValue ?? null, 'strengthValue') ?? null,
    strengthUnit: normalizeOptionalText(payload.strengthUnit ?? null) ?? null,
    form: normalizeOptionalText(payload.form ?? null) ?? null,
    instructions: normalizeOptionalText(payload.instructions ?? null) ?? null,
    notes: normalizeOptionalText(payload.notes ?? null) ?? null,
    prescribingProvider: normalizeOptionalText(payload.prescribingProvider ?? null) ?? null,
    startDate: parseOptionalDate(payload.startDate ?? null, 'startDate') ?? null,
    endDate: parseOptionalDate(payload.endDate ?? null, 'endDate') ?? null,
    quantityOnHand: parseOptionalInteger(payload.quantityOnHand ?? null, 'quantityOnHand') ?? null,
    refillThreshold: parseOptionalInteger(payload.refillThreshold ?? null, 'refillThreshold') ?? null,
    preferredPharmacy: normalizeOptionalText(payload.preferredPharmacy ?? null) ?? null
  };
}

function mapUpdatePayload(payload: MedicationUpdateRequest): Partial<MedicationWriteData> {
  const result: Partial<MedicationWriteData> = {};
  if (payload.name !== undefined) {
    result.name = ensureCreateName(payload.name);
  }
  if (payload.strengthValue !== undefined) {
    result.strengthValue = parseOptionalDecimal(payload.strengthValue, 'strengthValue');
  }
  if (payload.strengthUnit !== undefined) {
    result.strengthUnit = normalizeOptionalText(payload.strengthUnit);
  }
  if (payload.form !== undefined) {
    result.form = normalizeOptionalText(payload.form);
  }
  if (payload.instructions !== undefined) {
    result.instructions = normalizeOptionalText(payload.instructions);
  }
  if (payload.notes !== undefined) {
    result.notes = normalizeOptionalText(payload.notes);
  }
  if (payload.prescribingProvider !== undefined) {
    result.prescribingProvider = normalizeOptionalText(payload.prescribingProvider);
  }
  if (payload.startDate !== undefined) {
    result.startDate = parseOptionalDate(payload.startDate, 'startDate');
  }
  if (payload.endDate !== undefined) {
    result.endDate = parseOptionalDate(payload.endDate, 'endDate');
  }
  if (payload.quantityOnHand !== undefined) {
    result.quantityOnHand = parseOptionalInteger(payload.quantityOnHand, 'quantityOnHand');
  }
  if (payload.refillThreshold !== undefined) {
    result.refillThreshold = parseOptionalInteger(payload.refillThreshold, 'refillThreshold');
  }
  if (payload.preferredPharmacy !== undefined) {
    result.preferredPharmacy = normalizeOptionalText(payload.preferredPharmacy);
  }
  return result;
}

function normalizeTimeOfDay(value: string, field: string): string {
  const trimmed = value.trim();
  const hhmm = /^(\d{2}):(\d{2})(?::(\d{2}))?$/;
  const match = hhmm.exec(trimmed);
  if (!match) {
    throw new ValidationError({ field, issue: 'invalid_time' });
  }
  const [, hours, minutes, seconds] = match;
  const h = Number(hours);
  const m = Number(minutes);
  const s = seconds ? Number(seconds) : 0;
  if (h > 23 || m > 59 || s > 59) {
    throw new ValidationError({ field, issue: 'invalid_time' });
  }
  return `${hours}:${minutes}:${seconds ?? '00'}`;
}

function ensureTimezone(value: string | null | undefined, field: string): string {
  if (!value || !value.trim()) {
    throw new ValidationError({ field, issue: 'required' });
  }
  return value.trim();
}

function normalizeReminderWindow(value: number | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Number.isInteger(value) || value <= 0) {
    throw new ValidationError({ field: 'reminderWindowMinutes', issue: 'invalid_integer' });
  }
  return value;
}

function mapDoseInput(dose: MedicationDoseInput, index: number): MedicationDoseWriteData {
  return {
    label: normalizeOptionalText(dose.label ?? null) ?? null,
    timeOfDay: normalizeTimeOfDay(dose.timeOfDay, `doses[${index}].timeOfDay`),
    timezone: ensureTimezone(dose.timezone, `doses[${index}].timezone`),
    reminderWindowMinutes: normalizeReminderWindow(dose.reminderWindowMinutes) ?? 120,
    isActive: dose.isActive ?? true
  };
}

function mapDoseUpdateInput(dose: MedicationDoseUpdateInput): MedicationDoseUpdateData {
  const result: MedicationDoseUpdateData = {};
  if (dose.label !== undefined) {
    result.label = normalizeOptionalText(dose.label);
  }
  if (dose.timeOfDay !== undefined) {
    result.timeOfDay = normalizeTimeOfDay(dose.timeOfDay, 'dose.timeOfDay');
  }
  if (dose.timezone !== undefined) {
    result.timezone = ensureTimezone(dose.timezone, 'dose.timezone');
  }
  if (dose.reminderWindowMinutes !== undefined) {
    result.reminderWindowMinutes = normalizeReminderWindow(dose.reminderWindowMinutes);
  }
  if (dose.isActive !== undefined) {
    result.isActive = dose.isActive;
  }
  return result;
}

function buildIntakeWriteData(payload: MedicationIntakeRecordRequest, userId: number): MedicationIntakeWriteData {
  const status = payload.status;
  if (!ALLOWED_STATUSES.includes(status)) {
    throw new ValidationError({ field: 'status', issue: 'unsupported' });
  }
  const scheduledFor = parseOptionalDate(payload.scheduledFor, 'scheduledFor');
  if (!scheduledFor) {
    throw new ValidationError({ field: 'scheduledFor', issue: 'invalid_date' });
  }
  const doseId = payload.doseId ?? null;
  if (doseId !== null && (typeof doseId !== 'number' || !Number.isInteger(doseId) || doseId <= 0)) {
    throw new ValidationError({ field: 'doseId', issue: 'invalid_integer' });
  }
  return {
    doseId,
    scheduledFor,
    acknowledgedAt: status === 'expired' ? null : new Date(),
    status,
    actorUserId: userId
  };
}

function buildIntakeUpdateData(status: MedicationIntakeStatus, userId: number): MedicationIntakeUpdateData {
  if (!ALLOWED_STATUSES.includes(status)) {
    throw new ValidationError({ field: 'status', issue: 'unsupported' });
  }
  return {
    status,
    acknowledgedAt: status === 'expired' ? null : new Date(),
    actorUserId: userId
  };
}

function buildIntakeQueryOptions(options: MedicationListOptions | undefined) {
  const limit = clampIntakeLimit(options?.intakeLimit);
  const lookbackDays = options?.intakeLookbackDays && options.intakeLookbackDays > 0
    ? options.intakeLookbackDays
    : DEFAULT_INTAKE_LOOKBACK_DAYS;
  const since = new Date(Date.now() - lookbackDays * DAY_IN_MS);
  const statuses = normalizeStatuses(options?.statuses);
  return { limit, since, statuses };
}

async function hydrateMedication(
  medicationId: number,
  context: MedicationContext,
  options?: MedicationDetailOptions
): Promise<MedicationWithDetails> {
  const intakeOptions = buildIntakeQueryOptions(options);
  const [medication, doses, intakes, projection] = await Promise.all([
    getMedicationForRecipient(medicationId, context.recipientId),
    listMedicationDoses(medicationId),
    listMedicationIntakes(medicationId, {
      since: intakeOptions.since,
      limit: intakeOptions.limit,
      statuses: intakeOptions.statuses
    }),
    getMedicationRefillProjection(medicationId)
  ]);

  if (!medication) {
    throw new NotFoundError('Medication not found');
  }

  if (context.role === 'collaborator' && medication.archivedAt) {
    throw new NotFoundError('Medication not found');
  }

  return {
    ...medication,
    doses,
    upcomingIntakes: intakes,
    refillProjection: projection
  };
}

export async function listMedicationsForUser(
  user: User,
  options?: MedicationListOptions
): Promise<MedicationWithDetails[]> {
  const context = await resolveContext(user);
  const listOptions = buildIntakeQueryOptions(options);
  const includeArchived = context.role === 'owner' && options?.includeArchived === true;
  const medications = await listMedicationsForRecipient(context.recipientId, { includeArchived });

  const results: MedicationWithDetails[] = [];
  for (const medication of medications) {
    if (context.role === 'collaborator' && medication.archivedAt) {
      continue;
    }
    const [doses, intakes, projection] = await Promise.all([
      listMedicationDoses(medication.id),
      listMedicationIntakes(medication.id, {
        since: listOptions.since,
        limit: listOptions.limit,
        statuses: listOptions.statuses
      }),
      getMedicationRefillProjection(medication.id)
    ]);
    results.push({
      ...medication,
      doses,
      upcomingIntakes: intakes,
      refillProjection: projection
    });
  }
  return results;
}

export async function getMedicationForUser(
  user: User,
  medicationId: number,
  options?: MedicationDetailOptions
): Promise<MedicationWithDetails> {
  const context = await resolveContext(user);
  return hydrateMedication(medicationId, context, options);
}

export async function createMedicationForOwner(
  user: User,
  payload: MedicationCreateRequest
): Promise<MedicationWithDetails> {
  const context = await resolveContext(user);
  ensureOwner(context);
  if (payload.recipientId !== context.recipientId) {
    throw new ForbiddenError('Cannot create medication for another recipient');
  }

  const writeData = mapCreatePayload(payload);
  const medication = await createMedication(context.recipientId, context.ownerId, writeData);

  try {
    if (payload.doses && payload.doses.length > 0) {
      for (let index = 0; index < payload.doses.length; index += 1) {
        const doseInput = mapDoseInput(payload.doses[index]!, index);
        await createMedicationDose(medication.id, doseInput);
      }
    }
  } catch (error) {
    await deleteMedication(medication.id, context.ownerId);
    throw error;
  }

  await touchPlanForUser(context.ownerId);
  return hydrateMedication(medication.id, context);
}

export async function updateMedicationForOwner(
  user: User,
  medicationId: number,
  payload: MedicationUpdateRequest
): Promise<MedicationWithDetails> {
  const context = await resolveContext(user);
  ensureOwner(context);
  const updateData = mapUpdatePayload(payload);
  const updated = await updateMedication(medicationId, context.recipientId, context.ownerId, updateData);
  if (!updated) {
    throw new NotFoundError('Medication not found');
  }
  await touchPlanForUser(context.ownerId);
  return hydrateMedication(medicationId, context);
}

export async function archiveMedicationForOwner(user: User, medicationId: number): Promise<MedicationWithDetails> {
  const context = await resolveContext(user);
  ensureOwner(context);
  const archived = await archiveMedication(medicationId, context.recipientId, context.ownerId);
  if (!archived) {
    throw new NotFoundError('Medication not found');
  }
  await touchPlanForUser(context.ownerId);
  return hydrateMedication(medicationId, context);
}

export async function unarchiveMedicationForOwner(
  user: User,
  medicationId: number
): Promise<MedicationWithDetails> {
  const context = await resolveContext(user);
  ensureOwner(context);
  const restored = await unarchiveMedication(medicationId, context.recipientId, context.ownerId);
  if (!restored) {
    throw new NotFoundError('Medication not found');
  }
  await touchPlanForUser(context.ownerId);
  return hydrateMedication(medicationId, context);
}

export async function createMedicationDoseForOwner(
  user: User,
  medicationId: number,
  dose: MedicationDoseInput
): Promise<MedicationWithDetails> {
  const context = await resolveContext(user);
  ensureOwner(context);
  const medication = await getMedicationForRecipient(medicationId, context.recipientId);
  if (!medication) {
    throw new NotFoundError('Medication not found');
  }
  const doseInput = mapDoseInput(dose, 0);
  await createMedicationDose(medicationId, doseInput);
  await touchPlanForUser(context.ownerId);
  return hydrateMedication(medicationId, context);
}

export async function updateMedicationDoseForOwner(
  user: User,
  medicationId: number,
  doseId: number,
  dose: MedicationDoseUpdateInput
): Promise<MedicationWithDetails> {
  const context = await resolveContext(user);
  ensureOwner(context);
  const medication = await getMedicationForRecipient(medicationId, context.recipientId);
  if (!medication) {
    throw new NotFoundError('Medication not found');
  }
  const updateData = mapDoseUpdateInput(dose);
  const updated = await updateMedicationDose(doseId, medicationId, updateData);
  if (!updated) {
    throw new NotFoundError('Dose not found');
  }
  await touchPlanForUser(context.ownerId);
  return hydrateMedication(medicationId, context);
}

export async function deleteMedicationDoseForOwner(
  user: User,
  medicationId: number,
  doseId: number
): Promise<MedicationWithDetails> {
  const context = await resolveContext(user);
  ensureOwner(context);
  const medication = await getMedicationForRecipient(medicationId, context.recipientId);
  if (!medication) {
    throw new NotFoundError('Medication not found');
  }
  const removed = await deleteMedicationDose(doseId, medicationId);
  if (!removed) {
    throw new NotFoundError('Dose not found');
  }
  await touchPlanForUser(context.ownerId);
  return hydrateMedication(medicationId, context);
}

export async function recordMedicationIntake(
  user: User,
  medicationId: number,
  payload: MedicationIntakeRecordRequest
): Promise<MedicationWithDetails> {
  const context = await resolveContext(user);
  ensureOwner(context);
  const medication = await getMedicationForRecipient(medicationId, context.recipientId);
  if (!medication) {
    throw new NotFoundError('Medication not found');
  }
  const writeData = buildIntakeWriteData(payload, user.id);
  await createMedicationIntake(medicationId, writeData);
  await touchPlanForUser(context.ownerId);
  return hydrateMedication(medicationId, context);
}

export async function updateMedicationIntakeStatus(
  user: User,
  medicationId: number,
  intakeId: number,
  status: MedicationIntakeStatus
): Promise<MedicationWithDetails> {
  const context = await resolveContext(user);
  ensureOwner(context);
  const medication = await getMedicationForRecipient(medicationId, context.recipientId);
  if (!medication) {
    throw new NotFoundError('Medication not found');
  }
  const updateData = buildIntakeUpdateData(status, user.id);
  const updated = await updateMedicationIntake(intakeId, medicationId, updateData);
  if (!updated) {
    throw new NotFoundError('Intake not found');
  }
  await touchPlanForUser(context.ownerId);
  return hydrateMedication(medicationId, context);
}

export async function setMedicationRefillProjection(
  user: User,
  medicationId: number,
  expectedRunOutOn: string | null
): Promise<MedicationWithDetails> {
  const context = await resolveContext(user);
  ensureOwner(context);
  const medication = await getMedicationForRecipient(medicationId, context.recipientId);
  if (!medication) {
    throw new NotFoundError('Medication not found');
  }
  const parsedDate = expectedRunOutOn ? parseOptionalDate(expectedRunOutOn, 'expectedRunOutOn') : null;
  await upsertMedicationRefillProjection(medicationId, parsedDate ?? null);
  await touchPlanForUser(context.ownerId);
  return hydrateMedication(medicationId, context);
}

export async function clearMedicationRefillProjection(
  user: User,
  medicationId: number
): Promise<MedicationWithDetails> {
  const context = await resolveContext(user);
  ensureOwner(context);
  const medication = await getMedicationForRecipient(medicationId, context.recipientId);
  if (!medication) {
    throw new NotFoundError('Medication not found');
  }
  await deleteMedicationRefillProjection(medicationId);
  await touchPlanForUser(context.ownerId);
  return hydrateMedication(medicationId, context);
}
