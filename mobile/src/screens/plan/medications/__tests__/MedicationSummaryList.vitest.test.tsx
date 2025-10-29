import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MedicationSummaryList } from '../MedicationSummaryList';
import type { MedicationSummaryItem } from '../useMedicationSummary';
import { ThemeProvider } from '../../../../theme';

const renderWithTheme = (ui: React.ReactNode) =>
  render(<ThemeProvider>{ui}</ThemeProvider>);

describe('MedicationSummaryList', () => {
  it('renders medication cards and emits selection', () => {
    const onSelect = vi.fn();
    const items: MedicationSummaryItem[] = [
      {
        id: 1,
        name: 'Lipitor',
        nextDoseLabel: 'Morning',
        nextDoseTime: new Date('2025-01-01T15:00:00Z').toISOString(),
        isOverdue: true,
        isArchived: false
      },
      {
        id: 2,
        name: 'Metformin',
        nextDoseLabel: 'Evening',
        nextDoseTime: null,
        isOverdue: false,
        isArchived: false
      }
    ];

    renderWithTheme(<MedicationSummaryList items={items} onSelect={onSelect} />);

    expect(screen.getByText('Lipitor')).toBeTruthy();
    expect(screen.getByText('Overdue')).toBeTruthy();
    expect(screen.getByText('Metformin')).toBeTruthy();
    expect(screen.getByText('No upcoming doses')).toBeTruthy();

    fireEvent.click(screen.getByText('Lipitor'));
    expect(onSelect).toHaveBeenCalledWith(1);
  });
});
