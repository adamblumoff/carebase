import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import type {
  MedicationCreateRequest,
  MedicationDoseInput,
  MedicationDoseUpdateInput,
  MedicationIntakeRecordRequest,
  MedicationIntakeStatus,
  MedicationUpdateRequest,
  MedicationWithDetails
} from '@carebase/shared';
import {
  fetchMedications,
  fetchMedication,
  createMedication as createMedicationApi,
  updateMedication as updateMedicationApi,
  archiveMedication as archiveMedicationApi,
  unarchiveMedication as unarchiveMedicationApi,
  createMedicationDose as createMedicationDoseApi,
  updateMedicationDose as updateMedicationDoseApi,
  deleteMedicationDose as deleteMedicationDoseApi,
  recordMedicationIntake as recordMedicationIntakeApi,
  updateMedicationIntakeStatus as updateMedicationIntakeStatusApi,
  setMedicationRefillProjection as setMedicationRefillProjectionApi,
  clearMedicationRefillProjection as clearMedicationRefillProjectionApi,
  type MedicationListOptions
} from '../api/medications';
import { useAuth } from '../auth/AuthContext';
import { addPlanDeltaListener } from '../utils/realtime';
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

  const mutationWrapper = useCallback(
    async (
      action: () => Promise<MedicationWithDetails>,
      onSuccess?: (med: MedicationWithDetails) => void
    ) => {
      try {
        const medication = await action();
        if (onSuccess) {
          onSuccess(medication);
        } else {
          mutateState(medication);
        }
        return medication;
      } catch (err: any) {
        const message = err?.response?.data?.error || err?.message || 'Unable to update medication right now.';
        setError(message);
        throw err;
      }
    },
    [mutateState]
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
      mutationWrapper(() => clearMedicationRefillProjectionApi(id))
  }), [loadMedications, mutationWrapper, mutateState]);

  return {
    medications,
    loading,
    error,
    refresh: api.refresh,
    ...api
  };
}
