import type { GoogleCredential } from '../../db/queries.js';

export interface GoogleSyncOptions {
  forceFull?: boolean;
  calendarId?: string | null;
  pullRemote?: boolean;
}

export interface SyncError {
  itemId?: number;
  message: string;
}

export interface GoogleSyncSummary {
  pushed: number;
  pulled: number;
  deleted: number;
  errors: SyncError[];
  calendarId: string;
}

export type SyncRunner = (
  userId: number,
  options?: GoogleSyncOptions
) => Promise<GoogleSyncSummary>;

export interface RetryState {
  attempt: number;
  timer: NodeJS.Timeout | null;
}

export interface AuthenticatedCredential {
  credential: GoogleCredential;
  accessToken: string;
}

export interface GoogleEventResource {
  id: string;
  status?: string;
  updated?: string;
  etag?: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: {
    date?: string;
    dateTime?: string;
    timeZone?: string;
  };
  end?: {
    date?: string;
    dateTime?: string;
    timeZone?: string;
  };
  extendedProperties?: {
    private?: Record<string, string>;
  };
}
