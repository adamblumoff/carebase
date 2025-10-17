import type { GoogleIntegrationStatus } from '@carebase/shared';
import apiClient from './client';

export interface GoogleSyncErrorSummary {
  itemId?: number;
  message: string;
}

export interface GoogleSyncSummary {
  pushed: number;
  pulled: number;
  deleted: number;
  calendarId: string;
  errors: GoogleSyncErrorSummary[];
}

export async function fetchGoogleIntegrationStatus(): Promise<GoogleIntegrationStatus> {
  const response = await apiClient.get('/api/integrations/google/status');
  return response.data as GoogleIntegrationStatus;
}

export async function beginGoogleIntegrationConnect(): Promise<{
  authUrl: string;
  redirectUri: string;
}> {
  const response = await apiClient.post('/api/integrations/google/connect/start');
  return response.data as { authUrl: string; redirectUri: string };
}

export async function disconnectGoogleIntegration(): Promise<void> {
  await apiClient.delete('/api/integrations/google/connect');
}

export async function triggerGoogleManualSync(options: {
  forceFull?: boolean;
  calendarId?: string;
  pullRemote?: boolean;
} = {}): Promise<GoogleSyncSummary> {
  const response = await apiClient.post('/api/integrations/google/sync', options);
  const data = response.data as GoogleSyncSummary;
  if (process.env.NODE_ENV !== 'production') {
    console.log('[GoogleSync] summary', JSON.stringify(data));
  }
  return data;
}
