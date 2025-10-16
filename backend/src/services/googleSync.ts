import crypto from 'crypto';
import type { Appointment, Bill } from '@carebase/shared';
import {
  getGoogleCredential,
  upsertGoogleCredential,
  queueGoogleSyncForUser,
  listPendingGoogleSyncItems,
  getAppointmentByItemId,
  getBillByItemId,
  markGoogleSyncSuccess,
  markGoogleSyncError,
  deleteGoogleSyncLink,
  getItemOwnerUserId,
  updateAppointment,
  updateBill,
  markGoogleSyncPending,
  type GoogleCredential
} from '../db/queries.js';

const GOOGLE_CALENDAR_API = 'https://www.googleapis.com/calendar/v3';
const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const DEFAULT_LOOKBACK_DAYS = 30;
const IS_TEST_ENV = process.env.NODE_ENV === 'test';
const ENABLE_SYNC_IN_TEST = process.env.GOOGLE_SYNC_ENABLE_TEST === 'true';

const DEFAULT_DEBOUNCE_MS = IS_TEST_ENV && !ENABLE_SYNC_IN_TEST
  ? 0
  : Number.parseInt(process.env.GOOGLE_SYNC_DEBOUNCE_MS ?? '', 10) || 15_000;
const DEFAULT_RETRY_BASE_MS = IS_TEST_ENV && !ENABLE_SYNC_IN_TEST
  ? 1_000
  : Number.parseInt(process.env.GOOGLE_SYNC_RETRY_BASE_MS ?? '', 10) || 60_000;
const MAX_RETRY_MS = IS_TEST_ENV && !ENABLE_SYNC_IN_TEST
  ? 5_000
  : Number.parseInt(process.env.GOOGLE_SYNC_RETRY_MAX_MS ?? '', 10) || 300_000;

interface RetryState {
  attempt: number;
  timer: NodeJS.Timeout | null;
}

const debounceTimers = new Map<number, NodeJS.Timeout>();
const retryTimers = new Map<number, RetryState>();
const runningSyncs = new Set<number>();
const followUpRequested = new Set<number>();

type SyncRunner = (userId: number, options?: GoogleSyncOptions) => Promise<GoogleSyncSummary>;
let syncRunner: SyncRunner;

interface GoogleSyncOptions {
  forceFull?: boolean;
  calendarId?: string | null;
  pullRemote?: boolean;
}

interface SyncError {
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

interface AuthenticatedCredential {
  credential: GoogleCredential;
  accessToken: string;
}

interface GoogleEventResource {
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

class GoogleSyncException extends Error {
  status?: number;
  code?: string;

  constructor(message: string, status?: number, code?: string) {
    super(message);
    this.name = 'GoogleSyncException';
    this.status = status;
    this.code = code;
  }
}

function assertClientCredentials(): { clientId: string; clientSecret: string } {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID ?? process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new GoogleSyncException('Missing Google OAuth client credentials', 500, 'missing_credentials');
  }
  return { clientId, clientSecret };
}

export async function exchangeGoogleAuthorizationCode(
  authorizationCode: string,
  codeVerifier: string,
  redirectUri: string
): Promise<{
  accessToken: string;
  refreshToken: string;
  scope: string[];
  expiresIn?: number;
  tokenType?: string;
  idToken?: string;
}> {
  const { clientId, clientSecret } = assertClientCredentials();

  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code: authorizationCode,
    code_verifier: codeVerifier,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code'
  });

  const response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: params.toString()
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new GoogleSyncException(
      `Failed to exchange authorization code: ${payload.error_description || response.statusText}`,
      response.status,
      payload.error
    );
  }

  if (!payload.refresh_token) {
    throw new GoogleSyncException('Google did not return a refresh token. Ensure access_type=offline and prompt=consent.', 400, 'missing_refresh_token');
  }

  const scope = typeof payload.scope === 'string' ? payload.scope.split(' ') : [];

  return {
    accessToken: payload.access_token as string,
    refreshToken: payload.refresh_token as string,
    scope,
    expiresIn: typeof payload.expires_in === 'number' ? payload.expires_in : undefined,
    tokenType: typeof payload.token_type === 'string' ? payload.token_type : undefined,
    idToken: typeof payload.id_token === 'string' ? payload.id_token : undefined
  };
}

