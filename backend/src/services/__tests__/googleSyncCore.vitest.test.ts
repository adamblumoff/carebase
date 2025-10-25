import { beforeEach, describe, expect, it, vi } from 'vitest';

const queryMocks = vi.hoisted(() => ({
  upsertGoogleCredential: vi.fn(),
  queueGoogleSyncForUser: vi.fn(),
  listPendingGoogleSyncItems: vi.fn(),
  getAppointmentByItemId: vi.fn(),
  getBillByItemId: vi.fn(),
  markGoogleSyncSuccess: vi.fn(),
  markGoogleSyncError: vi.fn(),
  markGoogleSyncPending: vi.fn(),
  deleteGoogleSyncLink: vi.fn(),
  getItemOwnerUserId: vi.fn(),
  updateAppointment: vi.fn(),
  updateBill: vi.fn()
}));

const configMocks = vi.hoisted(() => ({
  getGoogleSyncConfig: vi.fn(() => ({
    lookbackDays: 30,
    debounceMs: 15,
    retryBaseMs: 1000,
    retryMaxMs: 5000,
    pollIntervalMs: 60000,
    enableInTest: true,
    enablePollingFallback: false,
    defaultTimeZone: 'UTC'
  })),
  isTestEnv: vi.fn(() => true)
}));

const loggerMocks = vi.hoisted(() => ({
  logError: vi.fn(),
  logInfo: vi.fn(),
  logWarn: vi.fn()
}));

const httpMocks = vi.hoisted(() => ({
  googleJsonRequest: vi.fn(),
  GOOGLE_CALENDAR_API: 'https://googleapis.test/calendar/v3'
}));

const authMocks = vi.hoisted(() => ({
  ensureValidAccessToken: vi.fn()
}));

const managedCalendarMocks = vi.hoisted(() => ({
  ensureManagedCalendarForUser: vi.fn(),
  ensureManagedCalendarAclForUser: vi.fn(),
  migrateEventsToManagedCalendar: vi.fn(),
  normalizeCalendarId: vi.fn((value: string | null) => value ?? 'primary'),
  MANAGED_CALENDAR_ACL_REFRESH_INTERVAL_MS: 60 * 60 * 1000
}));

const watcherMocks = vi.hoisted(() => ({
  ensureCalendarWatchForUser: vi.fn(),
  handleGoogleWatchNotification: vi.fn(),
  stopCalendarWatchForUser: vi.fn(),
  configureWatchEnvironment: vi.fn()
}));

const transformMocks = vi.hoisted(() => ({
  calculateAppointmentHash: vi.fn(() => 'appointment-hash'),
  calculateBillHash: vi.fn(() => 'bill-hash'),
  buildAppointmentEventPayload: vi.fn(),
  buildBillEventPayload: vi.fn(),
  applyGoogleAppointmentUpdate: vi.fn(),
  applyGoogleBillUpdate: vi.fn()
}));

const syncOperationMocks = vi.hoisted(() => ({
  pushAppointment: vi.fn(),
  pushBill: vi.fn(),
  pullGoogleChanges: vi.fn()
}));

const runtimeMocks = vi.hoisted(() => ({
  initializeGoogleSyncRuntime: vi.fn(),
  setSyncRunner: vi.fn(),
  scheduleGoogleSyncForUser: vi.fn(),
  startGoogleSyncPolling: vi.fn(),
  stopGoogleSyncPolling: vi.fn(),
  __setGoogleSyncRunnerForTests: vi.fn(),
  __resetGoogleSyncStateForTests: vi.fn(),
  __setGoogleSyncSchedulerForTests: vi.fn(),
  __setGoogleSyncLockBehaviorForTests: vi.fn()
}));

vi.mock('../../db/queries.js', () => queryMocks);
vi.mock('../googleSync/config.js', () => configMocks);
vi.mock('../googleSync/logger.js', () => loggerMocks);
vi.mock('../googleSync/http.js', () => httpMocks);
vi.mock('../googleSync/auth.js', () => authMocks);
vi.mock('../googleSync/managedCalendars.js', () => managedCalendarMocks);
vi.mock('../googleSync/watchers.js', () => watcherMocks);
vi.mock('../googleSync/eventTransforms.js', () => transformMocks);
vi.mock('../googleSync/syncOperations.js', () => syncOperationMocks);
vi.mock('../googleSync/runtime.js', () => runtimeMocks);

