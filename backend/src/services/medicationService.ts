import type {
  MedicationCreateRequest,
  MedicationDeleteResponse,
  MedicationDose,
  MedicationDoseInput,
  MedicationDoseOccurrence,
  MedicationDoseUpdateInput,
  MedicationIntake,
  MedicationIntakeDeleteResponse,
  MedicationIntakeEvent,
  MedicationIntakeRecordRequest,
  MedicationIntakeStatus,
  MedicationOccurrenceSummary,
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
  deleteMedicationIntake,
  deleteMedicationRefillProjection,
  getMedicationIntake,
  getMedicationForRecipient,
  getMedicationRefillProjection,
  insertMedicationIntakeEvent,
  listMedicationDoses,
  listMedicationIntakeEvents,
  listMedicationIntakes,
  listMedicationOccurrences,
  listMedicationsForRecipient,
  resolveRecipientContextForUser,
  touchPlanForUser,
  unarchiveMedication,
  updateMedication,
  updateMedicationDose,
  updateMedicationIntake,
  upsertMedicationRefillProjection,
  ensureOwnerCollaborator,
  createAuditLog,
  getMedicationDoseById,
  countMedicationIntakesByOccurrence,
  findMedicationIntakeByDoseAndDate
} from '../db/queries.js';
import type {
  MedicationDoseUpdateData,
  MedicationDoseWriteData,
  MedicationIntakeUpdateData,
  MedicationIntakeWriteData,
  MedicationWriteData
} from '../db/queries.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../utils/errors.js';
import {
  cancelMedicationRemindersForIntake,
  rescheduleMedicationIntakeReminder,
  scheduleMedicationIntakeReminder
} from './medicationReminderScheduler.js';
import { combineDateWithTimeZone, getDefaultTimeZone } from '../utils/timezone.js';
import {
  buildOccurrences,
  findOccurrenceForDose,
  toOccurrenceDate
} from './medicationOccurrenceUtils.js';

const DAY_IN_MS = 24 * 60 * 60 * 1000;
const DEFAULT_INTAKE_LOOKBACK_DAYS = 7;
const DEFAULT_INTAKE_LIMIT = 10;
const MAX_INTAKE_LIMIT = 50;
const DEFAULT_OCCURRENCE_LOOKBACK_DAYS = 7;

interface MedicationContext {
  recipientId: number;
  ownerUserId: number;
  ownerCollaboratorId: number | null;
  role: 'owner' | 'collaborator';
}

interface MedicationListOptions {
  includeArchived?: boolean;
  intakeLimit?: number;
  intakeLookbackDays?: number;
  statuses?: MedicationIntakeStatus[];
}

interface MedicationDetailOptions extends MedicationListOptions {}

const ALLOWED_STATUSES: MedicationIntakeStatus[] = ['pending', 'taken', 'skipped', 'expired'];
const OVERRIDE_WARNING_THRESHOLD = 1;

type IntakeEventType = 'taken' | 'skipped' | 'undo' | 'override';

function isSameOccurrenceDay(a: Date, b: Date): boolean {
  return toOccurrenceDate(a).getTime() === toOccurrenceDate(b).getTime();
}

function computeZoneOccurrenceDate(reference: Date, timeZone: string): Date {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  let year = reference.getUTCFullYear();
  let month = reference.getUTCMonth() + 1;
  let day = reference.getUTCDate();
  for (const part of formatter.formatToParts(reference)) {
    if (part.type === 'year') {
      year = Number.parseInt(part.value, 10);
    } else if (part.type === 'month') {
      month = Number.parseInt(part.value, 10);
    } else if (part.type === 'day') {
      day = Number.parseInt(part.value, 10);
    }
  }
  return new Date(Date.UTC(year, month - 1, day));
}

