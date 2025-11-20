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
  upsertGoogleSyncLink,
  type GoogleCredential
} from '../db/queries.js';
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
import { setGoogleCredentialReauth } from '../db/queries.js';
import {
  ensureCalendarWatchForUser,
  handleGoogleWatchNotification as handleGoogleWatchNotificationInternal,
  stopCalendarWatchForUser as stopCalendarWatchForUserInternal,
  configureWatchEnvironment
} from './googleSync/watchers.js';
import {
  calculateAppointmentHash,
  calculateBillHash,
  buildAppointmentEventPayload,
  buildBillEventPayload,
  applyGoogleAppointmentUpdate,
  applyGoogleBillUpdate
} from './googleSync/eventTransforms.js';
import { pushAppointment, pushBill, pullGoogleChanges } from './googleSync/syncOperations.js';
import type {
  GoogleSyncOptions,
  SyncError,
  GoogleSyncSummary,
  GoogleEventResource
} from './googleSync/types.js';
import {
  initializeGoogleSyncRuntime,
  setSyncRunner,
  scheduleGoogleSyncForUser,
  startGoogleSyncPolling,
  stopGoogleSyncPolling,
  __setGoogleSyncRunnerForTests,
  __resetGoogleSyncStateForTests,
  __setGoogleSyncSchedulerForTests,
  __setGoogleSyncLockBehaviorForTests
} from './googleSync/runtime.js';
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
export { pullGoogleChanges } from './googleSync/syncOperations.js';
export {
  scheduleGoogleSyncForUser,
  startGoogleSyncPolling,
  stopGoogleSyncPolling,
  __setGoogleSyncRunnerForTests,
  __resetGoogleSyncStateForTests,
  __setGoogleSyncSchedulerForTests,
  __setGoogleSyncLockBehaviorForTests
} from './googleSync/runtime.js';

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

initializeGoogleSyncRuntime({
  debounceMs: DEFAULT_DEBOUNCE_MS,
  retryBaseMs: DEFAULT_RETRY_BASE_MS,
  retryMaxMs: MAX_RETRY_MS,
  pollIntervalMs: DEFAULT_POLL_INTERVAL_MS,
  enableSyncInTest: ENABLE_SYNC_IN_TEST,
  enablePollingFallback: ENABLE_POLLING_FALLBACK,
  isTestEnv: IS_TEST_ENV
});

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
    await ensureCalendarWatchForUser(credential.userId, accessToken, normalizedTarget, credential.clerkUserId);
  } catch (error) {
    logWarn('Failed to ensure Google watch for managed calendar', {
      userId: credential.userId,
      calendarId: normalizedTarget,
      error: error instanceof Error ? error.message : String(error)
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
    try {
      const ensureResult = await ensureManagedCalendarForUser(credential, accessToken);
      ensuredCalendarId = ensureResult.calendarId;
    } catch (error) {
      if (error instanceof GoogleSyncException && error.status === 403) {
        await setGoogleCredentialReauth(userId, true);
        throw new GoogleSyncException(
          'Google permissions are missing. Please reconnect Google Calendar.',
          403,
          'needs_reauth',
          { userId }
        );
      }
      throw error;
    }
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
      await ensureCalendarWatchForUser(userId, accessToken, calendarId, credential.clerkUserId);
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
    }, { clerkUserId: credential.clerkUserId });
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
    }, { clerkUserId: credential.clerkUserId });
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

setSyncRunner(syncUserWithGoogle);

export const __testing = {
  formatDateTimeWithTimeZone,
  buildAppointmentEventPayload: (appointment: Appointment) =>
    buildAppointmentEventPayload(appointment, DEFAULT_TIME_ZONE),
  buildBillEventPayload
};