const { refreshManagedCalendarWatch, syncUserWithGoogle } = await import('../googleSync.js');

const credential = {
  userId: 42,
  accessToken: 'access',
  refreshToken: 'refresh',
  scope: ['calendar'],
  expiresAt: null,
  tokenType: 'Bearer',
  idToken: null,
  calendarId: null,
  managedCalendarId: null,
  managedCalendarSummary: null,
  managedCalendarState: 'pending',
  managedCalendarVerifiedAt: null,
  managedCalendarAclRole: 'reader',
  legacyCalendarId: null,
  syncToken: null,
  lastPulledAt: null,
  clerkUserId: 'user_123'
};

beforeEach(() => {
  vi.clearAllMocks();

  authMocks.ensureValidAccessToken.mockResolvedValue({
    credential: { ...credential },
    accessToken: 'live-access-token'
  });
  managedCalendarMocks.ensureManagedCalendarForUser.mockResolvedValue({ calendarId: 'managed-calendar' });
  managedCalendarMocks.migrateEventsToManagedCalendar.mockResolvedValue({ previousCalendarIds: ['legacy-1'] });
  managedCalendarMocks.ensureManagedCalendarAclForUser.mockResolvedValue(undefined);
  queryMocks.queueGoogleSyncForUser.mockResolvedValue(undefined);
  queryMocks.upsertGoogleCredential.mockResolvedValue(undefined);
  queryMocks.listPendingGoogleSyncItems.mockResolvedValue([]);
  syncOperationMocks.pullGoogleChanges.mockResolvedValue(undefined);
});

describe('refreshManagedCalendarWatch', () => {
  it('stops previous watches and tolerates stop failures', async () => {
    const stopError = new Error('network-failure');
    watcherMocks.stopCalendarWatchForUser.mockRejectedValueOnce(stopError);

    await refreshManagedCalendarWatch({ ...credential }, 'token', 'primary', ['legacy-1', 'legacy-2']);

    expect(watcherMocks.stopCalendarWatchForUser).toHaveBeenCalledWith(42);
    expect(loggerMocks.logWarn).toHaveBeenCalledWith(
      'Failed to stop existing Google watch channel during managed calendar migration',
      expect.objectContaining({ userId: 42, error: 'network-failure' })
    );
    expect(watcherMocks.ensureCalendarWatchForUser).toHaveBeenCalledWith(42, 'token', 'primary', 'user_123');
  });

  it('ensures calendar watch and logs warning when ensure fails', async () => {
    watcherMocks.ensureCalendarWatchForUser.mockRejectedValueOnce(new Error('ensure-failed'));

    await refreshManagedCalendarWatch({ ...credential }, 'token', 'primary', []);

    expect(loggerMocks.logWarn).toHaveBeenCalledWith(
      'Failed to ensure Google watch for managed calendar',
      expect.objectContaining({ userId: 42, calendarId: 'primary', error: 'ensure-failed' })
    );
  });
});

describe('syncUserWithGoogle', () => {
  it('queues initial sync and captures downstream errors for appointments', async () => {
    queryMocks.listPendingGoogleSyncItems.mockResolvedValueOnce([
      { itemId: 800, itemType: 'appointment' }
    ]);
    queryMocks.getAppointmentByItemId.mockResolvedValueOnce({
      id: 200,
      itemId: 800,
      googleSync: { eventId: 'evt', syncStatus: 'pending' }
    });
    syncOperationMocks.pushAppointment.mockRejectedValueOnce(new Error('push failed'));

    const summary = await syncUserWithGoogle(42, { forceFull: true });

    expect(queryMocks.queueGoogleSyncForUser).toHaveBeenCalledWith(42, 'managed-calendar', { schedule: false });
    expect(syncOperationMocks.pullGoogleChanges).toHaveBeenCalledWith(
      'live-access-token',
      expect.objectContaining({ userId: 42, calendarId: 'managed-calendar' }),
      'managed-calendar',
      expect.any(Object)
    );
    expect(queryMocks.markGoogleSyncError).toHaveBeenCalledWith(800, 'push failed');
    expect(summary.errors).toEqual([expect.objectContaining({ itemId: 800, message: 'push failed' })]);
  });

  it('skips remote pull when explicitly disabled', async () => {
    const summary = await syncUserWithGoogle(42, { pullRemote: false });

    expect(syncOperationMocks.pullGoogleChanges).not.toHaveBeenCalled();
    expect(summary.errors).toEqual([]);
  });
});