async function ensureTodayDoseOccurrences(
  medicationId: number,
  context: MedicationContext,
  doses: MedicationDose[],
  occurrenceSummaries: MedicationOccurrenceSummary[],
  intakes: MedicationIntake[]
): Promise<boolean> {
  const activeDoses = doses.filter((dose) => dose.isActive !== false && dose.id != null);
  if (activeDoses.length === 0) {
    return false;
  }

  const referenceNow = new Date();
  const defaultTimeZone = getDefaultTimeZone();
  const doseMap = new Map<number, MedicationDose>();
  activeDoses.forEach((dose) => {
    if (dose.id != null) {
      doseMap.set(dose.id, dose);
    }
  });

  const intakeById = new Map<number, MedicationIntake>();
  intakes.forEach((intake) => intakeById.set(intake.id, intake));

  const summariesByDose = new Map<number, MedicationOccurrenceSummary[]>();
  const unassignedSummaries: MedicationOccurrenceSummary[] = [];
  for (const summary of occurrenceSummaries) {
    if (summary.doseId != null && doseMap.has(summary.doseId)) {
      const list = summariesByDose.get(summary.doseId) ?? [];
      list.push(summary);
      summariesByDose.set(summary.doseId, list);
    } else {
      unassignedSummaries.push(summary);
    }
  }

  const zoneDayCache = new Map<string, Date>();
  const getZoneDay = (timeZone: string): Date => {
    const zone = timeZone && timeZone.trim().length > 0 ? timeZone : defaultTimeZone;
    let cached = zoneDayCache.get(zone);
    if (!cached) {
      cached = computeZoneOccurrenceDate(referenceNow, zone);
      zoneDayCache.set(zone, cached);
    }
    return cached;
  };

  const sortedDoses = [...activeDoses].sort((a, b) => a.timeOfDay.localeCompare(b.timeOfDay));
  const duplicates: MedicationOccurrenceSummary[] = [];
  const unusedUnassigned = new Set(unassignedSummaries);
  let changed = false;

  const ensureIntake = async (intakeId: number): Promise<MedicationIntake> => {
    const cached = intakeById.get(intakeId);
    if (cached) {
      return cached;
    }
    const fetched = await getMedicationIntake(intakeId, medicationId);
    if (!fetched) {
      throw new NotFoundError('Medication intake not found');
    }
    intakeById.set(fetched.id, fetched);
    intakes.push(fetched);
    return fetched;
  };

  for (const dose of sortedDoses) {
    const doseId = dose.id!;
    const timeZone = dose.timezone ?? defaultTimeZone;
    const zoneDay = getZoneDay(timeZone);
    const scheduledFor = combineDateWithTimeZone(zoneDay, dose.timeOfDay, timeZone);

    const candidates = summariesByDose.get(doseId) ?? [];
    let selected: MedicationOccurrenceSummary | null =
      candidates.find((summary) => isSameOccurrenceDay(summary.occurrenceDate, zoneDay)) ?? null;

    if (!selected) {
      selected =
        candidates.find((summary) => {
          const intake = intakeById.get(summary.intakeId);
          return intake?.status === 'pending';
        }) ?? null;
    }

    if (!selected && candidates.length > 0) {
      selected = candidates[0];
    }

    if (!selected) {
      const fallback = [...unusedUnassigned].find((summary) => intakeById.get(summary.intakeId)?.status === 'pending')
        ?? [...unusedUnassigned][0] ?? null;
      if (fallback) {
        unusedUnassigned.delete(fallback);
        let intake = await ensureIntake(fallback.intakeId);
        let updated = false;
        while (true) {
          try {
            await updateMedicationIntake(fallback.intakeId, medicationId, {
              doseId,
              scheduledFor,
              occurrenceDate: zoneDay
            });
            updated = true;
            break;
          } catch (error: any) {
            if (error?.code !== '23505') {
              throw error;
            }
            const resolution = await reconcileOccurrenceConflict(
              medicationId,
              doseId,
              zoneDay,
              intake,
              occurrenceSummaries,
              intakes
            );
            if (!resolution) {
              throw error;
            }
            intakeById.set(resolution.intake.id, resolution.intake);
            selected = resolution.summary;
            intake = resolution.intake;
            selected.doseId = doseId;
            selected.occurrenceDate = zoneDay;
            updated = true;
            break;
          }
        }
        if (!selected) {
          selected = fallback;
        }
        selected.doseId = doseId;
        selected.occurrenceDate = zoneDay;
        intake.doseId = doseId;
        intake.occurrenceDate = zoneDay;
        intake.scheduledFor = scheduledFor;
        if (updated) {
          changed = true;
        }
      }
    }

    if (!selected) {
      let created: MedicationIntake | null = null;
      let createdNew = false;
      try {
        created = await createMedicationIntake(medicationId, {
          doseId,
          scheduledFor,
          acknowledgedAt: null,
          status: 'pending',
          actorUserId: null,
          occurrenceDate: zoneDay,
          overrideCount: 0
        });
        createdNew = true;
      } catch (error: any) {
        if (error?.code === '23505') {
          created = await findMedicationIntakeByDoseAndDate(medicationId, doseId, zoneDay);
          if (!created) {
            continue;
          }
        } else {
          throw error;
        }
      }

      const summary: MedicationOccurrenceSummary = {
        intakeId: created.id,
        medicationId,
        doseId,
        occurrenceDate: created.occurrenceDate,
        status: created.status,
        acknowledgedAt: created.acknowledgedAt,
        acknowledgedByUserId: created.actorUserId,
        overrideCount: created.overrideCount ?? 0
      };
      occurrenceSummaries.push(summary);
      intakes.push(created);
      intakeById.set(created.id, created);
      selected = summary;
      summariesByDose.set(doseId, [...candidates, summary]);
      changed = true;

      if (createdNew) {
        await scheduleMedicationIntakeReminder({
          medicationId,
          recipientId: context.recipientId,
          intake: {
            id: created.id,
            scheduledFor: created.scheduledFor,
            occurrenceDate: created.occurrenceDate
          },
          dose: {
            id: doseId,
            timezone: timeZone,
            reminderWindowMinutes: dose.reminderWindowMinutes
          }
        });
      }
    } else {
      let intake = await ensureIntake(selected.intakeId);
      const diffMs = Math.abs(intake.scheduledFor.getTime() - scheduledFor.getTime());
      if (diffMs > 60 * 1000 || !isSameOccurrenceDay(selected.occurrenceDate, zoneDay)) {
        while (true) {
          try {
            const updated = await updateMedicationIntake(selected.intakeId, medicationId, {
              scheduledFor,
              occurrenceDate: zoneDay
            });
            if (updated) {
              intake.scheduledFor = updated.scheduledFor;
              intake.occurrenceDate = updated.occurrenceDate;
            } else {
              intake.scheduledFor = scheduledFor;
              intake.occurrenceDate = zoneDay;
            }
            selected.occurrenceDate = zoneDay;
            changed = true;
            break;
          } catch (error: any) {
            if (error?.code !== '23505') {
              throw error;
            }
            const resolution = await reconcileOccurrenceConflict(
              medicationId,
              doseId,
              zoneDay,
              intake,
              occurrenceSummaries,
              intakes
            );
            if (!resolution) {
              throw error;
            }
            selected = resolution.summary;
            intakeById.set(resolution.intake.id, resolution.intake);
            intake = resolution.intake;
            summariesByDose.set(doseId, (summariesByDose.get(doseId) ?? []).filter((item) => item.intakeId !== selected!.intakeId).concat(selected));
          }
        }
      }
      selected.doseId = doseId;
    }

    const remaining = (summariesByDose.get(doseId) ?? []).filter((summary) => summary !== selected);
    duplicates.push(...remaining);
    summariesByDose.set(doseId, [selected!]);
  }

  for (const duplicate of duplicates) {
    const intake = intakeById.get(duplicate.intakeId);
    if (!intake) {
      continue;
    }
    await cancelMedicationRemindersForIntake(intake.id);
    await deleteMedicationIntake(intake.id, medicationId);
    const summaryIndex = occurrenceSummaries.findIndex((summary) => summary.intakeId === intake.id);
    if (summaryIndex >= 0) {
      occurrenceSummaries.splice(summaryIndex, 1);
    }
    const intakeIndex = intakes.findIndex((item) => item.id === intake.id);
    if (intakeIndex >= 0) {
      intakes.splice(intakeIndex, 1);
    }
    intakeById.delete(intake.id);
    changed = true;
  }

  for (const leftover of unusedUnassigned) {
    const intake = intakeById.get(leftover.intakeId);
    if (!intake) {
      continue;
    }
    await cancelMedicationRemindersForIntake(intake.id);
    await deleteMedicationIntake(intake.id, medicationId);
    const summaryIndex = occurrenceSummaries.findIndex((summary) => summary.intakeId === intake.id);
    if (summaryIndex >= 0) {
      occurrenceSummaries.splice(summaryIndex, 1);
    }
    const intakeIndex = intakes.findIndex((item) => item.id === intake.id);
    if (intakeIndex >= 0) {
      intakes.splice(intakeIndex, 1);
    }
    intakeById.delete(intake.id);
    changed = true;
  }

  return changed;
}

