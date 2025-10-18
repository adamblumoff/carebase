import { describe, expect, it, vi } from 'vitest';
import type { Appointment } from '@carebase/shared';

describe('google sync timezone formatting', () => {
  it('formats appointment dateTimes using configured timezone offsets', async () => {
    process.env.GOOGLE_SYNC_DEFAULT_TIME_ZONE = 'America/Chicago';
    vi.resetModules();

    const googleSyncModule: any = await import('../googleSync.ts');
    const appointment: Appointment = {
      id: 1,
      itemId: 42,
      startLocal: new Date(Date.UTC(2025, 9, 20, 10, 0, 0)), // 10:00 local stored as naive UTC
      endLocal: new Date(Date.UTC(2025, 9, 20, 11, 30, 0)),
      location: 'Clinic',
      prepNote: null,
      summary: 'Follow-up',
      icsToken: 'ics-token-1',
      assignedCollaboratorId: null,
      createdAt: new Date(Date.UTC(2025, 9, 1, 12, 0, 0)),
      googleSync: null
    };

    const payload = googleSyncModule.__testing.buildAppointmentEventPayload(appointment);
    expect(payload.start.timeZone).toBe('America/Chicago');
    expect(payload.start.dateTime).toBe('2025-10-20T10:00:00-05:00');
    expect(payload.end?.timeZone).toBe('America/Chicago');
    expect(payload.end?.dateTime).toBe('2025-10-20T11:30:00-05:00');

    delete process.env.GOOGLE_SYNC_DEFAULT_TIME_ZONE;
  });
});
