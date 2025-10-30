import { renderHook, act, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  MedicationWithDetails,
  PlanItemDelta
} from '@carebase/shared';
import { useMedications } from '../useMedications';

const apiMocks = vi.hoisted(() => ({
  fetchMedications: vi.fn(),
  fetchMedication: vi.fn(),
  createMedication: vi.fn(),
  updateMedication: vi.fn(),
  archiveMedication: vi.fn(),
  unarchiveMedication: vi.fn(),
  createMedicationDose: vi.fn(),
  updateMedicationDose: vi.fn(),
  deleteMedicationDose: vi.fn(),
  deleteMedication: vi.fn(),
  recordMedicationIntake: vi.fn(),
  deleteMedicationIntake: vi.fn(),
  updateMedicationIntakeStatus: vi.fn(),
  setMedicationRefillProjection: vi.fn(),
  clearMedicationRefillProjection: vi.fn()
}));

const reminderMocks = vi.hoisted(() => ({
  syncLocalMedicationReminders: vi.fn()
}));

vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ status: 'signedIn' as const, user: { id: 777 } })
}));

vi.mock('../../utils/realtime', () => ({
  addPlanDeltaListener: (listener: (delta: PlanItemDelta) => void) => {
    listeners.push(listener);
    return () => {
      const idx = listeners.indexOf(listener);
      if (idx >= 0) listeners.splice(idx, 1);
    };
  }
}));

vi.mock('../../api/medications', () => apiMocks);
vi.mock('../../notifications/localMedicationReminders', () => reminderMocks);

const listeners: Array<(delta: PlanItemDelta) => void> = [];

function createMedication(id = 1): MedicationWithDetails {
  const now = new Date();
  return {
    id,
    recipientId: 10,
    ownerId: 5,
    name: `Medication-${id}`,
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
    refillProjection: null,
    occurrences: []
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  listeners.length = 0;
  apiMocks.fetchMedications.mockResolvedValue({ medications: [createMedication()] });
  apiMocks.createMedication.mockResolvedValue(createMedication(2));
  apiMocks.deleteMedication.mockResolvedValue({ deletedMedicationId: 1, auditLogId: 100 });
  apiMocks.deleteMedicationIntake.mockResolvedValue({
    medication: createMedication(1),
    deletedIntakeId: 999,
    auditLogId: 101
  });
  reminderMocks.syncLocalMedicationReminders.mockResolvedValue(undefined);
});

