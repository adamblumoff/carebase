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
  listGoogleConnectedUserIds,
  findGoogleSyncLinkByEvent,
  upsertGoogleWatchChannel,
  deleteGoogleWatchChannel,
  findGoogleWatchChannelByUser,
  findGoogleWatchChannelById,
  findGoogleWatchChannelByResource,
  findGoogleWatchChannelByToken,
  listExpiringGoogleWatchChannels,
  listGoogleWatchChannelsByUser,
  type GoogleCredential,
  type GoogleWatchChannel
} from '../db/queries.js';
import { getGoogleSyncConfig, isTestEnv } from './googleSync/config.js';
import { logError, logInfo, logWarn } from './googleSync/logger.js';
import { formatDateTimeWithTimeZone } from '../utils/timezone.js';
import {
  GOOGLE_CALENDAR_API,
  GOOGLE_CHANNELS_API,
  GOOGLE_WEBHOOK_PATH,
  WATCH_TTL_SECONDS,
  WATCH_RENEWAL_LOOKAHEAD_MS,
  WATCH_RENEWAL_THRESHOLD_MS
} from './googleSync/constants.js';
import { googleJsonRequest as googleJsonRequestInternal } from './googleSync/http.js';
import { ensureValidAccessToken } from './googleSync/credentials.js';
import {
  exchangeGoogleAuthorizationCode as exchangeGoogleAuthorizationCodeInternal,
  exchangeGoogleAuthorizationCodeServer as exchangeGoogleAuthorizationCodeServerInternal
} from './googleSync/auth.js';
import {
  GoogleSyncException,
  type AuthenticatedCredential,
  type GoogleEventResource,
  type GoogleSyncOptions,
  type GoogleSyncSummary,
  type SyncError,
  type SyncRunner
} from './googleSync/types.js';

export { GoogleSyncException } from './googleSync/types.js';
export type { GoogleSyncSummary, GoogleSyncOptions, SyncError } from './googleSync/types.js';

const {
  lookbackDays: DEFAULT_LOOKBACK_DAYS,
  debounceMs: DEFAULT_DEBOUNCE_MS,
  retryBaseMs: DEFAULT_RETRY_BASE_MS,
  retryMaxMs: MAX_RETRY_MS,
  pollIntervalMs: DEFAULT_POLL_INTERVAL_MS,
  enableInTest: ENABLE_SYNC_IN_TEST,
  enablePollingFallback: ENABLE_POLLING_FALLBACK,
  defaultTimeZone: DEFAULT_TIME_ZONE
} = getGoogleSyncConfig();

const IS_TEST_ENV = isTestEnv();
const VERBOSE_SYNC_LOGS = process.env.GOOGLE_SYNC_VERBOSE === 'true';

interface RetryState {
  attempt: number;
  timer: NodeJS.Timeout | null;
}

const debounceTimers = new Map<number, NodeJS.Timeout>();
const retryTimers = new Map<number, RetryState>();
const runningSyncs = new Set<number>();
const followUpRequested = new Set<number>();
let pollingTimer: NodeJS.Timeout | null = null;
let testSchedulerOverride: ((userId: number, debounceMs: number) => void) | null = null;

let syncRunner: SyncRunner;

function getGoogleWebhookAddress(): string {
  const base =
    process.env.GOOGLE_SYNC_WEBHOOK_BASE_URL ??
    process.env.GOOGLE_SYNC_WEBHOOK_URL ??
    process.env.BASE_URL ??
    'http://localhost:3000';
  const url = new URL(GOOGLE_WEBHOOK_PATH, base);
  return url.toString();
}

export function exchangeGoogleAuthorizationCode(
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
  return exchangeGoogleAuthorizationCodeInternal(authorizationCode, codeVerifier, redirectUri);
}

