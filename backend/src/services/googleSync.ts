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
  upsertGoogleSyncLink,
  listGoogleSyncLinksForUser,
  listAcceptedCollaboratorEmailsForOwner,
  type GoogleCredential,
} from '../db/queries.js';
import { getClient } from '../db/client.js';
import { getGoogleSyncConfig, isTestEnv } from './googleSync/config.js';
import { logError, logInfo, logWarn } from './googleSync/logger.js';
import {
  googleJsonRequest,
  GOOGLE_CALENDAR_API
} from './googleSync/http.js';
import { GoogleSyncException } from './googleSync/errors.js';
import { ensureValidAccessToken } from './googleSync/auth.js';
import {
  ensureManagedCalendarForUser,
  ensureManagedCalendarAclForUser,
  MANAGED_CALENDAR_ACL_REFRESH_INTERVAL_MS,
  MANAGED_CALENDAR_SUMMARY,
  migrateEventsToManagedCalendar,
  normalizeCalendarId
} from './googleSync/managedCalendars.js';
import {
  ensureCalendarWatchForUser,
  refreshExpiringGoogleWatches,
  handleGoogleWatchNotification as handleGoogleWatchNotificationInternal,
  stopCalendarWatchForUser as stopCalendarWatchForUserInternal,
  configureWatchEnvironment,
  setWatchScheduleCallback,
  setWatchTestSchedulerOverride,
  resetWatchStateForTests
} from './googleSync/watchers.js';
import {
  calculateAppointmentHash,
  calculateBillHash,
  buildAppointmentEventPayload,
  buildBillEventPayload,
  applyGoogleAppointmentUpdate,
  applyGoogleBillUpdate
} from './googleSync/eventTransforms.js';
import type {
  GoogleSyncOptions,
  SyncError,
  GoogleSyncSummary,
  SyncRunner,
  RetryState,
  AuthenticatedCredential,
  GoogleEventResource
} from './googleSync/types.js';
import { formatDateTimeWithTimeZone } from '../utils/timezone.js';

export type { GoogleSyncSummary } from './googleSync/types.js';
export { exchangeGoogleAuthorizationCode, exchangeGoogleAuthorizationCodeServer } from './googleSync/auth.js';
export {
  ensureManagedCalendarForUser,
  migrateEventsToManagedCalendar,
  ensureManagedCalendarAclForUser
} from './googleSync/managedCalendars.js';
export {
  handleGoogleWatchNotificationInternal as handleGoogleWatchNotification,
  stopCalendarWatchForUserInternal as stopCalendarWatchForUser
};
const GOOGLE_SYNC_LOCK_NAMESPACE = 0x4753;

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

configureWatchEnvironment({ isTestEnv: IS_TEST_ENV, enableSyncInTest: ENABLE_SYNC_IN_TEST });

const debounceTimers = new Map<number, NodeJS.Timeout>();
const retryTimers = new Map<number, RetryState>();
const runningSyncs = new Set<number>();
const followUpRequested = new Set<number>();
let pollingTimer: NodeJS.Timeout | null = null;
let advisoryLocksSupported = true;
let locksDisabledForTests = false;
let lockHookForTests: ((userId: number) => boolean | Promise<boolean>) | null = null;
let testSchedulerOverride: ((userId: number, debounceMs: number) => void) | null = null;

let syncRunner: SyncRunner;

