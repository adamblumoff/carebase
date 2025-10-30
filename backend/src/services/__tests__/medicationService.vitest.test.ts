import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  Medication,
  MedicationDose,
  MedicationIntake,
  MedicationRefillProjection,
  User
} from '@carebase/shared';
import { ForbiddenError, NotFoundError } from '../../utils/errors.js';

type QueryMocks = Record<string, ReturnType<typeof vi.fn>>;

const queriesMock: QueryMocks = {
  archiveMedication: vi.fn(),
  createMedication: vi.fn(),
  createMedicationDose: vi.fn(),
  createMedicationIntake: vi.fn(),
  deleteMedication: vi.fn(),
  deleteMedicationDose: vi.fn(),
  deleteMedicationIntake: vi.fn(),
  deleteMedicationRefillProjection: vi.fn(),
  getMedicationForRecipient: vi.fn(),
  getMedicationIntake: vi.fn(),
  getMedicationRefillProjection: vi.fn(),
  listMedicationDoses: vi.fn(),
  listMedicationIntakes: vi.fn(),
  listMedicationsForRecipient: vi.fn(),
  resolveRecipientContextForUser: vi.fn(),
  touchPlanForUser: vi.fn(),
  unarchiveMedication: vi.fn(),
  updateMedication: vi.fn(),
  updateMedicationDose: vi.fn(),
  updateMedicationIntake: vi.fn(),
  upsertMedicationRefillProjection: vi.fn(),
  ensureOwnerCollaborator: vi.fn(),
  createAuditLog: vi.fn()
};

vi.mock('../../db/queries.js', () => queriesMock);

const {
  listMedicationsForUser,
  createMedicationForOwner,
  updateMedicationForOwner,
  recordMedicationIntake,
  deleteMedicationForOwner,
  deleteMedicationIntakeForOwner
} = await import('../medicationService.js');

const now = new Date('2025-01-01T00:00:00.000Z');

function createUser(overrides: Partial<User> = {}): User {
  return {
    id: 10,
    email: 'owner@example.com',
    googleId: null,
    legacyGoogleId: null,
    clerkUserId: null,
    passwordResetRequired: false,
    forwardingAddress: 'owner-forward@carebase.dev',
    planSecret: 'secret',
    planVersion: 1,
    planUpdatedAt: now,
    createdAt: now,
    ...overrides
  };
}

function createMedication(overrides: Partial<Medication> = {}): Medication {
  return {
    id: 100,
    recipientId: 55,
    ownerId: 500,
    name: 'Lipitor',
    strengthValue: 5,
    strengthUnit: 'mg',
    form: 'tablet',
    instructions: 'Take daily',
    notes: null,
    prescribingProvider: 'Dr. Smith',
    startDate: now,
    endDate: null,
    quantityOnHand: 30,
    refillThreshold: 10,
    preferredPharmacy: 'CVS',
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    ...overrides
  };
}

