import { beforeEach, describe, expect, it, vi } from 'vitest';

const queryMocks = vi.hoisted(() => ({
  listActiveMedications: vi.fn(),
  listMedicationDoses: vi.fn(),
  listMedicationIntakes: vi.fn(),
  createMedicationIntake: vi.fn()
}));

const recipientMocks = vi.hoisted(() => ({
  findRecipientById: vi.fn()
}));

const planMocks = vi.hoisted(() => ({
  touchPlanForUser: vi.fn()
}));

const reminderMocks = vi.hoisted(() => ({
  scheduleMedicationIntakeReminder: vi.fn()
}));

vi.mock('../../db/queries.js', () => ({
  listActiveMedications: queryMocks.listActiveMedications,
  listMedicationDoses: queryMocks.listMedicationDoses,
  listMedicationIntakes: queryMocks.listMedicationIntakes,
  createMedicationIntake: queryMocks.createMedicationIntake
}));

vi.mock('../../db/queries/recipients.js', () => ({
  findRecipientById: recipientMocks.findRecipientById
}));

vi.mock('../../db/queries/plan.js', () => ({
  touchPlanForUser: planMocks.touchPlanForUser
}));

vi.mock('../../services/medicationReminderScheduler.js', () => ({
  scheduleMedicationIntakeReminder: reminderMocks.scheduleMedicationIntakeReminder
}));

const { runMedicationOccurrenceReset } = await import('../medicationOccurrenceReset.js');

describe('runMedicationOccurrenceReset', () => {
  const now = new Date('2025-03-02T14:15:00Z');

  let consoleLogSpy: vi.SpyInstance;
  let consoleWarnSpy: vi.SpyInstance;
  let consoleErrorSpy: vi.SpyInstance;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    queryMocks.listActiveMedications.mockReset();
    queryMocks.listMedicationDoses.mockReset();
    queryMocks.listMedicationIntakes.mockReset();
    queryMocks.createMedicationIntake.mockReset();
    recipientMocks.findRecipientById.mockReset();
    planMocks.touchPlanForUser.mockReset();
    reminderMocks.scheduleMedicationIntakeReminder.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    consoleLogSpy.mockRestore();
    consoleWarnSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  it('creates next-day pending intake using dose timezone when past reset window', async () => {
    queryMocks.listActiveMedications.mockResolvedValueOnce([
      { id: 10, recipientId: 200, ownerId: 300 }
    ]);

    queryMocks.listMedicationDoses.mockResolvedValueOnce([
      {
        id: 5,
        medicationId: 10,
        label: 'Morning',
        timeOfDay: '08:00:00',
        timezone: 'America/New_York',
        reminderWindowMinutes: 120,
        isActive: true,
        createdAt: new Date('2025-02-15T15:00:00Z'),
        updatedAt: new Date('2025-02-15T15:00:00Z')
      }
    ]);

    const takenIntake = {
      id: 100,
      medicationId: 10,
      doseId: 5,
      scheduledFor: new Date('2025-03-02T13:00:00Z'),
      acknowledgedAt: new Date('2025-03-02T13:05:00Z'),
      status: 'taken' as const,
      actorUserId: 300,
      occurrenceDate: new Date('2025-03-02T00:00:00Z'),
      overrideCount: 0,
      createdAt: new Date('2025-03-02T13:05:00Z'),
      updatedAt: new Date('2025-03-02T13:05:00Z')
    };

    queryMocks.listMedicationIntakes.mockResolvedValueOnce([takenIntake]);

    queryMocks.createMedicationIntake.mockImplementationOnce(async (_medicationId, payload) => ({
      id: 101,
      medicationId: 10,
      doseId: payload.doseId ?? null,
      scheduledFor: payload.scheduledFor,
      acknowledgedAt: payload.acknowledgedAt ?? null,
      status: payload.status,
      actorUserId: payload.actorUserId ?? null,
      occurrenceDate: payload.occurrenceDate ?? new Date('2025-03-03T00:00:00Z'),
      overrideCount: payload.overrideCount ?? 0,
      createdAt: new Date('2025-03-03T13:00:00Z'),
      updatedAt: new Date('2025-03-03T13:00:00Z')
    }));

    recipientMocks.findRecipientById.mockResolvedValueOnce({
      id: 200,
      userId: 400
    });

    await runMedicationOccurrenceReset();

    expect(queryMocks.createMedicationIntake).toHaveBeenCalledTimes(1);
    const [, payload] = queryMocks.createMedicationIntake.mock.calls[0] as [
      number,
      {
        doseId: number | null;
        scheduledFor: Date;
        occurrenceDate: Date;
      }
    ];
    expect(payload.doseId).toBe(5);
    expect(payload.status).toBe('pending');
    expect(payload.occurrenceDate.toISOString()).toBe('2025-03-03T00:00:00.000Z');
    expect(payload.scheduledFor.toISOString()).toBe('2025-03-03T13:00:00.000Z');
    expect(planMocks.touchPlanForUser).toHaveBeenCalledWith(400);
    expect(reminderMocks.scheduleMedicationIntakeReminder).toHaveBeenCalledTimes(1);
    expect(reminderMocks.scheduleMedicationIntakeReminder).toHaveBeenCalledWith(
      expect.objectContaining({
        medicationId: 10,
        recipientId: 200,
        intake: expect.objectContaining({ id: 101 })
      })
    );
  });

  it('skips creation when next occurrence already exists', async () => {
    queryMocks.listActiveMedications.mockResolvedValueOnce([
      { id: 11, recipientId: 201, ownerId: 301 }
    ]);

    queryMocks.listMedicationDoses.mockResolvedValueOnce([
      {
        id: 6,
        medicationId: 11,
        label: 'Evening',
        timeOfDay: '20:00:00',
        timezone: 'America/Chicago',
        reminderWindowMinutes: 90,
        isActive: true,
        createdAt: new Date('2025-02-16T15:00:00Z'),
        updatedAt: new Date('2025-02-16T15:00:00Z')
      }
    ]);

    const takenIntake = {
      id: 110,
      medicationId: 11,
      doseId: 6,
      scheduledFor: new Date('2025-03-02T02:00:00Z'),
      acknowledgedAt: new Date('2025-03-02T02:10:00Z'),
      status: 'taken' as const,
      actorUserId: 301,
      occurrenceDate: new Date('2025-03-01T00:00:00Z'),
      overrideCount: 0,
      createdAt: new Date('2025-03-01T02:00:00Z'),
      updatedAt: new Date('2025-03-02T02:10:00Z')
    };

    const nextPending = {
      id: 111,
      medicationId: 11,
      doseId: 6,
      scheduledFor: new Date('2025-03-02T02:00:00Z'),
      acknowledgedAt: null,
      status: 'pending' as const,
      actorUserId: null,
      occurrenceDate: new Date('2025-03-02T00:00:00Z'),
      overrideCount: 0,
      createdAt: new Date('2025-03-01T02:00:00Z'),
      updatedAt: new Date('2025-03-01T02:00:00Z')
    };

    queryMocks.listMedicationIntakes.mockResolvedValueOnce([takenIntake, nextPending]);
    recipientMocks.findRecipientById.mockResolvedValueOnce({ id: 201, userId: 401 });

    await runMedicationOccurrenceReset();

    expect(queryMocks.createMedicationIntake).not.toHaveBeenCalled();
    expect(planMocks.touchPlanForUser).not.toHaveBeenCalled();
    expect(reminderMocks.scheduleMedicationIntakeReminder).not.toHaveBeenCalled();
  });
});
