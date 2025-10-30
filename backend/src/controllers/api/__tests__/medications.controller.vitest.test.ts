import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import type { MedicationWithDetails, User } from '@carebase/shared';

const serviceMocks = vi.hoisted(() => ({
  listMedicationsForUser: vi.fn(),
  getMedicationForUser: vi.fn(),
  createMedicationForOwner: vi.fn(),
  updateMedicationForOwner: vi.fn(),
  archiveMedicationForOwner: vi.fn(),
  unarchiveMedicationForOwner: vi.fn(),
  createMedicationDoseForOwner: vi.fn(),
  updateMedicationDoseForOwner: vi.fn(),
  deleteMedicationDoseForOwner: vi.fn(),
  deleteMedicationForOwner: vi.fn(),
  deleteMedicationIntakeForOwner: vi.fn(),
  recordMedicationIntake: vi.fn(),
  updateMedicationIntakeStatus: vi.fn(),
  setMedicationRefillProjection: vi.fn(),
  clearMedicationRefillProjection: vi.fn()
}));

vi.mock('../../../services/medicationService.js', () => serviceMocks);

const {
  listMedications,
  createMedication,
  updateMedication,
  deleteMedication,
  createDose,
  createIntake,
  deleteIntake,
  setRefillProjection
} = await import('../medications.js');

function createResponseHarness() {
  let statusCode: number | null = null;
  let jsonPayload: unknown = undefined;

  const res: Partial<Response> = {
    status(code: number) {
      statusCode = code;
      return this as Response;
    },
    json(payload: unknown) {
      jsonPayload = payload;
      return this as Response;
    }
  };

  return {
    res: res as Response,
    getStatus: () => statusCode,
    getJson: <T>() => jsonPayload as T
  };
}

function createUser(): User {
  const now = new Date();
  return {
    id: 10,
    email: 'owner@example.com',
    googleId: null,
    legacyGoogleId: null,
    clerkUserId: null,
    passwordResetRequired: false,
    forwardingAddress: 'forward@example.com',
    planSecret: 'secret',
    planVersion: 1,
    planUpdatedAt: now,
    createdAt: now
  };
}

beforeEach(() => {
  Object.values(serviceMocks).forEach((mockFn) => mockFn.mockReset());
});