export async function exchangeGoogleAuthorizationCodeServer(
  authorizationCode: string,
  redirectUri: string
): Promise<{
  accessToken: string;
  refreshToken: string;
  scope: string[];
  expiresIn?: number;
  tokenType?: string;
  idToken?: string;
}> {
  const { clientId, clientSecret } = assertClientCredentials();

  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code: authorizationCode,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
    access_type: 'offline',
  });

  const response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new GoogleSyncException(
      `Failed to exchange authorization code: ${payload.error_description || response.statusText}`,
      response.status,
      payload.error
    );
  }

  if (!payload.refresh_token) {
    throw new GoogleSyncException('Google did not return a refresh token. Ensure access_type=offline and prompt=consent.', 400, 'missing_refresh_token');
  }

  const scope = typeof payload.scope === 'string' ? payload.scope.split(' ') : [];

  return {
    accessToken: payload.access_token as string,
    refreshToken: payload.refresh_token as string,
    scope,
    expiresIn: typeof payload.expires_in === 'number' ? payload.expires_in : undefined,
    tokenType: typeof payload.token_type === 'string' ? payload.token_type : undefined,
    idToken: typeof payload.id_token === 'string' ? payload.id_token : undefined,
  };
}

function hashContent(parts: Array<string | number | null | undefined | Date>): string {
  const normalized = parts.map((value) => {
    if (value === null || value === undefined) return '';
    if (value instanceof Date) return value.toISOString();
    return String(value).trim();
  });
  return crypto.createHash('sha256').update(normalized.join('|')).digest('hex');
}

export function calculateAppointmentHash(appointment: Appointment): string {
  return hashContent([
    appointment.summary,
    appointment.startLocal,
    appointment.endLocal,
    appointment.location,
    appointment.prepNote,
    appointment.assignedCollaboratorId
  ]);
}

export function calculateBillHash(bill: Bill): string {
  return hashContent([
    bill.amount,
    bill.dueDate,
    bill.statementDate,
    bill.status,
    bill.payUrl,
    bill.taskKey
  ]);
}

function ensureIsoDateTime(date: Date): string {
  return new Date(date).toISOString();
}

function formatDateOnly(date: Date): string {
  return new Date(date).toISOString().split('T')[0];
}

function buildAppointmentEventPayload(appointment: Appointment): Record<string, unknown> {
  const descriptionParts: string[] = [];
  if (appointment.prepNote) {
    descriptionParts.push(appointment.prepNote);
  }

  return {
    summary: appointment.summary,
    description: descriptionParts.length > 0 ? descriptionParts.join('\n\n') : undefined,
    location: appointment.location ?? undefined,
    start: {
      dateTime: ensureIsoDateTime(appointment.startLocal)
    },
    end: {
      dateTime: ensureIsoDateTime(appointment.endLocal)
    },
    extendedProperties: {
      private: {
        carebaseItemId: String(appointment.itemId),
        carebaseType: 'appointment'
      }
    },
    reminders: {
      useDefault: true
    },
    source: {
      title: 'Carebase',
      url: process.env.CAREBASE_APP_BASE_URL || 'https://carebase.app'
    },
    conferenceDataVersion: 0
  };
}

function buildBillEventPayload(bill: Bill): Record<string, unknown> {
  const dueDate = bill.dueDate ?? bill.statementDate ?? new Date();
  const dueDateStr = formatDateOnly(dueDate);
  const endDate = new Date(dueDate);
  endDate.setDate(endDate.getDate() + 1);

  const summaryParts: string[] = ['Bill'];
  if (bill.amount !== null) {
    summaryParts.push(`$${bill.amount.toFixed(2)}`);
  }
  if (bill.status === 'overdue') {
    summaryParts.push('(Overdue)');
  }

  const descriptionLines: string[] = [];
  if (bill.payUrl) {
    descriptionLines.push(`Pay online: ${bill.payUrl}`);
  }
  descriptionLines.push(`Status: ${bill.status}`);

  return {
    summary: summaryParts.join(' '),
    description: descriptionLines.join('\n'),
    start: {
      date: dueDateStr
    },
    end: {
      date: formatDateOnly(endDate)
    },
    extendedProperties: {
      private: {
        carebaseItemId: String(bill.itemId),
        carebaseType: 'bill'
      }
    },
    reminders: {
      useDefault: true
    },
    source: {
      title: 'Carebase',
      url: process.env.CAREBASE_APP_BASE_URL || 'https://carebase.app'
    }
  };
}

