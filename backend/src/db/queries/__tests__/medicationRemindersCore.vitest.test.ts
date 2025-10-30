import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMocks = vi.hoisted(() => ({
  query: vi.fn()
}));

vi.mock('../shared.js', () => ({
  db: dbMocks
}));

const {
  createMedicationReminderEvent,
  cancelPendingMedicationRemindersForIntake,
  getPendingMedicationReminderForIntake
} = await import('../medicationReminders.js');

const baseRow = {
  id: 1,
  medication_id: 42,
  dose_id: 7,
  intake_id: 100,
  recipient_id: 55,
  event_kind: 'initial' as const,
  status: 'pending' as const,
  scheduled_for: new Date('2025-03-01T13:00:00Z'),
  sent_at: null,
  attempt: 0,
  context: { channel: 'expo' },
  created_at: new Date('2025-02-28T12:00:00Z'),
  updated_at: new Date('2025-02-28T12:00:00Z')
};

beforeEach(() => {
  vi.clearAllMocks();
  dbMocks.query.mockReset();
});

describe('medication reminder queries', () => {
  it('creates reminder events with defaults', async () => {
    dbMocks.query.mockResolvedValueOnce({ rows: [baseRow], rowCount: 1 });

    const created = await createMedicationReminderEvent({
      medicationId: 42,
      doseId: 7,
      intakeId: 100,
      recipientId: 55,
      eventKind: 'initial',
      scheduledFor: baseRow.scheduled_for,
      context: { channel: 'expo' }
    });

    const [sql, params] = dbMocks.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('INSERT INTO medication_reminder_events');
    expect(params).toHaveLength(10);
    expect(params[0]).toBe(42);
    expect(params[4]).toBe('initial');
    expect(params[5]).toBe('pending');
    expect(params[6]).toBe(baseRow.scheduled_for);
    expect(params[9]).toEqual({ channel: 'expo' });
    expect(created.id).toBe(1);
    expect(created.status).toBe('pending');
  });

  it('cancels pending reminders for an intake', async () => {
    dbMocks.query.mockResolvedValueOnce({ rowCount: 2 });

    const count = await cancelPendingMedicationRemindersForIntake(100);

    expect(count).toBe(2);
    const [sql, params] = dbMocks.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('UPDATE medication_reminder_events');
    expect(sql).toContain("status = 'cancelled'");
    expect(params).toEqual([100]);
  });

  it('returns pending reminder for intake when available', async () => {
    dbMocks.query.mockResolvedValueOnce({ rows: [baseRow], rowCount: 1 });

    const reminder = await getPendingMedicationReminderForIntake(100);

    expect(reminder?.id).toBe(1);
    const [sql, params] = dbMocks.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('SELECT');
    expect(sql).toContain('FROM medication_reminder_events');
    expect(params).toEqual([100]);
  });

  it('returns null when no pending reminders exist', async () => {
    dbMocks.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const reminder = await getPendingMedicationReminderForIntake(101);

    expect(reminder).toBeNull();
  });
});

