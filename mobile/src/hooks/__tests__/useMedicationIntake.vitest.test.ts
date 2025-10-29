import { renderHook, act } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MedicationWithDetails } from '@carebase/shared';
import { useMedicationIntake } from '../useMedicationIntake';

const apiMocks = vi.hoisted(() => ({
  recordMedicationIntake: vi.fn(),
  updateMedicationIntakeStatus: vi.fn()
}));

vi.mock('../../api/medications', () => apiMocks);

function createMedication(): MedicationWithDetails {
  const now = new Date();
  return {
    id: 1,
    recipientId: 10,
    ownerId: 5,
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
    doses: [],
    upcomingIntakes: [],
    refillProjection: null
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  apiMocks.recordMedicationIntake.mockResolvedValue(createMedication());
  apiMocks.updateMedicationIntakeStatus.mockResolvedValue(createMedication());
});

describe('useMedicationIntake', () => {
  it('records intake and updates status', async () => {
    const { result } = renderHook(() => useMedicationIntake());

    await act(async () => {
      const medication = await result.current.recordIntake(1, {
        doseId: null,
        scheduledFor: new Date().toISOString(),
        status: 'taken'
      });
      expect(medication?.name).toBe('Lipitor');
    });

    await act(async () => {
      const medication = await result.current.updateStatus(1, 2, 'skipped');
      expect(apiMocks.updateMedicationIntakeStatus).toHaveBeenCalledWith(1, 2, 'skipped');
      expect(medication?.id).toBe(1);
    });
  });

  it('captures API errors', async () => {
    apiMocks.recordMedicationIntake.mockRejectedValueOnce(new Error('boom'));
    const { result } = renderHook(() => useMedicationIntake());

    await act(async () => {
      await result.current.recordIntake(1, {
        doseId: null,
        scheduledFor: new Date().toISOString(),
        status: 'taken'
      });
    });

    expect(result.current.error).toContain('Unable to record medication intake');
  });
});