export function exchangeGoogleAuthorizationCodeServer(
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
  return exchangeGoogleAuthorizationCodeServerInternal(authorizationCode, redirectUri);
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

function buildDateTimeForGoogle(date: Date, preferredTimeZone: string): { dateTime: string; timeZone: string } {
  try {
    const formatted = formatDateTimeWithTimeZone(date, preferredTimeZone);
    return {
      dateTime: `${formatted.local}${formatted.offset}`,
      timeZone: preferredTimeZone
    };
  } catch (error) {
    logWarn(
      'Failed to format appointment time with preferred timezone; falling back to UTC',
      error instanceof Error ? error.message : String(error)
    );
    const fallback = formatDateTimeWithTimeZone(date, 'UTC');
    return {
      dateTime: `${fallback.local}${fallback.offset}`,
      timeZone: 'UTC'
    };
  }
}

function formatDateOnly(date: Date): string {
  return new Date(date).toISOString().split('T')[0];
}

function extractLocalDateTime(
  eventDate: GoogleEventResource['start'] | GoogleEventResource['end'] | undefined
): string | null {
  if (!eventDate) {
    return null;
  }
  if (eventDate.dateTime) {
    let value = eventDate.dateTime;
    const offsetMatch = value.match(/([+-]\d{2}:\d{2}|Z)$/);
    if (offsetMatch) {
      value = value.slice(0, value.length - offsetMatch[0].length);
    }
    if (value.includes('.')) {
      value = value.split('.')[0];
    }
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) {
      return `${value}:00`;
    }
    return value;
  }
  if (eventDate.date) {
    return `${eventDate.date}T00:00:00`;
  }
  return null;
}

