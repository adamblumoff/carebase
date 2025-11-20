import { describe, expect, it } from 'vitest';
import type { MedicationIntakeEvent, MedicationOccurrenceSummary } from '@carebase/shared';
import {
  buildOccurrences,
  findOccurrenceForDose,
  toOccurrenceDate
} from '../medicationOccurrenceUtils.js';

describe('medicationOccurrenceUtils', () => {
  it('normalizes dates to UTC midnight', () => {
    const date = new Date('2024-08-10T18:23:00-05:00');
    const utcDate = toOccurrenceDate(date);
    expect(utcDate.toISOString()).toBe('2024-08-10T00:00:00.000Z');
  });

  it('builds occurrences with history grouped per intake', () => {
    const summaries: MedicationOccurrenceSummary[] = [
      {
        intakeId: 1,
        medicationId: 10,
        doseId: 100,
        occurrenceDate: new Date('2024-08-10'),
        status: 'pending',
        acknowledgedAt: null,
        acknowledgedByUserId: null,
        overrideCount: 0
      },
      {
        intakeId: 2,
        medicationId: 10,
        doseId: 200,
        occurrenceDate: new Date('2024-08-10'),
        status: 'taken',
        acknowledgedAt: new Date('2024-08-10T14:00:00Z'),
        acknowledgedByUserId: 5,
        overrideCount: 1
      }
    ];
    const events: MedicationIntakeEvent[] = [
      { id: 1, intakeId: 1, medicationId: 10, doseId: 100, eventType: 'taken', occurredAt: new Date('2024-08-10T15:00:00Z'), actorUserId: 2 },
      { id: 2, intakeId: 2, medicationId: 10, doseId: 200, eventType: 'taken', occurredAt: new Date('2024-08-10T14:00:00Z'), actorUserId: 5 },
      { id: 3, intakeId: 2, medicationId: 10, doseId: 200, eventType: 'override', occurredAt: new Date('2024-08-10T14:10:00Z'), actorUserId: 5 }
    ];

    const occurrences = buildOccurrences(summaries, events);
    expect(occurrences).toHaveLength(2);
    const withHistory = occurrences.find((item) => item.intakeId === 2);
    expect(withHistory?.history).toHaveLength(2);
    expect(withHistory?.history?.[0].eventType).toBe('taken');
    expect(withHistory?.history?.[1].eventType).toBe('override');
  });

  it('finds occurrence by dose id', () => {
    const summaries: MedicationOccurrenceSummary[] = [
      {
        intakeId: 1,
        medicationId: 10,
        doseId: 100,
        occurrenceDate: new Date('2024-08-10'),
        status: 'pending',
        acknowledgedAt: null,
        acknowledgedByUserId: null,
        overrideCount: 0
      }
    ];
    expect(findOccurrenceForDose(summaries, 100)?.intakeId).toBe(1);
    expect(findOccurrenceForDose(summaries, 200)).toBeUndefined();
  });
});
