import { logInfo, logWarn } from './logger.js';
import { googleJsonRequest, GOOGLE_CALENDAR_API } from './http.js';
import { GoogleSyncException } from './errors.js';
import { getGoogleSyncConfig } from './config.js';
import {
  upsertGoogleCredential,
  listGoogleSyncLinksForUser,
  upsertGoogleSyncLink,
  markGoogleSyncPending,
  listAcceptedCollaboratorEmailsForOwner,
  type GoogleCredential
} from '../../db/queries.js';

const { defaultTimeZone: DEFAULT_TIME_ZONE } = getGoogleSyncConfig();

export const MANAGED_CALENDAR_SUMMARY = 'CareBase';
export const MANAGED_CALENDAR_ACL_REFRESH_INTERVAL_MS = 12 * 60 * 60 * 1000; // 12 hours

type GoogleCalendarResource = {
  id: string;
  summary?: string;
  timeZone?: string;
};

export function normalizeCalendarId(calendarId?: string | null): string {
  return calendarId && calendarId.trim().length > 0 ? calendarId : 'primary';
}

function isManagedCalendarSummary(value: unknown): boolean {
  return typeof value === 'string' && value.trim().toLowerCase() === MANAGED_CALENDAR_SUMMARY.toLowerCase();
}

async function tryGetCalendarById(accessToken: string, calendarId: string): Promise<GoogleCalendarResource | null> {
  const encodedCalendarId = encodeURIComponent(calendarId);
  try {
    const payload = await googleJsonRequest(
      accessToken,
      `${GOOGLE_CALENDAR_API}/calendars/${encodedCalendarId}`
    );
    return payload ?? null;
  } catch (error) {
    if (error instanceof GoogleSyncException && error.status === 404) {
      return null;
    }
    throw error;
  }
}

async function listAllCalendars(accessToken: string): Promise<GoogleCalendarResource[]> {
  const results: GoogleCalendarResource[] = [];
  let pageToken: string | undefined;
  do {
    const url = new URL(`${GOOGLE_CALENDAR_API}/users/me/calendarList`);
    if (pageToken) {
      url.searchParams.set('pageToken', pageToken);
    }
    const payload = await googleJsonRequest(accessToken, url.toString());
    if (Array.isArray(payload?.items)) {
      for (const item of payload.items) {
        if (item && typeof item.id === 'string') {
          results.push(item as GoogleCalendarResource);
        }
      }
    }
    pageToken = typeof payload?.nextPageToken === 'string' ? payload.nextPageToken : undefined;
  } while (pageToken);
  return results;
}

async function createManagedCalendar(accessToken: string): Promise<GoogleCalendarResource> {
  const payload = await googleJsonRequest(accessToken, `${GOOGLE_CALENDAR_API}/calendars`, {
    method: 'POST',
    body: JSON.stringify({
      summary: MANAGED_CALENDAR_SUMMARY,
      timeZone: DEFAULT_TIME_ZONE ?? 'UTC'
    })
  });
  if (!payload || typeof payload.id !== 'string') {
    throw new GoogleSyncException('Google API did not return a calendar ID on creation', 500, 'missing_calendar');
  }
  return payload as GoogleCalendarResource;
}

