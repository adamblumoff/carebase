import { describe, expect, it } from 'vitest';
import {
  formatDisplayDate,
  formatDisplayTime,
  formatForPayload,
  parseServerDate,
} from '../date';

describe('date utilities', () => {
  it('parseServerDate converts ISO strings to Date', () => {
    const date = parseServerDate('2025-01-02T03:04:05Z');
    expect(date).toBeInstanceOf(Date);
    expect(date.toISOString()).toBe('2025-01-02T03:04:05.000Z');
  });

  it('formatDisplayDate produces human readable label', () => {
    const date = new Date('2025-03-15T10:00:00Z');
    const label = formatDisplayDate(date);
    expect(label).toMatch(/Mar/);
  });

  it('formatDisplayTime formats hour and minutes', () => {
    const date = new Date('2025-03-15T10:05:00Z');
    const label = formatDisplayTime(date);
    expect(label).toMatch(/:/);
    expect(label).toMatch(/05/);
  });

  it('formatForPayload returns ISO-like string without timezone suffix', () => {
    const date = new Date('2025-04-01T09:08:07Z');
    const payload = formatForPayload(date);
    const expected = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
      date.getDate()
    ).padStart(2, '0')}T${String(date.getHours()).padStart(2, '0')}:${String(
      date.getMinutes()
    ).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`;
    expect(payload).toBe(expected);
  });
});
