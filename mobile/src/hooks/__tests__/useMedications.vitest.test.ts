import { renderHook, act, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  MedicationWithDetails,
  PlanItemDelta
} from '@carebase/shared';
import { useMedications } from '../useMedications';

const apiMocks = vi.hoisted(() => ({
  fetchMedications: vi.fn(),
  createMedication: vi.fn(),
  updateMedication: vi.fn(),
  archiveMedication: vi.fn(),
  unarchiveMedication: vi.fn(),
  createMedicationDose: vi.fn(),
  updateMedicationDose: vi.fn(),
  deleteMedicationDose: vi.fn(),
  recordMedicationIntake: vi.fn(),
  updateMedicationIntakeStatus: vi.fn(),
  setMedicationRefillProjection: vi.fn(),
  clearMedicationRefillProjection: vi.fn()
}));

vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ status: 'signedIn' as const })
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
    refillProjection: null
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  listeners.length = 0;
  apiMocks.fetchMedications.mockResolvedValue({ medications: [createMedication()] });
  apiMocks.createMedication.mockResolvedValue(createMedication(2));
});

describe('useMedications', () => {
  it('loads medications and refreshes on plan delta', async () => {
    const { result } = renderHook(() => useMedications());

    await waitFor(() => {
      expect(result.current.medications).toHaveLength(1);
    });

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
});
