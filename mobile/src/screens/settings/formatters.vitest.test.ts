import { describe, expect, it, vi } from 'vitest';
import { formatLastSynced } from './formatters';

describe('settings formatters', () => {
  it('returns fallback for null values', () => {
    expect(formatLastSynced(null)).toBe('Never synced');
  });

  it('formats valid dates with locale string', () => {
    const date = new Date('2025-02-01T12:00:00Z');
    const result = formatLastSynced(date);
    expect(result).toEqual(date.toLocaleString());
  });

  it('handles toLocaleString errors by returning Unknown', () => {
    const date = new Date('2025-02-01T12:00:00Z');
    const spy = vi.spyOn(date, 'toLocaleString').mockImplementation(() => {
      throw new Error('Boom');
    });
    expect(formatLastSynced(date)).toBe('Unknown');
    spy.mockRestore();
  });
});
