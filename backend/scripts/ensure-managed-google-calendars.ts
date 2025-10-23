#!/usr/bin/env node

/**
 * Ensure every connected Google user has a managed CareBase calendar and that all
 * existing events are migrated onto it. Safe to run repeatedly.
 *
 * Usage:
 *   npx tsx backend/scripts/ensure-managed-google-calendars.ts
 */

import dbClient from '../src/db/client.js';
import {
  listGoogleConnectedUserIds,
  getGoogleCredential
} from '../src/db/queries.js';
import {
  ensureManagedCalendarForUser,
  migrateEventsToManagedCalendar,
  refreshManagedCalendarWatch,
  ensureManagedCalendarAclForUser,
  syncUserWithGoogle
} from '../src/services/googleSync.js';

async function ensureCalendars(): Promise<void> {
  const userIds = await listGoogleConnectedUserIds();
  if (userIds.length === 0) {
    console.log('No Google-connected users found. Nothing to do.');
    return;
  }

  console.log(`Ensuring managed calendars for ${userIds.length} user(s)...\n`);

  for (const userId of userIds) {
    try {
      const credential = await getGoogleCredential(userId);
      if (!credential) {
        console.warn(`• Skipping user ${userId}: no credential record found`);
        continue;
      }

      const accessToken = credential.accessToken;
      if (!accessToken) {
        console.warn(`• Skipping user ${userId}: missing access token`);
        continue;
      }

      const ensureResult = await ensureManagedCalendarForUser(credential, accessToken);
      const migration = await migrateEventsToManagedCalendar(credential, accessToken, ensureResult.calendarId);
      await refreshManagedCalendarWatch(credential, accessToken, ensureResult.calendarId, migration.previousCalendarIds);
      await ensureManagedCalendarAclForUser(credential, accessToken, ensureResult.calendarId);

      const summary = await syncUserWithGoogle(userId, {
        forceFull: migration.migrated > 0 || migration.pending > 0,
        pullRemote: true
      });

      console.log(
        [
          `• User ${userId}`,
          `calendar=${ensureResult.calendarId}`,
          `created=${ensureResult.created}`,
          `migrated=${migration.migrated}`,
          `queued=${migration.pending}`,
          `errors=${summary.errors.length}`
        ].join(' | ')
      );
    } catch (error) {
      console.error(`• Failed to ensure managed calendar for user ${userId}:`, error);
    }
  }
}

ensureCalendars()
  .then(() => dbClient.end())
  .catch(async (error) => {
    console.error('Fatal error ensuring managed calendars:', error);
    await dbClient.end();
    process.exit(1);
  });
