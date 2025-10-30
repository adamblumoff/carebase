import { useMemo } from 'react';
import type {
  MedicationDose,
  MedicationDoseOccurrence,
  MedicationIntakeStatus,
  MedicationWithDetails
} from '@carebase/shared';
import { parseServerDate } from '../../../utils/date';

const OCCURRENCE_LIMIT = 3;

export interface MedicationSummaryOccurrence {
  intakeId: number;
  label: string | null;
  status: MedicationIntakeStatus;
  scheduledFor: string | null;
  timezone: string | null;
  isOverdue: boolean;
}

export interface MedicationSummaryItem {
  id: number;
  name: string;
  isArchived: boolean;
  occurrences: MedicationSummaryOccurrence[];
  nextOccurrenceLabel: string | null;
  nextOccurrenceTime: string | null;
  isOverdue: boolean;
  dailyCount: MedicationDailyCountSummary;
}

export interface MedicationDailyCountSummary {
  expectedCount: number;
  takenCount: number;
  skippedCount: number;
  overrideCount: number;
  recordedCount: number;
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function buildOccurrenceSummary(
  medication: MedicationWithDetails,
  doseMap: Map<number, MedicationDose>
): {
  occurrences: MedicationSummaryOccurrence[];
  nextOccurrenceLabel: string | null;
  nextOccurrenceTime: string | null;
  isOverdue: boolean;
} {
  const occurrences = (medication.occurrences ?? [])
    .slice()
    .sort((a, b) => toDate(a.occurrenceDate).getTime() - toDate(b.occurrenceDate).getTime());

  const summaries: MedicationSummaryOccurrence[] = [];
  let nextOccurrence: MedicationSummaryOccurrence | null = null;
  let isOverdue = false;

  for (const occurrence of occurrences) {
    const dose = occurrence.doseId != null ? doseMap.get(occurrence.doseId) ?? null : null;
    const intake = medication.upcomingIntakes.find((item) => item.id === occurrence.intakeId) ?? null;
    const scheduledFor = intake ? parseServerDate(intake.scheduledFor).toISOString() : null;
    const overdue = intake ? intake.status === 'expired' : occurrence.status === 'expired';

    if (overdue) {
      isOverdue = true;
    }

    const summary: MedicationSummaryOccurrence = {
      intakeId: occurrence.intakeId,
      label: dose?.label ?? null,
      status: occurrence.status,
      scheduledFor,
      timezone: dose?.timezone ?? null,
      isOverdue: overdue
    };

    if (!nextOccurrence && occurrence.status === 'pending') {
      nextOccurrence = summary;
    }

    summaries.push(summary);
  }

  const fallbackNext = summaries[0] ?? null;
  const primaryNext = nextOccurrence ?? fallbackNext;

  return {
    occurrences: summaries.slice(0, OCCURRENCE_LIMIT),
    nextOccurrenceLabel: primaryNext?.label ?? medication.doses[0]?.label ?? null,
    nextOccurrenceTime: primaryNext?.scheduledFor ?? null,
    isOverdue
  };
}

export function useMedicationSummary(medications: MedicationWithDetails[]): MedicationSummaryItem[] {
  return useMemo(() => {
    return medications.map((medication) => {
      const doseMap = new Map<number, MedicationDose>();
      medication.doses.forEach((dose) => {
        if (dose.id != null) {
          doseMap.set(dose.id, dose);
        }
      });

      const {
        occurrences,
        nextOccurrenceLabel,
        nextOccurrenceTime,
        isOverdue
      } = buildOccurrenceSummary(medication, doseMap);

      return {
        id: medication.id,
        name: medication.name,
        isArchived: Boolean(medication.archivedAt),
        occurrences,
        nextOccurrenceLabel,
        nextOccurrenceTime,
        isOverdue,
        dailyCount: computeMedicationDailyCount(medication)
      };
    });
  }, [medications]);
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
}

export function computeMedicationDailyCount(
  medication: MedicationWithDetails,
  referenceDate: Date = new Date()
): MedicationDailyCountSummary {
  const occurrences = medication.occurrences ?? [];
  let expectedCount = 0;
  let takenCount = 0;
  let skippedCount = 0;
  let overrideCount = 0;

  for (const occurrence of occurrences) {
    const occurrenceDate = toDate(occurrence.occurrenceDate);
    if (!isSameDay(occurrenceDate, referenceDate)) {
      continue;
    }

    expectedCount += 1;

    if (occurrence.status === 'taken') {
      takenCount += 1;
      overrideCount += occurrence.overrideCount ?? 0;
    } else if (occurrence.status === 'skipped') {
      skippedCount += 1;
    }
  }

  return {
    expectedCount,
    takenCount,
    skippedCount,
    overrideCount,
    recordedCount: takenCount + overrideCount
  };
}