async function ensureValidAccessToken(userId: number): Promise<AuthenticatedCredential> {
  const credential = await getGoogleCredential(userId);
  if (!credential) {
    throw new GoogleSyncException('Google Calendar is not connected for this user', 400, 'not_connected');
  }

  const expiresAt = credential.expiresAt ? new Date(credential.expiresAt) : null;
  const needsRefresh = !expiresAt || expiresAt.getTime() - Date.now() < 60_000;

  if (!needsRefresh) {
    return { credential, accessToken: credential.accessToken };
  }

  const { clientId, clientSecret } = assertClientCredentials();
  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'refresh_token',
    refresh_token: credential.refreshToken
  });

  const response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: params.toString()
  });

  if (!response.ok) {
    const errorPayload = await response.json().catch(() => ({}));
    throw new GoogleSyncException(
      `Failed to refresh Google access token: ${errorPayload.error_description || response.statusText}`,
      response.status,
      errorPayload.error
    );
  }

  const refreshed = (await response.json()) as {
    access_token: string;
    expires_in?: number;
    scope?: string;
    token_type?: string;
    id_token?: string;
  };

  const nextExpiresAt = refreshed.expires_in ? new Date(Date.now() + refreshed.expires_in * 1000) : credential.expiresAt;
  const scope = refreshed.scope ? refreshed.scope.split(' ') : credential.scope;

  const updated = await upsertGoogleCredential(credential.userId, {
    accessToken: refreshed.access_token,
    refreshToken: credential.refreshToken,
    scope,
    expiresAt: nextExpiresAt ?? null,
    tokenType: refreshed.token_type ?? credential.tokenType ?? undefined,
    idToken: refreshed.id_token ?? credential.idToken ?? undefined,
    calendarId: credential.calendarId,
    syncToken: credential.syncToken,
    lastPulledAt: credential.lastPulledAt ?? null
  });

  return { credential: updated, accessToken: updated.accessToken };
}

async function googleJsonRequest(
  accessToken: string,
  url: string,
  init: RequestInit & { retry?: boolean } = {}
): Promise<any> {
  const response = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
      ...(init.headers ?? {})
    }
  });

  if (response.status === 204) {
    return null;
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new GoogleSyncException(
      `Google API request failed: ${payload.error?.message || response.statusText}`,
      response.status,
      payload.error?.status
    );
  }

  return payload;
}

async function pushAppointment(
  accessToken: string,
  calendarId: string,
  appointment: Appointment,
  localHash: string
): Promise<void> {
  const payload = buildAppointmentEventPayload(appointment);
  const encodedCalendarId = encodeURIComponent(calendarId);
  const baseUrl = `${GOOGLE_CALENDAR_API}/calendars/${encodedCalendarId}/events`;
  const existingEventId = appointment.googleSync?.eventId;

  try {
    const result: GoogleEventResource = existingEventId
      ? await googleJsonRequest(accessToken, `${baseUrl}/${encodeURIComponent(existingEventId)}`, {
          method: 'PATCH',
          body: JSON.stringify(payload)
        })
      : await googleJsonRequest(accessToken, baseUrl, {
          method: 'POST',
          body: JSON.stringify(payload)
        });

    await markGoogleSyncSuccess(appointment.itemId, {
      calendarId,
      eventId: result.id,
      etag: result.etag ?? null,
      lastSyncedAt: new Date(),
      lastSyncDirection: 'push',
      localHash,
      remoteUpdatedAt: result.updated ? new Date(result.updated) : null
    });
  } catch (error) {
    if (error instanceof GoogleSyncException && error.status === 404 && existingEventId) {
      await deleteGoogleSyncLink(appointment.itemId);
      await markGoogleSyncPending(appointment.itemId, localHash);
      await pushAppointment(accessToken, calendarId, appointment, localHash);
      return;
    }
    throw error;
  }
}

