import type { Appointment, Bill } from '@carebase/shared';
import {
  upsertGoogleCredential,
  markGoogleSyncSuccess,
  markGoogleSyncPending,
  markGoogleSyncError,
  deleteGoogleSyncLink,
  findGoogleSyncLinkByEvent,
  getAppointmentByItemId,
  getBillByItemId,
  type GoogleCredential
} from '../../db/queries.js';
import { logInfo, logWarn } from './logger.js';
import { GoogleSyncException } from './errors.js';
import {
  buildAppointmentEventPayload,
  buildBillEventPayload,
  applyGoogleAppointmentUpdate,
  applyGoogleBillUpdate
} from './eventTransforms.js';
import { googleJsonRequest, GOOGLE_CALENDAR_API } from './http.js';
import { getGoogleSyncConfig } from './config.js';
import type { GoogleEventResource, GoogleSyncSummary } from './types.js';

const { defaultTimeZone: DEFAULT_TIME_ZONE } = getGoogleSyncConfig();

export async function pushAppointment(
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

export async function pushBill(
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

export async function pullGoogleChanges(
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
      }, { clerkUserId: credential.clerkUserId });

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
    }, { clerkUserId: credential.clerkUserId });
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
    }, { clerkUserId: credential.clerkUserId });
  }
}
