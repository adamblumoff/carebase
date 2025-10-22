import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createGoogleSyncTestContext } from './googleSync.testUtils.js';
import { FakeGoogleCalendarApi } from './googleSync.testDoubles.js';
import { upsertGoogleCredential } from '../db/queries.js';

let sequence = 1;

function nextValue(prefix: string): string {
  sequence += 1;
  return `${prefix}-${sequence}`;
}

async function seedAppointmentFixture(pool: any, overrides?: { summary?: string }): Promise<{
  userId: number;
  itemId: number;
  appointmentId: number;
}> {
  const { rows: userRows } = await pool.query(
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
  const userId = userRows[0].id as number;

  const { rows: recipientRows } = await pool.query(
    `INSERT INTO recipients (user_id, display_name)
     VALUES ($1, $2)
     RETURNING id`,
    [userId, `Recipient ${nextValue('recipient')}`]
  );
  const recipientId = recipientRows[0].id as number;

  const { rows: sourceRows } = await pool.query(
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

  const { rows: itemRows } = await pool.query(
    `INSERT INTO items (recipient_id, source_id, detected_type, confidence)
     VALUES ($1, $2, 'appointment', 0.9)
     RETURNING id`,
    [recipientId, sourceId]
  );
  const itemId = itemRows[0].id as number;

  const summary = overrides?.summary ?? 'Initial consultation';
  const { rows: appointmentRows } = await pool.query(
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

  return { userId, itemId, appointmentId };
}

async function seedGoogleCredential(
  _pool: any,
  userId: number,
  overrides?: { syncToken?: string | null; calendarId?: string | null }
): Promise<void> {
  await upsertGoogleCredential(userId, {
    accessToken: 'ya29.test-access-token',
    refreshToken: '1//test-refresh-token',
    scope: ['https://www.googleapis.com/auth/calendar'],
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    tokenType: 'Bearer',
    idToken: null,
    calendarId: overrides?.calendarId ?? 'primary',
    syncToken: overrides?.syncToken ?? null,
    lastPulledAt: overrides?.syncToken ? new Date() : null
  });
}

test('initial sync pushes pending appointments and stores next sync token', async (t) => {
  const ctx = await createGoogleSyncTestContext(t);
  const fakeCalendar = new FakeGoogleCalendarApi();
  fakeCalendar.install();
  t.after(() => fakeCalendar.restore());

  const googleSyncModule = await import('./googleSync.js');
  const { syncUserWithGoogle, __resetGoogleSyncStateForTests } = googleSyncModule;
  t.after(() => __resetGoogleSyncStateForTests());

  const { userId, itemId } = await seedAppointmentFixture(ctx.pool);
  await seedGoogleCredential(ctx.pool, userId, { syncToken: null });

  const summary = await syncUserWithGoogle(userId, { pullRemote: true });

  assert.equal(summary.pulled, 0);
  assert.equal(summary.pushed, 1);
  assert.equal(summary.deleted, 0);
  if (summary.errors.length > 0) {
    for (const error of summary.errors) {
      assert.ok(
        error.message.toLowerCase().includes('remote appointment updated'),
        `Unexpected error message: ${error.message}`
      );
    }
  }

  const { rows: credentialRows } = await ctx.exec(
    'SELECT sync_token, last_pulled_at FROM google_credentials WHERE user_id = $1',
    [userId]
  );
  assert.equal(credentialRows.length, 1);
  assert.ok(credentialRows[0].sync_token);
  assert.ok(credentialRows[0].last_pulled_at);

  const { rows: linkRows } = await ctx.exec(
    `SELECT event_id, sync_status, last_sync_direction, local_hash, remote_updated_at
       FROM google_sync_links
      WHERE item_id = $1`,
    [itemId]
  );
  assert.equal(linkRows.length, 1);
  assert.equal(linkRows[0].sync_status, 'idle');
  assert.equal(linkRows[0].last_sync_direction, 'push');
  assert.ok(linkRows[0].event_id);
  assert.ok(linkRows[0].local_hash);
  assert.ok(linkRows[0].remote_updated_at);
  const remoteEvent = fakeCalendar.getEvent('primary', linkRows[0].event_id);
  assert.ok(remoteEvent, 'expected remote event to exist after push');
  const remoteStart = remoteEvent?.start as Record<string, unknown> | undefined;
  assert.equal(remoteStart?.timeZone, 'UTC');
  assert.equal(remoteStart?.dateTime, '2025-10-20T16:00:00+00:00');

  assert.equal(ctx.scheduleCalls.length, 0);
});

test('remote updates supersede local appointment when Google timestamp is newer', async (t) => {
  const ctx = await createGoogleSyncTestContext(t);
  const fakeCalendar = new FakeGoogleCalendarApi();
  fakeCalendar.install();
  t.after(() => fakeCalendar.restore());

  const googleSyncModule = await import('./googleSync.js');
  const { syncUserWithGoogle, __resetGoogleSyncStateForTests } = googleSyncModule;
  t.after(() => __resetGoogleSyncStateForTests());

  const { userId, itemId, appointmentId } = await seedAppointmentFixture(ctx.pool, { summary: 'Local summary' });
  await seedGoogleCredential(ctx.pool, userId);

  await syncUserWithGoogle(userId, { pullRemote: true });

  const { rows: linkRows } = await ctx.exec(
    'SELECT event_id, remote_updated_at FROM google_sync_links WHERE item_id = $1',
    [itemId]
  );
  assert.equal(linkRows.length, 1);
  const eventId = linkRows[0].event_id as string;
  const remoteBefore = fakeCalendar.getEvent('primary', eventId);
  assert.ok(remoteBefore);
  const previousRemoteUpdatedAt = linkRows[0].remote_updated_at as Date | null;

  const { rows: credentialRows } = await ctx.exec(
    'SELECT sync_token FROM google_credentials WHERE user_id = $1',
    [userId]
  );
  const previousSyncToken = credentialRows[0].sync_token as string | null;
  assert.ok(previousSyncToken);

  fakeCalendar.updateRemoteEvent('primary', eventId, {
    summary: 'Remote authored summary',
    extendedProperties: {
      private: {
        carebaseItemId: String(itemId),
        carebaseType: 'appointment'
      }
    }
  });

  ctx.scheduleCalls.length = 0;
  const summary = await syncUserWithGoogle(userId, { pullRemote: true });

  if (summary.errors.length > 0) {
    for (const error of summary.errors) {
      assert.ok(
        error.message.toLowerCase().includes('remote appointment updated'),
        `Unexpected error message: ${error.message}`
      );
    }
  }

  const { rows: appointmentRows } = await ctx.exec(
    'SELECT summary FROM appointments WHERE id = $1',
    [appointmentId]
  );
  assert.equal(appointmentRows[0].summary, 'Remote authored summary');

  const { rows: linkAfter } = await ctx.exec(
    'SELECT last_sync_direction, remote_updated_at FROM google_sync_links WHERE item_id = $1',
    [itemId]
  );
  assert.equal(linkAfter[0].last_sync_direction, 'pull');
  const updatedRemote = linkAfter[0].remote_updated_at as Date | null;
  if (previousRemoteUpdatedAt && updatedRemote) {
    assert.ok(new Date(updatedRemote).getTime() > new Date(previousRemoteUpdatedAt).getTime());
  } else {
    assert.ok(updatedRemote);
  }

  const { rows: credentialAfter } = await ctx.exec(
    'SELECT sync_token FROM google_credentials WHERE user_id = $1',
    [userId]
  );
  const nextSyncToken = credentialAfter[0].sync_token as string | null;
  assert.ok(nextSyncToken);
  if (previousSyncToken) {
    assert.notEqual(nextSyncToken, previousSyncToken);
  }
});

test('local edits push to Google when sync link is pending', async (t) => {
  const ctx = await createGoogleSyncTestContext(t);
  const fakeCalendar = new FakeGoogleCalendarApi();
  fakeCalendar.install();
  t.after(() => fakeCalendar.restore());

  const googleSyncModule = await import('./googleSync.js');
  const { syncUserWithGoogle, __resetGoogleSyncStateForTests } = googleSyncModule;
  t.after(() => __resetGoogleSyncStateForTests());

  const queries = await import('../db/queries.js');

  const { userId, itemId, appointmentId } = await seedAppointmentFixture(ctx.pool, { summary: 'Initial summary' });
  await seedGoogleCredential(ctx.pool, userId);

  await syncUserWithGoogle(userId, { pullRemote: true });

  ctx.scheduleCalls.length = 0;
  await queries.updateAppointment(appointmentId, userId, {
    summary: 'Locally updated summary',
    startLocal: '2025-10-20T16:00:00.000Z',
    endLocal: '2025-10-20T17:00:00.000Z',
    location: 'Virtual',
    prepNote: null
  });
  await queries.markGoogleSyncPending(itemId);

  const { rows: pendingBefore } = await ctx.exec(
    'SELECT sync_status FROM google_sync_links WHERE item_id = $1',
    [itemId]
  );
  assert.equal(pendingBefore[0].sync_status, 'pending');

  const summary = await syncUserWithGoogle(userId, { pullRemote: true });

  assert.equal(summary.pushed, 1);
  assert.deepEqual(summary.errors, [], `Unexpected push errors: ${JSON.stringify(summary.errors)}`);

  const { rows: remoteMeta } = await ctx.exec(
    'SELECT sync_status, last_sync_direction, remote_updated_at FROM google_sync_links WHERE item_id = $1',
    [itemId]
  );
  assert.equal(remoteMeta[0].sync_status, 'idle');
  assert.equal(remoteMeta[0].last_sync_direction, 'push');
  assert.ok(remoteMeta[0].remote_updated_at);

  const { rows: appointmentRows } = await ctx.exec(
    'SELECT summary FROM appointments WHERE id = $1',
    [appointmentId]
  );
  assert.equal(appointmentRows[0].summary, 'Locally updated summary');
});

test('invalid sync token triggers reset and retry without duplicate pushes', async (t) => {
  const ctx = await createGoogleSyncTestContext(t);
  const fakeCalendar = new FakeGoogleCalendarApi();
  fakeCalendar.install();
  t.after(() => fakeCalendar.restore());

  const googleSyncModule = await import('./googleSync.js');
  const { syncUserWithGoogle, __resetGoogleSyncStateForTests } = googleSyncModule;
  t.after(() => __resetGoogleSyncStateForTests());

  const { userId, itemId } = await seedAppointmentFixture(ctx.pool);
  await seedGoogleCredential(ctx.pool, userId);

  await syncUserWithGoogle(userId, { pullRemote: true });

  fakeCalendar.forceInvalidSyncToken('primary');
  ctx.scheduleCalls.length = 0;
  const summary = await syncUserWithGoogle(userId, { pullRemote: true });

  assert.equal(summary.errors.length, 0);
  assert.equal(summary.pushed, 0);

  const listCalls = fakeCalendar
    .log()
    .filter((entry) => entry.method === 'GET' && entry.url.includes('/events'));
  assert.ok(listCalls.length >= 2);

  const { rows: linkRows } = await ctx.exec(
    `SELECT sync_status FROM google_sync_links WHERE item_id = $1`,
    [itemId]
  );
  assert.equal(linkRows[0].sync_status, 'idle');
});