describe('medication controller', () => {
  it('lists medications with query filters', async () => {
    const user = createUser();
    const medications: MedicationWithDetails[] = [
      {
        id: 1,
        recipientId: 55,
        ownerId: user.id,
        name: 'Lipitor',
        strengthValue: 5,
        strengthUnit: 'mg',
        form: 'tablet',
        instructions: 'Take daily',
        notes: null,
        prescribingProvider: 'Dr. Smith',
        startDate: new Date(),
        endDate: null,
        quantityOnHand: 30,
        refillThreshold: 10,
        preferredPharmacy: 'CVS',
        createdAt: new Date(),
        updatedAt: new Date(),
        archivedAt: null,
        doses: [],
        upcomingIntakes: [],
        refillProjection: null
      }
    ];
    serviceMocks.listMedicationsForUser.mockResolvedValueOnce(medications);

    const req = {
      user,
      query: {
        includeArchived: 'true',
        intakeLimit: '5',
        intakeLookbackDays: '14',
        statuses: 'taken,skipped'
      }
    } as unknown as Request;
    const { res, getJson } = createResponseHarness();

    await listMedications(req, res);

    expect(serviceMocks.listMedicationsForUser).toHaveBeenCalledWith(user, {
      includeArchived: true,
      intakeLimit: 5,
      intakeLookbackDays: 14,
      statuses: ['taken', 'skipped']
    });
    expect(getJson<{ medications: MedicationWithDetails[] }>()?.medications).toHaveLength(1);
  });

  it('creates medication and returns 201', async () => {
    const user = createUser();
    const medication: MedicationWithDetails = {
      id: 2,
      recipientId: 55,
      ownerId: user.id,
      name: 'Metformin',
      strengthValue: 500,
      strengthUnit: 'mg',
      form: 'tablet',
      instructions: 'Take with meals',
      notes: null,
      prescribingProvider: 'Dr. Adams',
      startDate: new Date(),
      endDate: null,
      quantityOnHand: 60,
      refillThreshold: 10,
      preferredPharmacy: 'Walgreens',
      createdAt: new Date(),
      updatedAt: new Date(),
      archivedAt: null,
      doses: [],
      upcomingIntakes: [],
      refillProjection: null
    };
    serviceMocks.createMedicationForOwner.mockResolvedValueOnce(medication);

    const req = {
      user,
      body: {
        recipientId: medication.recipientId,
        name: 'Metformin',
        strengthValue: 500
      }
    } as unknown as Request;
    const { res, getStatus, getJson } = createResponseHarness();

    await createMedication(req, res);

    expect(serviceMocks.createMedicationForOwner).toHaveBeenCalledWith(user, expect.objectContaining({ name: 'Metformin' }));
    expect(getStatus()).toBe(201);
    expect(getJson<MedicationWithDetails>().name).toBe('Metformin');
  });

  it('validates payload and reports unauthorized when user missing', async () => {
    const req = {
      body: {
        recipientId: 55,
        name: ''
      }
    } as unknown as Request;
    const { res, getStatus, getJson } = createResponseHarness();

    await createMedication(req, res, () => undefined);
    expect(getStatus()).toBe(401);
    const payload = getJson<{ error: string }>();
    expect(payload?.error).toBe('Not authenticated');
  });

  it('updates medication dosage fields', async () => {
    const user = createUser();
    const medication: MedicationWithDetails = {
      id: 10,
      recipientId: 55,
      ownerId: user.id,
      name: 'Lisinopril',
      strengthValue: 10,
      strengthUnit: 'mg',
      form: 'tablet',
      instructions: null,
      notes: null,
      prescribingProvider: null,
      startDate: new Date(),
      endDate: null,
      quantityOnHand: null,
      refillThreshold: null,
      preferredPharmacy: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      archivedAt: null,
      doses: [],
      upcomingIntakes: [],
      refillProjection: null
    };
    serviceMocks.updateMedicationForOwner.mockResolvedValueOnce(medication);

    const req = {
      user,
      params: { id: '10' },
      body: {
        preferredPharmacy: 'CVS'
      }
    } as unknown as Request;
    const { res, getJson } = createResponseHarness();

    await updateMedication(req, res);

    expect(serviceMocks.updateMedicationForOwner).toHaveBeenCalledWith(user, 10, { preferredPharmacy: 'CVS' });
   expect(getJson<MedicationWithDetails>().id).toBe(10);
  });

  it('deletes medication and returns audit', async () => {
    const user = createUser();
    serviceMocks.deleteMedicationForOwner.mockResolvedValueOnce({ deletedMedicationId: 10, auditLogId: 77 });

    const req = {
      user,
      params: { id: '10' }
    } as unknown as Request;
    const { res, getJson } = createResponseHarness();

    await deleteMedication(req, res);

    expect(serviceMocks.deleteMedicationForOwner).toHaveBeenCalledWith(user, 10);
    expect(getJson<{ deletedMedicationId: number; auditLogId: number }>().auditLogId).toBe(77);
  });

  it('deletes intake and returns refreshed medication', async () => {
    const user = createUser();
    const medication = createMockMedication();
    serviceMocks.deleteMedicationIntakeForOwner.mockResolvedValueOnce({
      medication,
      deletedIntakeId: 301,
      auditLogId: 88
    });

    const req = {
      user,
      params: { id: '5', intakeId: '301' }
    } as unknown as Request;
    const { res, getJson } = createResponseHarness();

    await deleteIntake(req, res);

    expect(serviceMocks.deleteMedicationIntakeForOwner).toHaveBeenCalledWith(user, 5, 301);
    expect(getJson<{ auditLogId: number }>().auditLogId).toBe(88);
  });

  it('creates dose and intake payloads with validation', async () => {
    const user = createUser();
    const medication = createMockMedication();
    serviceMocks.createMedicationDoseForOwner.mockResolvedValueOnce(medication);
    serviceMocks.recordMedicationIntake.mockResolvedValueOnce(medication);
    serviceMocks.setMedicationRefillProjection.mockResolvedValueOnce(medication);

    const doseReq = {
      user,
      params: { id: '5' },
      body: {
        label: 'Morning',
        timeOfDay: '08:00',
        timezone: 'America/New_York',
        reminderWindowMinutes: 90
      }
    } as unknown as Request;
    const doseRes = createResponseHarness();

    await createDose(doseReq, doseRes.res);
    expect(serviceMocks.createMedicationDoseForOwner).toHaveBeenCalledWith(user, 5, expect.any(Object));
    expect(doseRes.getStatus()).toBe(201);

    const intakeReq = {
      user,
      params: { id: '5' },
      body: {
        scheduledFor: new Date().toISOString(),
        status: 'taken'
      }
    } as unknown as Request;
    const intakeRes = createResponseHarness();

    await createIntake(intakeReq, intakeRes.res);
    expect(serviceMocks.recordMedicationIntake).toHaveBeenCalledWith(user, 5, expect.objectContaining({ status: 'taken' }));
    expect(intakeRes.getStatus()).toBe(201);

    const refillReq = {
      user,
      params: { id: '5' },
      body: {
        expectedRunOutOn: new Date().toISOString()
      }
    } as unknown as Request;
    const refillRes = createResponseHarness();

    await setRefillProjection(refillReq, refillRes.res);
    expect(serviceMocks.setMedicationRefillProjection).toHaveBeenCalled();
  });
});

function createMockMedication(): MedicationWithDetails {
  const now = new Date();
  return {
    id: 5,
    recipientId: 55,
    ownerId: 10,
    name: 'Mock',
    strengthValue: null,
    strengthUnit: null,
    form: null,
    instructions: null,
    notes: null,
    prescribingProvider: null,
    startDate: now,
    endDate: null,
    quantityOnHand: null,
    refillThreshold: null,
    preferredPharmacy: null,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    doses: [],
    upcomingIntakes: [],
    refillProjection: null
  };
}