function buildAppointmentEventPayload(appointment: Appointment): Record<string, unknown> {
  const descriptionParts: string[] = [];
  if (appointment.prepNote) {
    descriptionParts.push(appointment.prepNote);
  }

  const startDateTime = buildDateTimeForGoogle(appointment.startLocal, DEFAULT_TIME_ZONE);
  const endDateTime = buildDateTimeForGoogle(appointment.endLocal, DEFAULT_TIME_ZONE);

  return {
    summary: appointment.summary,
    description: descriptionParts.length > 0 ? descriptionParts.join('\n\n') : undefined,
    location: appointment.location ?? undefined,
    start: {
      dateTime: startDateTime.dateTime,
      timeZone: startDateTime.timeZone
    },
    end: {
      dateTime: endDateTime.dateTime,
      timeZone: endDateTime.timeZone
    },
    extendedProperties: {
      private: {
        carebaseItemId: String(appointment.itemId),
        carebaseType: 'appointment'
      }
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
    source: {
      title: 'Carebase',
      url: process.env.CAREBASE_APP_BASE_URL || 'https://carebase.app'
    }
  };
}

function googleJsonRequest(
  accessToken: string,
  url: string,
  init: RequestInit & { retry?: boolean } = {}
): Promise<any> {
  return googleJsonRequestInternal(accessToken, url, init, { verbose: VERBOSE_SYNC_LOGS });
}


function normalizeCalendarId(calendarId?: string | null): string {
  return calendarId && calendarId.trim().length > 0 ? calendarId : 'primary';
}

async function stopGoogleWatch(accessToken: string, channelId: string, resourceId: string): Promise<void> {
  try {
    await googleJsonRequest(accessToken, GOOGLE_CHANNELS_API, {
      method: 'POST',
      body: JSON.stringify({ id: channelId, resourceId })
    });
  } catch (error) {
    logWarn(
      `Failed to stop Google watch channel ${channelId}`,
      error instanceof Error ? error.message : String(error)
    );
  }
}

async function ensureCalendarWatchForUser(
  userId: number,
  accessToken: string,
  calendarId: string
): Promise<GoogleWatchChannel> {
  const normalizedCalendarId = normalizeCalendarId(calendarId);
  if (IS_TEST_ENV && testSchedulerOverride) {
    const existingTestChannel = await findGoogleWatchChannelByUser(userId, normalizedCalendarId);
    if (existingTestChannel) {
      return existingTestChannel;
    }
    return upsertGoogleWatchChannel({
      channelId: `test-${userId}-${normalizedCalendarId}`,
      userId,
      calendarId: normalizedCalendarId,
      resourceId: `test-resource-${userId}-${normalizedCalendarId}`,
      resourceUri: null,
      expiration: new Date(Date.now() + WATCH_RENEWAL_LOOKAHEAD_MS * 2),
      channelToken: null
    });
  }
  const existing = await findGoogleWatchChannelByUser(userId, normalizedCalendarId);
  const now = Date.now();
  if (existing) {
    const expiresAtMs = existing.expiration instanceof Date ? existing.expiration.getTime() : Number.POSITIVE_INFINITY;
    if (expiresAtMs - now > WATCH_RENEWAL_THRESHOLD_MS) {
      return existing;
    }
    if (existing.resourceId) {
      await stopGoogleWatch(accessToken, existing.channelId, existing.resourceId);
    }
    await deleteGoogleWatchChannel(existing.channelId);
  }

  const channelId = crypto.randomUUID();
  const channelToken = crypto.randomBytes(16).toString('hex');
  const webhookAddress = getGoogleWebhookAddress();
  const encodedCalendarId = encodeURIComponent(normalizedCalendarId);

  const response = await googleJsonRequest(
    accessToken,
    `${GOOGLE_CALENDAR_API}/calendars/${encodedCalendarId}/events/watch`,
    {
      method: 'POST',
      body: JSON.stringify({
        id: channelId,
        type: 'webhook',
        address: webhookAddress,
        token: channelToken,
        params: {
          ttl: String(WATCH_TTL_SECONDS)
        }
      })
    }
  );

  const responseResourceId = response.resourceId ?? response.resource_id;
  if (!responseResourceId) {
    throw new GoogleSyncException('Google watch response missing resourceId', 500, 'missing_resource');
  }

  const expiration =
    typeof response.expiration === 'string' || typeof response.expiration === 'number'
      ? new Date(Number(response.expiration))
      : null;

  return upsertGoogleWatchChannel({
    channelId,
    userId,
    calendarId: normalizedCalendarId,
    resourceId: String(responseResourceId),
    resourceUri: response.resourceUri ?? response.resource_uri ?? null,
    expiration,
    channelToken
  });
}

async function refreshExpiringGoogleWatches(): Promise<void> {
  try {
    const threshold = new Date(Date.now() + WATCH_RENEWAL_LOOKAHEAD_MS);
    const expiring = await listExpiringGoogleWatchChannels(threshold);
    if (expiring.length === 0) {
      return;
    }
    const processed = new Set<number>();
    for (const channel of expiring) {
      if (processed.has(channel.userId)) {
        continue;
      }
      processed.add(channel.userId);
      try {
        const { credential, accessToken } = await ensureValidAccessToken(channel.userId);
        const calendarId = normalizeCalendarId(credential.calendarId);
        await ensureCalendarWatchForUser(channel.userId, accessToken, calendarId);
      } catch (error) {
        logWarn(
          `Failed to renew Google watch for user ${channel.userId}`,
          error instanceof Error ? error.message : String(error)
        );
      }
    }
  } catch (error) {
    logError(
      'Failed to refresh Google watch channels',
      error instanceof Error ? error.message : String(error)
    );
  }
}

function headerValue(
  headers: Record<string, string | string[] | undefined>,
  key: string
): string | undefined {
  const value = headers[key.toLowerCase()];
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

export async function handleGoogleWatchNotification(
  headers: Record<string, string | string[] | undefined>
): Promise<void> {
  const channelId = headerValue(headers, 'x-goog-channel-id');
  const resourceId = headerValue(headers, 'x-goog-resource-id');
  const messageType = headerValue(headers, 'x-goog-message-type')?.toUpperCase() ?? '';
  const resourceState = headerValue(headers, 'x-goog-resource-state') ?? '';
  const channelToken = headerValue(headers, 'x-goog-channel-token');
  const resourceUri = headerValue(headers, 'x-goog-resource-uri');
  const expirationHeader = headerValue(headers, 'x-goog-channel-expiration');
  const messageNumber = headerValue(headers, 'x-goog-message-number');

  if (!channelId || !resourceId) {
    logWarn('Received Google webhook with missing identifiers');
    return;
  }

  let channel: GoogleWatchChannel | null = null;
  if (channelToken) {
    channel = await findGoogleWatchChannelByToken(channelToken);
  }
  if (!channel) {
    channel = await findGoogleWatchChannelById(channelId);
  }
  if (!channel && resourceId) {
    channel = await findGoogleWatchChannelByResource(resourceId);
  }

  if (!channel) {
    logWarn(`No matching Google watch channel for ${channelId}`);
    return;
  }

  logInfo('Received Google webhook', {
    channelId,
    userId: channel.userId,
    resourceId,
    resourceState,
    messageType,
    messageNumber,
    resourceUri
  });

  if (messageType === 'STOP') {
    await deleteGoogleWatchChannel(channel.channelId);
    return;
  }

  const expiration = expirationHeader ? new Date(expirationHeader) : channel.expiration;

  await upsertGoogleWatchChannel({
    channelId: channel.channelId,
    userId: channel.userId,
    calendarId: channel.calendarId,
    resourceId: channel.resourceId,
    resourceUri: resourceUri ?? channel.resourceUri ?? undefined,
    expiration: expiration ?? undefined,
    channelToken: channel.channelToken ?? undefined
  });

  if (resourceState === 'sync') {
    // Initial sync notification; nothing to merge yet.
    logInfo('Google webhook initial sync acknowledgement', {
      userId: channel.userId,
      channelId
    });
    scheduleGoogleSyncForUser(channel.userId, 0);
    return;
  }

  scheduleGoogleSyncForUser(channel.userId, 0);
}

export async function stopCalendarWatchForUser(userId: number): Promise<void> {
  const channels = await listGoogleWatchChannelsByUser(userId);
  if (channels.length === 0) {
    return;
  }

  let accessToken: string | null = null;
  try {
    const authenticated = await ensureValidAccessToken(userId);
    accessToken = authenticated.accessToken;
  } catch (error) {
    logWarn(
      `Unable to fetch Google credentials when stopping watch for user ${userId}`,
      error instanceof Error ? error.message : String(error)
    );
  }

  for (const channel of channels) {
    if (accessToken && channel.resourceId) {
      await stopGoogleWatch(accessToken, channel.channelId, channel.resourceId);
    }
    await deleteGoogleWatchChannel(channel.channelId);
  }
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
  let existingEventId = appointment.googleSync?.eventId;
  const previousRemoteUpdatedAt = appointment.googleSync?.remoteUpdatedAt
    ? new Date(appointment.googleSync.remoteUpdatedAt)
    : null;
  if (existingEventId) {
    try {
      const remoteEvent: GoogleEventResource = await googleJsonRequest(
        accessToken,
        `${baseUrl}/${encodeURIComponent(existingEventId)}`,
        { method: 'GET' }
      );
      const remoteUpdatedAt = remoteEvent.updated ? new Date(remoteEvent.updated) : null;
      if (
        remoteUpdatedAt &&
        previousRemoteUpdatedAt &&
        remoteUpdatedAt.getTime() > previousRemoteUpdatedAt.getTime()
      ) {
        throw new GoogleSyncException('Remote appointment updated after local edit', 409, 'remote_newer', {
          remoteEvent,
          itemType: 'appointment'
        });
      }
    } catch (error) {
      if (error instanceof GoogleSyncException && error.status === 404) {
        existingEventId = null;
      } else {
        throw error;
      }
    }
  }

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

    if (previousRemoteUpdatedAt && result.updated) {
      const remoteTimestamp = new Date(result.updated);
      if (previousRemoteUpdatedAt.getTime() > remoteTimestamp.getTime()) {
        throw new GoogleSyncException('Remote appointment updated after local edit', 409, 'remote_newer');
      }
    }

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
  let existingEventId = bill.googleSync?.eventId;
  const previousRemoteUpdatedAt = bill.googleSync?.remoteUpdatedAt
    ? new Date(bill.googleSync.remoteUpdatedAt)
    : null;
  if (existingEventId) {
    try {
      const remoteEvent: GoogleEventResource = await googleJsonRequest(
        accessToken,
        `${baseUrl}/${encodeURIComponent(existingEventId)}`,
        { method: 'GET' }
      );
      const remoteUpdatedAt = remoteEvent.updated ? new Date(remoteEvent.updated) : null;
      if (
        remoteUpdatedAt &&
        previousRemoteUpdatedAt &&
        remoteUpdatedAt.getTime() > previousRemoteUpdatedAt.getTime()
      ) {
        throw new GoogleSyncException('Remote bill updated after local edit', 409, 'remote_newer', {
          remoteEvent,
          itemType: 'bill'
        });
      }
    } catch (error) {
      if (error instanceof GoogleSyncException && error.status === 404) {
        existingEventId = null;
      } else {
        throw error;
      }
    }
  }

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

    if (previousRemoteUpdatedAt && result.updated) {
      const remoteTimestamp = new Date(result.updated);
      if (previousRemoteUpdatedAt.getTime() > remoteTimestamp.getTime()) {
        throw new GoogleSyncException('Remote bill updated after local edit', 409, 'remote_newer');
      }
    }

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
  summary: GoogleSyncSummary,
  existingAppointment?: Appointment
): Promise<void> {
  const privateProps = event.extendedProperties?.private ?? {};
  const fallbackItemId = existingAppointment?.itemId;
  const itemIdCandidate = privateProps.carebaseItemId ? Number(privateProps.carebaseItemId) : fallbackItemId ?? NaN;
  if (!Number.isFinite(itemIdCandidate)) {
    return;
  }
  const itemId = Number(itemIdCandidate);

  if (event.status === 'cancelled') {
    await deleteGoogleSyncLink(itemId);
    summary.deleted += 1;
    return;
  }

  const appointment = existingAppointment ?? await getAppointmentByItemId(itemId);
  if (!appointment) {
    await deleteGoogleSyncLink(itemId);
    return;
  }

  const remoteUpdatedAt = event.updated ? new Date(event.updated) : null;
  const previousRemoteUpdatedAt = appointment.googleSync?.remoteUpdatedAt
    ? new Date(appointment.googleSync.remoteUpdatedAt)
    : null;
  if (
    remoteUpdatedAt &&
    previousRemoteUpdatedAt &&
    remoteUpdatedAt.getTime() <= previousRemoteUpdatedAt.getTime()
  ) {
    return;
  }

  const start = parseEventDate(event.start);
  const end = parseEventDate(event.end);
  if (!start || !end) {
    const message = 'Google event missing start/end time';
    summary.errors.push({ itemId, message });
    logWarn(message, {
      calendarId,
      eventId: event.id,
      itemId,
      userId: await getItemOwnerUserId(itemId)
    });
    return;
  }
  const startLocalStr = extractLocalDateTime(event.start);
  const endLocalStr = extractLocalDateTime(event.end);
  if (!startLocalStr || !endLocalStr) {
    const message = 'Unable to extract local start/end time';
    summary.errors.push({ itemId, message });
    logWarn(message, {
      calendarId,
      eventId: event.id,
      itemId,
      userId: await getItemOwnerUserId(itemId)
    });
    return;
  }

  const ownerUserId = await getItemOwnerUserId(itemId);
  if (!ownerUserId) {
    return;
  }

  const updated = await updateAppointment(
    appointment.id,
    ownerUserId,
    {
      summary: event.summary ?? appointment.summary,
      startLocal: startLocalStr,
      endLocal: endLocalStr,
      location: event.location ?? appointment.location ?? undefined,
      prepNote: event.description ?? appointment.prepNote ?? undefined,
      assignedCollaboratorId: appointment.assignedCollaboratorId ?? null
    },
    { queueGoogleSync: false }
  );

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
  summary: GoogleSyncSummary,
  existingBill?: Bill
): Promise<void> {
  const privateProps = event.extendedProperties?.private ?? {};
  const fallbackItemId = existingBill?.itemId;
  const itemIdCandidate = privateProps.carebaseItemId ? Number(privateProps.carebaseItemId) : fallbackItemId ?? NaN;
  if (!Number.isFinite(itemIdCandidate)) {
    return;
  }
  const itemId = Number(itemIdCandidate);

  if (event.status === 'cancelled') {
    await deleteGoogleSyncLink(itemId);
    summary.deleted += 1;
    return;
  }

  const bill = existingBill ?? await getBillByItemId(itemId);
  if (!bill) {
    await deleteGoogleSyncLink(itemId);
    return;
  }

  const remoteUpdatedAt = event.updated ? new Date(event.updated) : null;
  const previousRemoteUpdatedAt = bill.googleSync?.remoteUpdatedAt
    ? new Date(bill.googleSync.remoteUpdatedAt)
    : null;
  if (
    remoteUpdatedAt &&
    previousRemoteUpdatedAt &&
    remoteUpdatedAt.getTime() <= previousRemoteUpdatedAt.getTime()
  ) {
    return;
  }

  const start = parseEventDate(event.start);
  const ownerUserId = await getItemOwnerUserId(itemId);
  if (!ownerUserId) {
    return;
  }

  const nextDueDate = start ? formatDateOnly(start) : undefined;

  const updated = await updateBill(
    bill.id,
    ownerUserId,
    {
      statementDate: bill.statementDate ? formatDateOnly(bill.statementDate) : undefined,
      amount: bill.amount ?? undefined,
      dueDate: nextDueDate ?? (bill.dueDate ? formatDateOnly(bill.dueDate) : undefined),
      payUrl: bill.payUrl ?? undefined,
      status: bill.status,
      assignedCollaboratorId: bill.assignedCollaboratorId ?? null
    },
    { queueGoogleSync: false }
  );

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
  summary: GoogleSyncSummary,
  retrying: boolean = false
): Promise<void> {
  let syncToken = credential.syncToken ?? undefined;
  if (syncToken === 'local-seed') {
    syncToken = undefined;
  }
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
        logInfo(`No sync token found for user ${credential.userId}; performing full pull without updatedMin`, {
          calendarId
        });
      }

      if (pageToken) {
        params.set('pageToken', pageToken);
      }

      const url = `${GOOGLE_CALENDAR_API}/calendars/${encodedCalendarId}/events?${params.toString()}`;
      const payload = await googleJsonRequest(accessToken, url, { method: 'GET' });

      const items: GoogleEventResource[] = Array.isArray(payload.items) ? payload.items : [];
      for (const event of items) {
        const privateProps = event.extendedProperties?.private ?? {};
        const carebaseItemId = privateProps.carebaseItemId;

        let itemId = Number.isFinite(Number(carebaseItemId)) ? Number(carebaseItemId) : NaN;
        let preloadedAppointment: Appointment | undefined;
        let preloadedBill: Bill | undefined;

        if (!Number.isFinite(itemId)) {
          const link = await findGoogleSyncLinkByEvent(event.id);
          if (link) {
            itemId = link.itemId;
          }
        }

        if (!Number.isFinite(itemId)) {
          continue;
        }

        let handled = false;

        if (privateProps.carebaseType === 'appointment') {
          await applyGoogleAppointmentUpdate(calendarId, event, summary);
          handled = true;
        } else if (privateProps.carebaseType === 'bill') {
          await applyGoogleBillUpdate(calendarId, event, summary);
          handled = true;
        } else {
          preloadedAppointment = await getAppointmentByItemId(itemId);
          if (preloadedAppointment) {
            await applyGoogleAppointmentUpdate(calendarId, event, summary, preloadedAppointment);
            handled = true;
          } else {
            preloadedBill = await getBillByItemId(itemId);
            if (preloadedBill) {
              await applyGoogleBillUpdate(calendarId, event, summary, preloadedBill);
              handled = true;
            }
          }
        }

        if (!handled) {
          await deleteGoogleSyncLink(itemId);
        }
      }

      latestSyncToken = payload.nextSyncToken ?? latestSyncToken;
      pageToken = payload.nextPageToken ?? undefined;
      syncToken = undefined;
    } while (pageToken);
  } catch (error) {
    if (error instanceof GoogleSyncException && error.status === 410) {
      const errorContext = error.context as Record<string, unknown> | undefined;
      const errorPayload =
        errorContext && typeof errorContext === 'object'
          ? (errorContext as any).payload?.error ?? (errorContext as any).payload ?? null
          : null;
      logWarn(
        `Google sync token invalid for user ${credential.userId}, resetting for full reload`,
        {
          calendarId,
          hadSyncToken: Boolean(credential.syncToken),
          retrying,
          context: error.context ?? null,
          errorPayload
        }
      );
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

      if (!retrying) {
        await pullGoogleChanges(
          accessToken,
          { ...credential, calendarId, syncToken: null, lastPulledAt: null },
          calendarId,
          summary,
          true
        );
        return;
      }

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
    logInfo(`Updated sync token for user ${credential.userId}`, {
      calendarId,
      nextSyncToken: latestSyncToken,
      pulled: summary.pulled,
      pushed: summary.pushed
    });
  } else {
    logWarn(`No nextSyncToken returned for user ${credential.userId}`, {
      calendarId,
      pulled: summary.pulled,
      pushed: summary.pushed
    });

    await upsertGoogleCredential(credential.userId, {
      accessToken,
      refreshToken: credential.refreshToken,
      scope: credential.scope,
      expiresAt: credential.expiresAt,
      tokenType: credential.tokenType ?? undefined,
      idToken: credential.idToken ?? undefined,
      calendarId,
      syncToken: credential.syncToken,
      lastPulledAt: new Date()
    });
  }
}

