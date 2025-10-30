import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMocks = vi.hoisted(() => ({
  query: vi.fn()
}));

vi.mock('../shared.js', () => ({
  db: dbMocks
}));

const {
  medicationRowToMedication,
  createMedication,
  updateMedication,
  archiveMedication,
  deleteMedication,
  listMedicationsForRecipient,
  listActiveMedications,
  createMedicationDose,
  updateMedicationDose,
  getMedicationDoseById,
  listMedicationDoses,
  createMedicationIntake,
  deleteMedicationIntake,
  getMedicationIntake,
  updateMedicationIntake,
  listMedicationIntakes,
  listMedicationOccurrences,
  listMedicationIntakeEvents,
  upsertMedicationRefillProjection,
  getMedicationRefillProjection,
  countMedicationIntakesByOccurrence
} = await import('../medications.js');

const baseMedicationRow = {
  id: 42,
  recipient_id: 10,
  owner_id: 3,
  name: 'Lipitor',
  strength_value: '5.00',
  strength_unit: 'mg',
  form: 'tablet',
  instructions: 'Take once daily',
  notes: 'Morning dose',
  prescribing_provider: 'Dr. Smith',
  start_date: new Date('2025-01-01T00:00:00Z'),
  end_date: null,
  quantity_on_hand: 30,
  refill_threshold: 10,
  preferred_pharmacy: 'CVS',
  created_at: new Date('2025-01-01T00:00:00Z'),
  updated_at: new Date('2025-01-02T00:00:00Z'),
  archived_at: null
};

const baseDoseRow = {
  id: 7,
  medication_id: 42,
  label: 'Breakfast',
  time_of_day: '08:00:00',
  timezone: 'America/New_York',
  reminder_window_minutes: 90,
  is_active: true,
  created_at: new Date('2025-01-01T00:00:00Z'),
  updated_at: new Date('2025-01-01T00:00:00Z')
};

const baseIntakeRow = {
  id: 9,
  medication_id: 42,
  dose_id: 7,
  scheduled_for: new Date('2025-01-03T08:00:00Z'),
  acknowledged_at: new Date('2025-01-03T08:05:00Z'),
  status: 'taken' as const,
  actor_user_id: 3,
  occurrence_date: new Date('2025-01-03T00:00:00Z'),
  override_count: 0,
  created_at: new Date('2025-01-03T08:05:00Z'),
  updated_at: new Date('2025-01-03T08:05:00Z')
};

const baseProjectionRow = {
  medication_id: 42,
  expected_run_out_on: new Date('2025-02-01T00:00:00Z'),
  calculated_at: new Date('2025-01-15T00:00:00Z')
};

beforeEach(() => {
  vi.clearAllMocks();
  dbMocks.query.mockReset();
});

