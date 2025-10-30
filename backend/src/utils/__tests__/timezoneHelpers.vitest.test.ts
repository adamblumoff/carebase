import { describe, expect, it } from 'vitest';
import { combineDateWithTimeZone, formatInstantWithZone, isValidTimeZone } from '../timezone.js';

describe('formatInstantWithZone', () => {
  it('returns ISO string with correct offset for zoned instant', () => {
    const date = new Date('2025-10-27T17:00:00Z');
    const result = formatInstantWithZone(date, 'America/Chicago');
    expect(result).toEqual({ dateTime: '2025-10-27T12:00:00-05:00', timeZone: 'America/Chicago' });
  });

  it('throws RangeError for invalid timezone', () => {
    const date = new Date('2025-10-27T17:00:00Z');
    expect(() => formatInstantWithZone(date, 'America/Chiago')).toThrow(RangeError);
  });

  it('detects valid and invalid timezones', () => {
    expect(isValidTimeZone('America/Chicago')).toBe(true);
    expect(isValidTimeZone('America/Chiago')).toBe(false);
  });
});

describe('combineDateWithTimeZone', () => {
  it('combines occurrence date and time of day using timezone offset', () => {
    const occurrenceDate = new Date(Date.UTC(2025, 2, 1)); // 2025-03-01 UTC midnight
    const result = combineDateWithTimeZone(occurrenceDate, '08:00:00', 'America/New_York');
    expect(result.toISOString()).toBe('2025-03-01T13:00:00.000Z');

    const tokyoResult = combineDateWithTimeZone(occurrenceDate, '21:30:00', 'Asia/Tokyo');
    expect(tokyoResult.toISOString()).toBe('2025-03-01T12:30:00.000Z');
  });
});
