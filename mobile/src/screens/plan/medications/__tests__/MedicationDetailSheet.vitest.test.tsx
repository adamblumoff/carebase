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
        createdAt: now,
        updatedAt: now
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
    const onMarkTaken = vi.fn();
    const onMarkSkipped = vi.fn();
    const onRecordNow = vi.fn();
    const onEdit = vi.fn();

    renderWithTheme(
      <MedicationDetailSheet
        visible
        medication={medication}
        canManage
        onClose={onClose}
        onMarkTaken={async (id) => onMarkTaken(id)}
        onMarkSkipped={async (id) => onMarkSkipped(id)}
        onRecordNow={async () => onRecordNow()}
        onEdit={onEdit}
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
    expect(onMarkTaken).toHaveBeenCalledWith(201);

    fireEvent.click(screen.getByText('Skip'));
    expect(onMarkSkipped).toHaveBeenCalledWith(201);

    fireEvent.click(screen.getByText('Edit'));
    expect(onEdit).toHaveBeenCalled();

    fireEvent.click(screen.getByText('Close'));
    expect(onClose).toHaveBeenCalled();
  });
});
