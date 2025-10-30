import { differenceInMinutes, subMinutes, isBefore, isAfter } from 'date-fns';
import type { MedicationIntakeStatus } from '@carebase/shared';
import {
  listMedicationOccurrences,
  listMedicationIntakeEvents,
  listMedicationsForRecipient,
  resolveRecipientContextForUser,
  updateMedicationIntake,
  getMedicationForRecipient,
  createMedicationIntake,
  insertMedicationIntakeEvent
} from '../db/queries.js';
import { touchPlanForUser } from '../db/queries/plan.js';
import { logger } from '../utils/logger.js';

const RESET_WINDOW_MINUTES = 60;

interface ResetContext {
  medicationId: number;
  doseId: number | null;
  occurrenceDate: Date;
  status: MedicationIntakeStatus;
  intakeId: number;
  timezone: string;
  timeOfDay: string;
}

function computeResetTime(occurrence: ResetContext): Date {
  const [hours, minutes] = occurrence.timeOfDay.split(':').map((value) => Number(value));
  const base = new Date(occurrence.occurrenceDate);
  base.setHours(hours, minutes, 0, 0);
  return subMinutes(base, RESET_WINDOW_MINUTES);
}

export async function resetMedicationOccurrences(userId: number): Promise<void> {
  const context = await resolveRecipientContextForUser(userId);
  if (!context.recipient || !context.recipient.id) {
    return;
  }

  const medications = await listMedicationsForRecipient(context.recipient.id, { includeArchived: false });
  const now = new Date();

  for (const medication of medications) {
    try {
      const doses = medication.doses;
      const occurrenceSummaries = await listMedicationOccurrences(medication.id);
      const events = await listMedicationIntakeEvents(occurrenceSummaries.map((summary) => summary.intakeId));
      const historyByIntake = new Map<number, typeof events>();
      for (const event of events) {
        if (!historyByIntake.has(event.intakeId)) {
          historyByIntake.set(event.intakeId, []);
        }
        historyByIntake.get(event.intakeId)!.push(event);
      }

      for (const summary of occurrenceSummaries) {
        const dose = doses.find((item) => item.id === summary.doseId) ?? doses[0];
        if (!dose) {
          continue;
        }

        const resetTime = computeResetTime({
          medicationId: medication.id,
          doseId: summary.doseId,
          occurrenceDate: summary.occurrenceDate,
          status: summary.status,
          intakeId: summary.intakeId,
          timezone: dose.timezone,
          timeOfDay: dose.timeOfDay
        });

        if (isAfter(resetTime, now)) {
          continue;
        }

        if (summary.status === 'pending') {
          continue;
        }

        const nextOccurrenceDate = new Date(summary.occurrenceDate.getTime() + 24 * 60 * 60 * 1000);
        const existingNext = occurrenceSummaries.find(
          (item) => item.doseId === summary.doseId && item.occurrenceDate.getTime() === nextOccurrenceDate.getTime()
        );

        if (!existingNext) {
          const newIntake = await createMedicationIntake(medication.id, {
            doseId: summary.doseId,
            scheduledFor: computeScheduledFor(nextOccurrenceDate, dose.timeOfDay, dose.timezone),
            acknowledgedAt: null,
            status: 'pending',
            actorUserId: null,
            occurrenceDate: nextOccurrenceDate,
            overrideCount: 0
          });
          await insertMedicationIntakeEvent(newIntake.id, medication.id, newIntake.doseId, 'undo', null);
        }
      }

      await touchPlanForUser(context.recipient.userId);
    } catch (error) {
      logger.error({ err: error, medicationId: medication.id }, 'Failed to reset medication occurrences');
    }
  }
}

function computeScheduledFor(date: Date, timeOfDay: string, _timezone: string): Date {
  const [hours, minutes] = timeOfDay.split(':').map((value) => Number(value));
  const scheduled = new Date(date);
  scheduled.setHours(hours, minutes, 0, 0);
  return scheduled;
}
