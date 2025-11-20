import { subMinutes } from 'date-fns';
import type { MedicationDose, MedicationIntake } from '@carebase/shared';
import {
  listActiveMedications,
  listMedicationDoses,
  listMedicationIntakes,
  createMedicationIntake,
  updateMedicationIntake
} from '../db/queries.js';
import { findRecipientById } from '../db/queries/recipients.js';
import { touchPlanForUser } from '../db/queries/plan.js';
import { combineDateWithTimeZone } from '../utils/timezone.js';
import { scheduleMedicationIntakeReminder } from '../services/medicationReminderScheduler.js';
import { incrementMetric } from '../utils/metrics.js';

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

  const startedAt = Date.now();
  let createdCount = 0;
  let processedMedications = 0;
  console.info('[MedicationReset] Starting reset run', { medications: medications.length });
  incrementMetric('job.medication_reset.run', 1);

  const now = new Date();
  const intakeSince = new Date(now.getTime() - LOOKBACK_DAYS * DAY_MS);

  for (const medication of medications) {
    processedMedications += 1;
    let planTouched = false;
    try {
      const doses = await listMedicationDoses(medication.id);
      const activeDoses = doses.filter((dose) => dose.isActive !== false);
      if (activeDoses.length === 0) {
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
      for (const dose of activeDoses) {
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

        let matchingDose: MedicationDose | null = null;
        if (intake.doseId != null) {
          matchingDose = doseIndex.get(intake.doseId) ?? null;
        } else if (doseIndex.size === 1) {
          matchingDose = [...doseIndex.values()][0] ?? null;
          if (matchingDose) {
            await updateMedicationIntake(intake.id, medication.id, { doseId: matchingDose.id });
            intake.doseId = matchingDose.id;
          }
        }

        // If the associated dose is inactive/missing and there are multiple active doses,
        // do not create a new occurrence for this intake.
        if (!matchingDose && doseIndex.size > 1) {
          continue;
        }
        const nextScheduledFor = computeNextScheduledFor(intake, matchingDose);
        const created = await createMedicationIntake(medication.id, {
          doseId: matchingDose?.id ?? intake.doseId ?? null,
          scheduledFor: nextScheduledFor,
          acknowledgedAt: null,
          status: 'pending',
          actorUserId: null,
          occurrenceDate: nextOccurrenceDate,
          overrideCount: 0
        });

        intakeIndex.set(nextKey, created);
        createdCount += 1;
        incrementMetric('job.medication_reset.created', 1, { env: process.env.NODE_ENV ?? 'unknown' });
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

  const durationMs = Date.now() - startedAt;
  console.info('[MedicationReset] Completed reset run', {
    medicationsProcessed: processedMedications,
    created: createdCount,
    durationMs
  });
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