export async function refreshManagedCalendarWatch(
  credential: GoogleCredential,
  accessToken: string,
  calendarId: string,
  previousCalendarIds: string[]
): Promise<void> {
  const normalizedTarget = normalizeCalendarId(calendarId);
  const distinctPrevious = Array.from(
    new Set(previousCalendarIds.map((id) => normalizeCalendarId(id)).filter((id) => id !== normalizedTarget))
  );

  if (distinctPrevious.length > 0) {
    try {
      await stopCalendarWatchForUserInternal(credential.userId);
    } catch (error) {
      logWarn('Failed to stop existing Google watch channel during managed calendar migration', {
        userId: credential.userId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  try {
    await ensureCalendarWatchForUser(credential.userId, accessToken, normalizedTarget);
  } catch (error) {
    logWarn('Failed to ensure Google watch for managed calendar', {
      userId: credential.userId,
      calendarId: normalizedTarget,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

async function pushAppointment(
  accessToken: string,
  calendarId: string,
  appointment: Appointment,
  localHash: string
): Promise<void> {
  const payload = buildAppointmentEventPayload(appointment, DEFAULT_TIME_ZONE);
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
          await applyGoogleAppointmentUpdate(calendarId, event, summary, DEFAULT_TIME_ZONE);
          handled = true;
        } else if (privateProps.carebaseType === 'bill') {
          await applyGoogleBillUpdate(calendarId, event, summary);
          handled = true;
        } else {
          preloadedAppointment = await getAppointmentByItemId(itemId);
          if (preloadedAppointment) {
            await applyGoogleAppointmentUpdate(calendarId, event, summary, DEFAULT_TIME_ZONE, preloadedAppointment);
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
      lastPulledAt: null,
      managedCalendarId: credential.managedCalendarId ?? null,
      managedCalendarSummary: credential.managedCalendarSummary ?? null,
      managedCalendarState: credential.managedCalendarState ?? null,
      managedCalendarVerifiedAt: credential.managedCalendarVerifiedAt ?? null,
      managedCalendarAclRole: credential.managedCalendarAclRole ?? null,
      legacyCalendarId: credential.legacyCalendarId ?? null
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
    lastPulledAt: new Date(),
    managedCalendarId: credential.managedCalendarId ?? null,
    managedCalendarSummary: credential.managedCalendarSummary ?? null,
    managedCalendarState: credential.managedCalendarState ?? null,
    managedCalendarVerifiedAt: credential.managedCalendarVerifiedAt ?? null,
    managedCalendarAclRole: credential.managedCalendarAclRole ?? null,
    legacyCalendarId: credential.legacyCalendarId ?? null
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
    lastPulledAt: new Date(),
    managedCalendarId: credential.managedCalendarId ?? null,
    managedCalendarSummary: credential.managedCalendarSummary ?? null,
    managedCalendarState: credential.managedCalendarState ?? null,
    managedCalendarVerifiedAt: credential.managedCalendarVerifiedAt ?? null,
    managedCalendarAclRole: credential.managedCalendarAclRole ?? null,
    legacyCalendarId: credential.legacyCalendarId ?? null
  });
  }
}

export async function syncUserWithGoogle(userId: number, options: GoogleSyncOptions = {}): Promise<GoogleSyncSummary> {
  const { credential, accessToken } = await ensureValidAccessToken(userId);

  const normalizedCurrentCalendar = normalizeCalendarId(credential.calendarId ?? null);
  const normalizedManagedCalendar = normalizeCalendarId(credential.managedCalendarId ?? credential.calendarId ?? null);
  const needsManagedCalendar =
    !credential.managedCalendarId || credential.managedCalendarState !== 'active' || normalizedCurrentCalendar !== normalizedManagedCalendar;

  let ensuredCalendarId: string | null = credential.managedCalendarId ?? credential.calendarId ?? null;
  if (needsManagedCalendar) {
    const ensureResult = await ensureManagedCalendarForUser(credential, accessToken);
    ensuredCalendarId = ensureResult.calendarId;
  }

  const targetCalendarId = ensuredCalendarId ?? 'primary';
  const migrationSummary = await migrateEventsToManagedCalendar(credential, accessToken, targetCalendarId);
  await refreshManagedCalendarWatch(credential, accessToken, targetCalendarId, migrationSummary.previousCalendarIds);

  const lastAclVerification = credential.managedCalendarVerifiedAt
    ? new Date(credential.managedCalendarVerifiedAt)
    : null;
  const needsAclRefresh =
    !lastAclVerification ||
    Date.now() - lastAclVerification.getTime() > MANAGED_CALENDAR_ACL_REFRESH_INTERVAL_MS ||
    (credential.managedCalendarAclRole ?? 'writer') !== 'writer';
  if (needsAclRefresh) {
    await ensureManagedCalendarAclForUser(credential, accessToken, targetCalendarId);
  }

  const calendarId = normalizeCalendarId(options.calendarId ?? targetCalendarId ?? 'primary');
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
      lastPulledAt: credential.lastPulledAt ?? null,
      managedCalendarId: credential.managedCalendarId ?? null,
      managedCalendarSummary: credential.managedCalendarSummary ?? null,
      managedCalendarState: credential.managedCalendarState ?? null,
      managedCalendarVerifiedAt: credential.managedCalendarVerifiedAt ?? null,
      managedCalendarAclRole: credential.managedCalendarAclRole ?? null,
      legacyCalendarId: credential.legacyCalendarId ?? null
    });
  }

  if (options.forceFull) {
    await queueGoogleSyncForUser(userId, calendarId, { schedule: false });
  }

  const hasQueuedSeed = credential.syncToken === 'local-seed';
  const hasRealSyncToken = Boolean(credential.syncToken && credential.syncToken !== 'local-seed');
  const needsInitialSeed = !hasRealSyncToken && !hasQueuedSeed;

  if (needsInitialSeed) {
    await queueGoogleSyncForUser(userId, calendarId, { schedule: false });
    await upsertGoogleCredential(userId, {
      accessToken,
      refreshToken: credential.refreshToken,
      scope: credential.scope,
      expiresAt: credential.expiresAt,
      tokenType: credential.tokenType ?? undefined,
      idToken: credential.idToken ?? undefined,
      calendarId,
      syncToken: 'local-seed',
      lastPulledAt: credential.lastPulledAt ?? null,
      managedCalendarId: credential.managedCalendarId ?? null,
      managedCalendarSummary: credential.managedCalendarSummary ?? null,
      managedCalendarState: credential.managedCalendarState ?? null,
      managedCalendarVerifiedAt: credential.managedCalendarVerifiedAt ?? null,
      managedCalendarAclRole: credential.managedCalendarAclRole ?? null,
      legacyCalendarId: credential.legacyCalendarId ?? null
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
                await applyGoogleAppointmentUpdate(calendarId, remoteEvent, summary, DEFAULT_TIME_ZONE, appointment);
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

async function withSyncLock<T>(userId: number, action: () => Promise<T>): Promise<{ acquired: boolean; value?: T }> {
  if (locksDisabledForTests) {
    const value = await action();
    return { acquired: true, value };
  }

  if (lockHookForTests) {
    const decision = await lockHookForTests(userId);
    if (!decision) {
      return { acquired: false };
    }
    const value = await action();
    return { acquired: true, value };
  }

  if (!advisoryLocksSupported) {
    const value = await action();
    return { acquired: true, value };
  }

  const client = await getClient();
  let acquired = false;
  let lockAttempted = false;
  try {
    try {
      const result = await client.query<{ acquired: boolean }>(
        'SELECT pg_try_advisory_lock($1::int, $2::int) AS acquired',
        [GOOGLE_SYNC_LOCK_NAMESPACE, userId]
      );
      lockAttempted = true;
      acquired = Boolean(result.rows[0]?.acquired);
    } catch (error) {
      if (
        error instanceof Error &&
        /pg_try_advisory_lock/.test(error.message ?? '')
      ) {
        advisoryLocksSupported = false;
        logWarn(
          'Postgres advisory locks unavailable; falling back to process-local sync coordination',
          error instanceof Error ? error.message : String(error)
        );
      } else {
        throw error;
      }
    }

    if (!lockAttempted || !advisoryLocksSupported) {
      const value = await action();
      return { acquired: true, value };
    }

    if (!acquired) {
      return { acquired: false };
    }

    const value = await action();
    return { acquired: true, value };
  } finally {
    if (acquired) {
      try {
        await client.query('SELECT pg_advisory_unlock($1::int, $2::int)', [GOOGLE_SYNC_LOCK_NAMESPACE, userId]);
      } catch (error) {
        logWarn(
          'Failed to release Google sync advisory lock',
          error instanceof Error ? error.message : String(error)
        );
      }
    }
    client.release();
  }
}

async function performSync(userId: number): Promise<void> {
  if (runningSyncs.has(userId)) {
    followUpRequested.add(userId);
    return;
  }

  runningSyncs.add(userId);
  let lockAcquired = false;
  let summary: GoogleSyncSummary | null = null;
  try {
    const result = await withSyncLock(userId, async () => {
      lockAcquired = true;
      const syncSummary = await syncRunner(userId, { pullRemote: true });
      retryTimers.delete(userId);
      return syncSummary;
    });

    if (!lockAcquired || !result.acquired) {
      logInfo('Skipped Google sync because advisory lock is held elsewhere', { userId });
      scheduleGoogleSyncForUser(userId, DEFAULT_DEBOUNCE_MS);
      return;
    }

    summary = result.value ?? null;
    if (!summary) {
      return;
    }

    logInfo(
      `user=${userId} pushed=${summary.pushed} pulled=${summary.pulled} deleted=${summary.deleted} errors=${summary.errors.length}`
    );
  } catch (error) {
    if (!lockAcquired) {
      logWarn(
        `Google sync lock contention resulted in error`,
        error instanceof Error ? error.message : String(error)
      );
      scheduleGoogleSyncForUser(userId, DEFAULT_DEBOUNCE_MS);
      return;
    }
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
  logInfo('Scheduling Google sync', { userId, debounceMs });
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

setWatchScheduleCallback(scheduleGoogleSyncForUser);

export function __setGoogleSyncRunnerForTests(runner?: SyncRunner): void {
  syncRunner = runner ?? syncUserWithGoogle;
}

export function __resetGoogleSyncStateForTests(): void {
  testSchedulerOverride = null;
  resetWatchStateForTests();
  debounceTimers.forEach((timer) => clearTimeout(timer));
  debounceTimers.clear();
  retryTimers.forEach(({ timer }) => timer && clearTimeout(timer));
  retryTimers.clear();
  runningSyncs.clear();
  followUpRequested.clear();
  advisoryLocksSupported = true;
  locksDisabledForTests = false;
  lockHookForTests = null;
  syncRunner = syncUserWithGoogle;
}

export function __setGoogleSyncSchedulerForTests(
  scheduler: ((userId: number, debounceMs: number) => void) | null
): void {
  testSchedulerOverride = scheduler;
  setWatchTestSchedulerOverride(scheduler);
}

export function __setGoogleSyncLockBehaviorForTests(options?: {
  disableLocks?: boolean;
  acquireHook?: (userId: number) => boolean | Promise<boolean>;
}): void {
  locksDisabledForTests = options?.disableLocks ?? false;
  lockHookForTests = options?.acquireHook ?? null;
}

export const __testing = {
  formatDateTimeWithTimeZone,
  buildAppointmentEventPayload: (appointment: Appointment) =>
    buildAppointmentEventPayload(appointment, DEFAULT_TIME_ZONE),
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
