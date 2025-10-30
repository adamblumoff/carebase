import type { MedicationDose, MedicationIntake } from '@carebase/shared';
import {
  cancelPendingMedicationRemindersForIntake,
  createMedicationReminderEvent
} from '../db/queries.js';

interface ReminderScheduleParams {
  medicationId: number;
  recipientId: number;
  intake: Pick<MedicationIntake, 'id' | 'scheduledFor' | 'occurrenceDate'>;
  dose?: Pick<MedicationDose, 'id' | 'timezone' | 'reminderWindowMinutes'> | null;
}

function buildReminderContext(params: ReminderScheduleParams): Record<string, unknown> {
  const reminderWindow = params.dose?.reminderWindowMinutes ?? 120;
  return {
    reminderWindowMinutes: reminderWindow,
    occurrenceDate: params.intake.occurrenceDate.toISOString(),
    timezone: params.dose?.timezone ?? null
  };
}

export async function scheduleMedicationIntakeReminder(params: ReminderScheduleParams): Promise<void> {
  await cancelPendingMedicationRemindersForIntake(params.intake.id);
  await createMedicationReminderEvent({
    medicationId: params.medicationId,
    doseId: params.dose?.id ?? null,
    intakeId: params.intake.id,
    recipientId: params.recipientId,
    eventKind: 'initial',
    scheduledFor: params.intake.scheduledFor,
    context: buildReminderContext(params)
  });
}

export async function rescheduleMedicationIntakeReminder(params: ReminderScheduleParams): Promise<void> {
  await scheduleMedicationIntakeReminder(params);
}

export async function cancelMedicationRemindersForIntake(intakeId: number): Promise<void> {
  await cancelPendingMedicationRemindersForIntake(intakeId);
}
