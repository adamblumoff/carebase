import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import type {
  MedicationCreateRequest,
  MedicationDoseInput,
  MedicationDoseUpdateInput,
  MedicationIntakeRecordRequest,
  MedicationIntakeStatus,
  MedicationUpdateRequest,
  MedicationWithDetails,
  MedicationDeleteResponse,
  MedicationIntakeDeleteResponse
} from '@carebase/shared';
import {
  fetchMedications,
  createMedication as createMedicationApi,
  updateMedication as updateMedicationApi,
  archiveMedication as archiveMedicationApi,
  unarchiveMedication as unarchiveMedicationApi,
  createMedicationDose as createMedicationDoseApi,
  updateMedicationDose as updateMedicationDoseApi,
  deleteMedicationDose as deleteMedicationDoseApi,
  deleteMedication as deleteMedicationApi,
  recordMedicationIntake as recordMedicationIntakeApi,
  deleteMedicationIntake as deleteMedicationIntakeApi,
  updateMedicationIntakeStatus as updateMedicationIntakeStatusApi,
  setMedicationRefillProjection as setMedicationRefillProjectionApi,
  clearMedicationRefillProjection as clearMedicationRefillProjectionApi,
  type MedicationListOptions
} from '../api/medications';
import { useAuth } from '../auth/AuthContext';
import { addPlanDeltaListener } from '../utils/realtime';
import { syncLocalMedicationReminders } from '../notifications/localMedicationReminders';
import type { PlanItemDelta } from '@carebase/shared';

interface UseMedicationsOptions extends MedicationListOptions {}

interface UseMedicationsResult {
  medications: MedicationWithDetails[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  createMedication: (payload: MedicationCreateRequest) => Promise<MedicationWithDetails>;
  updateMedication: (id: number, payload: MedicationUpdateRequest) => Promise<MedicationWithDetails>;
  archiveMedication: (id: number) => Promise<MedicationWithDetails>;
  unarchiveMedication: (id: number) => Promise<MedicationWithDetails>;
  createDose: (id: number, dose: MedicationDoseInput) => Promise<MedicationWithDetails>;
  updateDose: (id: number, doseId: number, dose: MedicationDoseUpdateInput) => Promise<MedicationWithDetails>;
  deleteDose: (id: number, doseId: number) => Promise<MedicationWithDetails>;
  recordIntake: (id: number, payload: MedicationIntakeRecordRequest) => Promise<MedicationWithDetails>;
  updateIntakeStatus: (id: number, intakeId: number, status: MedicationIntakeStatus) => Promise<MedicationWithDetails>;
  setRefillProjection: (id: number, expectedRunOutOn: string | null) => Promise<MedicationWithDetails>;
  clearRefillProjection: (id: number) => Promise<MedicationWithDetails>;
  deleteMedication: (id: number) => Promise<MedicationDeleteResponse>;
  deleteIntake: (id: number, intakeId: number) => Promise<MedicationIntakeDeleteResponse>;
}

const RELEVANT_ITEM_TYPES: PlanItemDelta['itemType'][] = ['plan', 'appointment', 'bill'];

function isMedicationDelta(delta: PlanItemDelta): boolean {
  return delta.itemType === 'plan' || delta.itemType === 'plan-medication';
}

export function useMedications(options?: UseMedicationsOptions): UseMedicationsResult {
  const { status } = useAuth();
  const [medications, setMedications] = useState<MedicationWithDetails[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const optionsRef = useRef(options);

  const loadMedications = useCallback(async () => {
    if (status !== 'signedIn') {
      setMedications([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await fetchMedications(optionsRef.current);
      setMedications(response.medications);
    } catch (err: any) {
      const message = err?.response?.data?.error || err?.message || 'Unable to load medications right now.';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  useEffect(() => {
    loadMedications();
  }, [loadMedications]);

  useEffect(() => {
    const unsubscribe = addPlanDeltaListener((delta) => {
      if (isMedicationDelta(delta)) {
        loadMedications();
      }
    });
    return unsubscribe;
  }, [loadMedications]);

  useEffect(() => {
    void syncLocalMedicationReminders(medications);
  }, [medications]);

  const mutateState = useCallback((updated: MedicationWithDetails) => {
    setMedications((current) => {
      const index = current.findIndex((med) => med.id === updated.id);
      if (index === -1) {
        return [updated, ...current];
      }
      const next = [...current];
      next[index] = updated;
      return next;
    });
  }, []);

  const removeMedication = useCallback((id: number) => {
    setMedications((current) => current.filter((med) => med.id !== id));
  }, []);

  const runAction = useCallback(
    async <T>(action: () => Promise<T>, onSuccess?: (result: T) => void): Promise<T> => {
      try {
        const result = await action();
        onSuccess?.(result);
        return result;
      } catch (err: any) {
        const message = err?.response?.data?.error || err?.message || 'Unable to update medication right now.';
        setError(message);
        throw err;
      }
    },
    [setError]
  );

  const mutationWrapper = useCallback(
    async (
      action: () => Promise<MedicationWithDetails>,
      onSuccess?: (med: MedicationWithDetails) => void
    ) => runAction(action, onSuccess ?? mutateState),
    [mutateState, runAction]
  );

  const deleteMedication = useCallback(
    async (id: number) =>
      runAction(() => deleteMedicationApi(id), () => {
        removeMedication(id);
      }),
    [removeMedication, runAction]
  );

  const deleteIntake = useCallback(
    async (id: number, intakeId: number) =>
      runAction(() => deleteMedicationIntakeApi(id, intakeId), (result) => {
        mutateState(result.medication);
      }),
    [mutateState, runAction]
  );

  const api = useMemo(() => ({
    refresh: loadMedications,
    createMedication: (payload: MedicationCreateRequest) =>
      mutationWrapper(() => createMedicationApi(payload), (med) => mutateState(med)),
    updateMedication: (id: number, payload: MedicationUpdateRequest) =>
      mutationWrapper(() => updateMedicationApi(id, payload)),
    archiveMedication: (id: number) =>
      mutationWrapper(() => archiveMedicationApi(id)),
    unarchiveMedication: (id: number) =>
      mutationWrapper(() => unarchiveMedicationApi(id)),
    createDose: (id: number, dose: MedicationDoseInput) =>
      mutationWrapper(() => createMedicationDoseApi(id, dose)),
    updateDose: (id: number, doseId: number, dose: MedicationDoseUpdateInput) =>
      mutationWrapper(() => updateMedicationDoseApi(id, doseId, dose)),
    deleteDose: (id: number, doseId: number) =>
      mutationWrapper(() => deleteMedicationDoseApi(id, doseId)),
    recordIntake: (id: number, payload: MedicationIntakeRecordRequest) =>
      mutationWrapper(() => recordMedicationIntakeApi(id, payload)),
    updateIntakeStatus: (id: number, intakeId: number, status: MedicationIntakeStatus) =>
      mutationWrapper(() => updateMedicationIntakeStatusApi(id, intakeId, status)),
    setRefillProjection: (id: number, expectedRunOutOn: string | null) =>
      mutationWrapper(() => setMedicationRefillProjectionApi(id, expectedRunOutOn)),
    clearRefillProjection: (id: number) =>
      mutationWrapper(() => clearMedicationRefillProjectionApi(id)),
    deleteMedication,
    deleteIntake
  }), [loadMedications, mutationWrapper, mutateState, deleteMedication, deleteIntake]);

  return {
    medications,
    loading,
    error,
    refresh: api.refresh,
    ...api
  };
}
