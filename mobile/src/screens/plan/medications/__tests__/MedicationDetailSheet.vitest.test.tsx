import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MedicationWithDetails } from '@carebase/shared';
import { MedicationDetailSheet } from '../MedicationDetailSheet';
import { ThemeProvider } from '../../../../theme';

vi.mock('react-native', async () => {
  const actual = await vi.importActual<typeof import('react-native')>('react-native');
  return {
    ...actual,
    Modal: ({ children }: { children: React.ReactNode }) => <>{children}</>
  };
});

const renderWithTheme = (ui: React.ReactNode) =>
  render(<ThemeProvider>{ui}</ThemeProvider>);

const buildMedication = (): MedicationWithDetails => {
  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  return {
    id: 10,
    recipientId: 5,
    ownerId: 3,
    name: 'Lipitor',
    strengthValue: null,
    strengthUnit: null,
    form: null,
    instructions: 'Take once daily with food.',
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
    doses: [
      {
        id: 101,
        medicationId: 10,
        label: 'Morning',
        timeOfDay: '08:00',
        timezone: 'America/Chicago',
        reminderWindowMinutes: 120,
        isActive: true,
        createdAt: now,
        updatedAt: now
      }
    ],
    upcomingIntakes: [
      {
        id: 201,
        medicationId: 10,
        doseId: 101,
        scheduledFor: new Date(now.getTime() + 60 * 60 * 1000) as unknown as Date,
        acknowledgedAt: null,
        status: 'expired',
        actorUserId: null,
        occurrenceDate: new Date(now.getFullYear(), now.getMonth(), now.getDate()) as unknown as Date,
        overrideCount: 0,
        createdAt: now,
        updatedAt: now
      },
      {
        id: 203,
        medicationId: 10,
        doseId: 101,
        scheduledFor: new Date(now.getTime() + 2 * 60 * 60 * 1000) as unknown as Date,
        acknowledgedAt: now,
        status: 'taken',
        actorUserId: 3,
        occurrenceDate: new Date(now.getFullYear(), now.getMonth(), now.getDate()) as unknown as Date,
        overrideCount: 0,
        createdAt: now,
        updatedAt: now
      }
    ],
    occurrences: [
      {
        intakeId: 201,
        medicationId: 10,
        doseId: 101,
        occurrenceDate: new Date(now.getFullYear(), now.getMonth(), now.getDate()) as unknown as Date,
        status: 'pending',
        acknowledgedAt: null,
        acknowledgedByUserId: null,
        overrideCount: 0,
        history: []
      },
      {
        intakeId: 203,
        medicationId: 10,
        doseId: 101,
        occurrenceDate: new Date(now.getFullYear(), now.getMonth(), now.getDate()) as unknown as Date,
        status: 'taken',
        acknowledgedAt: now,
        acknowledgedByUserId: 3,
        overrideCount: 0,
        history: [
          {
            id: 2,
            intakeId: 203,
            medicationId: 10,
            doseId: 101,
            eventType: 'taken',
            occurredAt: now,
            actorUserId: 3
          }
        ]
      },
      {
        intakeId: 202,
        medicationId: 10,
        doseId: 101,
        occurrenceDate: new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate()) as unknown as Date,
        status: 'taken',
        acknowledgedAt: now,
        acknowledgedByUserId: 3,
        overrideCount: 0,
        history: [
          {
            id: 1,
            intakeId: 202,
            medicationId: 10,
            doseId: 101,
            eventType: 'taken',
            occurredAt: now,
            actorUserId: 3
          }
        ]
      }
    ],
    refillProjection: null
  };
};

