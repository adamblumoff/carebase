import { describe, expect, it } from 'vitest';
import type { Appointment } from '@carebase/shared';
import { toAppointmentPayload } from '../planPayload.js';

describe('plan payload timezone handling', () => {
  it('includes appointment-specific timezone offsets in payload', () => {
    const appointment: Appointment = {
      id: 101,
      itemId: 202,
      startLocal: new Date('2025-10-22T12:00:00-04:00'),
      endLocal: new Date('2025-10-22T13:00:00-04:00'),
      startTimeZone: 'America/New_York',
      endTimeZone: 'America/New_York',
      startOffset: '-04:00',
      endOffset: '-04:00',
      location: null,
      prepNote: null,
      summary: 'Therapy',
      icsToken: 'ics-token-3',
      assignedCollaboratorId: null,
      createdAt: new Date(Date.UTC(2025, 9, 1, 14, 0, 0)),
      googleSync: null
    };

    const payload = toAppointmentPayload(appointment);
    expect(payload.startLocal).toBe('2025-10-22T12:00:00-04:00');
    expect(payload.endLocal).toBe('2025-10-22T13:00:00-04:00');
  });

  it('falls back to configured default timezone when appointment timezone missing', () => {
    const previousDefaultTz = process.env.DEFAULT_TIME_ZONE;
    const previousGoogleSyncTz = process.env.GOOGLE_SYNC_DEFAULT_TIME_ZONE;
    process.env.GOOGLE_SYNC_DEFAULT_TIME_ZONE = 'America/Chicago';
    process.env.DEFAULT_TIME_ZONE = 'America/Chicago';

    const appointment: Appointment = {
      id: 303,
      itemId: 404,
      startLocal: new Date('2025-09-01T15:30:00-05:00'),
      endLocal: new Date('2025-09-01T16:30:00-05:00'),
      startTimeZone: null,
      endTimeZone: null,
      startOffset: null,
      endOffset: null,
      location: null,
      prepNote: null,
      summary: 'Consult',
      icsToken: 'ics-token-4',
      assignedCollaboratorId: null,
      createdAt: new Date(Date.UTC(2025, 7, 20, 12, 0, 0)),
      googleSync: null
    };

    const payload = toAppointmentPayload(appointment);
    expect(payload.startLocal).toBe('2025-09-01T15:30:00-05:00');
    expect(payload.endLocal).toBe('2025-09-01T16:30:00-05:00');

    if (previousDefaultTz === undefined) {
      delete process.env.DEFAULT_TIME_ZONE;
    } else {
      process.env.DEFAULT_TIME_ZONE = previousDefaultTz;
    }
    if (previousGoogleSyncTz === undefined) {
      delete process.env.GOOGLE_SYNC_DEFAULT_TIME_ZONE;
    } else {
      process.env.GOOGLE_SYNC_DEFAULT_TIME_ZONE = previousGoogleSyncTz;
    }
  });
});
