import { describe, expect, it, vi } from 'vitest';

const reminderMocks = vi.hoisted(() => ({
  cancelPendingMedicationRemindersForIntake: vi.fn(),
  createMedicationReminderEvent: vi.fn()
}));

vi.mock('../../db/queries.js', () => ({
  cancelPendingMedicationRemindersForIntake: reminderMocks.cancelPendingMedicationRemindersForIntake,
  createMedicationReminderEvent: reminderMocks.createMedicationReminderEvent
}));

const {
  scheduleMedicationIntakeReminder,
  rescheduleMedicationIntakeReminder,
  cancelMedicationRemindersForIntake
} = await import('../medicationReminderScheduler.js');

describe('medicationReminderScheduler', () => {
  it('schedules reminder after clearing pending entries', async () => {
    reminderMocks.createMedicationReminderEvent.mockResolvedValueOnce({
      id: 1
    });

    const scheduledFor = new Date('2025-03-01T13:00:00Z');
    await scheduleMedicationIntakeReminder({
      medicationId: 10,
      recipientId: 20,
      intake: {
        id: 300,
        scheduledFor,
        occurrenceDate: new Date('2025-03-01T00:00:00Z')
      },
      dose: {
        id: 5,
        timezone: 'America/New_York',
        reminderWindowMinutes: 90
      }
    });

    expect(reminderMocks.cancelPendingMedicationRemindersForIntake).toHaveBeenCalledWith(300);
    expect(reminderMocks.createMedicationReminderEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        medicationId: 10,
        doseId: 5,
        intakeId: 300,
        recipientId: 20,
        eventKind: 'initial',
        scheduledFor,
        context: expect.objectContaining({
          reminderWindowMinutes: 90,
          timezone: 'America/New_York'
        })
      })
    );
  });

  it('reschedules reminders by delegating to schedule', async () => {
    const scheduledFor = new Date('2025-03-02T08:00:00Z');
    reminderMocks.createMedicationReminderEvent.mockResolvedValueOnce({ id: 2 });

    await rescheduleMedicationIntakeReminder({
      medicationId: 11,
      recipientId: 21,
      intake: {
        id: 301,
        scheduledFor,
        occurrenceDate: new Date('2025-03-02T00:00:00Z')
      },
      dose: null
    });

    expect(reminderMocks.cancelPendingMedicationRemindersForIntake).toHaveBeenCalledWith(301);
    expect(reminderMocks.createMedicationReminderEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        medicationId: 11,
        doseId: null,
        intakeId: 301,
        scheduledFor
      })
    );
  });

  it('cancels reminders for an intake', async () => {
    reminderMocks.cancelPendingMedicationRemindersForIntake.mockResolvedValueOnce(1);
    await cancelMedicationRemindersForIntake(400);
    expect(reminderMocks.cancelPendingMedicationRemindersForIntake).toHaveBeenCalledWith(400);
  });
});