export async function syncUserWithGoogle(userId: number, options: GoogleSyncOptions = {}): Promise<GoogleSyncSummary> {
  const { credential, accessToken } = await ensureValidAccessToken(userId);
  const calendarId = normalizeCalendarId(options.calendarId ?? credential.calendarId ?? 'primary');
  const summary: GoogleSyncSummary = {
    pushed: 0,
    pulled: 0,
    deleted: 0,
    errors: [],
    calendarId
  };

  if (options.pullRemote !== false) {
    try {
      await ensureCalendarWatchForUser(userId, accessToken, calendarId);
    } catch (error) {
      logWarn(
        `Failed to ensure Google watch for user ${userId}`,
        error instanceof Error ? error.message : String(error)
      );
    }
  }

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

  if (options.forceFull) {
    await queueGoogleSyncForUser({ userId, calendarId, schedule: false, forceFull: true });
  }

  const hasQueuedSeed = credential.syncToken === 'local-seed';
  const hasRealSyncToken = Boolean(credential.syncToken && credential.syncToken !== 'local-seed');
  const needsInitialSeed = !hasRealSyncToken && !hasQueuedSeed;

  if (needsInitialSeed) {
    await queueGoogleSyncForUser({ userId, calendarId, schedule: false, forceFull: true });
    await upsertGoogleCredential(userId, {
      accessToken,
      refreshToken: credential.refreshToken,
      scope: credential.scope,
      expiresAt: credential.expiresAt,
      tokenType: credential.tokenType ?? undefined,
      idToken: credential.idToken ?? undefined,
      calendarId,
      syncToken: 'local-seed',
      lastPulledAt: credential.lastPulledAt ?? null
    });
    credential.syncToken = 'local-seed';
  }

  const shouldPullRemote = options.pullRemote !== false;
  if (shouldPullRemote) {
    const effectiveSyncToken = hasRealSyncToken ? credential.syncToken : null;
    try {
      const pullCredential = { ...credential, calendarId, syncToken: effectiveSyncToken ?? undefined };
      await pullGoogleChanges(accessToken, pullCredential, calendarId, summary);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to pull Google Calendar changes';
      summary.errors.push({ message });
    }
  }

  if (
    summary.errors.some((entry) =>
      entry.message?.includes('remote appointment updated after local edit') ||
      entry.message?.includes('Remote appointment updated after local edit')
    )
  ) {
    return summary;
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
        try {
          await pushAppointment(accessToken, calendarId, appointment, localHash);
          summary.pushed += 1;
        } catch (error) {
          if (error instanceof GoogleSyncException && error.code === 'remote_newer') {
            let remoteEvent = error.context?.remoteEvent as GoogleEventResource | undefined;
            if (!remoteEvent && appointment.googleSync?.eventId) {
              try {
                const encodedCalendarId = encodeURIComponent(calendarId);
                remoteEvent = await googleJsonRequest(
                  accessToken,
                  `${GOOGLE_CALENDAR_API}/calendars/${encodedCalendarId}/events/${encodeURIComponent(appointment.googleSync.eventId)}`,
                  { method: 'GET' }
                );
              } catch {}
            }
            if (remoteEvent) {
              try {
                await applyGoogleAppointmentUpdate(calendarId, remoteEvent, summary, appointment);
              } catch (applyError) {
                const message =
                  applyError instanceof Error ? applyError.message : 'Failed to apply remote appointment update';
                summary.errors.push({ itemId: appointment.itemId, message });
              }
              continue;
            }
            await markGoogleSyncPending(appointment.itemId, localHash);
            const ownerUserId = await getItemOwnerUserId(appointment.itemId);
            if (ownerUserId) {
              scheduleGoogleSyncForUser(ownerUserId, 0);
            }
            summary.errors.push({ itemId: appointment.itemId, message: error.message });
            continue;
          }
          throw error;
        }
      } else if (item.itemType === 'bill') {
        const bill = await getBillByItemId(item.itemId);
        if (!bill) {
          await deleteGoogleSyncLink(item.itemId);
          continue;
        }
        const localHash = calculateBillHash(bill);
        try {
          await pushBill(accessToken, calendarId, bill, localHash);
          summary.pushed += 1;
        } catch (error) {
          if (error instanceof GoogleSyncException && error.code === 'remote_newer') {
            let remoteEvent = error.context?.remoteEvent as GoogleEventResource | undefined;
            if (!remoteEvent && bill.googleSync?.eventId) {
              try {
                const encodedCalendarId = encodeURIComponent(calendarId);
                remoteEvent = await googleJsonRequest(
                  accessToken,
                  `${GOOGLE_CALENDAR_API}/calendars/${encodedCalendarId}/events/${encodeURIComponent(bill.googleSync.eventId)}`,
                  { method: 'GET' }
                );
              } catch {}
            }
            if (remoteEvent) {
              try {
                await applyGoogleBillUpdate(calendarId, remoteEvent, summary, bill);
              } catch (applyError) {
                const message =
                  applyError instanceof Error ? applyError.message : 'Failed to apply remote bill update';
                summary.errors.push({ itemId: bill.itemId, message });
              }
              continue;
            }
            await markGoogleSyncPending(bill.itemId, localHash);
            const ownerUserId = await getItemOwnerUserId(bill.itemId);
            if (ownerUserId) {
              scheduleGoogleSyncForUser(ownerUserId, 0);
            }
            summary.errors.push({ itemId: bill.itemId, message: error.message });
            continue;
          }
          throw error;
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown Google sync error';
      summary.errors.push({ itemId: item.itemId, message });
      await markGoogleSyncError(item.itemId, message);
    }
  }

  return summary;
}

