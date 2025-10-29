import { useMemo } from 'react';
import type { MedicationWithDetails } from '@carebase/shared';
import { parseServerDate } from '../../../utils/date';

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
      const nextIntake = [...medication.upcomingIntakes]
        .sort((a, b) => {
          const first = parseServerDate(a.scheduledFor).getTime();
          const second = parseServerDate(b.scheduledFor).getTime();
          return second - first;
        })[0] ?? null;
      const nextDoseTime = nextIntake ? new Date(nextIntake.scheduledFor).toISOString() : null;
      const isOverdue = nextIntake ? nextIntake.status === 'expired' : false;
      const sortedDoses = [...medication.doses].sort((a, b) => {
        if (a.updatedAt && b.updatedAt) {
          return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
        }
        return a.timeOfDay.localeCompare(b.timeOfDay);
      });
      const doseLabel = sortedDoses[0]?.label ?? 'Dose';
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
