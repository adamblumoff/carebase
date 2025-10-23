import type {
  Appointment,
  Bill,
  GoogleIntegrationStatus,
  GoogleSyncDirection,
  GoogleSyncMetadata,
  GoogleSyncStatus,
  ItemType
} from '@carebase/shared';
import { db } from './shared.js';
import { encryptSecret, decryptSecret } from '../../utils/secretCipher.js';

let googleIntegrationSchemaEnsured = false;
let googleIntegrationEnsurePromise: Promise<void> | null = null;
let scheduleGoogleSyncForUserFn: ((userId: number, debounceMs?: number) => void) | null = null;

async function scheduleGoogleSync(userId: number): Promise<void> {
  try {
    if (!scheduleGoogleSyncForUserFn) {
      const mod = await import('../../services/googleSync.js');
      scheduleGoogleSyncForUserFn = mod.scheduleGoogleSyncForUser;
    }
    scheduleGoogleSyncForUserFn?.(userId, 0);
  } catch (error) {
    console.error('Failed to schedule Google sync for user', userId, error);
  }
}

async function ensureGoogleIntegrationSchema(): Promise<void> {
  if (googleIntegrationSchemaEnsured) {
    return;
  }

  if (!googleIntegrationEnsurePromise) {
    googleIntegrationEnsurePromise = (async () => {
      try {
        await db.query(`
          CREATE TABLE IF NOT EXISTS google_sync_links (
            id SERIAL PRIMARY KEY,
            item_id INTEGER NOT NULL UNIQUE REFERENCES items(id) ON DELETE CASCADE,
            calendar_id TEXT,
            event_id TEXT,
            etag TEXT,
            last_synced_at TIMESTAMP,
            last_sync_direction VARCHAR(10) CHECK (last_sync_direction IN ('push', 'pull')),
            local_hash VARCHAR(128),
            remote_updated_at TIMESTAMP,
            sync_status VARCHAR(20) NOT NULL DEFAULT 'idle' CHECK (sync_status IN ('idle', 'pending', 'error')),
            last_error TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          )
        `);
        await db.query(`
          CREATE TABLE IF NOT EXISTS google_credentials (
            user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
            access_token TEXT NOT NULL,
            refresh_token TEXT NOT NULL,
            scope TEXT[],
            expires_at TIMESTAMP,
            token_type VARCHAR(50),
            id_token TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          )
        `);
        await db.query(
          `CREATE INDEX IF NOT EXISTS idx_google_sync_links_event ON google_sync_links(event_id)`
        );
        await db.query(
          `CREATE INDEX IF NOT EXISTS idx_google_sync_links_calendar ON google_sync_links(calendar_id)`
        );
        await db.query(
          `CREATE INDEX IF NOT EXISTS idx_google_credentials_expires_at ON google_credentials(expires_at)`
        );
        await db.query(
          `ALTER TABLE google_sync_links
             ADD COLUMN IF NOT EXISTS sync_status VARCHAR(20) NOT NULL DEFAULT 'idle' CHECK (sync_status IN ('idle', 'pending', 'error'))`
        );
        await db.query(
          `ALTER TABLE google_sync_links
             ADD COLUMN IF NOT EXISTS last_error TEXT`
        );
        await db.query(
          `ALTER TABLE google_sync_links
             ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`
        );
        await db.query(
          `ALTER TABLE google_credentials
             ADD COLUMN IF NOT EXISTS token_type VARCHAR(50)`
        );
        await db.query(
          `ALTER TABLE google_credentials
             ADD COLUMN IF NOT EXISTS id_token TEXT`
        );
        await db.query(
          `ALTER TABLE google_credentials
             ADD COLUMN IF NOT EXISTS calendar_id TEXT`
        );
        await db.query(
          `ALTER TABLE google_credentials
             ADD COLUMN IF NOT EXISTS sync_token TEXT`
        );
        await db.query(
          `ALTER TABLE google_credentials
             ADD COLUMN IF NOT EXISTS last_pulled_at TIMESTAMP`
        );
        await db.query(
          `ALTER TABLE google_credentials
             ADD COLUMN IF NOT EXISTS needs_reauth BOOLEAN NOT NULL DEFAULT false`
        );
        await db.query(
          `ALTER TABLE google_credentials
             ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`
        );
        await db.query(`
          CREATE TABLE IF NOT EXISTS google_watch_channels (
            channel_id TEXT PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            calendar_id TEXT,
            resource_id TEXT NOT NULL,
            resource_uri TEXT,
            expiration TIMESTAMP,
            channel_token TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          )
        `);
        await db.query(
          `CREATE INDEX IF NOT EXISTS idx_google_watch_channels_user ON google_watch_channels(user_id)`
        );
        await db.query(
          `CREATE INDEX IF NOT EXISTS idx_google_watch_channels_resource ON google_watch_channels(resource_id)`
        );
        await db.query(
          `CREATE INDEX IF NOT EXISTS idx_google_watch_channels_expiration ON google_watch_channels(expiration)`
        );
      } catch (error) {
        console.error('Failed to ensure Google integration schema:', error);
      } finally {
        googleIntegrationSchemaEnsured = true;
      }
    })();
  }

  await googleIntegrationEnsurePromise;
}

