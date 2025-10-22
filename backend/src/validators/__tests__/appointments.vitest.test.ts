import { describe, expect, it } from 'vitest';
import { appointmentOwnerUpdateSchema } from '../appointments.js';

describe('appointmentOwnerUpdateSchema timezone validation', () => {
  it('accepts valid timezones', () => {
    const result = appointmentOwnerUpdateSchema.parse({
      summary: 'Checkup',
      startLocal: '2025-10-27T12:00:00',
      endLocal: '2025-10-27T13:00:00',
      startTimeZone: 'America/Chicago',
      endTimeZone: 'America/Chicago'
    });
    expect(result.startTimeZone).toBe('America/Chicago');
  });

  it('rejects invalid timezones', () => {
    expect(() =>
      appointmentOwnerUpdateSchema.parse({
        summary: 'Checkup',
        startLocal: '2025-10-27T12:00:00',
        endLocal: '2025-10-27T13:00:00',
        startTimeZone: 'America/Chiago'
      })
    ).toThrow(/Invalid time zone/);
  });
});