function createDose(overrides: Partial<MedicationDose> = {}): MedicationDose {
  return {
    id: 200,
    medicationId: 100,
    label: 'Morning',
    timeOfDay: '08:00:00',
    timezone: 'America/New_York',
    reminderWindowMinutes: 120,
    isActive: true,
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

function createIntake(overrides: Partial<MedicationIntake> = {}): MedicationIntake {
  return {
    id: 300,
    medicationId: 100,
    doseId: 200,
    scheduledFor: new Date('2025-01-02T13:00:00.000Z'),
    acknowledgedAt: new Date('2025-01-02T13:05:00.000Z'),
    status: 'taken',
    actorUserId: 10,
    occurrenceDate: new Date('2025-01-02T00:00:00.000Z'),
    overrideCount: 0,
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

function createProjection(overrides: Partial<MedicationRefillProjection> = {}): MedicationRefillProjection {
  return {
    medicationId: 100,
    expectedRunOutOn: new Date('2025-02-01T00:00:00.000Z'),
    calculatedAt: now,
    ...overrides
  };
}

function resetMocks(): void {
  Object.values(queriesMock).forEach((mockFn) => mockFn.mockReset());
  queriesMock.listMedicationDoses.mockResolvedValue([]);
  queriesMock.listMedicationIntakes.mockResolvedValue([]);
  queriesMock.getMedicationRefillProjection.mockResolvedValue(null);
  queriesMock.ensureOwnerCollaborator.mockResolvedValue({ id: 500 });
  queriesMock.createAuditLog.mockResolvedValue({ id: 900 });
  queriesMock.getMedicationIntake.mockResolvedValue(null);
  queriesMock.deleteMedicationIntake.mockResolvedValue(null);
}

beforeEach(() => {
  resetMocks();
});

describe('listMedicationsForUser', () => {
  it('returns hydrated medications for owners and respects includeArchived', async () => {
    const user = createUser();
    const medication = createMedication();
    const dose = createDose();
    const intake = createIntake();
    const projection = createProjection();

    queriesMock.resolveRecipientContextForUser.mockResolvedValueOnce({
      recipient: { id: medication.recipientId, userId: user.id, displayName: 'Alex', createdAt: now },
      collaborator: null
    });
    queriesMock.listMedicationsForRecipient.mockResolvedValueOnce([medication]);
    queriesMock.listMedicationDoses.mockResolvedValueOnce([dose]);
    queriesMock.listMedicationIntakes.mockResolvedValueOnce([intake]);
    queriesMock.getMedicationRefillProjection.mockResolvedValueOnce(projection);

    const results = await listMedicationsForUser(user, { includeArchived: true, intakeLimit: 5 });

    expect(results).toHaveLength(1);
    expect(results[0]?.doses[0]?.label).toBe('Morning');
    expect(results[0]?.upcomingIntakes[0]?.status).toBe('taken');
    expect(results[0]?.refillProjection?.expectedRunOutOn).toEqual(projection.expectedRunOutOn);
    expect(queriesMock.listMedicationsForRecipient).toHaveBeenCalledWith(medication.recipientId, { includeArchived: true });
    expect(queriesMock.ensureOwnerCollaborator).toHaveBeenCalledWith(medication.recipientId, user);
  });

  it('filters archived medications for collaborators', async () => {
    const user = createUser({ id: 11, email: 'collab@example.com' });
    const medication = createMedication({ archivedAt: new Date() });

    queriesMock.resolveRecipientContextForUser.mockResolvedValueOnce({
      recipient: { id: medication.recipientId, userId: 42, displayName: 'Alex', createdAt: now },
      collaborator: { id: 77 }
    });
    queriesMock.listMedicationsForRecipient.mockResolvedValueOnce([medication]);

    const results = await listMedicationsForUser(user, { includeArchived: true });

    expect(results).toHaveLength(0);
    expect(queriesMock.listMedicationsForRecipient).toHaveBeenCalledWith(medication.recipientId, { includeArchived: false });
    expect(queriesMock.ensureOwnerCollaborator).not.toHaveBeenCalled();
  });
});

describe('createMedicationForOwner', () => {
  it('normalizes payload, creates doses, and touches plan', async () => {
    const user = createUser();
    const medication = createMedication();

    queriesMock.resolveRecipientContextForUser.mockResolvedValueOnce({
      recipient: { id: medication.recipientId, userId: user.id, displayName: 'Alex', createdAt: now },
      collaborator: null
    });
    queriesMock.createMedication.mockResolvedValueOnce(medication);
    queriesMock.getMedicationForRecipient.mockResolvedValueOnce(medication);
    queriesMock.createMedicationDose.mockResolvedValue(createDose());
    queriesMock.listMedicationDoses.mockResolvedValueOnce([createDose()]);

    const result = await createMedicationForOwner(user, {
      recipientId: medication.recipientId,
      name: '  Lipitor  ',
      strengthValue: 5,
      strengthUnit: ' mg ',
      form: ' tablet ',
      instructions: ' Take daily ',
      notes: undefined,
      prescribingProvider: ' Dr. Smith ',
      startDate: '2025-01-01',
      endDate: null,
      quantityOnHand: 30,
      refillThreshold: 10,
      preferredPharmacy: ' CVS ',
      doses: [
        {
          label: ' Morning ',
          timeOfDay: '08:00',
          timezone: 'America/New_York',
          reminderWindowMinutes: 90,
          isActive: true
        }
      ]
    });

    expect(result.name).toBe('Lipitor');
    expect(queriesMock.ensureOwnerCollaborator).toHaveBeenCalledWith(medication.recipientId, user);
    expect(queriesMock.createMedication).toHaveBeenCalledWith(
      medication.recipientId,
      500,
      expect.any(Object)
    );
    expect(queriesMock.createMedicationDose).toHaveBeenCalledWith(medication.id, {
      label: 'Morning',
      timeOfDay: '08:00:00',
      timezone: 'America/New_York',
      reminderWindowMinutes: 90,
      isActive: true
    });
    expect(queriesMock.touchPlanForUser).toHaveBeenCalledWith(user.id);
  });

  it('throws when recipient mismatch', async () => {
    const user = createUser();

    queriesMock.resolveRecipientContextForUser.mockResolvedValueOnce({
      recipient: { id: 999, userId: user.id, displayName: 'Alex', createdAt: now },
      collaborator: null
    });

    await expect(
      createMedicationForOwner(user, {
        recipientId: 123,
        name: 'Med',
        doses: [],
        strengthValue: null,
        strengthUnit: null,
        form: null,
        instructions: null,
        notes: null,
        prescribingProvider: null,
        startDate: null,
        endDate: null,
        quantityOnHand: null,
        refillThreshold: null,
        preferredPharmacy: null
      })
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe('updateMedicationForOwner', () => {
  it('updates medication and hydrates result', async () => {
    const user = createUser();
    const medication = createMedication();

    queriesMock.resolveRecipientContextForUser.mockResolvedValueOnce({
      recipient: { id: medication.recipientId, userId: user.id, displayName: 'Alex', createdAt: now },
      collaborator: null
    });
    queriesMock.updateMedication.mockResolvedValueOnce(medication);
    queriesMock.getMedicationForRecipient.mockResolvedValueOnce(medication);
    queriesMock.listMedicationDoses.mockResolvedValueOnce([]);

    const result = await updateMedicationForOwner(user, medication.id, {
      name: 'Updated',
      preferredPharmacy: 'Walgreens'
    });

    expect(result.name).toBe('Lipitor');
    expect(queriesMock.updateMedication).toHaveBeenCalledWith(
      medication.id,
      medication.recipientId,
      500,
      expect.objectContaining({ name: 'Updated', preferredPharmacy: 'Walgreens' })
    );
    expect(queriesMock.touchPlanForUser).toHaveBeenCalledWith(user.id);
  });

  it('throws NotFound when update returns null', async () => {
    const user = createUser();

    queriesMock.resolveRecipientContextForUser.mockResolvedValueOnce({
      recipient: { id: 55, userId: user.id, displayName: 'Alex', createdAt: now },
      collaborator: null
    });
    queriesMock.updateMedication.mockResolvedValueOnce(null);

    await expect(updateMedicationForOwner(user, 999, { name: 'Missing' })).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('deleteMedicationForOwner', () => {
  it('deletes medication, logs audit, and touches plan', async () => {
    const user = createUser();
    const medication = createMedication();
    const dose = createDose();
    const intake = createIntake();

    queriesMock.resolveRecipientContextForUser.mockResolvedValueOnce({
      recipient: { id: medication.recipientId, userId: user.id, displayName: 'Alex', createdAt: now },
      collaborator: null
    });
    queriesMock.getMedicationForRecipient.mockResolvedValueOnce(medication);
    queriesMock.listMedicationDoses.mockResolvedValueOnce([dose]);
    queriesMock.listMedicationIntakes
      .mockResolvedValueOnce([intake])
      .mockResolvedValueOnce([intake]);
    queriesMock.deleteMedication.mockResolvedValueOnce(medication);
    queriesMock.createAuditLog.mockResolvedValueOnce({ id: 1234 });

    const result = await deleteMedicationForOwner(user, medication.id);

    expect(result).toEqual({ deletedMedicationId: medication.id, auditLogId: 1234 });
    expect(queriesMock.deleteMedication).toHaveBeenCalledWith(medication.id, medication.recipientId, 500);
    expect(queriesMock.createAuditLog).toHaveBeenCalledWith(
      null,
      'medication_deleted',
      expect.objectContaining({
        medicationId: medication.id,
        deletedByUserId: user.id,
        snapshot: expect.objectContaining({
          medication: expect.objectContaining({ id: medication.id })
        })
      })
    );
    expect(queriesMock.touchPlanForUser).toHaveBeenCalledWith(user.id);
  });
});

describe('deleteMedicationIntakeForOwner', () => {
  it('deletes intake, logs audit, refreshes medication', async () => {
    const user = createUser();
    const medication = createMedication();
    const dose = createDose();
    const intake = createIntake();

    queriesMock.resolveRecipientContextForUser.mockResolvedValueOnce({
      recipient: { id: medication.recipientId, userId: user.id, displayName: 'Alex', createdAt: now },
      collaborator: null
    });
    queriesMock.getMedicationForRecipient
      .mockResolvedValueOnce(medication)
      .mockResolvedValueOnce(medication);
    queriesMock.getMedicationIntake.mockResolvedValueOnce(intake);
    queriesMock.deleteMedicationIntake.mockResolvedValueOnce(intake);
    queriesMock.listMedicationDoses.mockResolvedValueOnce([dose]);
    queriesMock.listMedicationIntakes.mockResolvedValueOnce([]);
    queriesMock.createAuditLog.mockResolvedValueOnce({ id: 4321 });

    const result = await deleteMedicationIntakeForOwner(user, medication.id, intake.id);

    expect(result.deletedIntakeId).toBe(intake.id);
    expect(result.auditLogId).toBe(4321);
    expect(result.medication.doses[0]?.id).toBe(dose.id);
    expect(result.medication.upcomingIntakes).toHaveLength(0);
    expect(queriesMock.deleteMedicationIntake).toHaveBeenCalledWith(intake.id, medication.id);
    expect(queriesMock.createAuditLog).toHaveBeenCalledWith(
      null,
      'medication_intake_deleted',
      expect.objectContaining({
        medicationId: medication.id,
        intakeId: intake.id,
        deletedByUserId: user.id
      })
    );
    expect(queriesMock.touchPlanForUser).toHaveBeenCalledWith(user.id);
  });
});

describe('recordMedicationIntake', () => {
  it('records intake for owner and hydrates response', async () => {
    const user = createUser();
    const medication = createMedication();

    queriesMock.resolveRecipientContextForUser.mockResolvedValueOnce({
      recipient: { id: medication.recipientId, userId: user.id, displayName: 'Alex', createdAt: now },
      collaborator: null
    });
    queriesMock.getMedicationForRecipient.mockResolvedValueOnce(medication);
    queriesMock.getMedicationForRecipient.mockResolvedValueOnce(medication);
    queriesMock.createMedicationIntake.mockResolvedValueOnce(createIntake());

    const result = await recordMedicationIntake(user, medication.id, {
      doseId: 200,
      scheduledFor: '2025-03-01T13:00:00Z',
      status: 'taken'
    });

    expect(result.recipientId).toBe(medication.recipientId);
    expect(queriesMock.createMedicationIntake).toHaveBeenCalled();
    expect(queriesMock.touchPlanForUser).toHaveBeenCalledWith(user.id);
  });

  it('rejects collaborator mutation attempts', async () => {
    const user = createUser({ id: 99, email: 'collab@example.com' });

    queriesMock.resolveRecipientContextForUser.mockResolvedValueOnce({
      recipient: { id: 55, userId: 10, displayName: 'Alex', createdAt: now },
      collaborator: { id: 88 }
    });

    await expect(
      recordMedicationIntake(user, 100, { doseId: null, scheduledFor: '2025-03-01T13:00:00Z', status: 'taken' })
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
