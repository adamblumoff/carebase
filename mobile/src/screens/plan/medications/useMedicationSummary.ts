import { useMemo } from 'react';
import type { MedicationWithDetails } from '@carebase/shared';

export interface MedicationSummaryItem {
  id: number;
  name: string;
  nextDoseLabel: string;
  nextDoseTime: string | null;
  isOverdue: boolean;
  isArchived: boolean;
}

export function useMedicationSummary(medications: MedicationWithDetails[]): MedicationSummaryItem[] {
  return useMemo(() => {
    return medications.map((medication) => {
      const nextIntake = medication.upcomingIntakes[0] ?? null;
      const nextDoseTime = nextIntake ? new Date(nextIntake.scheduledFor).toISOString() : null;
      const isOverdue = nextIntake ? nextIntake.status === 'expired' : false;
      const doseLabel = medication.doses[0]?.label ?? 'Dose';
      return {
        id: medication.id,
        name: medication.name,
        nextDoseLabel: doseLabel,
        nextDoseTime,
        isOverdue,
        isArchived: Boolean(medication.archivedAt)
      };
    });
  }, [medications]);
}