function upsertSummaryFromIntake(
  summaries: MedicationOccurrenceSummary[],
  intake: MedicationIntake
): MedicationOccurrenceSummary {
  const summary: MedicationOccurrenceSummary = {
    intakeId: intake.id,
    medicationId: intake.medicationId,
    doseId: intake.doseId ?? null,
    occurrenceDate: intake.occurrenceDate,
    status: intake.status,
    acknowledgedAt: intake.acknowledgedAt,
    acknowledgedByUserId: intake.actorUserId,
    overrideCount: intake.overrideCount ?? 0
  };

  const existingIndex = summaries.findIndex((item) => item.intakeId === intake.id);
  if (existingIndex >= 0) {
    summaries[existingIndex] = { ...summaries[existingIndex], ...summary };
    return summaries[existingIndex];
  }

  summaries.push(summary);
  return summary;
}

function upsertIntakeCache(intakes: MedicationIntake[], intake: MedicationIntake): MedicationIntake {
  const index = intakes.findIndex((item) => item.id === intake.id);
  if (index >= 0) {
    intakes[index] = intake;
    return intakes[index];
  }
  intakes.push(intake);
  return intake;
}

function removeIntakeFromCaches(
  intakeId: number,
  occurrenceSummaries: MedicationOccurrenceSummary[],
  intakes: MedicationIntake[]
): void {
  const summaryIndex = occurrenceSummaries.findIndex((summary) => summary.intakeId === intakeId);
  if (summaryIndex >= 0) {
    occurrenceSummaries.splice(summaryIndex, 1);
  }
  const intakeIndex = intakes.findIndex((item) => item.id === intakeId);
  if (intakeIndex >= 0) {
    intakes.splice(intakeIndex, 1);
  }
}