export async function ensureManagedCalendarForUser(
  credential: GoogleCredential,
  accessToken: string
): Promise<{ calendarId: string; created: boolean; reused: boolean }> {
  const orderedCandidates: string[] = [];
  if (credential.managedCalendarId) {
    orderedCandidates.push(credential.managedCalendarId);
  }
  if (credential.legacyCalendarId) {
    orderedCandidates.push(credential.legacyCalendarId);
  }
  if (credential.calendarId && credential.calendarId !== credential.managedCalendarId) {
    orderedCandidates.push(credential.calendarId);
  }
  const candidates = new Set(orderedCandidates);

  let calendar: GoogleCalendarResource | null = null;
  let reused = false;
  let created = false;

  for (const candidate of candidates) {
    const existing = await tryGetCalendarById(accessToken, candidate);
    const knownManagedId =
      candidate === credential.managedCalendarId || candidate === credential.legacyCalendarId;
    if (existing && (knownManagedId || isManagedCalendarSummary(existing.summary))) {
      calendar = existing;
      reused = true;
      break;
    }
  }

  if (!calendar) {
    const calendars = await listAllCalendars(accessToken);
    const match = calendars.find((entry) => isManagedCalendarSummary(entry.summary));
    if (match) {
      calendar = match;
      reused = true;
    }
  }

  if (!calendar) {
    calendar = await createManagedCalendar(accessToken);
    created = true;
    reused = false;
    logInfo(`Created CareBase managed calendar for user ${credential.userId}`, {
      calendarId: calendar.id,
      timeZone: calendar.timeZone ?? null
    });
  } else {
    logInfo(`Reusing CareBase managed calendar for user ${credential.userId}`, {
      calendarId: calendar.id,
      timeZone: calendar.timeZone ?? null
    });
  }

  const calendarId = calendar.id;
  const summary = calendar.summary ?? MANAGED_CALENDAR_SUMMARY;

  let legacyCalendarId = credential.legacyCalendarId ?? null;
  if (credential.managedCalendarId && credential.managedCalendarId !== calendarId) {
    legacyCalendarId = credential.managedCalendarId;
  } else if (!legacyCalendarId && credential.calendarId && credential.calendarId !== calendarId) {
    legacyCalendarId = credential.calendarId;
  }

  const updated = await upsertGoogleCredential(credential.userId, {
    accessToken,
    refreshToken: credential.refreshToken,
    scope: credential.scope,
    expiresAt: credential.expiresAt,
    tokenType: credential.tokenType ?? undefined,
    idToken: credential.idToken ?? undefined,
    calendarId,
    syncToken: credential.syncToken,
    lastPulledAt: credential.lastPulledAt ?? null,
    managedCalendarId: calendarId,
    managedCalendarSummary: summary,
    managedCalendarState: 'active',
    managedCalendarVerifiedAt: credential.managedCalendarVerifiedAt ?? null,
    managedCalendarAclRole: credential.managedCalendarAclRole ?? null,
    legacyCalendarId
  }, { clerkUserId: credential.clerkUserId });

  credential.calendarId = updated.calendarId;
  credential.managedCalendarId = updated.managedCalendarId;
  credential.managedCalendarSummary = updated.managedCalendarSummary;
  credential.managedCalendarState = updated.managedCalendarState;
  credential.managedCalendarVerifiedAt = updated.managedCalendarVerifiedAt;
  credential.managedCalendarAclRole = updated.managedCalendarAclRole;
  credential.legacyCalendarId = updated.legacyCalendarId;

  return {
    calendarId,
    created,
    reused
  };
}

