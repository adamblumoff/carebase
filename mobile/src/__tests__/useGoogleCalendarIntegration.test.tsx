import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { describe, beforeEach, afterEach, expect, it, vi } from 'vitest';
import * as WebBrowser from 'expo-web-browser';
import { useGoogleCalendarIntegration } from '../hooks/useGoogleCalendarIntegration';

const webBrowser = vi.mocked(WebBrowser);

const mockBeginGoogleIntegrationConnect = vi.fn();
const mockDisconnectGoogleIntegration = vi.fn();
const mockFetchGoogleIntegrationStatus = vi.fn();
const mockTriggerGoogleManualSync = vi.fn();

vi.mock('../api/googleIntegration', () => ({
  beginGoogleIntegrationConnect: (...args: any[]) => mockBeginGoogleIntegrationConnect(...args),
  disconnectGoogleIntegration: (...args: any[]) => mockDisconnectGoogleIntegration(...args),
  fetchGoogleIntegrationStatus: (...args: any[]) => mockFetchGoogleIntegrationStatus(...args),
  triggerGoogleManualSync: (...args: any[]) => mockTriggerGoogleManualSync(...args)
}));

function renderHook<T>(callback: () => T) {
  const result: { current: T | undefined } = { current: undefined };
  const container = document.createElement('div');
  const root = createRoot(container);
  function TestComponent() {
    result.current = callback();
    return null;
  }
  act(() => {
    root.render(<TestComponent />);
  });
  return {
    result,
    rerender: async () => {
      await act(async () => {
        root.render(<TestComponent />);
      });
    }
  };
}

async function flushPromises() {
  await act(async () => {});
}

describe('useGoogleCalendarIntegration', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetchGoogleIntegrationStatus.mockResolvedValue({
      connected: false,
      calendarId: null,
      lastSyncedAt: null,
      syncPendingCount: 0,
      lastError: null
    });
    mockBeginGoogleIntegrationConnect.mockResolvedValue({
      authUrl: 'https://accounts.google.com/o/oauth2/v2/auth'
    });
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
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
    await flushPromises();

    expect(result.current?.loading).toBe(false);
    expect(result.current?.status?.lastSyncedAt).toBeInstanceOf(Date);
    expect(result.current?.status?.lastSyncedAt?.toISOString()).toBe(lastSyncedAt);
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

    webBrowser.openAuthSessionAsync.mockResolvedValue({
      type: 'success',
      url: 'carebase://integrations/google?status=success'
    } as any);

    const { result } = renderHook(() => useGoogleCalendarIntegration());
    await flushPromises();

    let outcome: 'success' | 'cancelled' | undefined;
    await act(async () => {
      outcome = await result.current!.connect();
    });

    expect(outcome).toBe('success');
    expect(mockFetchGoogleIntegrationStatus).toHaveBeenCalledTimes(2);
    expect(result.current?.status?.connected).toBe(true);
  });

  it('returns cancelled when auth session is dismissed', async () => {
    webBrowser.openAuthSessionAsync.mockResolvedValue({ type: 'dismiss' } as any);

    const { result } = renderHook(() => useGoogleCalendarIntegration());
    await flushPromises();

    let outcome: 'success' | 'cancelled' | undefined;
    await act(async () => {
      outcome = await result.current!.connect();
    });

    expect(outcome).toBe('cancelled');
    expect(mockFetchGoogleIntegrationStatus).toHaveBeenCalledTimes(1);
  });

  it('throws when Google returns failure code', async () => {
    webBrowser.openAuthSessionAsync.mockResolvedValue({
      type: 'success',
      url: 'carebase://integrations/google?status=error&code=access_denied'
    } as any);

    const { result } = renderHook(() => useGoogleCalendarIntegration());
    await flushPromises();

    await expect(result.current!.connect()).rejects.toThrow(/access_denied/);
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
    await flushPromises();

    let summary;
    await act(async () => {
      summary = await result.current!.manualSync();
    });

    expect(summary).toEqual({
      pushed: 2,
      pulled: 1,
      deleted: 0,
      errors: [],
      calendarId: 'primary'
    });
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
    await flushPromises();

    await act(async () => {
      await result.current!.disconnect();
    });

    expect(mockDisconnectGoogleIntegration).toHaveBeenCalledTimes(1);
    expect(mockFetchGoogleIntegrationStatus).toHaveBeenCalledTimes(2);
    expect(result.current?.status?.connected).toBe(false);
  });
});
