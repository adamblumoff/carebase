import type { TestContext } from 'node:test';
import { newDb } from 'pg-mem';
import type { Pool } from 'pg';

interface DbClientProxy {
  query: (text: string, params?: any[]) => Promise<any>;
  getClient: () => Promise<any>;
  end: () => Promise<void>;
  pool: Pool | null;
}

interface GoogleSyncTestEnvBackup {
  GOOGLE_SYNC_ENABLE_TEST?: string;
  GOOGLE_SYNC_DEBOUNCE_MS?: string;
  GOOGLE_SYNC_RETRY_BASE_MS?: string;
  GOOGLE_SYNC_RETRY_MAX_MS?: string;
  GOOGLE_SYNC_ENABLE_POLLING_FALLBACK?: string;
}

export interface GoogleSyncTestContext {
  pool: Pool;
  exec<T = any>(text: string, params?: any[]): Promise<{ rows: T[] }>;
  scheduleCalls: Array<{ userId: number; debounceMs: number }>;
  restore(): Promise<void>;
}

export async function createGoogleSyncTestContext(t: TestContext): Promise<GoogleSyncTestContext> {
  const dbClientModule = await import('../db/client.js');
  const dbClient = dbClientModule.default as unknown as DbClientProxy;
  const queriesModule = await import('../db/queries.js');
  const setSchemaEnsured =
    (queriesModule as any).__setGoogleIntegrationSchemaEnsuredForTests?.bind(queriesModule) ??
    (() => {});

  const envBackup: GoogleSyncTestEnvBackup = {
    GOOGLE_SYNC_ENABLE_TEST: process.env.GOOGLE_SYNC_ENABLE_TEST,
    GOOGLE_SYNC_DEBOUNCE_MS: process.env.GOOGLE_SYNC_DEBOUNCE_MS,
    GOOGLE_SYNC_RETRY_BASE_MS: process.env.GOOGLE_SYNC_RETRY_BASE_MS,
    GOOGLE_SYNC_RETRY_MAX_MS: process.env.GOOGLE_SYNC_RETRY_MAX_MS,
    GOOGLE_SYNC_ENABLE_POLLING_FALLBACK: process.env.GOOGLE_SYNC_ENABLE_POLLING_FALLBACK
  };

  process.env.GOOGLE_SYNC_ENABLE_TEST = 'true';
  process.env.GOOGLE_SYNC_DEBOUNCE_MS = '0';
  process.env.GOOGLE_SYNC_RETRY_BASE_MS = '1';
  process.env.GOOGLE_SYNC_RETRY_MAX_MS = '1';
  process.env.GOOGLE_SYNC_ENABLE_POLLING_FALLBACK = 'false';

  const mem = newDb({ autoCreateForeignKeyIndices: true });
  mem.public.registerFunction({
    name: 'now',
    returns: 'timestamp',
    implementation: () => new Date()
  });

  mem.public.none(GOOGLE_SYNC_TEST_SCHEMA);
  setSchemaEnsured(true);

  const adapter = mem.adapters.createPg();
  const { Pool } = adapter;
  const pool = new Pool();

  const originalQuery = dbClient.query;
  const originalGetClient = dbClient.getClient;
  const originalEnd = dbClient.end;
  const originalPool = dbClient.pool;

  dbClient.query = async (text: string, params?: any[]) => {
    const normalized = text.trim().toLowerCase();
    if (normalized.startsWith('update appointments as a') && normalized.includes('returning a.*')) {
      const [
        startLocal,
        endLocal,
        startTimeZone,
        endTimeZone,
        startOffset,
        endOffset,
        location,
        prepNote,
        summary,
        assignedCollaboratorId,
        appointmentId,
        userId
      ] = params ?? [];

      const ownership = await pool.query(
        `SELECT a.id
         FROM appointments a
         JOIN items i ON a.item_id = i.id
         JOIN recipients r ON i.recipient_id = r.id
         WHERE a.id = $1 AND r.user_id = $2`,
        [appointmentId, userId]
      );

      if (ownership.rowCount === 0) {
        return { rows: [], rowCount: 0, command: 'UPDATE' };
      }

      const updateResult = await pool.query(
        `UPDATE appointments
         SET start_local = $1,
             end_local = $2,
             start_time_zone = $3,
             end_time_zone = $4,
             start_offset = $5,
             end_offset = $6,
             location = $7,
             prep_note = $8,
             summary = $9,
             assigned_collaborator_id = $10
         WHERE id = $11
         RETURNING *`,
        [
          startLocal ?? null,
          endLocal ?? null,
          startTimeZone ?? null,
          endTimeZone ?? null,
          startOffset ?? null,
          endOffset ?? null,
          location ?? null,
          prepNote ?? null,
          summary ?? null,
          assignedCollaboratorId ?? null,
          appointmentId
        ]
      );

      return updateResult;
    }

    if (normalized.startsWith('update users u') && normalized.includes('returning u.id')) {
      const [itemId] = params ?? [];
      const ownership = await pool.query(
        `SELECT r.user_id
         FROM items i
         JOIN recipients r ON i.recipient_id = r.id
         WHERE i.id = $1`,
        [itemId]
      );

      if (ownership.rowCount === 0) {
        return { rows: [], rowCount: 0, command: 'UPDATE' };
      }

      const userId = ownership.rows[0].user_id;
      const updateResult = await pool.query(
        `UPDATE users
         SET plan_version = COALESCE(plan_version, 0) + 1,
             plan_updated_at = NOW()
         WHERE id = $1
         RETURNING id`,
        [userId]
      );

      return updateResult;
    }

    return pool.query(text, params);
  };
  dbClient.getClient = async () => pool.connect();
  dbClient.end = async () => pool.end();
  dbClient.pool = pool;

  const scheduleCalls: Array<{ userId: number; debounceMs: number }> = [];
  const googleSyncModule = await import('./googleSync.js');
  const { __setGoogleSyncSchedulerForTests, __resetGoogleSyncStateForTests } = googleSyncModule;
  __resetGoogleSyncStateForTests();
  __setGoogleSyncSchedulerForTests((userId: number, debounceMs: number) => {
    scheduleCalls.push({ userId, debounceMs });
  });

  async function restore(): Promise<void> {
    __setGoogleSyncSchedulerForTests(null);
    setSchemaEnsured(false);
    dbClient.query = originalQuery;
    dbClient.getClient = originalGetClient;
    dbClient.end = originalEnd;
    dbClient.pool = originalPool;
    await pool.end();
    restoreEnv('GOOGLE_SYNC_ENABLE_TEST', envBackup.GOOGLE_SYNC_ENABLE_TEST);
    restoreEnv('GOOGLE_SYNC_DEBOUNCE_MS', envBackup.GOOGLE_SYNC_DEBOUNCE_MS);
    restoreEnv('GOOGLE_SYNC_RETRY_BASE_MS', envBackup.GOOGLE_SYNC_RETRY_BASE_MS);
    restoreEnv('GOOGLE_SYNC_RETRY_MAX_MS', envBackup.GOOGLE_SYNC_RETRY_MAX_MS);
    restoreEnv('GOOGLE_SYNC_ENABLE_POLLING_FALLBACK', envBackup.GOOGLE_SYNC_ENABLE_POLLING_FALLBACK);
  }

  t.after(async () => {
    await restore();
  });

  return {
    pool,
    exec: (text: string, params?: any[]) => pool.query(text, params),
    scheduleCalls,
    restore
  };
}

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