export async function migrateEventsToManagedCalendar(
  credential: GoogleCredential,
  accessToken: string,
  targetCalendarId: string
): Promise<{ migrated: number; pending: number; failed: number; previousCalendarIds: string[] }> {
  const normalizedTarget = normalizeCalendarId(targetCalendarId);
  const links = await listGoogleSyncLinksForUser(credential.userId);
  let migrated = 0;
  let pending = 0;
  let failed = 0;
  const previousCalendars = new Set<string>();

  for (const link of links) {
    const sourceCalendar = normalizeCalendarId(link.calendarId);
    if (sourceCalendar === normalizedTarget) {
      continue;
    }
    previousCalendars.add(sourceCalendar);

    if (!link.eventId) {
      await upsertGoogleSyncLink(link.itemId, {
        calendarId: normalizedTarget
      });
      continue;
    }

    const moveUrl = `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(sourceCalendar)}/events/${encodeURIComponent(link.eventId)}/move?destination=${encodeURIComponent(normalizedTarget)}`;
    try {
      const moved = await googleJsonRequest(accessToken, moveUrl, { method: 'POST' });
      const eventId = typeof moved?.id === 'string' ? moved.id : link.eventId;
      const etag = typeof moved?.etag === 'string' ? moved.etag : undefined;
      const remoteUpdatedAt =
        typeof moved?.updated === 'string' ? new Date(moved.updated) : undefined;

      await upsertGoogleSyncLink(link.itemId, {
        calendarId: normalizedTarget,
        eventId,
        etag,
        remoteUpdatedAt
      });
      migrated += 1;
    } catch (error) {
      if (error instanceof GoogleSyncException && error.status === 404) {
        await upsertGoogleSyncLink(link.itemId, {
          calendarId: normalizedTarget,
          eventId: null,
          etag: null,
          remoteUpdatedAt: null
        });
        await markGoogleSyncPending(link.itemId);
        pending += 1;
        continue;
      }
      failed += 1;
      logWarn('Failed to move Google event to managed calendar', {
        userId: credential.userId,
        itemId: link.itemId,
        sourceCalendar,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  return {
    migrated,
    pending,
    failed,
    previousCalendarIds: Array.from(previousCalendars)
  };
}

export async function ensureManagedCalendarAclForUser(
  credential: GoogleCredential,
  accessToken: string,
  calendarId: string,
  role: 'writer' | 'reader' = 'writer'
): Promise<{ granted: number; skipped: number; errors: number }> {
  const emails = await listAcceptedCollaboratorEmailsForOwner(credential.userId);
  const uniqueEmails = Array.from(
    new Set(
      emails
        .map((email) => email?.trim().toLowerCase())
        .filter((email): email is string => Boolean(email))
    )
  );

  const verifiedAt = credential.managedCalendarVerifiedAt
    ? new Date(credential.managedCalendarVerifiedAt)
    : null;
  const recentlyVerified =
    verifiedAt && Date.now() - verifiedAt.getTime() < MANAGED_CALENDAR_ACL_REFRESH_INTERVAL_MS;
  if (recentlyVerified && credential.managedCalendarAclRole === role && uniqueEmails.length === 0) {
    return { granted: 0, skipped: 0, errors: 0 };
  }

  let granted = 0;
  let skipped = 0;
  let errors = 0;
  const aclBaseUrl = `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/acl`;

  let existingAcl: Map<string, string> | null = null;
  try {
    const aclList = await googleJsonRequest(accessToken, aclBaseUrl, { method: 'GET' });
    const items = Array.isArray(aclList?.items) ? aclList.items : [];
    existingAcl = new Map();
    for (const entry of items) {
      const scopeValue = typeof entry?.scope?.value === 'string' ? entry.scope.value.trim().toLowerCase() : null;
      const entryRole = typeof entry?.role === 'string' ? entry.role : null;
      if (scopeValue && entryRole) {
        existingAcl.set(scopeValue, entryRole);
      }
    }
  } catch (error) {
    logWarn('Failed to list Google calendar ACL entries', {
      userId: credential.userId,
      calendarId,
      error: error instanceof Error ? error.message : String(error)
    });

    existingAcl = null;
  }

  for (const email of uniqueEmails) {
    const currentRole = existingAcl?.get(email) ?? null;
    if (currentRole === role) {
      skipped += 1;
      continue;
    }

    try {
      await googleJsonRequest(accessToken, aclBaseUrl, {
        method: 'POST',
        body: JSON.stringify({
          role,
          scope: {
            type: 'user',
            value: email
          },
          sendNotifications: false
        })
      });
      granted += 1;
    } catch (error) {
      if (error instanceof GoogleSyncException && error.code === 'duplicate') {
        skipped += 1;
        continue;
      }
      errors += 1;
      logWarn('Failed to share CareBase managed calendar with collaborator', {
        userId: credential.userId,
        calendarId,
        email,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  const verifiedAtNext = new Date();
  const updated = await upsertGoogleCredential(credential.userId, {
    accessToken,
    refreshToken: credential.refreshToken,
    scope: credential.scope,
    expiresAt: credential.expiresAt,
    tokenType: credential.tokenType ?? undefined,
    idToken: credential.idToken ?? undefined,
    calendarId: credential.calendarId,
    syncToken: credential.syncToken,
    lastPulledAt: credential.lastPulledAt ?? null,
    managedCalendarId: credential.managedCalendarId ?? calendarId,
    managedCalendarSummary: credential.managedCalendarSummary ?? MANAGED_CALENDAR_SUMMARY,
    managedCalendarState: 'active',
    managedCalendarVerifiedAt: verifiedAtNext,
    managedCalendarAclRole: role,
    legacyCalendarId: credential.legacyCalendarId ?? null
  }, { clerkUserId: credential.clerkUserId });

  credential.managedCalendarId = updated.managedCalendarId;
  credential.managedCalendarSummary = updated.managedCalendarSummary;
  credential.managedCalendarState = updated.managedCalendarState;
  credential.managedCalendarVerifiedAt = updated.managedCalendarVerifiedAt;
  credential.managedCalendarAclRole = updated.managedCalendarAclRole;
  credential.legacyCalendarId = updated.legacyCalendarId;

  return { granted, skipped, errors };
}
