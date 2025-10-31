import { useMemo } from 'react';
import type {
  MedicationDose,
  MedicationDoseOccurrence,
  MedicationIntakeStatus,
  MedicationWithDetails
} from '@carebase/shared';
import { formatDateKeyInZone, parseServerDate } from '../../../utils/date';

const OCCURRENCE_LIMIT = 3;
const DEVICE_TIME_ZONE = (() => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC';
  } catch {
    return 'UTC';
  }
})();

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

function toDateKey(value: Date | string): string {
  return toDate(value).toISOString().slice(0, 10);
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

  const occurrenceDateMeta = new Map<number, { key: string; zoneToday: string }>();
  const parseScheduled = (value: unknown): Date | null => {
    if (!value) return null;
    if (value instanceof Date) return value;
    if (typeof value === 'string') return parseServerDate(value);
    return null;
  };

  occurrences.forEach((occurrence) => {
    const intake = medication.upcomingIntakes.find((item) => item.id === occurrence.intakeId) ?? null;
    const scheduled = intake ? parseScheduled(intake.scheduledFor) : null;
    let reference = occurrence.occurrenceDate;
    const dose = occurrence.doseId != null ? doseMap.get(occurrence.doseId) ?? null : null;
    const zone = dose?.timezone ?? DEVICE_TIME_ZONE;
    if (scheduled) {
      const occurrenceKey = formatDateKeyInZone(reference, zone);
      const scheduledKey = formatDateKeyInZone(scheduled, zone);
      if (scheduledKey !== occurrenceKey) {
        reference = scheduled;
      }
    }
    const key = formatDateKeyInZone(reference, zone);
    const zoneToday = formatDateKeyInZone(new Date(), zone);
    occurrenceDateMeta.set(occurrence.intakeId, { key, zoneToday });
  });

  const todays = occurrences.filter((occurrence) => {
    const meta = occurrenceDateMeta.get(occurrence.intakeId);
    return meta ? meta.key === meta.zoneToday : false;
  });
  const futurePending = occurrences.filter((occurrence) => {
    if (occurrence.status !== 'pending') {
      return false;
    }
    const meta = occurrenceDateMeta.get(occurrence.intakeId);
    if (!meta) {
      const fallback = formatDateKeyInZone(occurrence.occurrenceDate, DEVICE_TIME_ZONE);
      const fallbackToday = formatDateKeyInZone(new Date(), DEVICE_TIME_ZONE);
      return fallback > fallbackToday;
    }
    return meta.key > meta.zoneToday;
  });

  const summaries: MedicationSummaryOccurrence[] = [];
  const summaryById = new Map<number, MedicationSummaryOccurrence>();
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
    summaryById.set(occurrence.intakeId, summary);
  }

  const fallbackNext = summaries[0] ?? null;
  const primaryNext = nextOccurrence ?? fallbackNext;

  const displaySource =
    todays.length > 0 ? todays : futurePending.slice(0, OCCURRENCE_LIMIT);
  const displaySummaries = displaySource
    .map((occurrence) => summaryById.get(occurrence.intakeId))
    .filter((summary): summary is MedicationSummaryOccurrence => Boolean(summary));

  return {
    occurrences: displaySummaries.slice(0, OCCURRENCE_LIMIT),
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
    } else if (occurrence.status === 'skipped') {
      skippedCount += 1;
    }
  }

  return {
    expectedCount,
    takenCount,
    skippedCount,
    overrideCount,
    recordedCount: takenCount
  };
}