async function pushBill(
  accessToken: string,
  calendarId: string,
  bill: Bill,
  localHash: string
): Promise<void> {
  const payload = buildBillEventPayload(bill);
  const encodedCalendarId = encodeURIComponent(calendarId);
  const baseUrl = `${GOOGLE_CALENDAR_API}/calendars/${encodedCalendarId}/events`;
  const existingEventId = bill.googleSync?.eventId;

  try {
    const result: GoogleEventResource = existingEventId
      ? await googleJsonRequest(accessToken, `${baseUrl}/${encodeURIComponent(existingEventId)}`, {
          method: 'PATCH',
          body: JSON.stringify(payload)
        })
      : await googleJsonRequest(accessToken, baseUrl, {
          method: 'POST',
          body: JSON.stringify(payload)
        });

    await markGoogleSyncSuccess(bill.itemId, {
      calendarId,
      eventId: result.id,
      etag: result.etag ?? null,
      lastSyncedAt: new Date(),
      lastSyncDirection: 'push',
      localHash,
      remoteUpdatedAt: result.updated ? new Date(result.updated) : null
    });
  } catch (error) {
    if (error instanceof GoogleSyncException && error.status === 404 && existingEventId) {
      await deleteGoogleSyncLink(bill.itemId);
      await markGoogleSyncPending(bill.itemId, localHash);
      await pushBill(accessToken, calendarId, bill, localHash);
      return;
    }
    throw error;
  }
}

function parseEventDate(event: GoogleEventResource['start'] | undefined): Date | null {
  if (!event) {
    return null;
  }
  if (event.dateTime) {
    return new Date(event.dateTime);
  }
  if (event.date) {
    return new Date(`${event.date}T00:00:00.000Z`);
  }
  return null;
}

async function applyGoogleAppointmentUpdate(
  calendarId: string,
  event: GoogleEventResource,
  summary: GoogleSyncSummary
): Promise<void> {
  const privateProps = event.extendedProperties?.private ?? {};
  const itemId = privateProps.carebaseItemId ? Number(privateProps.carebaseItemId) : NaN;
  if (!Number.isFinite(itemId)) {
    return;
  }

  if (event.status === 'cancelled') {
    await deleteGoogleSyncLink(itemId);
    summary.deleted += 1;
    return;
  }

  const appointment = await getAppointmentByItemId(itemId);
  if (!appointment) {
    await deleteGoogleSyncLink(itemId);
    return;
  }

  const start = parseEventDate(event.start);
  const end = parseEventDate(event.end);
  if (!start || !end) {
    throw new GoogleSyncException('Google event missing start/end time', 400, 'invalid_event');
  }

  const ownerUserId = await getItemOwnerUserId(itemId);
  if (!ownerUserId) {
    return;
  }

  const updated = await updateAppointment(appointment.id, ownerUserId, {
    summary: event.summary ?? appointment.summary,
    startLocal: ensureIsoDateTime(start),
    endLocal: ensureIsoDateTime(end),
    location: event.location ?? appointment.location ?? undefined,
    prepNote: event.description ?? appointment.prepNote ?? undefined,
    assignedCollaboratorId: appointment.assignedCollaboratorId ?? null
  });

  const localHash = calculateAppointmentHash(updated);
  await markGoogleSyncSuccess(updated.itemId, {
    calendarId,
    eventId: event.id,
    etag: event.etag ?? null,
    lastSyncedAt: new Date(),
    lastSyncDirection: 'pull',
    localHash,
    remoteUpdatedAt: event.updated ? new Date(event.updated) : null
  });

  summary.pulled += 1;
}

async function applyGoogleBillUpdate(
  calendarId: string,
  event: GoogleEventResource,
  summary: GoogleSyncSummary
): Promise<void> {
  const privateProps = event.extendedProperties?.private ?? {};
  const itemId = privateProps.carebaseItemId ? Number(privateProps.carebaseItemId) : NaN;
  if (!Number.isFinite(itemId)) {
    return;
  }

  if (event.status === 'cancelled') {
    await deleteGoogleSyncLink(itemId);
    summary.deleted += 1;
    return;
  }

  const bill = await getBillByItemId(itemId);
  if (!bill) {
    await deleteGoogleSyncLink(itemId);
    return;
  }

  const start = parseEventDate(event.start);
  const ownerUserId = await getItemOwnerUserId(itemId);
  if (!ownerUserId) {
    return;
  }

  const nextDueDate = start ? formatDateOnly(start) : undefined;

  const updated = await updateBill(bill.id, ownerUserId, {
    statementDate: bill.statementDate ? formatDateOnly(bill.statementDate) : undefined,
    amount: bill.amount ?? undefined,
    dueDate: nextDueDate ?? (bill.dueDate ? formatDateOnly(bill.dueDate) : undefined),
    payUrl: bill.payUrl ?? undefined,
    status: bill.status,
    assignedCollaboratorId: bill.assignedCollaboratorId ?? null
  });

  const localHash = calculateBillHash(updated);
  await markGoogleSyncSuccess(updated.itemId, {
    calendarId,
    eventId: event.id,
    etag: event.etag ?? null,
    lastSyncedAt: new Date(),
    lastSyncDirection: 'pull',
    localHash,
    remoteUpdatedAt: event.updated ? new Date(event.updated) : null
  });

  summary.pulled += 1;
}