describe('MedicationDetailSheet', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders medication details and triggers callbacks', () => {
    const medication = buildMedication();
    const onClose = vi.fn();
    const onToggleOccurrence = vi.fn().mockResolvedValue(undefined);
    const onConfirmOverride = vi.fn().mockResolvedValue(undefined);
    const onUndoOccurrence = vi.fn().mockResolvedValue(undefined);
    const onRecordNow = vi.fn();
    const onEdit = vi.fn();
    const onDeleteMedication = vi.fn();
    const onDeleteIntake = vi.fn();

    renderWithTheme(
      <MedicationDetailSheet
        visible
        medication={medication}
        canManage
        onClose={onClose}
        onToggleOccurrence={async (id, status) => onToggleOccurrence(id, status)}
        onConfirmOverride={async (id, status) => onConfirmOverride(id, status)}
        onUndoOccurrence={async (id) => onUndoOccurrence(id)}
        onRecordNow={async () => onRecordNow()}
        onEdit={onEdit}
        onDeleteMedication={async () => onDeleteMedication()}
        onDeleteIntake={async (id) => onDeleteIntake(id)}
        actionPending={false}
        actionError={null}
      />
    );

    expect(screen.getByText('Lipitor')).toBeTruthy();
    expect(screen.getByText('Take once daily with food.')).toBeTruthy();
    expect(screen.getByText(/Schedule/)).toBeTruthy();

    fireEvent.click(screen.getByText('Mark taken now'));
    expect(onRecordNow).toHaveBeenCalled();

    fireEvent.click(screen.getByText('Mark taken'));
    expect(onToggleOccurrence).toHaveBeenCalledWith(201, 'taken');

    fireEvent.click(screen.getByText('Skip'));
    expect(onToggleOccurrence).toHaveBeenCalledWith(201, 'skipped');

    fireEvent.click(screen.getByText('Edit'));
    expect(onEdit).toHaveBeenCalled();

    fireEvent.click(screen.getAllByText('Delete entry')[0]);
    expect(onDeleteIntake).toHaveBeenCalledWith(201);

    fireEvent.click(screen.getAllByText('Undo')[0]);
    expect(onUndoOccurrence).toHaveBeenCalledWith(203);

    fireEvent.click(screen.getByText('Override'));
    expect(onConfirmOverride).toHaveBeenCalledWith(203, 'taken');

    fireEvent.click(screen.getByText('Delete medication'));
    expect(onDeleteMedication).toHaveBeenCalled();

    fireEvent.click(screen.getByText('Close'));
    expect(onClose).toHaveBeenCalled();
  });

  it('displays daily dose count pill states', () => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const baseMedication = buildMedication();
    const commonProps = {
      visible: true,
      canManage: false,
      onClose: vi.fn(),
      onToggleOccurrence: async () => undefined,
      onConfirmOverride: async () => undefined,
      onUndoOccurrence: async () => undefined,
      onRecordNow: async () => undefined,
      onEdit: vi.fn(),
      onDeleteMedication: async () => undefined,
      onDeleteIntake: async () => undefined,
      actionPending: false,
      actionError: null
    };

    const pendingMedication: MedicationWithDetails = {
      ...baseMedication,
      occurrences: [
        {
          intakeId: 501,
          medicationId: baseMedication.id,
          doseId: 101,
          occurrenceDate: today,
          status: 'pending',
          acknowledgedAt: null,
          acknowledgedByUserId: null,
          overrideCount: 0,
          history: []
        }
      ],
      upcomingIntakes: []
    };

    const utils = renderWithTheme(
      <MedicationDetailSheet
        medication={pendingMedication}
        {...commonProps}
      />
    );

    const pendingPill = screen.getByText('0/1');
    expect(pendingPill.style.color).toBe('rgb(108, 143, 120)');
    expect(pendingPill.parentElement?.style.backgroundColor).toBe('rgb(216, 235, 222)');

    const takenMedication: MedicationWithDetails = {
      ...pendingMedication,
      occurrences: [
        {
          ...pendingMedication.occurrences[0]!,
          status: 'taken',
          acknowledgedAt: now,
          acknowledgedByUserId: 3,
          overrideCount: 0
        }
      ]
    };

    utils.rerender(
      <ThemeProvider>
        <MedicationDetailSheet
          medication={takenMedication}
          {...commonProps}
        />
      </ThemeProvider>
    );

    const takenPill = screen.getByText('1/1');
    expect(takenPill.style.color).toBe('rgb(22, 163, 74)');
    expect(takenPill.parentElement?.style.backgroundColor).toBe('rgb(220, 252, 231)');

    const overrideMedication: MedicationWithDetails = {
      ...takenMedication,
      occurrences: [
        {
          ...takenMedication.occurrences[0]!,
          overrideCount: 1
        }
      ]
    };

    utils.rerender(
      <ThemeProvider>
        <MedicationDetailSheet
          medication={overrideMedication}
          {...commonProps}
        />
      </ThemeProvider>
    );

    const overridePill = screen.getByText('2/1');
    expect(overridePill.style.color).toBe('rgb(220, 38, 38)');
    expect(overridePill.parentElement?.style.backgroundColor).toBe('rgb(254, 226, 226)');
  });
});
