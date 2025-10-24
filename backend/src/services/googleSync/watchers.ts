import crypto from 'crypto';
import {
  upsertGoogleWatchChannel,
  deleteGoogleWatchChannel,
  findGoogleWatchChannelByUser,
  findGoogleWatchChannelById,
  findGoogleWatchChannelByResource,
  findGoogleWatchChannelByToken,
  listExpiringGoogleWatchChannels,
  listGoogleWatchChannelsByUser,
  type GoogleWatchChannel
} from '../../db/queries.js';
import { logError, logInfo, logWarn } from './logger.js';
import {
  googleJsonRequest,
  GOOGLE_CALENDAR_API,
  GOOGLE_CHANNELS_API,
  getGoogleWebhookAddress
} from './http.js';
import { GoogleSyncException } from './errors.js';
import { ensureValidAccessToken } from './auth.js';
import { normalizeCalendarId } from './managedCalendars.js';

const WATCH_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days
const WATCH_RENEWAL_THRESHOLD_MS = 60 * 60 * 1000; // 1 hour
const WATCH_RENEWAL_LOOKAHEAD_MS = 12 * 60 * 60 * 1000; // 12 hours

type Scheduler = (userId: number, debounceMs: number) => void;

let isTestEnv = false;
let enableSyncInTest = false;
let scheduleCallback: Scheduler | null = null;
let testSchedulerOverride: Scheduler | null = null;

export function configureWatchEnvironment(options: { isTestEnv: boolean; enableSyncInTest: boolean }): void {
  isTestEnv = options.isTestEnv;
  enableSyncInTest = options.enableSyncInTest;
}

export function setWatchScheduleCallback(callback: Scheduler | null): void {
  scheduleCallback = callback;
}

export function setWatchTestSchedulerOverride(callback: Scheduler | null): void {
  testSchedulerOverride = callback;
}

export function resetWatchStateForTests(): void {
  testSchedulerOverride = null;
}

function schedule(userId: number, debounceMs: number): void {
  if (testSchedulerOverride) {
    testSchedulerOverride(userId, debounceMs);
    return;
  }
  if (isTestEnv && !enableSyncInTest) {
    return;
  }
  if (!scheduleCallback) {
    throw new Error('Google watch scheduler callback not configured');
  }
  scheduleCallback(userId, debounceMs);
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

export async function ensureCalendarWatchForUser(
  userId: number,
  accessToken: string,
  calendarId: string,
  clerkUserId?: string | null
): Promise<GoogleWatchChannel> {
  const normalizedCalendarId = normalizeCalendarId(calendarId);
  if (isTestEnv && testSchedulerOverride) {
    const existingTestChannel = await findGoogleWatchChannelByUser(userId, normalizedCalendarId, clerkUserId);
    if (existingTestChannel) {
      return existingTestChannel;
    }
    return upsertGoogleWatchChannel({
      channelId: `test-${userId}-${normalizedCalendarId}`,
      userId,
      clerkUserId: clerkUserId ?? null,
      calendarId: normalizedCalendarId,
      resourceId: `test-resource-${userId}-${normalizedCalendarId}`,
      resourceUri: null,
      expiration: new Date(Date.now() + WATCH_RENEWAL_LOOKAHEAD_MS * 2),
      channelToken: null
    });
  }

  const existing = await findGoogleWatchChannelByUser(userId, normalizedCalendarId, clerkUserId);
  const now = Date.now();
  if (existing) {
    const expiresAtMs =
      existing.expiration instanceof Date ? existing.expiration.getTime() : Number.POSITIVE_INFINITY;
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
    clerkUserId: clerkUserId ?? null,
    calendarId: normalizedCalendarId,
    resourceId: String(responseResourceId),
    resourceUri: response.resourceUri ?? response.resource_uri ?? null,
    expiration,
    channelToken
  });
}

export async function refreshExpiringGoogleWatches(): Promise<void> {
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
        await ensureCalendarWatchForUser(channel.userId, accessToken, calendarId, credential.clerkUserId);
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
    clerkUserId: channel.clerkUserId,
    calendarId: channel.calendarId,
    resourceId: channel.resourceId,
    resourceUri: resourceUri ?? channel.resourceUri ?? undefined,
    expiration: expiration ?? undefined,
    channelToken: channel.channelToken ?? undefined
  });

  if (resourceState === 'sync') {
    logInfo('Google webhook initial sync acknowledgement', {
      userId: channel.userId,
      channelId
    });
    schedule(channel.userId, 0);
    return;
  }

  schedule(channel.userId, 0);
}

export async function stopCalendarWatchForUser(userId: number): Promise<void> {
  let accessToken: string | null = null;
  let clerkUserId: string | null = null;
  try {
    const authenticated = await ensureValidAccessToken(userId);
    accessToken = authenticated.accessToken;
    clerkUserId = authenticated.credential.clerkUserId ?? null;
  } catch (error) {
    logWarn(
      `Unable to fetch Google credentials when stopping watch for user ${userId}`,
      error instanceof Error ? error.message : String(error)
    );
  }

  const channels = await listGoogleWatchChannelsByUser(userId, clerkUserId);
  if (channels.length === 0) {
    return;
  }

  for (const channel of channels) {
    if (accessToken && channel.resourceId) {
      await stopGoogleWatch(accessToken, channel.channelId, channel.resourceId);
    }
    await deleteGoogleWatchChannel(channel.channelId);
  }
}
