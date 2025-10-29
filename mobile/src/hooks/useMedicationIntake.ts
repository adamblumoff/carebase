import { useCallback, useState } from 'react';
import type { MedicationIntakeStatus, MedicationWithDetails } from '@carebase/shared';
import {
  recordMedicationIntake as recordIntakeApi,
  updateMedicationIntakeStatus as updateIntakeStatusApi
} from '../api/medications';

interface UseMedicationIntakeResult {
  pending: boolean;
  error: string | null;
  recordIntake: (
    medicationId: number,
    payload: { doseId?: number | null; scheduledFor: string; status: MedicationIntakeStatus }
  ) => Promise<MedicationWithDetails | null>;
  updateStatus: (
    medicationId: number,
    intakeId: number,
    status: MedicationIntakeStatus
  ) => Promise<MedicationWithDetails | null>;
}

export function useMedicationIntake(): UseMedicationIntakeResult {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const recordIntake = useCallback<UseMedicationIntakeResult['recordIntake']>(
    async (medicationId, payload) => {
      setPending(true);
      setError(null);
      try {
        const medication = await recordIntakeApi(medicationId, payload);
        return medication;
      } catch (err: any) {
        const message = err?.response?.data?.error || 'Unable to record medication intake right now.';
        setError(message);
        return null;
      } finally {
        setPending(false);
      }
    },
    []
  );

  const updateStatus = useCallback<UseMedicationIntakeResult['updateStatus']>(
    async (medicationId, intakeId, status) => {
      setPending(true);
      setError(null);
      try {
        const medication = await updateIntakeStatusApi(medicationId, intakeId, status);
        return medication;
      } catch (err: any) {
        const message = err?.response?.data?.error || 'Unable to update medication status right now.';
        setError(message);
        return null;
      } finally {
        setPending(false);
      }
    },
    []
  );

  return {
    pending,
    error,
    recordIntake,
    updateStatus
  };
}
