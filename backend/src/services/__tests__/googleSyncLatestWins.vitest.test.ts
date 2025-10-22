import { describe, expect, it, vi } from 'vitest';
import type { GoogleSyncSummary } from '../googleSync.js';
import type { Appointment } from '@carebase/shared';

const mockQueries = {
  findGoogleSyncLinkByEvent: vi.fn(),
  getAppointmentByItemId: vi.fn(),
  getItemOwnerUserId: vi.fn(),
  markGoogleSyncSuccess: vi.fn(),
  upsertGoogleCredential: vi.fn(async () => {}),
  updateAppointment: vi.fn()
};

vi.mock('../../db/queries.js', () => mockQueries);

const mockSchedule = vi.fn();

const { pullGoogleChanges } = await (async () => {
  const result = await vi.importActual<typeof import('../googleSync.js')>('../googleSync.js');
  vi.mock('../googleSync.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../googleSync.js')>();
    return {
      ...actual,
      scheduleGoogleSyncForUser: mockSchedule
    };
  });
  return result;
})();

interface FakeEvent {
  id: string;
  updated: string;
  status?: string;
  summary?: string;
  extendedProperties?: {
    private?: Record<string, string>;
  };
  start?: {
    dateTime?: string;
    timeZone?: string;
  };
  end?: {
    dateTime?: string;
    timeZone?: string;
  };
}

function createAppointment(overrides: Partial<Appointment> = {}): Appointment {
  const now = new Date();
  return {
    id: 1,
    itemId: 900,
    startLocal: now,
    endLocal: new Date(now.getTime() + 3600000),
    startTimeZone: 'UTC',
    endTimeZone: 'UTC',
    startOffset: '+00:00',
    endOffset: '+00:00',
    location: 'Clinic',
    prepNote: 'Bring ID',
    summary: 'Consultation',
    icsToken: 'ics-token',
    createdAt: now,
    assignedCollaboratorId: null,
    googleSync: {
      calendarId: 'primary',
      eventId: 'evt-1',
      etag: '"etag-1"',
      lastSyncedAt: now,
      lastSyncDirection: 'push',
      localHash: 'hash-1',
      remoteUpdatedAt: new Date(now.getTime() - 60000),
      syncStatus: 'idle',
      lastError: null
    },
    ...overrides
  };
}

function createEvent(overrides: Partial<FakeEvent> = {}): FakeEvent {
  const now = new Date();
  return {
    id: 'evt-1',
    updated: new Date(now.getTime() + 120000).toISOString(),
    summary: 'Updated summary',
    extendedProperties: {
      private: {
        carebaseItemId: '900',
        carebaseType: 'appointment'
      }
    },
    start: { dateTime: new Date(now.getTime() + 180000).toISOString() },
    end: { dateTime: new Date(now.getTime() + 360000).toISOString() },
    ...overrides
  };
}