async function reconcileOccurrenceConflict(
  medicationId: number,
  doseId: number | null,
  occurrenceDate: Date,
  failedIntake: MedicationIntake,
  occurrenceSummaries: MedicationOccurrenceSummary[],
  intakes: MedicationIntake[]
): Promise<{ intake: MedicationIntake; summary: MedicationOccurrenceSummary } | null> {
  const canonical = await findMedicationIntakeByDoseAndDate(medicationId, doseId, occurrenceDate);
  if (!canonical || canonical.id === failedIntake.id) {
    return null;
  }

  await cancelMedicationRemindersForIntake(failedIntake.id);
  await deleteMedicationIntake(failedIntake.id, medicationId);
  removeIntakeFromCaches(failedIntake.id, occurrenceSummaries, intakes);

  const cachedIntake = upsertIntakeCache(intakes, canonical);
  const summary = upsertSummaryFromIntake(occurrenceSummaries, canonical);

  return { intake: cachedIntake, summary };
}

async function resolveContext(user: User): Promise<MedicationContext> {
  const context = await resolveRecipientContextForUser(user.id);
  if (!context.recipient) {
    throw new NotFoundError('No recipient found');
  }
  const role = context.collaborator ? 'collaborator' : 'owner';
  let ownerCollaboratorId: number | null = context.collaborator?.id ?? null;

  if (role === 'owner') {
    const ownerCollaborator = await ensureOwnerCollaborator(context.recipient.id, user);
    ownerCollaboratorId = ownerCollaborator.id;
  }

  return {
    recipientId: context.recipient.id,
    ownerUserId: context.recipient.userId,
    ownerCollaboratorId,
    role
  };
}

function ensureOwner(context: MedicationContext): void {
  if (context.role !== 'owner') {
    throw new ForbiddenError('Only the owner can modify medications');
  }
}

