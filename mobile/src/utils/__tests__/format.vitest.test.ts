import { describe, expect, it } from 'vitest';
import { formatCurrency } from '../format';

describe('formatCurrency', () => {
  it('formats amounts using specified currency', () => {
    expect(formatCurrency(123.45, { currency: 'USD' })).toBe('$123.45');
  });

  it('handles nullish values with fallback label', () => {
    expect(formatCurrency(null)).toBe('Unknown amount');
    expect(formatCurrency(undefined, { unknownLabel: 'N/A' })).toBe('N/A');
  });
});
