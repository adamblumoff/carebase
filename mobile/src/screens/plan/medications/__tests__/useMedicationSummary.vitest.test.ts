import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MedicationDose, MedicationWithDetails } from '@carebase/shared';
import { computeMedicationDailyCount, useMedicationSummary } from '../useMedicationSummary';

const buildDose = (overrides: Partial<MedicationDose> = {}): MedicationDose => {
  const now = new Date();
  return {
    id: 1,
    medicationId: 1,
    label: 'Morning',
    timeOfDay: '08:00',
    timezone: 'America/Chicago',
    reminderWindowMinutes: 120,
    isActive: true,
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
};

const buildMedication = (overrides: Partial<MedicationWithDetails> = {}): MedicationWithDetails => {
  const now = new Date();
  return {
    id: 1,
    recipientId: 1,
    ownerId: 1,
    name: 'Lipitor',
    strengthValue: null,
    strengthUnit: null,
    form: null,
    instructions: null,
    notes: null,
    prescribingProvider: null,
    startDate: now,
    endDate: null,
    quantityOnHand: null,
    refillThreshold: null,
    preferredPharmacy: null,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    doses: [buildDose()],
    upcomingIntakes: [],
    occurrences: [],
    refillProjection: null,
    ...overrides
  };
};

describe('useMedicationSummary', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-03-01T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns next occurrence time and overdue indicator', () => {
    const future = new Date('2025-03-01T15:00:00Z');
    const meds = [
      buildMedication({
        upcomingIntakes: [
          {
            id: 10,
            medicationId: 1,
            doseId: 1,
            scheduledFor: future as unknown as Date,
            acknowledgedAt: null,
            status: 'expired',
            actorUserId: null,
            occurrenceDate: new Date('2025-03-01T00:00:00Z') as unknown as Date,
            overrideCount: 0,
            createdAt: future,
            updatedAt: future
          }
        ],
        occurrences: [
          {
            intakeId: 10,
            medicationId: 1,
            doseId: 1,
            occurrenceDate: new Date('2025-03-01T00:00:00Z') as unknown as Date,
            status: 'pending',
            acknowledgedAt: null,
            acknowledgedByUserId: null,
            overrideCount: 0,
            history: []
          }
        ]
      })
    ];

    const { result } = renderHook(() => useMedicationSummary(meds));

    expect(result.current[0]?.nextOccurrenceTime).toBe(future.toISOString());
    expect(result.current[0]?.isOverdue).toBe(true);
    expect(result.current[0]?.occurrences).toHaveLength(1);
  });

  it('hides future occurrences when today entries exist', () => {
    const today = new Date('2025-03-01T08:00:00Z');
    const tomorrow = new Date('2025-03-02T08:00:00Z');
    const meds = [
      buildMedication({
        occurrences: [
          {
            intakeId: 1,
            medicationId: 1,
            doseId: 1,
            occurrenceDate: today,
            status: 'taken',
            acknowledgedAt: today,
            acknowledgedByUserId: 1,
            overrideCount: 0,
            history: []
          },
          {
            intakeId: 2,
            medicationId: 1,
            doseId: 1,
            occurrenceDate: tomorrow,
            status: 'pending',
            acknowledgedAt: null,
            acknowledgedByUserId: null,
            overrideCount: 0,
            history: []
          }
        ],
        upcomingIntakes: [],
        doses: [buildDose()]
      })
    ];

    const { result } = renderHook(() => useMedicationSummary(meds));

    expect(result.current[0]?.occurrences).toHaveLength(1);
    expect(result.current[0]?.occurrences[0]?.status).toBe('taken');
  });

  it('falls back to next pending occurrence when today has none', () => {
    const tomorrow = new Date('2025-03-02T08:00:00Z');
    const meds = [
      buildMedication({
        occurrences: [
          {
            intakeId: 2,
            medicationId: 1,
            doseId: 1,
            occurrenceDate: tomorrow,
            status: 'pending',
            acknowledgedAt: null,
            acknowledgedByUserId: null,
            overrideCount: 0,
            history: []
          }
        ],
        upcomingIntakes: [],
        doses: [buildDose()]
      })
    ];

    const { result } = renderHook(() => useMedicationSummary(meds));

    expect(result.current[0]?.occurrences).toHaveLength(1);
    expect(result.current[0]?.occurrences[0]?.status).toBe('pending');
  });

  it('prefers the most recently updated dose label', () => {
    const older = new Date('2025-01-01T10:00:00Z');
    const newer = new Date('2025-01-02T10:00:00Z');
    const meds = [
      buildMedication({
        doses: [
          buildDose({ id: 1, label: 'Morning', updatedAt: older }),
          buildDose({ id: 2, label: 'Evening', updatedAt: newer })
        ],
        upcomingIntakes: [
          {
            id: 20,
            medicationId: 1,
            doseId: 2,
            scheduledFor: newer as unknown as Date,
            acknowledgedAt: null,
            status: 'expired',
            actorUserId: null,
            occurrenceDate: new Date('2025-01-02T00:00:00Z') as unknown as Date,
            overrideCount: 0,
            createdAt: newer,
            updatedAt: newer
          }
        ],
        occurrences: [
          {
            intakeId: 20,
            medicationId: 1,
            doseId: 2,
            occurrenceDate: new Date('2025-01-02T00:00:00Z') as unknown as Date,
            status: 'pending',
            acknowledgedAt: null,
            acknowledgedByUserId: null,
            overrideCount: 0,
            history: []
          }
        ]
      })
    ];

    const { result } = renderHook(() => useMedicationSummary(meds));

    expect(result.current[0]?.nextOccurrenceLabel).toBe('Evening');
  });

  it('returns both occurrences when occurrence dates straddle UTC midnight', () => {
    vi.setSystemTime(new Date('2025-02-28T12:00:00Z'));
    const meds = [
      buildMedication({
        doses: [
          buildDose({ id: 1, label: 'Morning', timezone: 'Pacific/Auckland' }),
          buildDose({ id: 2, label: 'Night', timezone: 'Pacific/Auckland', timeOfDay: '20:00:00' })
        ],
        upcomingIntakes: [
          {
            id: 11,
            medicationId: 1,
            doseId: 1,
            scheduledFor: '2025-03-01T08:00:00+13:00',
            acknowledgedAt: null,
            status: 'pending',
            actorUserId: null,
            occurrenceDate: new Date('2025-03-01T00:00:00Z') as unknown as Date,
            overrideCount: 0,
            createdAt: new Date('2025-03-01T08:00:00+13:00') as unknown as Date,
            updatedAt: new Date('2025-03-01T08:00:00+13:00') as unknown as Date
          },
          {
            id: 12,
            medicationId: 1,
            doseId: 2,
            scheduledFor: '2025-03-01T20:00:00+13:00',
            acknowledgedAt: null,
            status: 'pending',
            actorUserId: null,
            occurrenceDate: new Date('2025-03-01T00:00:00Z') as unknown as Date,
            overrideCount: 0,
            createdAt: new Date('2025-03-01T20:00:00+13:00') as unknown as Date,
            updatedAt: new Date('2025-03-01T20:00:00+13:00') as unknown as Date
          }
        ],
        occurrences: [
          {
            intakeId: 11,
            medicationId: 1,
            doseId: 1,
            occurrenceDate: new Date('2025-02-28T00:00:00Z'),
            status: 'pending',
            acknowledgedAt: null,
            acknowledgedByUserId: null,
            overrideCount: 0,
            history: []
          },
          {
            intakeId: 12,
            medicationId: 1,
            doseId: 2,
            occurrenceDate: new Date('2025-03-01T00:00:00Z'),
            status: 'pending',
            acknowledgedAt: null,
            acknowledgedByUserId: null,
            overrideCount: 0,
            history: []
          }
        ]
      })
    ];

    const { result } = renderHook(() => useMedicationSummary(meds));

    expect(result.current[0]?.occurrences).toHaveLength(2);
    expect(result.current[0]?.occurrences?.map((occ) => occ.label)).toEqual(['Morning', 'Night']);
  });
});