function requireOwnerCollaboratorId(context: MedicationContext): number {
  if (context.ownerCollaboratorId == null) {
    throw new ForbiddenError('Unable to determine owner context');
  }
  return context.ownerCollaboratorId;
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
  const occurrenceDate = toOccurrenceDate(scheduledFor);
  return {
    doseId,
    scheduledFor,
    acknowledgedAt: status === 'taken' || status === 'skipped' ? new Date() : null,
    status,
    actorUserId: userId,
    occurrenceDate,
    overrideCount: 0
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

type MedicationIntakeList = Awaited<ReturnType<typeof listMedicationIntakes>>;

function buildMedicationAuditSnapshot(
  medication: MedicationWithDetails,
  intakes: MedicationIntakeList
) {
  return {
    medication: {
      id: medication.id,
      recipientId: medication.recipientId,
      ownerId: medication.ownerId,
      name: medication.name,
      strengthValue: medication.strengthValue,
      strengthUnit: medication.strengthUnit,
      form: medication.form,
      instructions: medication.instructions,
      notes: medication.notes,
      prescribingProvider: medication.prescribingProvider,
      startDate: medication.startDate,
      endDate: medication.endDate,
      quantityOnHand: medication.quantityOnHand,
      refillThreshold: medication.refillThreshold,
      preferredPharmacy: medication.preferredPharmacy,
      createdAt: medication.createdAt,
      updatedAt: medication.updatedAt,
      archivedAt: medication.archivedAt
    },
    doses: medication.doses.map((dose) => ({
      id: dose.id,
      label: dose.label,
      timeOfDay: dose.timeOfDay,
      timezone: dose.timezone,
      reminderWindowMinutes: dose.reminderWindowMinutes,
      isActive: dose.isActive
    })),
    intakes: intakes.map((intake) => ({
      id: intake.id,
      doseId: intake.doseId,
      scheduledFor: intake.scheduledFor,
      acknowledgedAt: intake.acknowledgedAt,
      status: intake.status,
      actorUserId: intake.actorUserId,
      createdAt: intake.createdAt,
      updatedAt: intake.updatedAt
    })),
    refillProjection: medication.refillProjection
      ? {
          expectedRunOutOn: medication.refillProjection.expectedRunOutOn,
          calculatedAt: medication.refillProjection.calculatedAt
        }
      : null
  };
}

async function hydrateMedication(
  medicationId: number,
  context: MedicationContext,
  options?: MedicationDetailOptions
): Promise<MedicationWithDetails> {
  const intakeOptions = buildIntakeQueryOptions(options);
  const occurrenceSince = options?.intakeLookbackDays && options.intakeLookbackDays > 0
    ? new Date(Date.now() - options.intakeLookbackDays * DAY_IN_MS)
    : new Date(Date.now() - DEFAULT_OCCURRENCE_LOOKBACK_DAYS * DAY_IN_MS);

  const [medication, doses, intakes, projection, occurrenceSummaries] = await Promise.all([
    getMedicationForRecipient(medicationId, context.recipientId),
    listMedicationDoses(medicationId),
    listMedicationIntakes(medicationId, {
      since: intakeOptions.since,
      limit: intakeOptions.limit,
      statuses: intakeOptions.statuses
    }),
    getMedicationRefillProjection(medicationId),
    listMedicationOccurrences(medicationId, { since: occurrenceSince })
  ]);

  if (!medication) {
    throw new NotFoundError('Medication not found');
  }

  if (context.role === 'collaborator' && medication.archivedAt) {
    throw new NotFoundError('Medication not found');
  }

  const currentIntakes = intakes;
  const currentOccurrenceSummaries = occurrenceSummaries;

  await ensureTodayDoseOccurrences(medicationId, context, doses, currentOccurrenceSummaries, currentIntakes);

  const occurrenceEvents = await listMedicationIntakeEvents(currentOccurrenceSummaries.map((summary) => summary.intakeId));
  const occurrences = buildOccurrences(currentOccurrenceSummaries, occurrenceEvents);

  return {
    ...medication,
    doses,
    upcomingIntakes: currentIntakes,
    refillProjection: projection,
    occurrences
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
    const occurrenceSummaries = await listMedicationOccurrences(medication.id, { since: listOptions.since });
    const currentIntakes = intakes;

    await ensureTodayDoseOccurrences(medication.id, context, doses, occurrenceSummaries, currentIntakes);

    const occurrenceEvents = await listMedicationIntakeEvents(occurrenceSummaries.map((summary) => summary.intakeId));
    const occurrences = buildOccurrences(occurrenceSummaries, occurrenceEvents);
    results.push({
      ...medication,
      doses,
      upcomingIntakes: currentIntakes,
      refillProjection: projection,
      occurrences
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

  const ownerCollaboratorId = requireOwnerCollaboratorId(context);

  const writeData = mapCreatePayload(payload);
  const medication = await createMedication(context.recipientId, ownerCollaboratorId, writeData);

  try {
    if (payload.doses && payload.doses.length > 0) {
      for (let index = 0; index < payload.doses.length; index += 1) {
        const doseInput = mapDoseInput(payload.doses[index]!, index);
        await createMedicationDose(medication.id, doseInput);
      }
    }
  } catch (error) {
    await deleteMedication(medication.id, context.recipientId, ownerCollaboratorId);
    throw error;
  }

  await touchPlanForUser(context.ownerUserId);
  return hydrateMedication(medication.id, context);
}

export async function updateMedicationForOwner(
  user: User,
  medicationId: number,
  payload: MedicationUpdateRequest
): Promise<MedicationWithDetails> {
  const context = await resolveContext(user);
  ensureOwner(context);
  const ownerCollaboratorId = requireOwnerCollaboratorId(context);
  const updateData = mapUpdatePayload(payload);
  const updated = await updateMedication(
    medicationId,
    context.recipientId,
    ownerCollaboratorId,
    updateData
  );
  if (!updated) {
    throw new NotFoundError('Medication not found');
  }
  await touchPlanForUser(context.ownerUserId);
  return hydrateMedication(medicationId, context);
}

export async function archiveMedicationForOwner(user: User, medicationId: number): Promise<MedicationWithDetails> {
  const context = await resolveContext(user);
  ensureOwner(context);
  const ownerCollaboratorId = requireOwnerCollaboratorId(context);
  const archived = await archiveMedication(medicationId, context.recipientId, ownerCollaboratorId);
  if (!archived) {
    throw new NotFoundError('Medication not found');
  }
  await touchPlanForUser(context.ownerUserId);
  return hydrateMedication(medicationId, context);
}

export async function unarchiveMedicationForOwner(
  user: User,
  medicationId: number
): Promise<MedicationWithDetails> {
  const context = await resolveContext(user);
  ensureOwner(context);
  const ownerCollaboratorId = requireOwnerCollaboratorId(context);
  const restored = await unarchiveMedication(medicationId, context.recipientId, ownerCollaboratorId);
  if (!restored) {
    throw new NotFoundError('Medication not found');
  }
  await touchPlanForUser(context.ownerUserId);
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
  await touchPlanForUser(context.ownerUserId);
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
  await touchPlanForUser(context.ownerUserId);
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

  const intakes = await listMedicationIntakes(medicationId);
  for (const intake of intakes) {
    if (intake.doseId !== doseId) {
      continue;
    }
    await cancelMedicationRemindersForIntake(intake.id);
    await deleteMedicationIntake(intake.id, medicationId);
  }

  const removed = await deleteMedicationDose(doseId, medicationId);
  if (!removed) {
    throw new NotFoundError('Dose not found');
  }
  await touchPlanForUser(context.ownerUserId);
  return hydrateMedication(medicationId, context);
}

export async function deleteMedicationForOwner(
  user: User,
  medicationId: number
): Promise<MedicationDeleteResponse> {
  const context = await resolveContext(user);
  ensureOwner(context);
  const ownerCollaboratorId = requireOwnerCollaboratorId(context);
  const hydrated = await hydrateMedication(medicationId, context, {
    intakeLimit: MAX_INTAKE_LIMIT,
    intakeLookbackDays: 365
  });
  const allIntakes = await listMedicationIntakes(medicationId);
  const snapshot = buildMedicationAuditSnapshot(hydrated, allIntakes);

  const deleted = await deleteMedication(medicationId, context.recipientId, ownerCollaboratorId);
  if (!deleted) {
    throw new NotFoundError('Medication not found');
  }

  const auditRecord = (await createAuditLog(null, 'medication_deleted', {
    medicationId,
    recipientId: context.recipientId,
    deletedByUserId: user.id,
    snapshot
  })) as { id: number };

  await touchPlanForUser(context.ownerUserId);

  return {
    deletedMedicationId: medicationId,
    auditLogId: auditRecord.id
  };
}

export async function deleteMedicationIntakeForOwner(
  user: User,
  medicationId: number,
  intakeId: number
): Promise<MedicationIntakeDeleteResponse> {
  const context = await resolveContext(user);
  ensureOwner(context);
  requireOwnerCollaboratorId(context);

  const medication = await getMedicationForRecipient(medicationId, context.recipientId);
  if (!medication) {
    throw new NotFoundError('Medication not found');
  }

  const existingIntake = await getMedicationIntake(intakeId, medicationId);
  if (!existingIntake) {
    throw new NotFoundError('Intake not found');
  }

  await cancelMedicationRemindersForIntake(intakeId);

  const deletedIntake = await deleteMedicationIntake(intakeId, medicationId);
  if (!deletedIntake) {
    throw new NotFoundError('Intake not found');
  }

  let recreatedIntake: MedicationIntake | null = null;
  const remainingCount = await countMedicationIntakesByOccurrence(
    medicationId,
    deletedIntake.doseId ?? null,
    deletedIntake.occurrenceDate
  );

  if (remainingCount === 0) {
    recreatedIntake = await createMedicationIntake(medicationId, {
      doseId: deletedIntake.doseId ?? null,
      scheduledFor: deletedIntake.scheduledFor,
      status: 'pending',
      acknowledgedAt: null,
      actorUserId: null,
      occurrenceDate: deletedIntake.occurrenceDate,
      overrideCount: 0
    });

    const recreatedDose = recreatedIntake.doseId ? await getMedicationDoseById(recreatedIntake.doseId, medicationId) : null;
    await scheduleMedicationIntakeReminder({
      medicationId,
      recipientId: context.recipientId,
      intake: {
        id: recreatedIntake.id,
        scheduledFor: recreatedIntake.scheduledFor,
        occurrenceDate: recreatedIntake.occurrenceDate
      },
      dose: recreatedDose
        ? {
            id: recreatedDose.id,
            timezone: recreatedDose.timezone,
            reminderWindowMinutes: recreatedDose.reminderWindowMinutes
          }
        : null
    });
  }

  const auditRecord = (await createAuditLog(null, 'medication_intake_deleted', {
    medicationId,
    intakeId,
    recipientId: context.recipientId,
    deletedByUserId: user.id,
    intake: {
      id: deletedIntake.id,
      doseId: deletedIntake.doseId,
      scheduledFor: deletedIntake.scheduledFor,
      acknowledgedAt: deletedIntake.acknowledgedAt,
      status: deletedIntake.status,
      actorUserId: deletedIntake.actorUserId
    },
    recreatedIntakeId: recreatedIntake?.id ?? null
  })) as { id: number };

  await touchPlanForUser(context.ownerUserId);

  const refreshed = await hydrateMedication(medicationId, context);

  return {
    medication: refreshed,
    deletedIntakeId: intakeId,
    auditLogId: auditRecord.id
  };
}

async function writeIntakeEvent(
  intakeId: number,
  medicationId: number,
  doseId: number | null,
  eventType: IntakeEventType,
  actorUserId: number | null
): Promise<void> {
  await insertMedicationIntakeEvent(intakeId, medicationId, doseId, eventType, actorUserId);
}

async function setDoseStatus(
  user: User,
  medicationId: number,
  intakeId: number,
  status: MedicationIntakeStatus,
  options: { allowOverride?: boolean; context?: MedicationContext } = {}
): Promise<MedicationWithDetails> {
  const context = options.context ?? await resolveContext(user);
  ensureOwner(context);

  const medication = await getMedicationForRecipient(medicationId, context.recipientId);
  if (!medication) {
    throw new NotFoundError('Medication not found');
  }

  const existingIntake = await getMedicationIntake(intakeId, medicationId);
  if (!existingIntake) {
    throw new NotFoundError('Intake not found');
  }

  if (status === 'pending') {
    const updated = await updateMedicationIntake(intakeId, medicationId, {
      status,
      acknowledgedAt: null,
      actorUserId: user.id,
      overrideCount: 0
    });
    if (!updated) {
      throw new NotFoundError('Intake not found');
    }
    await writeIntakeEvent(intakeId, medicationId, existingIntake.doseId, 'undo', user.id);
    const dose = existingIntake.doseId ? await getMedicationDoseById(existingIntake.doseId, medicationId) : null;
    await rescheduleMedicationIntakeReminder({
      medicationId,
      recipientId: context.recipientId,
      intake: {
        id: updated.id,
        scheduledFor: updated.scheduledFor,
        occurrenceDate: updated.occurrenceDate
      },
      dose
    });
    await touchPlanForUser(context.ownerUserId);
    return hydrateMedication(medicationId, context);
  }

  const isOverride = existingIntake.status !== 'pending' && existingIntake.status === status;
  const shouldIncrementOverride = isOverride && (options.allowOverride ?? true);

  if (isOverride && !options.allowOverride) {
    throw new ValidationError({ field: 'status', issue: 'override_not_allowed' });
  }

  const baseOverrideCount = existingIntake.overrideCount ?? 0;
  let nextOverrideCount = baseOverrideCount;
  if (shouldIncrementOverride) {
    nextOverrideCount = baseOverrideCount + 1;
  } else if (existingIntake.status !== status) {
    nextOverrideCount = 0;
  }

  const updateData: MedicationIntakeUpdateData = {
    status,
    acknowledgedAt: status === 'taken' || status === 'skipped' ? new Date() : null,
    actorUserId: user.id,
    overrideCount: nextOverrideCount
  };

  const updated = await updateMedicationIntake(intakeId, medicationId, updateData);
  if (!updated) {
    throw new NotFoundError('Intake not found');
  }

  const eventType: IntakeEventType = shouldIncrementOverride ? 'override' : status === 'taken' ? 'taken' : 'skipped';
  await writeIntakeEvent(intakeId, medicationId, existingIntake.doseId, eventType, user.id);
  if (status === 'taken' || status === 'skipped') {
    await cancelMedicationRemindersForIntake(intakeId);
  }
  await touchPlanForUser(context.ownerUserId);
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
  const occurrenceDate = writeData.occurrenceDate ?? toOccurrenceDate(writeData.scheduledFor);

  const occurrenceSummaries = await listMedicationOccurrences(medicationId, {
    since: occurrenceDate,
    until: occurrenceDate
  });

  const matching = findOccurrenceForDose(occurrenceSummaries, writeData.doseId ?? null);
  if (matching) {
    return setDoseStatus(user, medicationId, matching.intakeId, payload.status, {
      allowOverride: true,
      context
    });
  }

  const created = await createMedicationIntake(medicationId, {
    ...writeData,
    occurrenceDate,
    overrideCount: 0
  });

  if (payload.status === 'taken' || payload.status === 'skipped') {
    const eventType: IntakeEventType = payload.status === 'taken' ? 'taken' : 'skipped';
    await writeIntakeEvent(created.id, medicationId, created.doseId, eventType, user.id);
  } else if (created.status === 'pending') {
    const dose = created.doseId ? await getMedicationDoseById(created.doseId, medicationId) : null;
    await scheduleMedicationIntakeReminder({
      medicationId,
      recipientId: context.recipientId,
      intake: {
        id: created.id,
        scheduledFor: created.scheduledFor,
        occurrenceDate: created.occurrenceDate
      },
      dose
    });
  }

  await touchPlanForUser(context.ownerUserId);
  return hydrateMedication(medicationId, context);
}

export async function updateMedicationIntakeStatus(
  user: User,
  medicationId: number,
  intakeId: number,
  status: MedicationIntakeStatus
): Promise<MedicationWithDetails> {
  return setDoseStatus(user, medicationId, intakeId, status, { allowOverride: true });
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
  await touchPlanForUser(context.ownerUserId);
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
  await touchPlanForUser(context.ownerUserId);
  return hydrateMedication(medicationId, context);
}
