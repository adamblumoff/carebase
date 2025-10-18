import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Appointment } from '@carebase/shared';
import { encryptSecret } from '../utils/secretCipher.js';

process.env.GOOGLE_SYNC_ENABLE_TEST = 'true';

const googleSyncModule = await import('./googleSync.js');
const queries = await import('../db/queries.js');
const dbClientModule = await import('../db/client.js');

const { syncUserWithGoogle, __resetGoogleSyncStateForTests, __setGoogleSyncSchedulerForTests } = googleSyncModule;
const dbClient = dbClientModule.default as {
  query: (text: string, params?: any[]) => Promise<any>;
};

test('legacy Google events without carebaseType still update local plan', async (t) => {
  const originalQuery = dbClient.query;
  const originalFetch = global.fetch;

  const ownerUserId = 51;
  const recipientId = 12;
  const itemId = 777;
  const appointmentId = 99;
  const calendarId = 'primary';

  const users = new Map<number, { id: number; plan_version: number; plan_updated_at: Date | null }>([
    [ownerUserId, { id: ownerUserId, plan_version: 0, plan_updated_at: null }]
  ]);

  const recipients = new Map<number, { id: number; user_id: number }>([
    [recipientId, { id: recipientId, user_id: ownerUserId }]
  ]);

  const items = new Map<number, { id: number; recipient_id: number; detected_type: 'appointment' | 'bill' }>([
    [itemId, { id: itemId, recipient_id: recipientId, detected_type: 'appointment' }]
  ]);

  const baseAppointment: Appointment = {
    id: appointmentId,
    itemId,
    startLocal: '2025-10-16T16:00:00.000Z',
    endLocal: '2025-10-16T17:00:00.000Z',
    location: null,
    prepNote: null,
    summary: 'Consultation',
    icsToken: 'ics-token',
    assignedCollaboratorId: null,
    createdAt: new Date('2025-10-15T00:00:00.000Z'),
    googleSync: null
  };

  const appointmentsByItem = new Map<number, Appointment>([[itemId, { ...baseAppointment }]]);

  type SyncLinkRow = {
    id: number;
    item_id: number;
    calendar_id: string | null;
    event_id: string | null;
    etag: string | null;
    last_synced_at: Date | null;
    last_sync_direction: 'push' | 'pull' | null;
    local_hash: string | null;
    remote_updated_at: Date | null;
    sync_status: 'idle' | 'pending' | 'error';
    last_error: string | null;
  };

  const googleSyncLinks = new Map<number, SyncLinkRow>([
    [
      itemId,
      {
        id: 1,
        item_id: itemId,
        calendar_id: calendarId,
        event_id: 'event-legacy',
        etag: 'etag-old',
        last_synced_at: new Date('2025-10-15T12:00:00.000Z'),
        last_sync_direction: 'push',
        local_hash: 'hash-old',
        remote_updated_at: new Date('2025-10-15T12:00:00.000Z'),
        sync_status: 'idle',
        last_error: null
      }
    ]
  ]);

  type CredentialRow = {
    user_id: number;
    access_token: string;
    refresh_token: string;
    scope: string[] | null;
    expires_at: Date | null;
    token_type: string | null;
    id_token: string | null;
    calendar_id: string | null;
    sync_token: string | null;
    last_pulled_at: Date | null;
    created_at: Date;
    updated_at: Date;
  };

  const googleCredentials = new Map<number, CredentialRow>([
    [
      ownerUserId,
      {
        user_id: ownerUserId,
        access_token: encryptSecret('ya29.test-access-token')!,
        refresh_token: encryptSecret('1//test-refresh-token')!,
        scope: ['https://www.googleapis.com/auth/calendar'],
        expires_at: new Date(Date.now() + 60 * 60 * 1000),
        token_type: 'Bearer',
        id_token: null,
        calendar_id: calendarId,
        sync_token: 'sync-token-1',
        last_pulled_at: null,
        created_at: new Date('2025-10-15T00:00:00.000Z'),
        updated_at: new Date('2025-10-15T00:00:00.000Z')
      }
    ]
  ]);

  let googleSyncDeletes = 0;

  await queries.__setGoogleIntegrationSchemaEnsuredForTests(true);

  dbClient.query = async (text: string, params: any[] = []) => {
    const sql = text.trim().toLowerCase();

    if (sql.startsWith('alter table') || sql.startsWith('create table') || sql.startsWith('create index')) {
      return { rows: [], rowCount: 0, command: 'ALTER' };
    }

    if (sql.startsWith('select * from google_credentials')) {
      const targetId = Number(params[0]);
      const row = googleCredentials.get(targetId);
      return {
        rows: row ? [row] : [],
        rowCount: row ? 1 : 0,
        command: 'SELECT'
      };
    }

    if (sql.startsWith('select gsl.item_id')) {
      const pendingRows = Array.from(googleSyncLinks.values()).filter((row) => row.sync_status === 'pending');
      const rows = pendingRows.map((row) => {
        const item = items.get(row.item_id);
        return {
          item_id: row.item_id,
          detected_type: item?.detected_type ?? 'appointment',
          recipient_id: item?.recipient_id ?? recipientId
        };
      });
      return { rows, rowCount: rows.length, command: 'SELECT' };
    }

    if (sql.startsWith('select a.*,')) {
      const targetItemId = Number(params[0]);
      const appointment = appointmentsByItem.get(targetItemId);
      if (!appointment) {
        return { rows: [], rowCount: 0, command: 'SELECT' };
      }
      const link = googleSyncLinks.get(targetItemId);
      return {
        rows: [
          {
            id: appointment.id,
            item_id: appointment.itemId,
            start_local: new Date(appointment.startLocal),
            end_local: new Date(appointment.endLocal),
            location: appointment.location,
            prep_note: appointment.prepNote,
            summary: appointment.summary,
            ics_token: appointment.icsToken,
            assigned_collaborator_id: appointment.assignedCollaboratorId,
            created_at: appointment.createdAt instanceof Date ? appointment.createdAt : new Date(appointment.createdAt),
            google_sync_id: link?.id ?? null,
            google_calendar_id: link?.calendar_id ?? null,
            google_event_id: link?.event_id ?? null,
            google_etag: link?.etag ?? null,
            google_last_synced_at: link?.last_synced_at ?? null,
            google_last_sync_direction: link?.last_sync_direction ?? null,
            google_local_hash: link?.local_hash ?? null,
            google_remote_updated_at: link?.remote_updated_at ?? null,
            google_sync_status: link?.sync_status ?? 'idle',
            google_last_error: link?.last_error ?? null
          }
        ],
        rowCount: 1,
        command: 'SELECT'
      };
    }

    if (sql.startsWith('update appointments as a')) {
      const [startLocal, endLocal, location, prepNote, summary, assignedId, updateId] = params;
      const appointment = Array.from(appointmentsByItem.values()).find((appt) => appt.id === Number(updateId));
      if (!appointment) {
        return { rows: [], rowCount: 0, command: 'UPDATE' };
      }
      const updated = {
        ...appointment,
        startLocal: startLocal ?? appointment.startLocal,
        endLocal: endLocal ?? appointment.endLocal,
        location: location ?? appointment.location,
        prepNote: prepNote ?? appointment.prepNote,
        summary: summary ?? appointment.summary,
        assignedCollaboratorId: assignedId ?? appointment.assignedCollaboratorId
      };
      appointmentsByItem.set(appointment.itemId, updated);

      return {
        rows: [
          {
            id: updated.id,
            item_id: updated.itemId,
            start_local: new Date(updated.startLocal),
            end_local: new Date(updated.endLocal),
            location: updated.location,
            prep_note: updated.prepNote,
            summary: updated.summary,
            ics_token: updated.icsToken,
            assigned_collaborator_id: updated.assignedCollaboratorId,
            created_at: updated.createdAt instanceof Date ? updated.createdAt : new Date(updated.createdAt)
          }
        ],
        rowCount: 1,
        command: 'UPDATE'
      };
    }

    if (sql.startsWith('update users u') && sql.includes('set plan_version')) {
      const targetItemId = Number(params[0]);
      const item = items.get(targetItemId);
      if (!item) {
        return { rows: [], rowCount: 0, command: 'UPDATE' };
      }
      const recipient = recipients.get(item.recipient_id);
      if (!recipient) {
        return { rows: [], rowCount: 0, command: 'UPDATE' };
      }
      const user = users.get(recipient.user_id);
      if (!user) {
        return { rows: [], rowCount: 0, command: 'UPDATE' };
      }
      user.plan_version += 1;
      user.plan_updated_at = new Date();
      users.set(recipient.user_id, user);
      return { rows: [{ id: recipient.user_id }], rowCount: 1, command: 'UPDATE' };
    }

    if (sql.startsWith('select r.user_id')) {
      const targetItemId = Number(params[0]);
      const item = items.get(targetItemId);
      const recipient = item ? recipients.get(item.recipient_id) : undefined;
      return {
        rows: recipient ? [{ user_id: recipient.user_id }] : [],
        rowCount: recipient ? 1 : 0,
        command: 'SELECT'
      };
    }

    if (sql.startsWith('select * from google_sync_links where item_id')) {
      const targetItemId = Number(params[0]);
      const link = googleSyncLinks.get(targetItemId);
      return {
        rows: link ? [link] : [],
        rowCount: link ? 1 : 0,
        command: 'SELECT'
      };
    }

    if (sql.startsWith('select * from google_sync_links where event_id')) {
      const link = Array.from(googleSyncLinks.values()).find((row) => row.event_id === params[0]);
      return {
        rows: link ? [link] : [],
        rowCount: link ? 1 : 0,
        command: 'SELECT'
      };
    }

    if (sql.startsWith('insert into google_sync_links')) {
      const [
        insertItemId,
        calendar,
        event,
        etag,
        lastSynced,
        lastDirection,
        localHash,
        remoteUpdated,
        syncStatus,
        lastError
      ] = params;
      const row: SyncLinkRow = {
        id: googleSyncLinks.size + 1,
        item_id: Number(insertItemId),
        calendar_id: calendar,
        event_id: event,
        etag,
        last_synced_at: lastSynced ?? null,
        last_sync_direction: lastDirection ?? null,
        local_hash: localHash ?? null,
        remote_updated_at: remoteUpdated ?? null,
        sync_status: syncStatus ?? 'idle',
        last_error: lastError ?? null
      };
      googleSyncLinks.set(row.item_id, row);
      return { rows: [row], rowCount: 1, command: 'INSERT' };
    }

    if (sql.startsWith('update google_sync_links')) {
      const [
        targetItemId,
        calendar,
        event,
        etag,
        lastSynced,
        lastDirection,
        localHash,
        remoteUpdated,
        syncStatus,
        lastError
      ] = params;
      const link = googleSyncLinks.get(Number(targetItemId));
      if (!link) {
        return { rows: [], rowCount: 0, command: 'UPDATE' };
      }
      const updated: SyncLinkRow = {
        ...link,
        calendar_id: calendar,
        event_id: event,
        etag,
        last_synced_at: lastSynced ?? null,
        last_sync_direction: lastDirection ?? null,
        local_hash: localHash ?? null,
        remote_updated_at: remoteUpdated ?? null,
        sync_status: syncStatus ?? 'idle',
        last_error: lastError ?? null
      };
      googleSyncLinks.set(updated.item_id, updated);
      return { rows: [updated], rowCount: 1, command: 'UPDATE' };
    }

    if (sql.startsWith('delete from google_sync_links')) {
      const targetItemId = Number(params[0]);
      googleSyncLinks.delete(targetItemId);
      googleSyncDeletes += 1;
      return { rows: [], rowCount: 1, command: 'DELETE' };
    }

    if (sql.startsWith('insert into google_credentials')) {
      const [
        insertUserId,
        accessToken,
        refreshToken,
        scope,
        expiresAt,
        tokenType,
        idToken,
        calId,
        syncToken,
        lastPulled
      ] = params;
      const row: CredentialRow = {
        user_id: Number(insertUserId),
        access_token: accessToken,
        refresh_token: refreshToken,
        scope: scope ?? null,
        expires_at: expiresAt ?? null,
        token_type: tokenType ?? null,
        id_token: idToken ?? null,
        calendar_id: calId ?? null,
        sync_token: syncToken ?? null,
        last_pulled_at: lastPulled ?? null,
        created_at: new Date(),
        updated_at: new Date()
      };
      googleCredentials.set(row.user_id, row);
      return { rows: [row], rowCount: 1, command: 'INSERT' };
    }

    if (sql.startsWith('update google_credentials')) {
      return { rows: [], rowCount: 1, command: 'UPDATE' };
    }

    return { rows: [], rowCount: 0, command: 'SELECT' };
  };

  const calendarResponse = {
    items: [
      {
        id: 'event-legacy',
        status: 'confirmed',
        updated: '2025-10-16T18:00:00.000Z',
        summary: 'Consultation (Google)',
        description: 'Bring medical history',
        location: 'Downtown Clinic',
        start: { dateTime: '2025-10-16T18:00:00.000Z' },
        end: { dateTime: '2025-10-16T19:00:00.000Z' },
        extendedProperties: undefined
      }
    ],
    nextSyncToken: 'sync-token-2'
  };

  global.fetch = async (input: any): Promise<any> => {
    const url =
      typeof input === 'string'
        ? input
        : input && typeof input === 'object' && 'href' in input
          ? (input as URL).href
          : String(input);

    if (url.startsWith('https://www.googleapis.com/calendar/v3/calendars/')) {
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        async json() {
          return calendarResponse;
        }
      };
    }

    if (url.startsWith('https://oauth2.googleapis.com/token')) {
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        async json() {
          return {
            access_token: 'ya29.test-access-token',
            expires_in: 3600,
            token_type: 'Bearer'
          };
        }
      };
    }

    throw new Error(`Unexpected fetch call: ${url}`);
  };

  t.after(() => {
    dbClient.query = originalQuery;
    global.fetch = originalFetch;
    __resetGoogleSyncStateForTests();
  });

  const summary = await syncUserWithGoogle(ownerUserId);

  assert.equal(summary.pulled, 1);
  assert.equal(summary.pushed, 0);
  assert.equal(summary.deleted, 0);
  assert.equal(summary.errors.length, 0);

  const updatedAppointment = appointmentsByItem.get(itemId);
  assert.ok(updatedAppointment);
  assert.equal(updatedAppointment?.summary, 'Consultation (Google)');
  assert.equal(updatedAppointment?.location, 'Downtown Clinic');
  assert.equal(updatedAppointment?.startLocal, '2025-10-16T18:00:00');
  assert.equal(updatedAppointment?.endLocal, '2025-10-16T19:00:00');

  const link = googleSyncLinks.get(itemId);
  assert.ok(link);
  assert.equal(link?.last_sync_direction, 'pull');
  assert.equal(link?.event_id, 'event-legacy');
  assert.equal(link?.remote_updated_at?.toISOString(), '2025-10-16T18:00:00.000Z');
  assert.equal(googleSyncDeletes, 0);

  const user = users.get(ownerUserId);
  assert.ok(user);
  assert.equal(user?.plan_version, 1);
});