async function pullGoogleChanges(
  accessToken: string,
  credential: GoogleCredential,
  calendarId: string,
  summary: GoogleSyncSummary
): Promise<void> {
  let syncToken = credential.syncToken ?? undefined;
  let pageToken: string | undefined;
  let latestSyncToken: string | null = null;
  const encodedCalendarId = encodeURIComponent(calendarId);

  try {
    do {
      const params = new URLSearchParams({
        showDeleted: 'true',
        singleEvents: 'true',
        maxResults: '2500'
      });

      if (syncToken) {
        params.set('syncToken', syncToken);
      } else {
        const minDate = new Date();
        minDate.setDate(minDate.getDate() - DEFAULT_LOOKBACK_DAYS);
        params.set('updatedMin', minDate.toISOString());
      }

      if (pageToken) {
        params.set('pageToken', pageToken);
      }

      const url = `${GOOGLE_CALENDAR_API}/calendars/${encodedCalendarId}/events?${params.toString()}`;
      const payload = await googleJsonRequest(accessToken, url, { method: 'GET' });

      const items: GoogleEventResource[] = Array.isArray(payload.items) ? payload.items : [];
      for (const event of items) {
        const privateProps = event.extendedProperties?.private ?? {};
        if (!privateProps.carebaseItemId) {
          continue;
        }
        if (privateProps.carebaseType === 'appointment') {
          await applyGoogleAppointmentUpdate(calendarId, event, summary);
        } else if (privateProps.carebaseType === 'bill') {
          await applyGoogleBillUpdate(calendarId, event, summary);
        }
      }

      latestSyncToken = payload.nextSyncToken ?? latestSyncToken;
      pageToken = payload.nextPageToken ?? undefined;
      syncToken = undefined;
    } while (pageToken);
  } catch (error) {
    if (error instanceof GoogleSyncException && error.status === 410) {
      await upsertGoogleCredential(credential.userId, {
        accessToken,
        refreshToken: credential.refreshToken,
        scope: credential.scope,
        expiresAt: credential.expiresAt,
        tokenType: credential.tokenType ?? undefined,
        idToken: credential.idToken ?? undefined,
        calendarId,
        syncToken: null,
        lastPulledAt: null
      });
      await queueGoogleSyncForUser(credential.userId, calendarId);
      return;
    }
    throw error;
  }

  if (latestSyncToken) {
    await upsertGoogleCredential(credential.userId, {
      accessToken,
      refreshToken: credential.refreshToken,
      scope: credential.scope,
      expiresAt: credential.expiresAt,
      tokenType: credential.tokenType ?? undefined,
      idToken: credential.idToken ?? undefined,
      calendarId,
      syncToken: latestSyncToken,
      lastPulledAt: new Date()
    });
  }
}