describe('google sync latest write wins', () => {
  it('applies remote update when Google timestamp is newer', async () => {
    const accessToken = 'token';
    const summary: GoogleSyncSummary = { calendarId: 'primary', pushed: 0, pulled: 0, deleted: 0, errors: [] };
    const appointment = createAppointment();
    const remoteEvent = createEvent({ summary: 'Remote title' });

    mockQueries.getItemOwnerUserId.mockResolvedValueOnce(42);
    mockQueries.findGoogleSyncLinkByEvent.mockResolvedValueOnce({ itemId: appointment.itemId });
    mockQueries.getAppointmentByItemId.mockResolvedValueOnce(appointment);
    mockQueries.updateAppointment.mockResolvedValueOnce({ ...appointment, summary: 'Remote title' });
    mockQueries.markGoogleSyncSuccess.mockResolvedValueOnce(undefined);

    const credential = {
      userId: 42,
      accessToken: 'ignored',
      refreshToken: 'refresh',
      scope: [''],
      expiresAt: null,
      tokenType: null,
      idToken: null,
      calendarId: 'primary',
      syncToken: 'sync-1',
      lastPulledAt: null
    };

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (typeof url === 'string' && url.includes('/events')) {
        return new Response(JSON.stringify({ items: [remoteEvent], nextSyncToken: 'sync-2' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      throw new Error(`Unexpected fetch url: ${url}`);
    });

    await pullGoogleChanges(accessToken, credential as any, 'primary', summary);

    expect(mockQueries.updateAppointment).toHaveBeenCalledWith(
      appointment.id,
      42,
      expect.objectContaining({ summary: 'Remote title' }),
      { queueGoogleSync: false }
    );
    expect(summary.pulled).toBe(1);
    fetchMock.mockRestore();
  });

  it('captures remote timezone data when applying updates', async () => {
    const accessToken = 'token';
    const summary: GoogleSyncSummary = { calendarId: 'primary', pushed: 0, pulled: 0, deleted: 0, errors: [] };
    const appointment = createAppointment();
    const remoteEvent = createEvent({
      start: { dateTime: '2025-10-22T12:00:00-05:00', timeZone: 'America/Chicago' },
      end: { dateTime: '2025-10-22T13:00:00-05:00', timeZone: 'America/Chicago' }
    });

    mockQueries.getItemOwnerUserId.mockResolvedValueOnce(42);
    mockQueries.findGoogleSyncLinkByEvent.mockResolvedValueOnce({ itemId: appointment.itemId });
    mockQueries.getAppointmentByItemId.mockResolvedValueOnce(appointment);
    mockQueries.updateAppointment.mockResolvedValueOnce({ ...appointment });
    mockQueries.markGoogleSyncSuccess.mockResolvedValueOnce(undefined);

    const credential = {
      userId: 42,
      accessToken: 'ignored',
      refreshToken: 'refresh',
      scope: [''],
      expiresAt: null,
      tokenType: null,
      idToken: null,
      calendarId: 'primary',
      syncToken: 'sync-1',
      lastPulledAt: null
    };

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (typeof url === 'string' && url.includes('/events')) {
        return new Response(JSON.stringify({ items: [remoteEvent], nextSyncToken: 'sync-3' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      throw new Error(`Unexpected fetch url: ${url}`);
    });

    await pullGoogleChanges(accessToken, credential as any, 'primary', summary);

    expect(mockQueries.updateAppointment).toHaveBeenCalledWith(
      appointment.id,
      42,
      expect.objectContaining({
        startLocal: '2025-10-22T12:00:00',
        endLocal: '2025-10-22T13:00:00',
        startTimeZone: 'America/Chicago',
        endTimeZone: 'America/Chicago'
      }),
      { queueGoogleSync: false }
    );
    fetchMock.mockRestore();
  });

  it('falls back to default timezone when Google omits tz but provides offset', async () => {
    process.env.GOOGLE_SYNC_DEFAULT_TIME_ZONE = 'America/Chicago';

    const accessToken = 'token';
    const summary: GoogleSyncSummary = { calendarId: 'primary', pushed: 0, pulled: 0, deleted: 0, errors: [] };
    const appointment = createAppointment({ startTimeZone: null, endTimeZone: null, startOffset: null, endOffset: null });
    const remoteEvent = createEvent({
      start: { dateTime: '2025-11-01T12:00:00-05:00' },
      end: { dateTime: '2025-11-01T13:00:00-05:00' }
    });

    mockQueries.getItemOwnerUserId.mockResolvedValueOnce(42);
    mockQueries.findGoogleSyncLinkByEvent.mockResolvedValueOnce({ itemId: appointment.itemId });
    mockQueries.getAppointmentByItemId.mockResolvedValueOnce(appointment);
    mockQueries.updateAppointment.mockResolvedValueOnce({ ...appointment, startTimeZone: 'America/Chicago', endTimeZone: 'America/Chicago', startOffset: '-05:00', endOffset: '-05:00' });
    mockQueries.markGoogleSyncSuccess.mockResolvedValueOnce(undefined);

    const credential = {
      userId: 42,
      accessToken: 'ignored',
      refreshToken: 'refresh',
      scope: [''],
      expiresAt: null,
      tokenType: null,
      idToken: null,
      calendarId: 'primary',
      syncToken: 'sync-4',
      lastPulledAt: null
    };

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (typeof url === 'string' && url.includes('/events')) {
        return new Response(JSON.stringify({ items: [remoteEvent], nextSyncToken: 'sync-5' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      throw new Error(`Unexpected fetch url: ${url}`);
    });

    await pullGoogleChanges(accessToken, credential as any, 'primary', summary);

    expect(mockQueries.updateAppointment).toHaveBeenCalledWith(
      appointment.id,
      42,
      expect.objectContaining({
        startTimeZone: 'America/Chicago',
        endTimeZone: 'America/Chicago',
        startOffset: '-05:00',
        endOffset: '-05:00'
      }),
      { queueGoogleSync: false }
    );

    delete process.env.GOOGLE_SYNC_DEFAULT_TIME_ZONE;
    fetchMock.mockRestore();
  });
});