describe('medication queries', () => {
  it('maps raw medication rows into domain types', () => {
    const medication = medicationRowToMedication(baseMedicationRow);
    expect(medication).toMatchObject({
      id: 42,
      strengthValue: 5,
      notes: 'Morning dose'
    });
  });

  it('lists active medications', async () => {
    dbMocks.query.mockResolvedValueOnce({ rows: [baseMedicationRow], rowCount: 1 });

    const headers = await listActiveMedications();

    expect(headers).toEqual([
      {
        id: baseMedicationRow.id,
        recipientId: baseMedicationRow.recipient_id,
        ownerId: baseMedicationRow.owner_id
      }
    ]);
    expect(dbMocks.query).toHaveBeenCalledWith(expect.stringContaining('WHERE archived_at IS NULL'));
  });

  it('creates medication with normalized fields', async () => {
    dbMocks.query.mockResolvedValueOnce({ rows: [baseMedicationRow], rowCount: 1 });

    const created = await createMedication(10, 3, {
      name: '  Lipitor  ',
      strengthValue: 5,
      strengthUnit: ' MG ',
      form: ' Tablet ',
      instructions: 'Take once daily',
      notes: undefined,
      prescribingProvider: ' Dr. Smith ',
      startDate: new Date('2025-01-01T00:00:00Z'),
      endDate: null,
      quantityOnHand: 30,
      refillThreshold: 10,
      preferredPharmacy: ' CVS '
    });

    const [, params] = dbMocks.query.mock.calls[0] as [string, unknown[]];
    expect(params.slice(0, 2)).toEqual([10, 3]);
    expect(params[2]).toBe('Lipitor');
    expect(params[3]).toBe(5);
    expect(params[4]).toBe('MG');
    expect(params[5]).toBe('Tablet');
    expect(params[6]).toBe('Take once daily');
    expect(params[7]).toBeNull();
    expect(params[8]).toBe('Dr. Smith');
    expect(params[9]).toBeInstanceOf(Date);
    expect(params[10]).toBeNull();
    expect(params[13]).toBe('CVS');

    expect(created.id).toBe(42);
  });

  it('updates medication with partial fields and fetches when no changes provided', async () => {
    dbMocks.query
      .mockResolvedValueOnce({ rows: [{ ...baseMedicationRow, name: 'Updated' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [baseMedicationRow], rowCount: 1 });

    const updated = await updateMedication(42, 10, 3, {
      name: 'Updated',
      refillThreshold: 5
    });

    const [updateSql, updateParams] = dbMocks.query.mock.calls[0] as [string, unknown[]];
    expect(updateSql).toContain('UPDATE medications');
    expect(updateParams).toEqual(['Updated', 5, 42, 10, 3]);
    expect(updated?.name).toBe('Updated');

    const fetched = await updateMedication(42, 10, 3, {});
    expect(fetched?.id).toBe(42);
    const [selectSql] = dbMocks.query.mock.calls[1] as [string, unknown[]];
    expect(selectSql).toContain('SELECT * FROM medications');
  });

  it('archives medication and lists by recipient with archive filtering', async () => {
    dbMocks.query
      .mockResolvedValueOnce({ rows: [{ ...baseMedicationRow, archived_at: new Date() }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [baseMedicationRow], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [baseMedicationRow], rowCount: 1 });

    const archived = await archiveMedication(42, 10, 3);
    expect(archived?.archivedAt).toBeInstanceOf(Date);

    await listMedicationsForRecipient(10);
    const [listSql] = dbMocks.query.mock.calls[1] as [string, unknown[]];
    expect(listSql).toContain('archived_at IS NULL');

    await listMedicationsForRecipient(10, { includeArchived: true });
    const [listAllSql] = dbMocks.query.mock.calls[2] as [string, unknown[]];
    expect(listAllSql).not.toContain('archived_at IS NULL');
  });

  it('deletes medication for owner', async () => {
    dbMocks.query.mockResolvedValueOnce({ rows: [baseMedicationRow], rowCount: 1 });

    const removed = await deleteMedication(42, 10, 3);

    expect(removed?.id).toBe(baseMedicationRow.id);
    const [sql, params] = dbMocks.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('DELETE FROM medications');
    expect(params).toEqual([42, 10, 3]);
  });
});

describe('medication dose queries', () => {
  it('creates, updates, lists, and deletes dose metadata', async () => {
    dbMocks.query
      .mockResolvedValueOnce({ rows: [baseDoseRow], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ ...baseDoseRow, reminder_window_minutes: 60 }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [baseDoseRow], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [baseDoseRow], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const created = await createMedicationDose(42, {
      label: '  Breakfast ',
      timeOfDay: '08:00:00',
      timezone: 'America/New_York',
      reminderWindowMinutes: 90
    });
    expect(created.label).toBe('Breakfast');

    const updated = await updateMedicationDose(7, 42, {
      reminderWindowMinutes: 60
    });
    expect(updated?.reminderWindowMinutes).toBe(60);

    await listMedicationDoses(42);
    const [listSql, listParams] = dbMocks.query.mock.calls[2] as [string, unknown[]];
    expect(listSql).toContain('SELECT * FROM medication_doses');
    expect(listParams).toEqual([42]);

    const fetched = await getMedicationDoseById(baseDoseRow.id, baseDoseRow.medication_id);
    expect(fetched?.id).toBe(baseDoseRow.id);
    const [getSql, getParams] = dbMocks.query.mock.calls[3] as [string, unknown[]];
    expect(getSql).toContain('FROM medication_doses');
    expect(getParams).toEqual([baseDoseRow.id, baseDoseRow.medication_id]);

    const missing = await getMedicationDoseById(999, baseDoseRow.medication_id);
    expect(missing).toBeNull();
    const [, missingParams] = dbMocks.query.mock.calls[4] as [string, unknown[]];
    expect(missingParams).toEqual([999, baseDoseRow.medication_id]);
  });
});

describe('medication intake queries', () => {
  it('records and updates intakes with filtering options', async () => {
    dbMocks.query
      .mockResolvedValueOnce({ rows: [baseIntakeRow], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ ...baseIntakeRow, status: 'skipped' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [baseIntakeRow], rowCount: 1 });

    const created = await createMedicationIntake(42, {
      doseId: 7,
      scheduledFor: baseIntakeRow.scheduled_for,
      status: 'taken',
      actorUserId: 3
    });
    expect(created.status).toBe('taken');

    const updated = await updateMedicationIntake(9, 42, {
      status: 'skipped',
      acknowledgedAt: new Date('2025-01-03T08:10:00Z')
    });
    expect(updated?.status).toBe('skipped');

    await listMedicationIntakes(42, { since: new Date('2025-01-01T00:00:00Z'), statuses: ['taken'] });
    const [listSql, listParams] = dbMocks.query.mock.calls[2] as [string, unknown[]];
    expect(listSql).toContain('status = ANY');
    expect(listParams[0]).toBe(42);
  });

  it('retrieves and deletes intake by id', async () => {
    dbMocks.query
      .mockResolvedValueOnce({ rows: [baseIntakeRow], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [baseIntakeRow], rowCount: 1 });

    const found = await getMedicationIntake(baseIntakeRow.id, baseIntakeRow.medication_id);
    expect(found?.id).toBe(baseIntakeRow.id);

    const removed = await deleteMedicationIntake(baseIntakeRow.id, baseIntakeRow.medication_id);
    expect(removed?.id).toBe(baseIntakeRow.id);

    const [, deleteParams] = dbMocks.query.mock.calls[1] as [string, unknown[]];
    expect(deleteParams).toEqual([baseIntakeRow.id, baseIntakeRow.medication_id]);
  });

  it('lists occurrences and events', async () => {
    dbMocks.query
      .mockResolvedValueOnce({ rows: [baseIntakeRow], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [
        {
          id: 1,
          intake_id: baseIntakeRow.id,
          medication_id: baseIntakeRow.medication_id,
          dose_id: baseIntakeRow.dose_id,
          event_type: 'taken',
          occurred_at: new Date('2025-01-03T08:05:00Z'),
          actor_user_id: baseIntakeRow.actor_user_id
        }
      ], rowCount: 1 });

    const occurrences = await listMedicationOccurrences(baseIntakeRow.medication_id);
    expect(occurrences[0]?.occurrenceDate).toEqual(baseIntakeRow.occurrence_date);
    expect(dbMocks.query.mock.calls[0]?.[0]).toContain('FROM medication_intakes');

    const events = await listMedicationIntakeEvents([baseIntakeRow.id]);
    expect(events[0]?.eventType).toBe('taken');
    expect(dbMocks.query.mock.calls[1]?.[0]).toContain('FROM medication_intake_events');
  });

  it('counts intakes by occurrence and dose', async () => {
    dbMocks.query.mockResolvedValueOnce({ rows: [{ count: 2 }], rowCount: 1 });

    const count = await countMedicationIntakesByOccurrence(baseIntakeRow.medication_id, baseIntakeRow.dose_id, baseIntakeRow.occurrence_date);

    expect(count).toBe(2);
    const [sql, params] = dbMocks.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('COUNT(*)');
    expect(sql).toContain('dose_id = $2');
    expect(params).toEqual([baseIntakeRow.medication_id, baseIntakeRow.dose_id, baseIntakeRow.occurrence_date]);

    dbMocks.query.mockClear();
    dbMocks.query.mockResolvedValueOnce({ rows: [{ count: 1 }], rowCount: 1 });

    const nullDoseCount = await countMedicationIntakesByOccurrence(baseIntakeRow.medication_id, null, baseIntakeRow.occurrence_date);
    expect(nullDoseCount).toBe(1);
    const [nullSql, nullParams] = dbMocks.query.mock.calls[0] as [string, unknown[]];
    expect(nullSql).toContain('dose_id IS NULL');
    expect(nullParams).toEqual([baseIntakeRow.medication_id, baseIntakeRow.occurrence_date]);
  });
});

describe('medication refill projections', () => {
  it('upserts and retrieves projections', async () => {
    dbMocks.query
      .mockResolvedValueOnce({ rows: [baseProjectionRow], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [baseProjectionRow], rowCount: 1 });

    const upserted = await upsertMedicationRefillProjection(42, baseProjectionRow.expected_run_out_on);
    expect(upserted.expectedRunOutOn).toEqual(baseProjectionRow.expected_run_out_on);

    const fetched = await getMedicationRefillProjection(42);
    expect(fetched?.medicationId).toBe(42);
  });
});