export async function syncUserWithGoogle(userId: number, options: GoogleSyncOptions = {}): Promise<GoogleSyncSummary> {
  const { credential, accessToken } = await ensureValidAccessToken(userId);
  const calendarId = options.calendarId ?? credential.calendarId ?? 'primary';
  const summary: GoogleSyncSummary = {
    pushed: 0,
    pulled: 0,
    deleted: 0,
    errors: [],
    calendarId
  };

  if (calendarId !== credential.calendarId) {
    await upsertGoogleCredential(userId, {
      accessToken,
      refreshToken: credential.refreshToken,
      scope: credential.scope,
      expiresAt: credential.expiresAt,
      tokenType: credential.tokenType ?? undefined,
      idToken: credential.idToken ?? undefined,
      calendarId,
      syncToken: credential.syncToken,
      lastPulledAt: credential.lastPulledAt ?? null
    });
  }

  if (options.forceFull || !credential.syncToken) {
    await queueGoogleSyncForUser(userId, calendarId);
  }

  const pending = await listPendingGoogleSyncItems(userId);
  for (const item of pending) {
    try {
      if (item.itemType === 'appointment') {
        const appointment = await getAppointmentByItemId(item.itemId);
        if (!appointment) {
          await deleteGoogleSyncLink(item.itemId);
          continue;
        }
        const localHash = calculateAppointmentHash(appointment);
        await pushAppointment(accessToken, calendarId, appointment, localHash);
        summary.pushed += 1;
      } else if (item.itemType === 'bill') {
        const bill = await getBillByItemId(item.itemId);
        if (!bill) {
          await deleteGoogleSyncLink(item.itemId);
          continue;
        }
        const localHash = calculateBillHash(bill);
        await pushBill(accessToken, calendarId, bill, localHash);
        summary.pushed += 1;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown Google sync error';
      summary.errors.push({ itemId: item.itemId, message });
      await markGoogleSyncError(item.itemId, message);
    }
  }

  if (options.pullRemote !== false) {
    try {
      await pullGoogleChanges(accessToken, { ...credential, calendarId }, calendarId, summary);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to pull Google Calendar changes';
      summary.errors.push({ message });
    }
  }

  return summary;
}

syncRunner = syncUserWithGoogle;

function computeRetryDelay(userId: number): number {
  const current = retryTimers.get(userId);
  const attempt = (current?.attempt ?? 0) + 1;
  const delay = Math.min(DEFAULT_RETRY_BASE_MS * 2 ** (attempt - 1), MAX_RETRY_MS);
  return delay;
}

async function performSync(userId: number): Promise<void> {
  if (runningSyncs.has(userId)) {
    followUpRequested.add(userId);
    return;
  }

  runningSyncs.add(userId);
  try {
    const summary = await syncRunner(userId, { pullRemote: true });
    retryTimers.delete(userId);
    console.log(
      `[GoogleSync] user=${userId} pushed=${summary.pushed} pulled=${summary.pulled} deleted=${summary.deleted} errors=${summary.errors.length}`
    );
  } catch (error) {
    const delay = computeRetryDelay(userId);
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[GoogleSync] user=${userId} sync failed (${message}). Retrying in ${delay}ms`);
    const existing = retryTimers.get(userId);
    if (existing?.timer) {
      clearTimeout(existing.timer);
    }
    const timer = setTimeout(() => {
      retryTimers.delete(userId);
      void performSync(userId);
    }, delay);
    retryTimers.set(userId, { attempt: (existing?.attempt ?? 0) + 1, timer });
    return;
  } finally {
    runningSyncs.delete(userId);
  }

  if (followUpRequested.has(userId)) {
    followUpRequested.delete(userId);
    scheduleGoogleSyncForUser(userId);
  }
}

export function scheduleGoogleSyncForUser(userId: number, debounceMs: number = DEFAULT_DEBOUNCE_MS): void {
  if (IS_TEST_ENV && !ENABLE_SYNC_IN_TEST) {
    return;
  }
  if (runningSyncs.has(userId)) {
    followUpRequested.add(userId);
    return;
  }

  const existing = debounceTimers.get(userId);
  if (existing) {
    clearTimeout(existing);
  }

  const retry = retryTimers.get(userId);
  if (retry?.timer) {
    clearTimeout(retry.timer);
  }
  retryTimers.delete(userId);

  if (debounceMs <= 0) {
    debounceTimers.delete(userId);
    void performSync(userId);
    return;
  }

  const timer = setTimeout(() => {
    debounceTimers.delete(userId);
    void performSync(userId);
  }, debounceMs);
  debounceTimers.set(userId, timer);
}

export function __setGoogleSyncRunnerForTests(runner?: SyncRunner): void {
  syncRunner = runner ?? syncUserWithGoogle;
}

export function __resetGoogleSyncStateForTests(): void {
  debounceTimers.forEach((timer) => clearTimeout(timer));
  debounceTimers.clear();
  retryTimers.forEach(({ timer }) => timer && clearTimeout(timer));
  retryTimers.clear();
  runningSyncs.clear();
  followUpRequested.clear();
  syncRunner = syncUserWithGoogle;
}