describe('computeMedicationDailyCount', () => {
  it('returns expected, taken, and override counts for today', () => {
    const today = new Date('2025-03-01T12:00:00Z');
    const meds = buildMedication({
      occurrences: [
        {
          intakeId: 1,
          medicationId: 1,
          doseId: 1,
          occurrenceDate: today,
          status: 'taken',
          acknowledgedAt: today,
          acknowledgedByUserId: 1,
          overrideCount: 2,
          history: []
        },
        {
          intakeId: 2,
          medicationId: 1,
          doseId: 2,
          occurrenceDate: today,
          status: 'skipped',
          acknowledgedAt: today,
          acknowledgedByUserId: 1,
          overrideCount: 0,
          history: []
        },
        {
          intakeId: 3,
          medicationId: 1,
          doseId: 1,
          occurrenceDate: new Date('2025-02-28T12:00:00Z'),
          status: 'taken',
          acknowledgedAt: today,
          acknowledgedByUserId: 1,
          overrideCount: 0,
          history: []
        }
      ],
      doses: [buildDose({ id: 1 }), buildDose({ id: 2 })]
    });

    const summary = computeMedicationDailyCount(meds, today);

    expect(summary.expectedCount).toBe(2);
    expect(summary.takenCount).toBe(1);
    expect(summary.overrideCount).toBe(0);
    expect(summary.recordedCount).toBe(1);
    expect(summary.skippedCount).toBe(1);
  });
});