export function __setGoogleIntegrationSchemaEnsuredForTests(ensured: boolean): void {
  googleIntegrationSchemaEnsured = ensured;
  googleIntegrationEnsurePromise = ensured ? Promise.resolve() : null;
}

export function __setGoogleSyncSchedulerForTests(
  scheduler: ((userId: number, debounceMs?: number) => void) | null
): void {
  scheduleGoogleSyncForUserFn = scheduler;
}

export const GOOGLE_SYNC_PROJECTION = `
  gsl.id AS google_sync_id,
  gsl.calendar_id AS google_calendar_id,
  gsl.event_id AS google_event_id,
  gsl.etag AS google_etag,
  gsl.last_synced_at AS google_last_synced_at,
  gsl.last_sync_direction AS google_last_sync_direction,
  gsl.local_hash AS google_local_hash,
  gsl.remote_updated_at AS google_remote_updated_at,
  gsl.sync_status AS google_sync_status,
  gsl.last_error AS google_last_error
`;

interface GoogleWatchChannelRow {
  channel_id: string;
  user_id: number;
  calendar_id: string | null;
  resource_id: string;
  resource_uri: string | null;
  expiration: Date | null;
  channel_token: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface GoogleWatchChannel {
  channelId: string;
  userId: number;
  calendarId: string | null;
  resourceId: string;
  resourceUri: string | null;
  expiration: Date | null;
  channelToken: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function watchRowToChannel(row: GoogleWatchChannelRow): GoogleWatchChannel {
  const rawExpiration = row.expiration ?? null;
  let expiration: Date | null = null;
  if (rawExpiration instanceof Date) {
    expiration = rawExpiration;
  } else if (typeof rawExpiration === 'string') {
    const normalized = rawExpiration.includes('T')
      ? rawExpiration
      : `${rawExpiration.replace(' ', 'T')}Z`;
    const parsed = new Date(normalized);
    expiration = Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  return {
    channelId: row.channel_id,
    userId: row.user_id,
    calendarId: row.calendar_id ?? null,
    resourceId: row.resource_id,
    resourceUri: row.resource_uri ?? null,
    expiration,
    channelToken: row.channel_token ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

interface GoogleSyncLinkRow {
  id: number;
  item_id: number;
  calendar_id: string | null;
  event_id: string | null;
  etag: string | null;
  last_synced_at: Date | null;
  last_sync_direction: GoogleSyncDirection | null;
  local_hash: string | null;
  remote_updated_at: Date | null;
  sync_status: GoogleSyncStatus;
  last_error: string | null;
  created_at: Date;
  updated_at: Date;
}

interface GoogleCredentialRow {
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
  needs_reauth: boolean;
  managed_calendar_id: string | null;
  managed_calendar_summary: string | null;
  managed_calendar_state: string | null;
  managed_calendar_verified_at: Date | null;
  managed_calendar_acl_role: string | null;
  legacy_calendar_id: string | null;
  created_at: Date;
  updated_at: Date;
}

function googleSyncLinkRowToMetadata(row: GoogleSyncLinkRow): GoogleSyncMetadata {
  return {
    calendarId: row.calendar_id ?? null,
    eventId: row.event_id ?? null,
    etag: row.etag ?? null,
    lastSyncedAt: row.last_synced_at ?? null,
    lastSyncDirection: row.last_sync_direction ?? null,
    localHash: row.local_hash ?? null,
    remoteUpdatedAt: row.remote_updated_at ?? null,
    syncStatus: row.sync_status,
    lastError: row.last_error ?? null
  };
}

export function projectGoogleSyncMetadata(
  row:
    | (Partial<GoogleSyncLinkRow> & { google_sync_id?: number | null })
    | (Record<string, unknown> & { google_sync_id?: number | null })
): GoogleSyncMetadata | null {
  const hasProjection =
    Object.prototype.hasOwnProperty.call(row, 'google_sync_id') ||
    Object.prototype.hasOwnProperty.call(row, 'google_event_id') ||
    Object.prototype.hasOwnProperty.call(row, 'google_calendar_id');

  if (!hasProjection) {
    return null;
  }

  const syncStatus: GoogleSyncStatus = (row as any).google_sync_status ?? 'idle';

  const anyValuePresent =
    (row as any).google_sync_id !== undefined ||
    (row as any).google_event_id !== undefined ||
    (row as any).google_calendar_id !== undefined ||
    (row as any).google_etag !== undefined ||
    (row as any).google_last_synced_at !== undefined ||
    (row as any).google_last_sync_direction !== undefined ||
    (row as any).google_local_hash !== undefined ||
    (row as any).google_remote_updated_at !== undefined;

  if (!anyValuePresent) {
    return null;
  }

  return {
    calendarId: (row as any).google_calendar_id ?? null,
    eventId: (row as any).google_event_id ?? null,
    etag: (row as any).google_etag ?? null,
    lastSyncedAt: (row as any).google_last_synced_at ?? null,
    lastSyncDirection: (row as any).google_last_sync_direction ?? null,
    localHash: (row as any).google_local_hash ?? null,
    remoteUpdatedAt: (row as any).google_remote_updated_at ?? null,
    syncStatus,
    lastError: (row as any).google_last_error ?? null
  };
}

export interface GoogleCredential {
  userId: number;
  accessToken: string;
  refreshToken: string;
  scope: string[];
  expiresAt: Date | null;
  tokenType: string | null;
  idToken: string | null;
  calendarId: string | null;
  syncToken: string | null;
  lastPulledAt: Date | null;
  needsReauth: boolean;
  managedCalendarId: string | null;
  managedCalendarSummary: string | null;
  managedCalendarState: string | null;
  managedCalendarVerifiedAt: Date | null;
  managedCalendarAclRole: string | null;
  legacyCalendarId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface GoogleSyncLinkUpsertData {
  calendarId?: string | null;
  eventId?: string | null;
  etag?: string | null;
  lastSyncedAt?: Date | null;
  lastSyncDirection?: GoogleSyncDirection | null;
  localHash?: string | null;
  remoteUpdatedAt?: Date | null;
  syncStatus?: GoogleSyncStatus;
  lastError?: string | null;
}

async function googleCredentialRowToCredential(row: GoogleCredentialRow): Promise<GoogleCredential> {
  const updates: Array<{ column: keyof GoogleCredentialRow; value: string | null }> = [];

  const resolveToken = (value: string | null, column: keyof GoogleCredentialRow): string | null => {
    if (!value) {
      return null;
    }
    try {
      const decrypted = decryptSecret(value);
      if (!decrypted) {
        throw new Error(`Unable to decrypt ${String(column)}`);
      }
      return decrypted;
    } catch {
      const encrypted = encryptSecret(value);
      if (!encrypted) {
        throw new Error(`Unable to encrypt ${String(column)}`);
      }
      updates.push({ column, value: encrypted });
      return value;
    }
  };

  const accessToken = resolveToken(row.access_token, 'access_token');
  const refreshToken = resolveToken(row.refresh_token, 'refresh_token');
  const idToken = resolveToken(row.id_token, 'id_token');

  if (!accessToken || !refreshToken) {
    throw new Error('Missing Google OAuth credentials for user');
  }

  if (updates.length > 0) {
    const setFragments = updates.map((entry, index) => `${entry.column} = $${index + 1}`);
    const values = updates.map((entry) => entry.value);
    await db.query(
      `UPDATE google_credentials
       SET ${setFragments.join(', ')}, updated_at = NOW()
       WHERE user_id = $${updates.length + 1}`,
      [...values, row.user_id]
    );
  }

  return {
    userId: row.user_id,
    accessToken,
    refreshToken,
    scope: row.scope ?? [],
    expiresAt: row.expires_at,
    tokenType: row.token_type,
    idToken,
    calendarId: row.calendar_id,
    syncToken: row.sync_token,
    lastPulledAt: row.last_pulled_at,
    managedCalendarId: row.managed_calendar_id ?? null,
    managedCalendarSummary: row.managed_calendar_summary ?? null,
    managedCalendarState: row.managed_calendar_state ?? null,
    managedCalendarVerifiedAt: row.managed_calendar_verified_at ?? null,
    managedCalendarAclRole: row.managed_calendar_acl_role ?? null,
    legacyCalendarId: row.legacy_calendar_id ?? null,
    needsReauth: row.needs_reauth ?? false,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export async function getGoogleCredential(userId: number): Promise<GoogleCredential | null> {
  await ensureGoogleIntegrationSchema();
  const result = await db.query(
    'SELECT * FROM google_credentials WHERE user_id = $1 LIMIT 1',
    [userId]
  );
  if (result.rows.length === 0) {
    return null;
  }
  return googleCredentialRowToCredential(result.rows[0] as GoogleCredentialRow);
}

export async function upsertGoogleCredential(
  userId: number,
  data: {
    accessToken: string;
    refreshToken: string;
    scope: string[];
    expiresAt: Date | null;
    tokenType?: string | null;
    idToken?: string | null;
    calendarId?: string | null;
    syncToken?: string | null;
    lastPulledAt?: Date | null;
    managedCalendarId?: string | null;
    managedCalendarSummary?: string | null;
    managedCalendarState?: string | null;
    managedCalendarVerifiedAt?: Date | null;
    managedCalendarAclRole?: string | null;
    legacyCalendarId?: string | null;
  }
): Promise<GoogleCredential> {
  await ensureGoogleIntegrationSchema();
  const encryptedAccessToken = encryptSecret(data.accessToken);
  const encryptedRefreshToken = encryptSecret(data.refreshToken);
  const encryptedIdToken = encryptSecret(data.idToken ?? null);

  if (!encryptedAccessToken || !encryptedRefreshToken) {
    throw new Error('Failed to encrypt Google OAuth credentials');
  }

  const result = await db.query(
    `INSERT INTO google_credentials (
        user_id,
        access_token,
        refresh_token,
        scope,
        expires_at,
        token_type,
        id_token,
        calendar_id,
        sync_token,
    last_pulled_at,
    needs_reauth,
    managed_calendar_id,
    managed_calendar_summary,
        managed_calendar_state,
        managed_calendar_verified_at,
        managed_calendar_acl_role,
        legacy_calendar_id,
        created_at,
        updated_at
     )
     VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
       $11, $12, $13, $14, $15, $16, $17,
       NOW(), NOW()
     )
     ON CONFLICT (user_id)
     DO UPDATE SET
       access_token = EXCLUDED.access_token,
       refresh_token = EXCLUDED.refresh_token,
       scope = EXCLUDED.scope,
       expires_at = EXCLUDED.expires_at,
       token_type = EXCLUDED.token_type,
       id_token = EXCLUDED.id_token,
       calendar_id = EXCLUDED.calendar_id,
       sync_token = EXCLUDED.sync_token,
       last_pulled_at = EXCLUDED.last_pulled_at,
       needs_reauth = EXCLUDED.needs_reauth,
       managed_calendar_id = EXCLUDED.managed_calendar_id,
       managed_calendar_summary = EXCLUDED.managed_calendar_summary,
       managed_calendar_state = EXCLUDED.managed_calendar_state,
       managed_calendar_verified_at = EXCLUDED.managed_calendar_verified_at,
       managed_calendar_acl_role = EXCLUDED.managed_calendar_acl_role,
       legacy_calendar_id = EXCLUDED.legacy_calendar_id,
       updated_at = NOW()
    RETURNING *`,
    [
      userId,
      encryptedAccessToken,
      encryptedRefreshToken,
      data.scope,
      data.expiresAt,
      data.tokenType ?? null,
      encryptedIdToken,
      data.calendarId ?? null,
      data.syncToken ?? null,
      data.lastPulledAt ?? null,
      data.needsReauth ?? false,
      data.managedCalendarId ?? null,
      data.managedCalendarSummary ?? null,
      data.managedCalendarState ?? null,
      data.managedCalendarVerifiedAt ?? null,
      data.managedCalendarAclRole ?? null,
      data.legacyCalendarId ?? null
    ]
  );
  return googleCredentialRowToCredential(result.rows[0] as GoogleCredentialRow);
}

export async function deleteGoogleCredential(userId: number): Promise<void> {
  await ensureGoogleIntegrationSchema();
  await db.query('DELETE FROM google_credentials WHERE user_id = $1', [userId]);
}

export async function setGoogleCredentialReauth(userId: number, needsReauth: boolean): Promise<void> {
  await ensureGoogleIntegrationSchema();
  await db.query(
    'UPDATE google_credentials SET needs_reauth = $2, updated_at = NOW() WHERE user_id = $1',
    [userId, needsReauth]
  );
}

export interface GoogleCredentialUserRow {
  userId: number;
  email: string;
  clerkUserId: string | null;
  needsReauth: boolean;
}

export async function listGoogleCredentialUsers(): Promise<GoogleCredentialUserRow[]> {
  await ensureGoogleIntegrationSchema();
  const result = await db.query(
    `SELECT gc.user_id AS user_id,
            u.email AS email,
            u.clerk_user_id AS clerk_user_id,
            gc.needs_reauth AS needs_reauth
       FROM google_credentials gc
       JOIN users u ON u.id = gc.user_id
      ORDER BY gc.user_id`
  );

  return result.rows.map((row) => ({
    userId: row.user_id as number,
    email: row.email as string,
    clerkUserId: (row.clerk_user_id as string) ?? null,
    needsReauth: Boolean(row.needs_reauth)
  }));
}

export async function upsertGoogleSyncLink(
  itemId: number,
  data: GoogleSyncLinkUpsertData
): Promise<GoogleSyncMetadata> {
  await ensureGoogleIntegrationSchema();
  const existingResult = await db.query(
    'SELECT * FROM google_sync_links WHERE item_id = $1 LIMIT 1',
    [itemId]
  );

  const merged = {
    calendar_id:
      data.calendarId !== undefined
        ? data.calendarId
        : (existingResult.rows[0]?.calendar_id as string | null) ?? null,
    event_id:
      data.eventId !== undefined
        ? data.eventId
        : (existingResult.rows[0]?.event_id as string | null) ?? null,
    etag:
      data.etag !== undefined
        ? data.etag
        : (existingResult.rows[0]?.etag as string | null) ?? null,
    last_synced_at:
      data.lastSyncedAt !== undefined
        ? data.lastSyncedAt
        : (existingResult.rows[0]?.last_synced_at as Date | null) ?? null,
    last_sync_direction:
      data.lastSyncDirection !== undefined
        ? data.lastSyncDirection
        : (existingResult.rows[0]?.last_sync_direction as GoogleSyncDirection | null) ?? null,
    local_hash:
      data.localHash !== undefined
        ? data.localHash
        : (existingResult.rows[0]?.local_hash as string | null) ?? null,
    remote_updated_at:
      data.remoteUpdatedAt !== undefined
        ? data.remoteUpdatedAt
        : (existingResult.rows[0]?.remote_updated_at as Date | null) ?? null,
    sync_status:
      data.syncStatus !== undefined
        ? data.syncStatus
        : ((existingResult.rows[0]?.sync_status as GoogleSyncStatus) ?? 'idle'),
    last_error:
      data.lastError !== undefined
        ? data.lastError
        : (existingResult.rows[0]?.last_error as string | null) ?? null
  };

  if (existingResult.rows.length === 0) {
    const insertResult = await db.query(
      `INSERT INTO google_sync_links (
        item_id,
        calendar_id,
        event_id,
        etag,
        last_synced_at,
        last_sync_direction,
        local_hash,
        remote_updated_at,
        sync_status,
        last_error,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())
      RETURNING *`,
      [
        itemId,
        merged.calendar_id,
        merged.event_id,
        merged.etag,
        merged.last_synced_at,
        merged.last_sync_direction,
        merged.local_hash,
        merged.remote_updated_at,
        merged.sync_status,
        merged.last_error
      ]
    );
    return googleSyncLinkRowToMetadata(insertResult.rows[0] as GoogleSyncLinkRow);
  }

  const updateResult = await db.query(
    `UPDATE google_sync_links
     SET calendar_id = $2,
         event_id = $3,
         etag = $4,
         last_synced_at = $5,
         last_sync_direction = $6,
         local_hash = $7,
         remote_updated_at = $8,
         sync_status = $9,
         last_error = $10,
         updated_at = NOW()
     WHERE item_id = $1
     RETURNING *`,
    [
      itemId,
      merged.calendar_id,
      merged.event_id,
      merged.etag,
      merged.last_synced_at,
      merged.last_sync_direction,
      merged.local_hash,
      merged.remote_updated_at,
      merged.sync_status,
      merged.last_error
    ]
  );

  return googleSyncLinkRowToMetadata(updateResult.rows[0] as GoogleSyncLinkRow);
}

export async function getGoogleSyncMetadataForItem(itemId: number): Promise<GoogleSyncMetadata | null> {
  await ensureGoogleIntegrationSchema();
  const result = await db.query(
    'SELECT * FROM google_sync_links WHERE item_id = $1 LIMIT 1',
    [itemId]
  );
  if (result.rows.length === 0) {
    return null;
  }
  return googleSyncLinkRowToMetadata(result.rows[0] as GoogleSyncLinkRow);
}

export async function findGoogleSyncLinkByEvent(
  eventId: string
): Promise<{ itemId: number; metadata: GoogleSyncMetadata } | null> {
  await ensureGoogleIntegrationSchema();
  const result = await db.query(
    `SELECT * FROM google_sync_links WHERE event_id = $1 LIMIT 1`,
    [eventId]
  );
  if (result.rows.length === 0) {
    return null;
  }
  const row = result.rows[0] as GoogleSyncLinkRow;
  return { itemId: row.item_id, metadata: googleSyncLinkRowToMetadata(row) };
}

export async function markGoogleSyncPending(itemId: number, localHash?: string | null): Promise<GoogleSyncMetadata | null> {
  await ensureGoogleIntegrationSchema();
  const ownerResult = await db.query(
    `SELECT r.user_id
     FROM items i
     JOIN recipients r ON i.recipient_id = r.id
     WHERE i.id = $1
     LIMIT 1`,
    [itemId]
  );

  const ownerRow = ownerResult.rows[0];
  if (!ownerRow || ownerRow.user_id === null) {
    return null;
  }

  const ownerUserId = ownerRow.user_id as number;
  const credential = await getGoogleCredential(ownerUserId);
  if (!credential) {
    await deleteGoogleSyncLink(itemId);
    return null;
  }

  const metadata = await upsertGoogleSyncLink(itemId, {
    syncStatus: 'pending',
    lastError: null,
    localHash: localHash ?? undefined
  });

  await scheduleGoogleSync(ownerUserId);
  return metadata;
}

export async function markGoogleSyncSuccess(
  itemId: number,
  data: {
    calendarId?: string | null;
    eventId?: string | null;
    etag?: string | null;
    lastSyncedAt: Date;
    lastSyncDirection: GoogleSyncDirection;
    localHash?: string | null;
    remoteUpdatedAt?: Date | null;
  }
): Promise<GoogleSyncMetadata> {
  return upsertGoogleSyncLink(itemId, {
    calendarId: data.calendarId,
    eventId: data.eventId,
    etag: data.etag,
    lastSyncedAt: data.lastSyncedAt,
    lastSyncDirection: data.lastSyncDirection,
    localHash: data.localHash ?? undefined,
    remoteUpdatedAt: data.remoteUpdatedAt,
    syncStatus: 'idle',
    lastError: null
  });
}

export async function markGoogleSyncError(itemId: number, message: string): Promise<GoogleSyncMetadata> {
  return upsertGoogleSyncLink(itemId, {
    syncStatus: 'error',
    lastError: message
  });
}

export async function deleteGoogleSyncLink(itemId: number): Promise<void> {
  await ensureGoogleIntegrationSchema();
  await db.query('DELETE FROM google_sync_links WHERE item_id = $1', [itemId]);
}

export async function upsertGoogleWatchChannel(channel: {
  channelId: string;
  userId: number;
  calendarId: string | null;
  resourceId: string;
  resourceUri?: string | null;
  expiration?: Date | null;
  channelToken?: string | null;
}): Promise<GoogleWatchChannel> {
  await ensureGoogleIntegrationSchema();
  const result = await db.query(
    `INSERT INTO google_watch_channels (channel_id, user_id, calendar_id, resource_id, resource_uri, expiration, channel_token, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
     ON CONFLICT (channel_id)
     DO UPDATE SET
       user_id = EXCLUDED.user_id,
       calendar_id = EXCLUDED.calendar_id,
       resource_id = EXCLUDED.resource_id,
       resource_uri = EXCLUDED.resource_uri,
       expiration = EXCLUDED.expiration,
       channel_token = EXCLUDED.channel_token,
       updated_at = NOW()
     RETURNING *`,
    [
      channel.channelId,
      channel.userId,
      channel.calendarId,
      channel.resourceId,
      channel.resourceUri ?? null,
      channel.expiration ?? null,
      channel.channelToken ?? null
    ]
  );

  return watchRowToChannel(result.rows[0] as GoogleWatchChannelRow);
}

export async function deleteGoogleWatchChannel(channelId: string): Promise<void> {
  await ensureGoogleIntegrationSchema();
  await db.query('DELETE FROM google_watch_channels WHERE channel_id = $1', [channelId]);
}

export async function findGoogleWatchChannelByResource(resourceId: string): Promise<GoogleWatchChannel | null> {
  await ensureGoogleIntegrationSchema();
  const result = await db.query('SELECT * FROM google_watch_channels WHERE resource_id = $1 LIMIT 1', [resourceId]);
  return result.rows[0] ? watchRowToChannel(result.rows[0] as GoogleWatchChannelRow) : null;
}

export async function findGoogleWatchChannelByUser(
  userId: number,
  calendarId: string | null
): Promise<GoogleWatchChannel | null> {
  await ensureGoogleIntegrationSchema();
  const result = await db.query(
    `SELECT * FROM google_watch_channels
     WHERE user_id = $1 AND ((calendar_id IS NULL AND $2::text IS NULL) OR calendar_id = $2)
     ORDER BY updated_at DESC
     LIMIT 1`,
    [userId, calendarId ?? null]
  );
  return result.rows[0] ? watchRowToChannel(result.rows[0] as GoogleWatchChannelRow) : null;
}

export async function findGoogleWatchChannelById(channelId: string): Promise<GoogleWatchChannel | null> {
  await ensureGoogleIntegrationSchema();
  const result = await db.query('SELECT * FROM google_watch_channels WHERE channel_id = $1 LIMIT 1', [channelId]);
  return result.rows[0] ? watchRowToChannel(result.rows[0] as GoogleWatchChannelRow) : null;
}

export async function findGoogleWatchChannelByToken(token: string): Promise<GoogleWatchChannel | null> {
  await ensureGoogleIntegrationSchema();
  const result = await db.query('SELECT * FROM google_watch_channels WHERE channel_token = $1 LIMIT 1', [token]);
  return result.rows[0] ? watchRowToChannel(result.rows[0] as GoogleWatchChannelRow) : null;
}

export async function listExpiringGoogleWatchChannels(threshold: Date): Promise<GoogleWatchChannel[]> {
  await ensureGoogleIntegrationSchema();
  const result = await db.query(
    'SELECT * FROM google_watch_channels WHERE expiration IS NOT NULL AND expiration <= $1',
    [threshold]
  );
  return result.rows.map((row) => watchRowToChannel(row as GoogleWatchChannelRow));
}

export async function listGoogleWatchChannelsByUser(userId: number): Promise<GoogleWatchChannel[]> {
  await ensureGoogleIntegrationSchema();
  const result = await db.query('SELECT * FROM google_watch_channels WHERE user_id = $1', [userId]);
  return result.rows.map((row) => watchRowToChannel(row as GoogleWatchChannelRow));
}

export async function clearGoogleSyncForUser(userId: number): Promise<void> {
  await ensureGoogleIntegrationSchema();
  await db.query(
    `DELETE FROM google_sync_links gsl
     USING items i
     JOIN recipients r ON i.recipient_id = r.id
     WHERE gsl.item_id = i.id
       AND r.user_id = $1`,
    [userId]
  );
  await db.query('DELETE FROM google_watch_channels WHERE user_id = $1', [userId]);
}

export async function getItemOwnerUserId(itemId: number): Promise<number | null> {
  const result = await db.query(
    `SELECT r.user_id
     FROM items i
     JOIN recipients r ON i.recipient_id = r.id
     WHERE i.id = $1
     LIMIT 1`,
    [itemId]
  );
  if (result.rows.length === 0) {
    return null;
  }
  return (result.rows[0].user_id as number) ?? null;
}

export async function listPendingGoogleSyncItems(
  userId: number
): Promise<Array<{ itemId: number; itemType: ItemType; recipientId: number }>> {
  await ensureGoogleIntegrationSchema();
  const result = await db.query(
    `SELECT gsl.item_id, i.detected_type, i.recipient_id
     FROM google_sync_links gsl
     JOIN items i ON gsl.item_id = i.id
     JOIN recipients r ON i.recipient_id = r.id
     WHERE r.user_id = $1
       AND gsl.sync_status = 'pending'
     ORDER BY gsl.updated_at ASC`,
    [userId]
  );

  return result.rows.map((row) => ({
    itemId: row.item_id as number,
    itemType: row.detected_type as ItemType,
    recipientId: row.recipient_id as number
  }));
}

export async function listGoogleSyncLinksForUser(
  userId: number
): Promise<Array<{ itemId: number; calendarId: string | null; eventId: string | null; itemType: ItemType }>> {
  await ensureGoogleIntegrationSchema();
  const result = await db.query(
    `SELECT gsl.item_id, gsl.calendar_id, gsl.event_id, i.detected_type
     FROM google_sync_links gsl
     JOIN items i ON gsl.item_id = i.id
     JOIN recipients r ON i.recipient_id = r.id
     WHERE r.user_id = $1`,
    [userId]
  );

  return result.rows.map((row) => ({
    itemId: row.item_id as number,
    calendarId: (row.calendar_id as string | null) ?? null,
    eventId: (row.event_id as string | null) ?? null,
    itemType: row.detected_type as ItemType
  }));
}

export async function getGoogleIntegrationStatus(userId: number): Promise<GoogleIntegrationStatus> {
  await ensureGoogleIntegrationSchema();
  const credential = await getGoogleCredential(userId);
  if (!credential) {
    return {
      connected: false,
      calendarId: null,
      lastSyncedAt: null,
      syncPendingCount: 0,
      lastError: null
    };
  }

  const summaryResult = await db.query(
    `SELECT
        MAX(gsl.last_synced_at) AS last_synced_at,
        COUNT(*) FILTER (WHERE gsl.sync_status = 'pending') AS pending_count,
        MAX(gsl.calendar_id) FILTER (WHERE gsl.calendar_id IS NOT NULL) AS calendar_id,
        MAX(gsl.last_error) FILTER (WHERE gsl.last_error IS NOT NULL) AS last_error
     FROM google_sync_links gsl
     JOIN items i ON gsl.item_id = i.id
     JOIN recipients r ON i.recipient_id = r.id
     WHERE r.user_id = $1`,
    [userId]
  );

  const row = summaryResult.rows[0] ?? {};
  const pendingCount = row.pending_count ? Number(row.pending_count) : 0;

  const calendarId = (credential.calendarId ?? (row.calendar_id as string | null)) ?? null;

  return {
    connected: true,
    calendarId,
    lastSyncedAt: (row.last_synced_at as Date | null) ?? null,
    syncPendingCount: pendingCount,
    lastError: (row.last_error as string | null) ?? null
  };
}

export async function queueGoogleSyncForUser(
  userId: number,
  calendarId?: string | null,
  options?: { schedule?: boolean }
): Promise<void> {
  await ensureGoogleIntegrationSchema();
  await db.query(
    `INSERT INTO google_sync_links (item_id, calendar_id, sync_status, created_at, updated_at)
     SELECT i.id,
            CASE WHEN $2::text IS NULL THEN NULL ELSE $2::text END,
            'pending',
            NOW(),
            NOW()
     FROM items i
     JOIN recipients r ON i.recipient_id = r.id
     LEFT JOIN appointments a ON a.item_id = i.id
     LEFT JOIN bills b ON b.item_id = i.id
     WHERE r.user_id = $1
       AND (
         (i.detected_type = 'appointment' AND a.id IS NOT NULL) OR
         (i.detected_type = 'bill' AND b.id IS NOT NULL)
       )
     ON CONFLICT (item_id)
     DO UPDATE SET
       calendar_id = COALESCE(EXCLUDED.calendar_id, google_sync_links.calendar_id),
       sync_status = 'pending',
       last_error = NULL,
       updated_at = NOW()`,
    [userId, calendarId ?? null]
  );

  if (options?.schedule ?? true) {
    await scheduleGoogleSync(userId);
  }
}

export async function listGoogleConnectedUserIds(): Promise<number[]> {
  await ensureGoogleIntegrationSchema();
  const result = await db.query('SELECT user_id FROM google_credentials');
  return result.rows.map((row) => Number(row.user_id)).filter((id) => Number.isFinite(id));
}

export async function hydrateAppointmentWithGoogleSync(appointment: Appointment): Promise<Appointment> {
  const googleSync = await getGoogleSyncMetadataForItem(appointment.itemId);
  return { ...appointment, googleSync };
}

export async function hydrateBillWithGoogleSync(bill: Bill): Promise<Bill> {
  const googleSync = await getGoogleSyncMetadataForItem(bill.itemId);
  return { ...bill, googleSync };
}

export { ensureGoogleIntegrationSchema };
