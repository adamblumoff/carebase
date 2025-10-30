import { subMinutes } from 'date-fns';
import type { MedicationDose, MedicationIntake } from '@carebase/shared';
import {
  listActiveMedications,
  listMedicationDoses,
  listMedicationIntakes,
  createMedicationIntake
} from '../db/queries.js';
import { findRecipientById } from '../db/queries/recipients.js';
import { touchPlanForUser } from '../db/queries/plan.js';
import { combineDateWithTimeZone } from '../utils/timezone.js';
import { scheduleMedicationIntakeReminder } from '../services/medicationReminderScheduler.js';

const RESET_WINDOW_MINUTES = 60;
const DAY_MS = 24 * 60 * 60 * 1000;
const LOOKBACK_DAYS = 2;
const DEFAULT_INTERVAL_MS = Number(process.env.MEDICATION_RESET_INTERVAL_MS ?? 15 * 60 * 1000);

let resetTimer: NodeJS.Timeout | null = null;

interface IntakeIndexKey {
  doseId: number | null;
  occurrenceDate: string;
}

function toKey(intake: IntakeIndexKey): string {
  return `${intake.doseId ?? 0}-${intake.occurrenceDate}`;
}

function toOccurrenceDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function computeResetTime(intake: MedicationIntake): Date {
  return subMinutes(new Date(intake.scheduledFor), RESET_WINDOW_MINUTES);
}

function computeNextOccurrenceDate(intake: MedicationIntake): Date {
  return new Date(intake.occurrenceDate.getTime() + DAY_MS);
}

function computeNextScheduledFor(intake: MedicationIntake, dose: MedicationDose | null): Date {
  if (dose) {
    try {
      return combineDateWithTimeZone(computeNextOccurrenceDate(intake), dose.timeOfDay, dose.timezone);
    } catch (error) {
      console.warn('[MedicationReset] Failed to combine timezone for next occurrence; falling back to UTC shift', {
        intakeId: intake.id,
        medicationId: intake.medicationId,
        doseId: dose.id,
        error
      });
    }
  }
  return new Date(new Date(intake.scheduledFor).getTime() + DAY_MS);
}

function toStringKey(intake: MedicationIntake): string {
  return toKey({
    doseId: intake.doseId,
    occurrenceDate: toOccurrenceDateString(intake.occurrenceDate)
  });
}

export async function runMedicationOccurrenceReset(): Promise<void> {
  const medications = await listActiveMedications();
  if (medications.length === 0) {
    return;
  }

  const now = new Date();
  const intakeSince = new Date(now.getTime() - LOOKBACK_DAYS * DAY_MS);

  for (const medication of medications) {
    let planTouched = false;
    try {
      const doses = await listMedicationDoses(medication.id);
      if (doses.length === 0) {
        continue;
      }

      const intakes = await listMedicationIntakes(medication.id, {
        since: intakeSince,
        limit: 100
      });

      if (intakes.length === 0) {
        continue;
      }

      const doseIndex = new Map<number, MedicationDose>();
      for (const dose of doses) {
        doseIndex.set(dose.id, dose);
      }

      const intakeIndex = new Map<string, MedicationIntake>();
      for (const intake of intakes) {
        intakeIndex.set(toStringKey(intake), intake);
      }

      for (const intake of intakes) {
        if (intake.status === 'pending' || intake.status === 'expired') {
          continue;
        }

        const resetTime = computeResetTime(intake);
        if (now < resetTime) {
          continue;
        }

        const nextOccurrenceDate = computeNextOccurrenceDate(intake);
        const nextKey = toKey({ doseId: intake.doseId, occurrenceDate: toOccurrenceDateString(nextOccurrenceDate) });
        if (intakeIndex.has(nextKey)) {
          continue;
        }

        const matchingDose = intake.doseId ? doseIndex.get(intake.doseId) ?? null : null;
        const nextScheduledFor = computeNextScheduledFor(intake, matchingDose);
        const created = await createMedicationIntake(medication.id, {
          doseId: intake.doseId ?? null,
          scheduledFor: nextScheduledFor,
          acknowledgedAt: null,
          status: 'pending',
          actorUserId: null,
          occurrenceDate: nextOccurrenceDate,
          overrideCount: 0
        });

        intakeIndex.set(nextKey, created);
        await scheduleMedicationIntakeReminder({
          medicationId: medication.id,
          recipientId: medication.recipientId,
          intake: {
            id: created.id,
            scheduledFor: created.scheduledFor,
            occurrenceDate: created.occurrenceDate
          },
          dose: matchingDose
            ? {
                id: matchingDose.id,
                timezone: matchingDose.timezone,
                reminderWindowMinutes: matchingDose.reminderWindowMinutes
              }
            : null
        });
        console.log('[MedicationReset] Created next occurrence', {
          medicationId: medication.id,
          previousIntakeId: intake.id,
          nextIntakeId: created.id,
          doseId: intake.doseId,
          scheduledFor: created.scheduledFor.toISOString()
        });
        planTouched = true;
      }

      if (planTouched) {
        const recipient = await findRecipientById(medication.recipientId);
        if (recipient) {
          await touchPlanForUser(recipient.userId);
        }
      }
    } catch (error) {
      console.error('[MedicationReset] Medication iteration failed', { medicationId: medication.id, error });
    }
  }
}

export function startMedicationOccurrenceResetJob(): void {
  if (resetTimer) {
    return;
  }
  const intervalMs = DEFAULT_INTERVAL_MS;
  const execute = async () => {
    try {
      await runMedicationOccurrenceReset();
    } catch (error) {
      console.error('[MedicationReset] Job execution failed', error);
    }
  };
  void execute();
  resetTimer = setInterval(execute, intervalMs);
}
