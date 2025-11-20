import type {
  MedicationDoseOccurrence,
  MedicationIntakeEvent,
  MedicationOccurrenceSummary
} from '@carebase/shared';

export function toOccurrenceDate(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function groupEventsByIntake(events: MedicationIntakeEvent[]): Map<number, MedicationIntakeEvent[]> {
  const map = new Map<number, MedicationIntakeEvent[]>();
  for (const event of events) {
    if (!map.has(event.intakeId)) {
      map.set(event.intakeId, []);
    }
    map.get(event.intakeId)!.push(event);
  }
  return map;
}

export function buildOccurrences(
  summaries: MedicationOccurrenceSummary[],
  events: MedicationIntakeEvent[]
): MedicationDoseOccurrence[] {
  if (summaries.length === 0) {
    return [];
  }
  const historyByIntake = groupEventsByIntake(events);
  return summaries.map((summary) => ({
    intakeId: summary.intakeId,
    medicationId: summary.medicationId,
    doseId: summary.doseId,
    occurrenceDate: summary.occurrenceDate,
    status: summary.status,
    acknowledgedAt: summary.acknowledgedAt,
    acknowledgedByUserId: summary.acknowledgedByUserId,
    overrideCount: summary.overrideCount ?? 0,
    history: historyByIntake.get(summary.intakeId) ?? []
  }));
}

export function findOccurrenceForDose(
  summaries: MedicationOccurrenceSummary[],
  doseId: number | null
): MedicationOccurrenceSummary | undefined {
  return summaries.find((summary) => summary.doseId === doseId);
}