test('remote edits with newer timestamp override pending local push', async (t) => {
  const originalQuery = dbClient.query;
  const originalFetch = global.fetch;

  const ownerUserId = 52;
  const recipientId = 22;
  const itemId = 888;
  const appointmentId = 199;
  const calendarId = 'primary';

  const users = new Map<number, { id: number; plan_version: number; plan_updated_at: Date | null }>([
    [ownerUserId, { id: ownerUserId, plan_version: 0, plan_updated_at: null }]
  ]);

  const recipients = new Map<number, { id: number; user_id: number }>([
    [recipientId, { id: recipientId, user_id: ownerUserId }]
  ]);

  const items = new Map<number, { id: number; recipient_id: number; detected_type: 'appointment' | 'bill' }>([
    [itemId, { id: itemId, recipient_id: recipientId, detected_type: 'appointment' }]
  ]);

  const baseAppointment: Appointment = {
    id: appointmentId,
    itemId,
    startLocal: '2025-10-16T16:30:00.000Z',
    endLocal: '2025-10-16T17:30:00.000Z',
    location: 'Valley Medical',
    prepNote: null,
    summary: 'Neurology consult',
    icsToken: 'ics-token',
    assignedCollaboratorId: null,
    createdAt: new Date('2025-10-15T00:00:00.000Z'),
    googleSync: {
      calendarId,
      eventId: 'event-remote-newer',
      etag: 'etag-old',
      lastSyncedAt: new Date('2025-10-16T10:00:00.000Z'),
      lastSyncDirection: 'push',
      localHash: 'hash-old',
      remoteUpdatedAt: new Date('2025-10-16T10:30:00.000Z'),
      syncStatus: 'pending',
      lastError: null
    }
  };

  const appointmentsByItem = new Map<number, Appointment>([[itemId, { ...baseAppointment }]]);

  type SyncLinkRow = {
    id: number;
    item_id: number;
    calendar_id: string | null;
    event_id: string | null;
    etag: string | null;
    last_synced_at: Date | null;
    last_sync_direction: 'push' | 'pull' | null;
    local_hash: string | null;
    remote_updated_at: Date | null;
    sync_status: 'idle' | 'pending' | 'error';
    last_error: string | null;
  };

  const googleSyncLinks = new Map<number, SyncLinkRow>([
    [
      itemId,
      {
        id: 1,
        item_id: itemId,
        calendar_id: calendarId,
        event_id: 'event-remote-newer',
        etag: 'etag-old',
        last_synced_at: new Date('2025-10-16T10:00:00.000Z'),
        last_sync_direction: 'push',
        local_hash: 'hash-old',
        remote_updated_at: new Date('2025-10-16T10:30:00.000Z'),
        sync_status: 'pending',
        last_error: null
      }
    ]
  ]);

  type CredentialRow = {
    user_id: number;
    access_token: string;
    refresh_token: string;
    scope: string[] | null;
    expires_at: Date | null;
    token_type: string | null;
    id_token: string | null;
    calendar_id: string | null;
    sync_token: string | null;
    last_pulled_at: Date | null;
    created_at: Date;
    updated_at: Date;
  };

  const googleCredentials = new Map<number, CredentialRow>([
    [
      ownerUserId,
      {
        user_id: ownerUserId,
        access_token: encryptSecret('ya29.test-access-token')!,
        refresh_token: encryptSecret('1//test-refresh-token')!,
        scope: ['https://www.googleapis.com/auth/calendar'],
        expires_at: new Date(Date.now() + 60 * 60 * 1000),
        token_type: 'Bearer',
        id_token: null,
        calendar_id: calendarId,
        sync_token: 'sync-token-1',
        last_pulled_at: null,
        created_at: new Date('2025-10-15T00:00:00.000Z'),
        updated_at: new Date('2025-10-15T00:00:00.000Z')
      }
    ]
  ]);

  await queries.__setGoogleIntegrationSchemaEnsuredForTests(true);

  dbClient.query = async (text: string, params: any[] = []) => {
    const sql = text.trim().toLowerCase();

    if (sql.startsWith('select * from google_credentials')) {
      const targetId = Number(params[0]);
      const row = googleCredentials.get(targetId);
      return {
        rows: row ? [row] : [],
        rowCount: row ? 1 : 0,
        command: 'SELECT'
      };
    }

    if (sql.startsWith('select gsl.item_id')) {
      const pendingRows = Array.from(googleSyncLinks.values()).filter((row) => row.sync_status === 'pending');
      const rows = pendingRows.map((row) => {
        const item = items.get(row.item_id);
        return {
          item_id: row.item_id,
          detected_type: item?.detected_type ?? 'appointment',
          recipient_id: item?.recipient_id ?? recipientId
        };
      });
      return { rows, rowCount: rows.length, command: 'SELECT' };
    }

    if (sql.startsWith('select a.*,')) {
      const targetItemId = Number(params[0]);
      const appointment = appointmentsByItem.get(targetItemId);
      if (!appointment) {
        return { rows: [], rowCount: 0, command: 'SELECT' };
      }
      const link = googleSyncLinks.get(targetItemId);
      return {
        rows: [
          {
            id: appointment.id,
            item_id: appointment.itemId,
            start_local: new Date(appointment.startLocal),
            end_local: new Date(appointment.endLocal),
            location: appointment.location,
            prep_note: appointment.prepNote,
            summary: appointment.summary,
            ics_token: appointment.icsToken,
            assigned_collaborator_id: appointment.assignedCollaboratorId,
            created_at: appointment.createdAt instanceof Date ? appointment.createdAt : new Date(appointment.createdAt),
            google_sync_id: link?.id ?? null,
            google_calendar_id: link?.calendar_id ?? null,
            google_event_id: link?.event_id ?? null,
            google_etag: link?.etag ?? null,
            google_last_synced_at: link?.last_synced_at ?? null,
            google_last_sync_direction: link?.last_sync_direction ?? null,
            google_local_hash: link?.local_hash ?? null,
            google_remote_updated_at: link?.remote_updated_at ?? null,
            google_sync_status: link?.sync_status ?? 'idle',
            google_last_error: link?.last_error ?? null
          }
        ],
        rowCount: 1,
        command: 'SELECT'
      };
    }

    if (sql.startsWith('update appointments as a')) {
      const [startLocal, endLocal, location, prepNote, summary, assignedId, updateId] = params;
      const appointment = Array.from(appointmentsByItem.values()).find((appt) => appt.id === Number(updateId));
      if (!appointment) {
        return { rows: [], rowCount: 0, command: 'UPDATE' };
      }
      const updated = {
        ...appointment,
        startLocal: startLocal ?? appointment.startLocal,
        endLocal: endLocal ?? appointment.endLocal,
        location: location ?? appointment.location,
        prepNote: prepNote ?? appointment.prepNote,
        summary: summary ?? appointment.summary,
        assignedCollaboratorId: assignedId ?? appointment.assignedCollaboratorId
      };
      appointmentsByItem.set(appointment.itemId, updated);

      return {
        rows: [
          {
            id: updated.id,
            item_id: updated.itemId,
            start_local: new Date(updated.startLocal),
            end_local: new Date(updated.endLocal),
            location: updated.location,
            prep_note: updated.prepNote,
            summary: updated.summary,
            ics_token: updated.icsToken,
            assigned_collaborator_id: updated.assignedCollaboratorId,
            created_at: updated.createdAt instanceof Date ? updated.createdAt : new Date(updated.createdAt)
          }
        ],
        rowCount: 1,
        command: 'UPDATE'
      };
    }

    if (sql.startsWith('update users u') && sql.includes('set plan_version')) {
      const targetItemId = Number(params[0]);
      const item = items.get(targetItemId);
      const recipient = item ? recipients.get(item.recipient_id) : undefined;
      if (!item || !recipient) {
        return { rows: [], rowCount: 0, command: 'UPDATE' };
      }
      const user = users.get(recipient.user_id);
      if (!user) {
        return { rows: [], rowCount: 0, command: 'UPDATE' };
      }
      user.plan_version += 1;
      user.plan_updated_at = new Date();
      users.set(recipient.user_id, user);
      return { rows: [{ id: recipient.user_id }], rowCount: 1, command: 'UPDATE' };
    }

    if (sql.startsWith('select r.user_id')) {
      const targetItemId = Number(params[0]);
      const item = items.get(targetItemId);
      const recipient = item ? recipients.get(item.recipient_id) : undefined;
      return {
        rows: recipient ? [{ user_id: recipient.user_id }] : [],
        rowCount: recipient ? 1 : 0,
        command: 'SELECT'
      };
    }

    if (sql.startsWith('select * from google_sync_links where item_id')) {
      const targetItemId = Number(params[0]);
      const link = googleSyncLinks.get(targetItemId);
      return {
        rows: link ? [link] : [],
        rowCount: link ? 1 : 0,
        command: 'SELECT'
      };
    }

    if (sql.startsWith('update google_sync_links')) {
      const [
        targetItemId,
        calendar,
        event,
        etag,
        lastSynced,
        lastDirection,
        localHash,
        remoteUpdated,
        syncStatus,
        lastError
      ] = params;
      const link = googleSyncLinks.get(Number(targetItemId));
      if (!link) {
        return { rows: [], rowCount: 0, command: 'UPDATE' };
      }
      const updated: SyncLinkRow = {
        ...link,
        calendar_id: calendar,
        event_id: event,
        etag,
        last_synced_at: lastSynced ?? null,
        last_sync_direction: lastDirection ?? null,
        local_hash: localHash ?? null,
        remote_updated_at: remoteUpdated ?? null,
        sync_status: syncStatus ?? 'idle',
        last_error: lastError ?? null
      };
      googleSyncLinks.set(updated.item_id, updated);
      return { rows: [updated], rowCount: 1, command: 'UPDATE' };
    }

    return { rows: [], rowCount: 0, command: 'SELECT' };
  };

  const remoteEvent = {
    id: 'event-remote-newer',
    status: 'confirmed',
    updated: '2025-10-16T12:00:00.000Z',
    summary: 'Neurology consult (Google)',
    location: 'Downtown Clinic',
    description: 'Bring scans',
    start: { dateTime: '2025-10-16T17:00:00.000Z' },
    end: { dateTime: '2025-10-16T18:00:00.000Z' },
    extendedProperties: {
      private: {
        carebaseItemId: String(itemId),
        carebaseType: 'appointment'
      }
    }
  };

  const fetchCalls: Array<{ url: string; method: string }> = [];
  const schedulerCalls: Array<{ userId: number; debounce: number }> = [];

  __setGoogleSyncSchedulerForTests((userId: number, debounceMs: number = 0) => {
    schedulerCalls.push({ userId, debounce: debounceMs });
  });

  global.fetch = async (input: any, init?: any) => {
    const url =
      typeof input === 'string'
        ? input
        : input && typeof input === 'object' && 'href' in input
          ? (input as URL).href
          : String(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    fetchCalls.push({ url, method });

    if (url.includes(`/events/${remoteEvent.id}`) && method === 'GET') {
      return {
        ok: true,
        status: 200,
        async json() {
          return remoteEvent;
        }
      };
    }

    if (url.includes('/events?') && method === 'GET') {
      return {
        ok: true,
        status: 200,
        async json() {
          return { items: [remoteEvent], nextSyncToken: 'sync-token-2' };
        }
      };
    }

    throw new Error(`Unexpected fetch ${method} ${url}`);
  };

  t.after(() => {
    __setGoogleSyncSchedulerForTests(null);
    dbClient.query = originalQuery;
    global.fetch = originalFetch;
    __resetGoogleSyncStateForTests();
  });

  const summary = await syncUserWithGoogle(ownerUserId);

  assert.equal(summary.pushed, 0);
  assert(summary.pulled >= 1);
  assert(summary.errors.length >= 1);

  const updatedAppointment = appointmentsByItem.get(itemId);
  assert.ok(updatedAppointment);
  assert.equal(updatedAppointment?.startLocal, '2025-10-16T17:00:00');
  assert.equal(updatedAppointment?.endLocal, '2025-10-16T18:00:00');
  assert.equal(updatedAppointment?.summary, 'Neurology consult (Google)');
  assert.equal(updatedAppointment?.location, 'Downtown Clinic');

  const link = googleSyncLinks.get(itemId);
  assert.ok(link);
  assert.equal(link?.sync_status, 'idle');
  assert.equal(link?.remote_updated_at?.toISOString(), remoteEvent.updated);
  assert.equal(link?.last_sync_direction, 'pull');

  const methods = new Set(fetchCalls.map((entry) => entry.method));
  assert(methods.has('GET'));
  assert(!methods.has('PATCH'));
  assert(!methods.has('POST'));
});
