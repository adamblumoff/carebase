import { describe, expect, it } from 'vitest';
import { formatInstantWithZone, isValidTimeZone } from '../timezone.js';

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