syncRunner = syncUserWithGoogle;

export { pullGoogleChanges };

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
    logInfo(
      `user=${userId} pushed=${summary.pushed} pulled=${summary.pulled} deleted=${summary.deleted} errors=${summary.errors.length}`
    );
  } catch (error) {
    const delay = computeRetryDelay(userId);
    const message = error instanceof Error ? error.message : String(error);
    logError(`user=${userId} sync failed (${message}). Retrying in ${delay}ms`);
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
  if (VERBOSE_SYNC_LOGS) {
    logInfo('Scheduling Google sync', { userId, debounceMs });
  }
  if (testSchedulerOverride) {
    testSchedulerOverride(userId, debounceMs);
    return;
  }
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
  testSchedulerOverride = null;
  debounceTimers.forEach((timer) => clearTimeout(timer));
  debounceTimers.clear();
  retryTimers.forEach(({ timer }) => timer && clearTimeout(timer));
  retryTimers.clear();
  runningSyncs.clear();
  followUpRequested.clear();
  syncRunner = syncUserWithGoogle;
}

export function __setGoogleSyncSchedulerForTests(
  scheduler: ((userId: number, debounceMs: number) => void) | null
): void {
  testSchedulerOverride = scheduler;
}

export const __testing = {
  formatDateTimeWithTimeZone,
  buildAppointmentEventPayload,
  buildBillEventPayload
};

async function runGoogleSyncPolling(): Promise<void> {
  try {
    await refreshExpiringGoogleWatches();
    if (!ENABLE_POLLING_FALLBACK) {
      return;
    }
    const userIds = await listGoogleConnectedUserIds();
    for (const userId of userIds) {
      scheduleGoogleSyncForUser(userId);
    }
  } catch (error) {
    logError('polling error', error instanceof Error ? error.message : error);
  }
}

export function startGoogleSyncPolling(): void {
  if (IS_TEST_ENV && !ENABLE_SYNC_IN_TEST) {
    return;
  }
  if (pollingTimer) {
    return;
  }

  // Kick off immediately so we don't wait for the first interval.
  void runGoogleSyncPolling();

  pollingTimer = setInterval(() => {
    void runGoogleSyncPolling();
  }, DEFAULT_POLL_INTERVAL_MS);
}

export function stopGoogleSyncPolling(): void {
  if (pollingTimer) {
    clearInterval(pollingTimer);
    pollingTimer = null;
  }
}
