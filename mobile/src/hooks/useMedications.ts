import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import type {
  MedicationCreateRequest,
  MedicationDoseInput,
  MedicationDoseUpdateInput,
  MedicationIntake,
  MedicationIntakeRecordRequest,
  MedicationIntakeStatus,
  MedicationDoseOccurrence,
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
  toggleOccurrenceStatus: (
    medicationId: number,
    intakeId: number,
    nextStatus?: MedicationIntakeStatus
  ) => Promise<MedicationWithDetails>;
  undoOccurrence: (medicationId: number, intakeId: number) => Promise<MedicationWithDetails>;
  confirmOverride: (
    medicationId: number,
    intakeId: number,
    status?: MedicationIntakeStatus
  ) => Promise<MedicationWithDetails>;
}

const RELEVANT_ITEM_TYPES: PlanItemDelta['itemType'][] = ['plan', 'appointment', 'bill'];

function isMedicationDelta(delta: PlanItemDelta): boolean {
  return delta.itemType === 'plan' || delta.itemType === 'plan-medication';
}

type OccurrencePatch = {
  occurrence?: Partial<MedicationDoseOccurrence>;
  intake?: Partial<MedicationIntake>;
};

type OccurrencePatchBuilder = (context: {
  occurrence: MedicationDoseOccurrence | undefined;
  intake: MedicationIntake | undefined;
}) => OccurrencePatch | null;

function cloneMedication(medication: MedicationWithDetails): MedicationWithDetails {
  return {
    ...medication,
    doses: medication.doses.map((dose) => ({ ...dose })),
    upcomingIntakes: medication.upcomingIntakes.map((intake) => ({ ...intake })),
    occurrences: medication.occurrences
      ? medication.occurrences.map((occurrence) => ({
          ...occurrence,
          history: occurrence.history.map((event) => ({ ...event }))
        }))
      : undefined,
    refillProjection: medication.refillProjection ? { ...medication.refillProjection } : null
  };
}

function buildStatusPatch(
  nextStatus: MedicationIntakeStatus,
  userId: number | null,
  occurrence: MedicationDoseOccurrence | undefined
): OccurrencePatch {
  const isOverride = occurrence?.status === nextStatus && nextStatus !== 'pending';
  const timestamp = nextStatus === 'pending' ? null : new Date();
  const overrideCount = nextStatus === 'pending'
    ? 0
    : isOverride
      ? (occurrence?.overrideCount ?? 0) + 1
      : occurrence?.overrideCount ?? 0;

  return {
    occurrence: {
      status: nextStatus,
      acknowledgedAt: timestamp,
      acknowledgedByUserId: nextStatus === 'pending' ? null : userId,
      overrideCount
    },
    intake: {
      status: nextStatus,
      acknowledgedAt: timestamp,
      actorUserId: nextStatus === 'pending' ? null : userId
    }
  };
}

export function useMedications(options?: UseMedicationsOptions): UseMedicationsResult {
  const { status, user } = useAuth();
  const [medications, setMedications] = useState<MedicationWithDetails[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const optionsRef = useRef(options);
  const medicationsRef = useRef<MedicationWithDetails[]>([]);

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
    medicationsRef.current = medications;
  }, [medications]);

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

  const replaceMedication = useCallback((updated: MedicationWithDetails, insertIfMissing = true) => {
    setMedications((current) => {
      const index = current.findIndex((med) => med.id === updated.id);
      if (index === -1) {
        return insertIfMissing ? [updated, ...current] : current;
      }
      const next = [...current];
      next[index] = updated;
      return next;
    });
  }, []);

  const mutateState = useCallback((updated: MedicationWithDetails) => {
    replaceMedication(updated, true);
  }, [replaceMedication]);

  const applyOccurrencePatch = useCallback(
    (medicationId: number, intakeId: number, builder: OccurrencePatchBuilder) => {
      setMedications((current) => {
        const index = current.findIndex((med) => med.id === medicationId);
        if (index === -1) {
          return current;
        }

        const medication = current[index];
        const occurrence = medication.occurrences?.find((occ) => occ.intakeId === intakeId);
        const intake = medication.upcomingIntakes.find((item) => item.id === intakeId);
        const patch = builder({ occurrence, intake });

        if (!patch) {
          return current;
        }

        const nextMedication: MedicationWithDetails = {
          ...medication,
          occurrences: medication.occurrences
            ? medication.occurrences.map((occ) =>
                occ.intakeId === intakeId && patch.occurrence
                  ? { ...occ, ...patch.occurrence }
                  : occ
              )
            : medication.occurrences,
          upcomingIntakes: medication.upcomingIntakes.map((item) =>
            item.id === intakeId && patch.intake ? { ...item, ...patch.intake } : item
          )
        };

        const next = [...current];
        next[index] = nextMedication;
        return next;
      });
    },
    []
  );

  const getMedicationSnapshot = useCallback((medicationId: number): MedicationWithDetails | null => {
    const current = medicationsRef.current.find((med) => med.id === medicationId);
    return current ? cloneMedication(current) : null;
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

  const setOccurrenceStatus = useCallback(
    async (medicationId: number, intakeId: number, nextStatus: MedicationIntakeStatus) => {
      const snapshot = getMedicationSnapshot(medicationId);
      if (!snapshot) {
        throw new Error('Medication not found');
      }

      applyOccurrencePatch(medicationId, intakeId, ({ occurrence }) =>
        buildStatusPatch(nextStatus, (user as any)?.id ?? null, occurrence)
      );

      try {
        const updated = await mutationWrapper(() =>
          updateMedicationIntakeStatusApi(medicationId, intakeId, nextStatus)
        );
        return updated;
      } catch (error) {
        replaceMedication(snapshot, true);
        throw error;
      }
    },
    [applyOccurrencePatch, getMedicationSnapshot, mutationWrapper, replaceMedication, user]
  );

  const toggleOccurrenceStatus = useCallback(
    async (
      medicationId: number,
      intakeId: number,
      forcedStatus?: MedicationIntakeStatus
    ) => {
      const medication = medicationsRef.current.find((med) => med.id === medicationId);
      const occurrence = medication?.occurrences?.find((occ) => occ.intakeId === intakeId);
      const currentStatus = occurrence?.status ?? 'pending';
      const nextStatus = forcedStatus ?? (currentStatus === 'taken' ? 'pending' : 'taken');
      return setOccurrenceStatus(medicationId, intakeId, nextStatus);
    },
    [setOccurrenceStatus]
  );

  const undoOccurrence = useCallback(
    async (medicationId: number, intakeId: number) =>
      setOccurrenceStatus(medicationId, intakeId, 'pending'),
    [setOccurrenceStatus]
  );

  const confirmOverride = useCallback(
    async (
      medicationId: number,
      intakeId: number,
      status: MedicationIntakeStatus = 'taken'
    ) => setOccurrenceStatus(medicationId, intakeId, status),
    [setOccurrenceStatus]
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
    deleteIntake,
    toggleOccurrenceStatus,
    undoOccurrence,
    confirmOverride
  }), [
    loadMedications,
    mutationWrapper,
    mutateState,
    deleteMedication,
    deleteIntake,
    toggleOccurrenceStatus,
    undoOccurrence,
    confirmOverride
  ]);

  return {
    medications,
    loading,
    error,
    refresh: api.refresh,
    ...api
  };
}
