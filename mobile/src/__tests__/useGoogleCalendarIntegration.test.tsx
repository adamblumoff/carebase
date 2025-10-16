import { renderHook, act, waitFor } from '@testing-library/react-native';
import { useGoogleCalendarIntegration } from '../hooks/useGoogleCalendarIntegration';

jest.mock('expo-web-browser', () => ({
  maybeCompleteAuthSession: jest.fn(),
  openAuthSessionAsync: jest.fn()
}));

const mockBeginGoogleIntegrationConnect = jest.fn();
const mockDisconnectGoogleIntegration = jest.fn();
const mockFetchGoogleIntegrationStatus = jest.fn();
const mockTriggerGoogleManualSync = jest.fn();

jest.mock('../api/googleIntegration', () => ({
  beginGoogleIntegrationConnect: (...args: any[]) => mockBeginGoogleIntegrationConnect(...args),
  disconnectGoogleIntegration: (...args: any[]) => mockDisconnectGoogleIntegration(...args),
  fetchGoogleIntegrationStatus: (...args: any[]) => mockFetchGoogleIntegrationStatus(...args),
  triggerGoogleManualSync: (...args: any[]) => mockTriggerGoogleManualSync(...args)
}));

const webBrowser = require('expo-web-browser');

describe('useGoogleCalendarIntegration', () => {
  let consoleErrorSpy: jest.SpyInstance;
  let consoleLogSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    mockFetchGoogleIntegrationStatus.mockResolvedValue({
      connected: false,
      calendarId: null,
      lastSyncedAt: null,
      syncPendingCount: 0,
      lastError: null
    });
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    consoleLogSpy.mockRestore();
  });

  it('loads initial status and normalizes dates', async () => {
    const lastSyncedAt = '2025-10-15T12:00:00.000Z';
    mockFetchGoogleIntegrationStatus.mockResolvedValueOnce({
      connected: true,
      calendarId: 'primary',
      lastSyncedAt,
      syncPendingCount: 1,
      lastError: null
    });

    const { result } = renderHook(() => useGoogleCalendarIntegration());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.status?.connected).toBe(true);
    expect(result.current.status?.lastSyncedAt).toBeInstanceOf(Date);
    expect(result.current.status?.lastSyncedAt?.toISOString()).toBe(lastSyncedAt);
  });

  it('completes connect flow and refreshes status on success', async () => {
    mockFetchGoogleIntegrationStatus.mockResolvedValueOnce({
      connected: false,
      calendarId: null,
      lastSyncedAt: null,
      syncPendingCount: 0,
      lastError: null
    });
    mockFetchGoogleIntegrationStatus.mockResolvedValueOnce({
      connected: true,
      calendarId: 'primary',
      lastSyncedAt: null,
      syncPendingCount: 0,
      lastError: null
    });

    mockBeginGoogleIntegrationConnect.mockResolvedValue({
      authUrl: 'https://accounts.google.com/o/oauth2/v2/auth'
    });
    (webBrowser.openAuthSessionAsync as jest.Mock).mockResolvedValue({
      type: 'success',
      url: 'carebase://integrations/google?status=success'
    });

    const { result } = renderHook(() => useGoogleCalendarIntegration());
    await waitFor(() => expect(result.current.loading).toBe(false));

    let outcome: 'success' | 'cancelled';
    await act(async () => {
      outcome = await result.current.connect();
    });

    expect(outcome!).toBe('success');
    expect(mockBeginGoogleIntegrationConnect).toHaveBeenCalledTimes(1);
    expect(mockFetchGoogleIntegrationStatus).toHaveBeenCalledTimes(2);
    expect(result.current.status?.connected).toBe(true);
  });

  it('returns cancelled when auth session is dismissed', async () => {
    (webBrowser.openAuthSessionAsync as jest.Mock).mockResolvedValue({
      type: 'dismiss'
    });

    const { result } = renderHook(() => useGoogleCalendarIntegration());
    await waitFor(() => expect(result.current.loading).toBe(false));

    let outcome: 'success' | 'cancelled';
    await act(async () => {
      outcome = await result.current.connect();
    });

    expect(outcome).toBe('cancelled');
    expect(mockFetchGoogleIntegrationStatus).toHaveBeenCalledTimes(1); // only initial load
  });

  it('throws when Google returns failure code', async () => {
    mockBeginGoogleIntegrationConnect.mockResolvedValue({
      authUrl: 'https://accounts.google.com/o/oauth2/v2/auth'
    });
    (webBrowser.openAuthSessionAsync as jest.Mock).mockResolvedValue({
      type: 'success',
      url: 'carebase://integrations/google?status=error&code=access_denied'
    });

    const { result } = renderHook(() => useGoogleCalendarIntegration());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await expect(
      act(async () => result.current.connect())
    ).rejects.toThrow(/access_denied/);
  });

  it('runs manual sync and refreshes status', async () => {
    mockFetchGoogleIntegrationStatus.mockResolvedValueOnce({
      connected: true,
      calendarId: 'primary',
      lastSyncedAt: null,
      syncPendingCount: 2,
      lastError: null
    });
    mockFetchGoogleIntegrationStatus.mockResolvedValueOnce({
      connected: true,
      calendarId: 'primary',
      lastSyncedAt: '2025-10-16T10:00:00.000Z',
      syncPendingCount: 0,
      lastError: null
    });
    mockTriggerGoogleManualSync.mockResolvedValue({
      pushed: 2,
      pulled: 1,
      deleted: 0,
      errors: [],
      calendarId: 'primary'
    });

    const { result } = renderHook(() => useGoogleCalendarIntegration());
    await waitFor(() => expect(result.current.loading).toBe(false));

    let summary;
    await act(async () => {
      summary = await result.current.manualSync();
    });

    expect(summary).toEqual({
      pushed: 2,
      pulled: 1,
      deleted: 0,
      errors: [],
      calendarId: 'primary'
    });
    expect(mockTriggerGoogleManualSync).toHaveBeenCalledWith({ forceFull: undefined });
    expect(mockFetchGoogleIntegrationStatus).toHaveBeenCalledTimes(2);
  });

  it('disconnects and refreshes status', async () => {
    mockFetchGoogleIntegrationStatus.mockResolvedValueOnce({
      connected: true,
      calendarId: 'primary',
      lastSyncedAt: null,
      syncPendingCount: 0,
      lastError: null
    });
    mockFetchGoogleIntegrationStatus.mockResolvedValueOnce({
      connected: false,
      calendarId: null,
      lastSyncedAt: null,
      syncPendingCount: 0,
      lastError: null
    });

    const { result } = renderHook(() => useGoogleCalendarIntegration());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => result.current.disconnect());

    expect(mockDisconnectGoogleIntegration).toHaveBeenCalledTimes(1);
    expect(mockFetchGoogleIntegrationStatus).toHaveBeenCalledTimes(2);
    expect(result.current.status?.connected).toBe(false);
  });
});
