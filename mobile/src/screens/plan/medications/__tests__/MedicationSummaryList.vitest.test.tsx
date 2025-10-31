import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MedicationSummaryList } from '../MedicationSummaryList';
import type { MedicationSummaryItem } from '../useMedicationSummary';
import { ThemeProvider } from '../../../../theme';
import type { MedicationIntakeStatus } from '@carebase/shared';

const renderWithTheme = (ui: React.ReactNode) =>
  render(<ThemeProvider>{ui}</ThemeProvider>);

describe('MedicationSummaryList', () => {
  it('renders medication cards and emits selection', () => {
    const onSelect = vi.fn();
    const onToggle = vi.fn().mockResolvedValue(undefined);
    const onUndo = vi.fn().mockResolvedValue(undefined);
    const items: MedicationSummaryItem[] = [
      {
        id: 1,
        name: 'Lipitor',
        nextOccurrenceLabel: 'Morning',
        nextOccurrenceTime: new Date('2025-01-01T15:00:00Z').toISOString(),
        isOverdue: true,
        isArchived: false,
        occurrences: [
          {
            intakeId: 10,
            label: 'Morning',
            status: 'pending',
            scheduledFor: new Date('2025-01-01T15:00:00Z').toISOString(),
            timezone: 'America/Chicago',
            isOverdue: true
          }
        ]
      },
      {
        id: 2,
        name: 'Metformin',
        nextOccurrenceLabel: 'Evening',
        nextOccurrenceTime: null,
        isOverdue: false,
        isArchived: false,
        occurrences: []
      }
    ];

    renderWithTheme(
      <MedicationSummaryList
        items={items}
        onSelect={onSelect}
        onToggleOccurrence={onToggle}
        onUndoOccurrence={onUndo}
        canManage
      />
    );

    expect(screen.getByText('Lipitor')).toBeTruthy();
    expect(screen.getByText('Overdue')).toBeTruthy();
    expect(screen.getByText('Metformin')).toBeTruthy();
    expect(screen.getByText('No upcoming doses')).toBeTruthy();

    fireEvent.click(screen.getByText('Lipitor'));
    expect(onSelect).toHaveBeenCalledWith(1);

    const chipButton = screen.getByTestId('medication-chip-1-10');
    fireEvent.click(chipButton);
    expect(onToggle).toHaveBeenCalledWith(1, 10, 'taken');
  });
});
