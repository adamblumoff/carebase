import { useCallback, useEffect, useState } from 'react';
import * as WebBrowser from 'expo-web-browser';
import type { GoogleIntegrationStatus } from '@carebase/shared';
import {
  beginGoogleIntegrationConnect,
  disconnectGoogleIntegration,
  fetchGoogleIntegrationStatus,
  triggerGoogleManualSync,
  type GoogleSyncSummary
} from '../api/googleIntegration';
const APP_RETURN_URL = 'carebase://integrations/google';

WebBrowser.maybeCompleteAuthSession();

export interface UseGoogleCalendarIntegrationResult {
  status: GoogleIntegrationStatus | null;
  loading: boolean;
  connecting: boolean;
  syncing: boolean;
  error: string | null;
  connect: () => Promise<'success' | 'cancelled'>;
  disconnect: () => Promise<void>;
  manualSync: (options?: { forceFull?: boolean }) => Promise<GoogleSyncSummary>;
  refreshStatus: () => Promise<void>;
  requestReady: boolean;
}

export function useGoogleCalendarIntegration(): UseGoogleCalendarIntegrationResult {
  const [status, setStatus] = useState<GoogleIntegrationStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    setLoading(true);
    try {
      const nextStatus = await fetchGoogleIntegrationStatus();
      const normalized: GoogleIntegrationStatus = {
        ...nextStatus,
        lastSyncedAt: nextStatus.lastSyncedAt ? new Date(nextStatus.lastSyncedAt) : null
      };
      setStatus(normalized);
      setError(null);
    } catch (err) {
      console.error('Failed to load Google integration status', err);
      setError('Unable to load Google Calendar connection status');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStatus().catch(() => {
      // errors handled in loadStatus
    });
  }, [loadStatus]);

  const connect = useCallback(async (): Promise<'success' | 'cancelled'> => {
    setConnecting(true);
    try {
      const { authUrl } = await beginGoogleIntegrationConnect();
      console.log('[GoogleAuth] starting flow', authUrl);

      const result = await WebBrowser.openAuthSessionAsync(authUrl, APP_RETURN_URL);
      if (result.type === 'dismiss' || result.type === 'cancel') {
        return 'cancelled';
      }

      if (result.type !== 'success' || !result.url) {
        throw new Error('Google authorization was not completed');
      }

      const url = new URL(result.url);
      const statusParam = url.searchParams.get('status');
      const errorCode = url.searchParams.get('code');

      await loadStatus();

      if (statusParam === 'success') {
        return 'success';
      }

      if (errorCode) {
        throw new Error(`Google authorization failed (${errorCode})`);
      }

      throw new Error('Google authorization did not complete successfully');
    } catch (err) {
      console.error('Google integration connect failed', err);
      setError(err instanceof Error ? err.message : 'Failed to connect Google Calendar');
      throw err;
    } finally {
      setConnecting(false);
    }
  }, [loadStatus]);

  const disconnect = useCallback(async () => {
    setConnecting(true);
    try {
      await disconnectGoogleIntegration();
      await loadStatus();
    } catch (err) {
      console.error('Failed to disconnect Google integration', err);
      setError(err instanceof Error ? err.message : 'Failed to disconnect Google Calendar');
      throw err;
    } finally {
      setConnecting(false);
    }
  }, [loadStatus]);

  const manualSync = useCallback(
    async (options: { forceFull?: boolean } = {}): Promise<GoogleSyncSummary> => {
      setSyncing(true);
      try {
        const summary = await triggerGoogleManualSync({
          forceFull: options.forceFull,
        });
        await loadStatus();
        return summary;
      } catch (err) {
        console.error('Failed to sync Google integration', err);
        setError(err instanceof Error ? err.message : 'Failed to sync Google Calendar');
        throw err;
      } finally {
        setSyncing(false);
      }
    },
    [loadStatus]
  );

  return {
    status,
    loading,
    connecting,
    syncing,
    error,
    connect,
    disconnect,
    manualSync,
    refreshStatus: loadStatus,
    requestReady: true
  };
}
