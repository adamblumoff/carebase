import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createGoogleSyncTestContext } from './googleSync.testUtils.js';
import { FakeGoogleCalendarApi } from './googleSync.testDoubles.js';
import {
  upsertGoogleCredential,
  getGoogleCredential
} from '../db/queries.js';

let sequence = 1;

function nextValue(prefix: string): string {
  sequence += 1;
  return `${prefix}-${sequence}`;
}

async function createUser(ctx: { exec: (query: string, params?: any[]) => Promise<{ rows: any[] }> }): Promise<number> {
  const { rows } = await ctx.exec(
    `INSERT INTO users (email, google_id, forwarding_address, plan_secret)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [
      `${nextValue('user')}@example.com`,
      nextValue('google'),
      `${nextValue('forward')}@carebase.test`,
      nextValue('secret')
    ]
  );
  return rows[0].id as number;
}

async function seedAppointmentForUser(
  ctx: { exec: (query: string, params?: any[]) => Promise<{ rows: any[] }> },
  userId: number,
  overrides?: { summary?: string }
): Promise<{ recipientId: number; itemId: number; appointmentId: number }> {
  const { rows: recipientRows } = await ctx.exec(
    `INSERT INTO recipients (user_id, display_name)
     VALUES ($1, $2)
     RETURNING id`,
    [userId, `Recipient ${nextValue('recipient')}`]
  );
  const recipientId = recipientRows[0].id as number;

  const { rows: sourceRows } = await ctx.exec(
    `INSERT INTO sources (recipient_id, kind, external_id, sender, subject, short_excerpt, storage_key)
     VALUES ($1, 'email', $2, $3, $4, $5, $6)
     RETURNING id`,
    [
      recipientId,
      nextValue('source'),
      'sender@example.com',
      'CareBase Intake',
      'Excerpt',
      nextValue('storage')
    ]
  );
  const sourceId = sourceRows[0].id as number;

  const { rows: itemRows } = await ctx.exec(
    `INSERT INTO items (recipient_id, source_id, detected_type, confidence)
     VALUES ($1, $2, 'appointment', 0.9)
     RETURNING id`,
    [recipientId, sourceId]
  );
  const itemId = itemRows[0].id as number;

  const summary = overrides?.summary ?? 'Initial consultation';
  const { rows: appointmentRows } = await ctx.exec(
    `INSERT INTO appointments (item_id, start_local, end_local, start_time_zone, end_time_zone, start_offset, end_offset, summary, ics_token, prep_note, location)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING id`,
    [
      itemId,
      '2025-10-20T16:00:00.000Z',
      '2025-10-20T17:00:00.000Z',
      'America/New_York',
      'America/New_York',
      '-04:00',
      '-04:00',
      summary,
      nextValue('ics'),
      null,
      'Virtual'
    ]
  );
  const appointmentId = appointmentRows[0].id as number;

  return { recipientId, itemId, appointmentId };
}

test('ensureManagedCalendarForUser creates a managed calendar when none exists', async (t) => {
  const ctx = await createGoogleSyncTestContext(t);
  const fakeCalendar = new FakeGoogleCalendarApi();
  fakeCalendar.install();
  t.after(() => fakeCalendar.restore());

  const googleSyncModule = await import('./googleSync.js');
  const { ensureManagedCalendarForUser, __resetGoogleSyncStateForTests } = googleSyncModule as {
    ensureManagedCalendarForUser: (credential: any, accessToken: string) => Promise<any>;
    __resetGoogleSyncStateForTests: () => void;
  };
  t.after(() => __resetGoogleSyncStateForTests());

  const userId = await createUser(ctx);
  await upsertGoogleCredential(userId, {
    accessToken: 'ya29.test-access-token',
    refreshToken: '1//test-refresh-token',
    scope: ['https://www.googleapis.com/auth/calendar'],
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    tokenType: 'Bearer',
    idToken: null,
    calendarId: 'primary',
    syncToken: null,
    lastPulledAt: null
  });

  const credential = await getGoogleCredential(userId);
  assert.ok(credential);

  const result = await ensureManagedCalendarForUser(credential, credential.accessToken);

  assert.ok(result.calendarId && result.calendarId !== 'primary');
  assert.equal(result.created, true);
  assert.equal(result.reused, false);

  const { rows } = await ctx.exec(
    `SELECT calendar_id,
            managed_calendar_id,
            managed_calendar_summary,
            managed_calendar_state
       FROM google_credentials
      WHERE user_id = $1`,
    [userId]
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].calendar_id, result.calendarId);
  assert.equal(rows[0].managed_calendar_id, result.calendarId);
  assert.equal(rows[0].managed_calendar_summary, 'CareBase');
  assert.equal(rows[0].managed_calendar_state, 'active');
});

test('ensureManagedCalendarForUser reuses an existing CareBase calendar', async (t) => {
  const ctx = await createGoogleSyncTestContext(t);
  const fakeCalendar = new FakeGoogleCalendarApi();
  fakeCalendar.install();
  fakeCalendar.seedCalendarList([
    { id: 'carebase-existing', summary: 'CareBase' },
    { id: 'primary', summary: 'Primary' }
  ]);
  t.after(() => fakeCalendar.restore());

  const googleSyncModule = await import('./googleSync.js');
  const { ensureManagedCalendarForUser, __resetGoogleSyncStateForTests } = googleSyncModule as {
    ensureManagedCalendarForUser: (credential: any, accessToken: string) => Promise<any>;
    __resetGoogleSyncStateForTests: () => void;
  };
  t.after(() => __resetGoogleSyncStateForTests());

  const userId = await createUser(ctx);
  await upsertGoogleCredential(userId, {
    accessToken: 'ya29.test-access-token',
    refreshToken: '1//test-refresh-token',
    scope: ['https://www.googleapis.com/auth/calendar'],
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    tokenType: 'Bearer',
    idToken: null,
    calendarId: 'primary',
    syncToken: null,
    lastPulledAt: null
  });

  const credential = await getGoogleCredential(userId);
  assert.ok(credential);

  const result = await ensureManagedCalendarForUser(credential, credential.accessToken);

  assert.equal(result.calendarId, 'carebase-existing');
  assert.equal(result.created, false);
  assert.equal(result.reused, true);

  const { rows } = await ctx.exec(
    `SELECT calendar_id,
            managed_calendar_id,
            managed_calendar_summary,
            managed_calendar_state
       FROM google_credentials
      WHERE user_id = $1`,
    [userId]
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].calendar_id, 'carebase-existing');
  assert.equal(rows[0].managed_calendar_id, 'carebase-existing');
  assert.equal(rows[0].managed_calendar_summary, 'CareBase');
  assert.equal(rows[0].managed_calendar_state, 'active');
});

test('ensureManagedCalendarForUser recreates calendar when stored id is invalid', async (t) => {
  const ctx = await createGoogleSyncTestContext(t);
  const fakeCalendar = new FakeGoogleCalendarApi();
  fakeCalendar.install();
  t.after(() => fakeCalendar.restore());

  const googleSyncModule = await import('./googleSync.js');
  const { ensureManagedCalendarForUser, __resetGoogleSyncStateForTests } = googleSyncModule as {
    ensureManagedCalendarForUser: (credential: any, accessToken: string) => Promise<any>;
    __resetGoogleSyncStateForTests: () => void;
  };
  t.after(() => __resetGoogleSyncStateForTests());

  const userId = await createUser(ctx);
  await upsertGoogleCredential(userId, {
    accessToken: 'ya29.test-access-token',
    refreshToken: '1//test-refresh-token',
    scope: ['https://www.googleapis.com/auth/calendar'],
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    tokenType: 'Bearer',
    idToken: null,
    calendarId: 'missing-calendar',
    syncToken: null,
    lastPulledAt: null
  });

  await ctx.exec(
    `UPDATE google_credentials
        SET managed_calendar_id = $1,
            managed_calendar_summary = 'CareBase',
            managed_calendar_state = 'active'
      WHERE user_id = $2`,
    ['missing-calendar', userId]
  );

  const credential = await getGoogleCredential(userId);
  assert.ok(credential);
  (credential as any).managedCalendarId = 'missing-calendar';

  const result = await ensureManagedCalendarForUser(credential, credential.accessToken);

  assert.ok(result.calendarId && result.calendarId !== 'missing-calendar');
  assert.equal(result.created, true);
  assert.equal(result.reused, false);

  const { rows } = await ctx.exec(
    `SELECT calendar_id,
            managed_calendar_id,
            managed_calendar_summary,
            managed_calendar_state
       FROM google_credentials
      WHERE user_id = $1`,
    [userId]
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].calendar_id, result.calendarId);
  assert.equal(rows[0].managed_calendar_id, result.calendarId);
  assert.equal(rows[0].managed_calendar_summary, 'CareBase');
  assert.equal(rows[0].managed_calendar_state, 'active');

  const createRequests = fakeCalendar
    .log()
    .filter((entry) => entry.method === 'POST' && entry.url.endsWith('/calendar/v3/calendars'));
  assert.ok(createRequests.length >= 1);
});

test('migrateEventsToManagedCalendar moves events and refreshManagedCalendarWatch updates channel', async (t) => {
  const ctx = await createGoogleSyncTestContext(t);
  const fakeCalendar = new FakeGoogleCalendarApi();
  fakeCalendar.install();
  t.after(() => fakeCalendar.restore());

  const googleSyncModule = await import('./googleSync.js');
  const {
    ensureManagedCalendarForUser,
    migrateEventsToManagedCalendar,
    refreshManagedCalendarWatch,
    __resetGoogleSyncStateForTests
  } = googleSyncModule as {
    ensureManagedCalendarForUser: (credential: any, accessToken: string) => Promise<any>;
    migrateEventsToManagedCalendar: (credential: any, accessToken: string, calendarId: string) => Promise<any>;
    refreshManagedCalendarWatch: (
      credential: any,
      accessToken: string,
      calendarId: string,
      previousCalendarIds: string[]
    ) => Promise<void>;
    __resetGoogleSyncStateForTests: () => void;
  };
  t.after(() => __resetGoogleSyncStateForTests());

  const userId = await createUser(ctx);
  await upsertGoogleCredential(userId, {
    accessToken: 'ya29.test-access-token',
    refreshToken: '1//test-refresh-token',
    scope: ['https://www.googleapis.com/auth/calendar'],
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    tokenType: 'Bearer',
    idToken: null,
    calendarId: 'primary',
    syncToken: null,
    lastPulledAt: null
  });

  const { itemId } = await seedAppointmentForUser(ctx, userId);
  const remoteEvent = fakeCalendar.createRemoteEvent('primary', {
    summary: 'Initial consultation',
    start: { dateTime: '2025-10-20T16:00:00Z', timeZone: 'UTC' },
    end: { dateTime: '2025-10-20T17:00:00Z', timeZone: 'UTC' },
    extendedProperties: {
      private: {
        carebaseItemId: String(itemId),
        carebaseType: 'appointment'
      }
    }
  });

  await ctx.exec(
    `INSERT INTO google_sync_links (item_id, calendar_id, event_id, sync_status, created_at, updated_at)
     VALUES ($1, $2, $3, 'idle', NOW(), NOW())`,
    [itemId, 'primary', remoteEvent.id]
  );

  const credential = await getGoogleCredential(userId);
  assert.ok(credential);

  const ensureResult = await ensureManagedCalendarForUser(credential, credential.accessToken);
  const targetCalendarId = ensureResult.calendarId;

  const migrationSummary = await migrateEventsToManagedCalendar(
    credential,
    credential.accessToken,
    targetCalendarId
  );

  assert.equal(migrationSummary.migrated, 1);
  assert.equal(migrationSummary.pending, 0);
  assert.equal(migrationSummary.failed, 0);
  assert.deepEqual(migrationSummary.previousCalendarIds, ['primary']);

  const { rows: linkRows } = await ctx.exec(
    `SELECT calendar_id FROM google_sync_links WHERE item_id = $1`,
    [itemId]
  );
  assert.equal(linkRows[0].calendar_id, targetCalendarId);
  assert.equal(fakeCalendar.getEvent('primary', remoteEvent.id), null);
  const moved = fakeCalendar.getEvent(targetCalendarId, remoteEvent.id);
  assert.ok(moved);

  await ctx.exec(
    `INSERT INTO google_watch_channels (channel_id, user_id, calendar_id, resource_id, resource_uri, expiration, channel_token, created_at, updated_at)
     VALUES ($1, $2, $3, $4, NULL, NOW(), NULL, NOW(), NOW())`,
    ['channel-primary', userId, 'primary', 'resource-primary']
  );

  await refreshManagedCalendarWatch(
    credential,
    credential.accessToken,
    targetCalendarId,
    migrationSummary.previousCalendarIds
  );

  const { rows: channelRows } = await ctx.exec(
    `SELECT calendar_id FROM google_watch_channels WHERE user_id = $1`,
    [userId]
  );
  assert.equal(channelRows.length, 1);
  assert.equal(channelRows[0].calendar_id, targetCalendarId);
});

test('ensureManagedCalendarAclForUser shares calendar with accepted collaborators', async (t) => {
  const ctx = await createGoogleSyncTestContext(t);
  const fakeCalendar = new FakeGoogleCalendarApi();
  fakeCalendar.install();
  t.after(() => fakeCalendar.restore());

  const googleSyncModule = await import('./googleSync.js');
  const {
    ensureManagedCalendarForUser,
    ensureManagedCalendarAclForUser,
    __resetGoogleSyncStateForTests
  } = googleSyncModule as {
    ensureManagedCalendarForUser: (credential: any, accessToken: string) => Promise<any>;
    ensureManagedCalendarAclForUser: (
      credential: any,
      accessToken: string,
      calendarId: string,
      role?: 'writer' | 'reader'
    ) => Promise<{ granted: number; skipped: number; errors: number }>;
    __resetGoogleSyncStateForTests: () => void;
  };
  t.after(() => __resetGoogleSyncStateForTests());

  const userId = await createUser(ctx);
  await upsertGoogleCredential(userId, {
    accessToken: 'ya29.test-access-token',
    refreshToken: '1//test-refresh-token',
    scope: ['https://www.googleapis.com/auth/calendar'],
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    tokenType: 'Bearer',
    idToken: null,
    calendarId: 'primary',
    syncToken: null,
    lastPulledAt: null
  });

  const { recipientId } = await seedAppointmentForUser(ctx, userId);

  const collaboratorEmail = 'caregiver@example.com';
  await ctx.exec(
    `INSERT INTO care_collaborators (recipient_id, user_id, email, role, status, invite_token, invited_by, invited_at, accepted_at)
     VALUES ($1, NULL, $2, 'contributor', 'accepted', $3, $4, NOW(), NOW())`,
    [recipientId, collaboratorEmail, nextValue('token'), userId]
  );

  const credential = await getGoogleCredential(userId);
  assert.ok(credential);

  const ensureResult = await ensureManagedCalendarForUser(credential, credential.accessToken);
  const calendarId = ensureResult.calendarId;

  const firstShare = await ensureManagedCalendarAclForUser(
    credential,
    credential.accessToken,
    calendarId
  );
  assert.equal(firstShare.granted, 1);
  assert.equal(firstShare.skipped, 0);
  assert.equal(firstShare.errors, 0);

  const aclEntries = fakeCalendar.getCalendarAcl(calendarId);
  assert.equal(aclEntries.length, 1);
  assert.equal(aclEntries[0].scopeValue, collaboratorEmail.toLowerCase());

  const secondShare = await ensureManagedCalendarAclForUser(
    credential,
    credential.accessToken,
    calendarId
  );
  assert.equal(secondShare.granted, 0);
  assert.equal(secondShare.skipped, 1);
  assert.equal(secondShare.errors, 0);

  const { rows } = await ctx.exec(
    `SELECT managed_calendar_verified_at, managed_calendar_acl_role
       FROM google_credentials
      WHERE user_id = $1`,
    [userId]
  );
  assert.equal(rows.length, 1);
  assert.ok(rows[0].managed_calendar_verified_at);
  assert.equal(rows[0].managed_calendar_acl_role, 'writer');
});