describe('useMedications', () => {
  it('loads medications and refreshes on plan delta', async () => {
    const { result } = renderHook(() => useMedications());

    await waitFor(() => {
      expect(result.current.medications).toHaveLength(1);
    });

    expect(reminderMocks.syncLocalMedicationReminders).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ id: 1 })])
    );

    apiMocks.fetchMedications.mockResolvedValueOnce({ medications: [createMedication(3)] });

    await act(async () => {
      listeners.forEach((listener) => listener({ itemType: 'plan-medication' } as PlanItemDelta));
    });

    await waitFor(() => {
      expect(apiMocks.fetchMedications).toHaveBeenCalledTimes(2);
      expect(result.current.medications[0].id).toBe(3);
    });
  });

  it('optimistically inserts created medication', async () => {
    const { result } = renderHook(() => useMedications());

    await waitFor(() => {
      expect(result.current.medications).toHaveLength(1);
    });

    await act(async () => {
      await result.current.createMedication({ recipientId: 10, name: 'New Med' });
    });

    expect(apiMocks.createMedication).toHaveBeenCalled();
    expect(result.current.medications.find((med) => med.id === 2)).toBeDefined();
  });

  it('removes medication when deleteMedication resolves', async () => {
    const { result } = renderHook(() => useMedications());

    await waitFor(() => {
      expect(result.current.medications).toHaveLength(1);
    });

    await act(async () => {
      await result.current.deleteMedication(1);
    });

    expect(apiMocks.deleteMedication).toHaveBeenCalledWith(1);
    expect(result.current.medications).toHaveLength(0);
  });

  it('updates medication when deleting an intake', async () => {
    const medication = createMedication(1);
    const now = new Date();
    medication.upcomingIntakes = [
      {
        id: 500,
        medicationId: medication.id,
        doseId: null,
        scheduledFor: now,
        acknowledgedAt: null,
        status: 'taken',
        actorUserId: null,
        occurrenceDate: new Date(now.getFullYear(), now.getMonth(), now.getDate()),
        overrideCount: 0,
        createdAt: now,
        updatedAt: now
      }
    ];

    const updatedMedication = { ...medication, upcomingIntakes: [] };

    apiMocks.fetchMedications.mockResolvedValueOnce({ medications: [medication] });
    apiMocks.deleteMedicationIntake.mockResolvedValueOnce({
      medication: updatedMedication,
      deletedIntakeId: 500,
      auditLogId: 200
    });

    const { result } = renderHook(() => useMedications());

    await waitFor(() => {
      expect(result.current.medications[0]?.upcomingIntakes).toHaveLength(1);
    });

    await act(async () => {
      await result.current.deleteIntake(medication.id, 500);
    });

    expect(apiMocks.deleteMedicationIntake).toHaveBeenCalledWith(medication.id, 500);
    expect(result.current.medications[0]?.upcomingIntakes).toHaveLength(0);
  });

  it('optimistically toggles occurrence status', async () => {
    const now = new Date();
    const intakeId = 700;
    const medication = createMedication(4);
    medication.doses = [
      {
        id: 88,
        medicationId: medication.id,
        label: 'Morning',
        timeOfDay: '08:00:00',
        timezone: 'America/Chicago',
        reminderWindowMinutes: 120,
        isActive: true,
        createdAt: now,
        updatedAt: now
      }
    ];
    medication.upcomingIntakes = [
      {
        id: intakeId,
        medicationId: medication.id,
        doseId: 88,
        scheduledFor: now,
        acknowledgedAt: null,
        status: 'pending',
        actorUserId: null,
        occurrenceDate: new Date(now.getFullYear(), now.getMonth(), now.getDate()) as unknown as Date,
        overrideCount: 0,
        createdAt: now,
        updatedAt: now
      }
    ];
    medication.occurrences = [
      {
        intakeId,
        medicationId: medication.id,
        doseId: 88,
        occurrenceDate: new Date(now.getFullYear(), now.getMonth(), now.getDate()) as unknown as Date,
        status: 'pending',
        acknowledgedAt: null,
        acknowledgedByUserId: null,
        overrideCount: 0,
        history: []
      }
    ];

    const updatedMedication: MedicationWithDetails = {
      ...medication,
      upcomingIntakes: [
        {
          ...medication.upcomingIntakes[0]!,
          status: 'taken',
          acknowledgedAt: now,
          actorUserId: 777
        }
      ],
      occurrences: [
        {
          ...medication.occurrences![0]!,
          status: 'taken',
          acknowledgedAt: now,
          acknowledgedByUserId: 777,
          overrideCount: 0
        }
      ]
    };

    apiMocks.fetchMedications.mockResolvedValueOnce({ medications: [medication] });
    apiMocks.updateMedicationIntakeStatus.mockResolvedValueOnce(updatedMedication);

    const { result } = renderHook(() => useMedications());

    await waitFor(() => {
      expect(result.current.medications[0]?.occurrences?.[0]?.status).toBe('pending');
    });

    await act(async () => {
      await result.current.toggleOccurrenceStatus(medication.id, intakeId, 'taken');
    });

    expect(apiMocks.updateMedicationIntakeStatus).toHaveBeenCalledWith(medication.id, intakeId, 'taken');
    expect(result.current.medications[0]?.occurrences?.[0]?.status).toBe('taken');
  });
});