const GOOGLE_SYNC_TEST_SCHEMA = `
  CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    google_id TEXT UNIQUE,
    legacy_google_id TEXT UNIQUE,
    clerk_user_id TEXT UNIQUE,
    password_reset_required BOOLEAN NOT NULL DEFAULT false,
    forwarding_address TEXT NOT NULL UNIQUE,
    plan_secret TEXT NOT NULL,
    plan_version INTEGER NOT NULL DEFAULT 0,
    plan_updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE users_mfa_status (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL,
    last_transition_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    grace_expires_at TIMESTAMPTZ
  );

  CREATE TABLE recipients (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    display_name TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE care_collaborators (
    id SERIAL PRIMARY KEY,
    recipient_id INTEGER NOT NULL REFERENCES recipients(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    email TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'contributor',
    status TEXT NOT NULL DEFAULT 'pending',
    invite_token TEXT NOT NULL,
    invited_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    invited_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    accepted_at TIMESTAMPTZ
  );
  CREATE INDEX idx_care_collaborators_recipient ON care_collaborators(recipient_id);
  CREATE INDEX idx_care_collaborators_user ON care_collaborators(user_id);

  CREATE TABLE sources (
    id SERIAL PRIMARY KEY,
    recipient_id INTEGER NOT NULL REFERENCES recipients(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    external_id TEXT,
    sender TEXT,
    subject TEXT,
    short_excerpt TEXT,
    storage_key TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE items (
    id SERIAL PRIMARY KEY,
    recipient_id INTEGER NOT NULL REFERENCES recipients(id) ON DELETE CASCADE,
    source_id INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    detected_type TEXT NOT NULL,
    confidence NUMERIC,
    review_status TEXT NOT NULL DEFAULT 'auto',
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE appointments (
    id SERIAL PRIMARY KEY,
    item_id INTEGER NOT NULL UNIQUE REFERENCES items(id) ON DELETE CASCADE,
    start_local TIMESTAMPTZ NOT NULL,
    end_local TIMESTAMPTZ NOT NULL,
    start_time_zone TEXT,
    end_time_zone TEXT,
    start_offset TEXT,
    end_offset TEXT,
    location TEXT,
    prep_note TEXT,
    summary TEXT NOT NULL,
    ics_token TEXT NOT NULL UNIQUE,
    assigned_collaborator_id INTEGER,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE bills (
    id SERIAL PRIMARY KEY,
    item_id INTEGER NOT NULL UNIQUE REFERENCES items(id) ON DELETE CASCADE,
    statement_date DATE,
    amount NUMERIC,
    due_date DATE,
    pay_url TEXT,
    status TEXT NOT NULL DEFAULT 'todo',
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE google_sync_links (
    id SERIAL PRIMARY KEY,
    item_id INTEGER NOT NULL UNIQUE REFERENCES items(id) ON DELETE CASCADE,
    calendar_id TEXT,
    event_id TEXT,
    etag TEXT,
    last_synced_at TIMESTAMPTZ,
    last_sync_direction TEXT,
    local_hash TEXT,
    remote_updated_at TIMESTAMPTZ,
    sync_status TEXT NOT NULL DEFAULT 'idle',
    last_error TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE google_credentials (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    access_token TEXT NOT NULL,
    refresh_token TEXT NOT NULL,
    scope TEXT[],
    expires_at TIMESTAMPTZ,
    token_type TEXT,
    id_token TEXT,
    calendar_id TEXT,
    sync_token TEXT,
    last_pulled_at TIMESTAMPTZ,
    needs_reauth BOOLEAN NOT NULL DEFAULT false,
    managed_calendar_id TEXT,
    managed_calendar_summary TEXT,
    managed_calendar_state TEXT DEFAULT 'pending',
    managed_calendar_verified_at TIMESTAMPTZ,
    managed_calendar_acl_role TEXT,
    legacy_calendar_id TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE google_watch_channels (
    channel_id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    calendar_id TEXT,
    resource_id TEXT NOT NULL,
    resource_uri TEXT,
    expiration TIMESTAMPTZ,
    channel_token TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX idx_items_recipient ON items(recipient_id);
  CREATE INDEX idx_google_sync_links_event ON google_sync_links(event_id);
  CREATE INDEX idx_google_sync_links_calendar ON google_sync_links(calendar_id);
  CREATE INDEX idx_google_credentials_expires_at ON google_credentials(expires_at);
`;
