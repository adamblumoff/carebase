import db from './client.js';
import crypto from 'crypto';
import type {
  User,
  Recipient,
  Source,
  SourceKind,
  Item,
  ItemType,
  Appointment,
  Bill,
  BillStatus,
  AppointmentCreateRequest,
  AppointmentUpdateRequest,
  BillCreateRequest,
  BillUpdateRequest,
  Collaborator,
  CollaboratorRole,
  CollaboratorStatus,
  GoogleIntegrationStatus,
  GoogleSyncMetadata,
  GoogleSyncDirection,
  GoogleSyncStatus
} from '@carebase/shared';
import { getRealtimeEmitter } from '../services/realtime.js';

let planVersionColumnsEnsured = false;
let planVersionEnsurePromise: Promise<void> | null = null;

let scheduleGoogleSyncForUserFn: ((userId: number, debounceMs?: number) => void) | null = null;

async function scheduleGoogleSync(userId: number): Promise<void> {
  try {
    if (!scheduleGoogleSyncForUserFn) {
      const mod = await import('../services/googleSync.js');
      scheduleGoogleSyncForUserFn = mod.scheduleGoogleSyncForUser;
    }
    scheduleGoogleSyncForUserFn?.(userId);
  } catch (error) {
    console.error('Failed to schedule Google sync for user', userId, error);
  }
}

export function __setGoogleSyncSchedulerForTests(scheduler: ((userId: number) => void) | null): void {
  scheduleGoogleSyncForUserFn = scheduler;
}

async function ensurePlanVersionColumns(): Promise<void> {
  if (planVersionColumnsEnsured) {
    return;
  }

  if (!planVersionEnsurePromise) {
    planVersionEnsurePromise = (async () => {
      try {
        await db.query(
          'ALTER TABLE users ADD COLUMN IF NOT EXISTS plan_version INTEGER NOT NULL DEFAULT 0'
        );
        await db.query(
          'ALTER TABLE users ADD COLUMN IF NOT EXISTS plan_updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP'
        );
      } catch (error) {
        console.error('Failed to ensure plan version columns:', error);
      } finally {
        planVersionColumnsEnsured = true;
      }
    })();
  }

  await planVersionEnsurePromise;
}

let collaboratorSchemaEnsured = false;
let collaboratorEnsurePromise: Promise<void> | null = null;

async function ensureCollaboratorSchema(): Promise<void> {
  if (collaboratorSchemaEnsured) {
    return;
  }

  if (!collaboratorEnsurePromise) {
    collaboratorEnsurePromise = (async () => {
      try {
        await db.query(`
          CREATE TABLE IF NOT EXISTS care_collaborators (
            id SERIAL PRIMARY KEY,
            recipient_id INTEGER NOT NULL REFERENCES recipients(id) ON DELETE CASCADE,
            user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
            email VARCHAR(320) NOT NULL,
            role VARCHAR(20) NOT NULL DEFAULT 'contributor' CHECK (role IN ('owner', 'contributor')),
            status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted')),
            invite_token VARCHAR(64) NOT NULL UNIQUE,
            invited_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            invited_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            accepted_at TIMESTAMP
          )
        `);
        await db.query(
          `ALTER TABLE appointments
             ADD COLUMN IF NOT EXISTS assigned_collaborator_id INTEGER REFERENCES care_collaborators(id) ON DELETE SET NULL`
        );
        await db.query(
          `ALTER TABLE bills
             ADD COLUMN IF NOT EXISTS assigned_collaborator_id INTEGER REFERENCES care_collaborators(id) ON DELETE SET NULL`
        );
        await db.query(
          `CREATE INDEX IF NOT EXISTS idx_collaborators_recipient_id ON care_collaborators(recipient_id)`
        );
        await db.query(
          `CREATE INDEX IF NOT EXISTS idx_collaborators_user_id ON care_collaborators(user_id)`
        );
        await db.query(
          `CREATE UNIQUE INDEX IF NOT EXISTS idx_collaborators_recipient_email ON care_collaborators(recipient_id, email)`
        );
      } catch (error) {
        console.error('Failed to ensure collaborator schema:', error);
      } finally {
        collaboratorSchemaEnsured = true;
      }
    })();
  }

  await collaboratorEnsurePromise;
}

let googleIntegrationSchemaEnsured = false;
let googleIntegrationEnsurePromise: Promise<void> | null = null;

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
             ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`
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

// Helper to generate random tokens
function generateToken(length: number = 32): string {
  return crypto.randomBytes(length).toString('hex');
}

// Helper to generate unique forwarding address
function generateForwardingAddress(userId: number): string {
  const randomPart = crypto.randomBytes(8).toString('hex');
  return `user-${userId}-${randomPart}@${process.env.INBOUND_EMAIL_DOMAIN}`;
}

const GOOGLE_SYNC_PROJECTION = `
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

// Database row types (snake_case from database)
interface UserRow {
  id: number;
  email: string;
  google_id: string;
  forwarding_address: string;
  plan_secret: string;
  plan_version: number;
  plan_updated_at: Date;
  created_at: Date;
}

interface RecipientRow {
  id: number;
  user_id: number;
  display_name: string;
  created_at: Date;
}

interface SourceRow {
  id: number;
  recipient_id: number;
  kind: SourceKind;
  external_id: string | null;
  sender: string | null;
  subject: string | null;
  short_excerpt: string | null;
  storage_key: string | null;
  created_at: Date;
}

interface ItemRow {
  id: number;
  recipient_id: number;
  source_id: number;
  detected_type: ItemType;
  confidence: number;
  created_at: Date;
}

interface AppointmentRow {
  id: number;
  item_id: number;
  start_local: Date;
  end_local: Date;
  location: string | null;
  prep_note: string | null;
  summary: string;
  ics_token: string;
  assigned_collaborator_id: number | null;
  created_at: Date;
  google_sync_id?: number | null;
  google_calendar_id?: string | null;
  google_event_id?: string | null;
  google_etag?: string | null;
  google_last_synced_at?: Date | null;
  google_last_sync_direction?: GoogleSyncDirection | null;
  google_local_hash?: string | null;
  google_remote_updated_at?: Date | null;
  google_sync_status?: GoogleSyncStatus | null;
  google_last_error?: string | null;
}

interface BillRow {
  id: number;
  item_id: number;
  statement_date: Date | null;
  amount: string | null; // Numeric from DB comes as string
  due_date: Date | null;
  pay_url: string | null;
  status: BillStatus;
  task_key: string;
  assigned_collaborator_id: number | null;
  created_at: Date;
  google_sync_id?: number | null;
  google_calendar_id?: string | null;
  google_event_id?: string | null;
  google_etag?: string | null;
  google_last_synced_at?: Date | null;
  google_last_sync_direction?: GoogleSyncDirection | null;
  google_local_hash?: string | null;
  google_remote_updated_at?: Date | null;
  google_sync_status?: GoogleSyncStatus | null;
  google_last_error?: string | null;
}

interface CollaboratorRow {
  id: number;
  recipient_id: number;
  user_id: number | null;
  email: string;
  role: CollaboratorRole;
  status: CollaboratorStatus;
  invite_token: string;
  invited_by: number;
  invited_at: Date;
  accepted_at: Date | null;
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
  created_at: Date;
  updated_at: Date;
}

// Converters from DB rows to shared types
function userRowToUser(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    googleId: row.google_id,
    forwardingAddress: row.forwarding_address,
    planSecret: row.plan_secret,
    planVersion: row.plan_version ?? 0,
    planUpdatedAt: row.plan_updated_at,
    createdAt: row.created_at
  };
}

function recipientRowToRecipient(row: RecipientRow): Recipient {
  return {
    id: row.id,
    userId: row.user_id,
    displayName: row.display_name,
    createdAt: row.created_at
  };
}

function sourceRowToSource(row: SourceRow): Source {
  return {
    id: row.id,
    recipientId: row.recipient_id,
    kind: row.kind,
    externalId: row.external_id,
    sender: row.sender,
    subject: row.subject,
    shortExcerpt: row.short_excerpt,
    storageKey: row.storage_key,
    createdAt: row.created_at
  };
}

function itemRowToItem(row: ItemRow): Item {
  return {
    id: row.id,
    recipientId: row.recipient_id,
    sourceId: row.source_id,
    detectedType: row.detected_type,
    confidence: row.confidence,
    createdAt: row.created_at
  };
}

function projectGoogleSyncMetadata(
  row:
    | (Partial<AppointmentRow> & { google_sync_id?: number | null })
    | (Partial<BillRow> & { google_sync_id?: number | null })
): GoogleSyncMetadata | null {
  const hasProjection =
    Object.prototype.hasOwnProperty.call(row, 'google_sync_id') ||
    Object.prototype.hasOwnProperty.call(row, 'google_event_id') ||
    Object.prototype.hasOwnProperty.call(row, 'google_calendar_id');

  if (!hasProjection) {
    return null;
  }

  const syncStatus: GoogleSyncStatus = row.google_sync_status ?? 'idle';

  const anyValuePresent =
    row.google_sync_id !== undefined ||
    row.google_event_id !== undefined ||
    row.google_calendar_id !== undefined ||
    row.google_etag !== undefined ||
    row.google_last_synced_at !== undefined ||
    row.google_last_sync_direction !== undefined ||
    row.google_local_hash !== undefined ||
    row.google_remote_updated_at !== undefined;

  if (!anyValuePresent) {
    return null;
  }

  return {
    calendarId: row.google_calendar_id ?? null,
    eventId: row.google_event_id ?? null,
    etag: row.google_etag ?? null,
    lastSyncedAt: row.google_last_synced_at ?? null,
    lastSyncDirection: row.google_last_sync_direction ?? null,
    localHash: row.google_local_hash ?? null,
    remoteUpdatedAt: row.google_remote_updated_at ?? null,
    syncStatus,
    lastError: row.google_last_error ?? null
  };
}

function appointmentRowToAppointment(row: AppointmentRow): Appointment {
  return {
    id: row.id,
    itemId: row.item_id,
    startLocal: row.start_local,
    endLocal: row.end_local,
    location: row.location,
    prepNote: row.prep_note,
    summary: row.summary,
    icsToken: row.ics_token,
    assignedCollaboratorId: row.assigned_collaborator_id ?? null,
    createdAt: row.created_at,
    googleSync: projectGoogleSyncMetadata(row)
  };
}

function billRowToBill(row: BillRow): Bill {
  return {
    id: row.id,
    itemId: row.item_id,
    statementDate: row.statement_date,
    amount: row.amount ? parseFloat(row.amount) : null,
    dueDate: row.due_date,
    payUrl: row.pay_url,
    status: row.status,
    taskKey: row.task_key,
    assignedCollaboratorId: row.assigned_collaborator_id ?? null,
    createdAt: row.created_at,
    googleSync: projectGoogleSyncMetadata(row)
  };
}

function collaboratorRowToCollaborator(row: CollaboratorRow): Collaborator {
  return {
    id: row.id,
    recipientId: row.recipient_id,
    userId: row.user_id,
    email: row.email,
    role: row.role,
    status: row.status,
    inviteToken: row.invite_token,
    invitedBy: row.invited_by,
    invitedAt: row.invited_at,
    acceptedAt: row.accepted_at
  };
}

function sanitizePayUrl(url?: string | null): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  try {
    const cleaned = trimmed.replace(/[),.;]+$/g, '');
    const parsed = new URL(cleaned);
    if (parsed.protocol !== 'https:') {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

// ========== GOOGLE INTEGRATIONS ==========

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

function googleCredentialRowToCredential(row: GoogleCredentialRow): GoogleCredential {
  return {
    userId: row.user_id,
    accessToken: row.access_token,
    refreshToken: row.refresh_token,
    scope: row.scope ?? [],
    expiresAt: row.expires_at ?? null,
    tokenType: row.token_type ?? null,
    idToken: row.id_token ?? null,
    calendarId: row.calendar_id ?? null,
    syncToken: row.sync_token ?? null,
    lastPulledAt: row.last_pulled_at ?? null
  };
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
    syncStatus: row.sync_status ?? 'idle',
    lastError: row.last_error ?? null
  };
}

export async function getGoogleCredential(userId: number): Promise<GoogleCredential | null> {
  await ensureGoogleIntegrationSchema();
  const result = await db.query(
    `SELECT * FROM google_credentials WHERE user_id = $1 LIMIT 1`,
    [userId]
  );
  return result.rows[0] ? googleCredentialRowToCredential(result.rows[0] as GoogleCredentialRow) : null;
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
  }
): Promise<GoogleCredential> {
  await ensureGoogleIntegrationSchema();
  const result = await db.query(
    `INSERT INTO google_credentials (user_id, access_token, refresh_token, scope, expires_at, token_type, id_token, calendar_id, sync_token, last_pulled_at, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())
     ON CONFLICT (user_id)
     DO UPDATE SET
       access_token = EXCLUDED.access_token,
       refresh_token = EXCLUDED.refresh_token,
       scope = EXCLUDED.scope,
       expires_at = EXCLUDED.expires_at,
       token_type = EXCLUDED.token_type,
       id_token = EXCLUDED.id_token,
       sync_token = EXCLUDED.sync_token,
       last_pulled_at = EXCLUDED.last_pulled_at,
       calendar_id = EXCLUDED.calendar_id,
       updated_at = NOW()
     RETURNING *`,
    [
      userId,
      data.accessToken,
      data.refreshToken,
      data.scope,
      data.expiresAt,
      data.tokenType ?? null,
      data.idToken ?? null,
      data.calendarId ?? null,
      data.syncToken ?? null,
      data.lastPulledAt ?? null
    ]
  );
  return googleCredentialRowToCredential(result.rows[0] as GoogleCredentialRow);
}

export async function deleteGoogleCredential(userId: number): Promise<void> {
  await ensureGoogleIntegrationSchema();
  await db.query('DELETE FROM google_credentials WHERE user_id = $1', [userId]);
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

  const credential = await getGoogleCredential(ownerRow.user_id as number);
  if (!credential) {
    await deleteGoogleSyncLink(itemId);
    return null;
  }

  return upsertGoogleSyncLink(itemId, {
    syncStatus: 'pending',
    lastError: null,
    localHash: localHash ?? undefined
  });
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

async function hydrateAppointmentWithGoogleSync(appointment: Appointment): Promise<Appointment> {
  const googleSync = await getGoogleSyncMetadataForItem(appointment.itemId);
  return { ...appointment, googleSync };
}

async function hydrateBillWithGoogleSync(bill: Bill): Promise<Bill> {
  const googleSync = await getGoogleSyncMetadataForItem(bill.itemId);
  return { ...bill, googleSync };
}

export async function queueGoogleSyncForUser(userId: number, calendarId?: string | null): Promise<void> {
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
     WHERE r.user_id = $1
     ON CONFLICT (item_id)
     DO UPDATE SET
       calendar_id = COALESCE(EXCLUDED.calendar_id, google_sync_links.calendar_id),
       sync_status = 'pending',
       last_error = NULL,
       updated_at = NOW()`,
    [userId, calendarId ?? null]
  );
}

// ========== COLLABORATORS ==========

export async function ensureOwnerCollaborator(recipientId: number, user: User): Promise<Collaborator> {
  await ensureCollaboratorSchema();
  const existing = await db.query(
    `SELECT * FROM care_collaborators WHERE recipient_id = $1 AND user_id = $2 LIMIT 1`,
    [recipientId, user.id]
  );

  if (existing.rows[0]) {
    return collaboratorRowToCollaborator(existing.rows[0] as CollaboratorRow);
  }

  const token = generateToken(16);
  const result = await db.query(
    `INSERT INTO care_collaborators (recipient_id, user_id, email, role, status, invite_token, invited_by, invited_at, accepted_at)
     VALUES ($1, $2, $3, 'owner', 'accepted', $4, $2, NOW(), NOW())
     RETURNING *`,
    [recipientId, user.id, user.email, token]
  );

  return collaboratorRowToCollaborator(result.rows[0] as CollaboratorRow);
}

export async function createCollaboratorInvite(
  recipientId: number,
  invitedByUserId: number,
  email: string,
  role: CollaboratorRole = 'contributor'
): Promise<{ collaborator: Collaborator; created: boolean; resent: boolean }> {
  await ensureCollaboratorSchema();
  const normalizedEmail = email.trim().toLowerCase();
  const existing = await db.query(
    `SELECT * FROM care_collaborators WHERE recipient_id = $1 AND email = $2 LIMIT 1`,
    [recipientId, normalizedEmail]
  );
  if (existing.rows[0]) {
    const row = existing.rows[0] as CollaboratorRow;
    if (row.status === 'pending') {
      const newToken = generateToken(16);
      const refreshed = await db.query(
        `UPDATE care_collaborators
         SET invite_token = $1,
             invited_at = NOW(),
             invited_by = $2
         WHERE id = $3
         RETURNING *`,
        [newToken, invitedByUserId, row.id]
      );
      return {
        collaborator: collaboratorRowToCollaborator(refreshed.rows[0] as CollaboratorRow),
        created: false,
        resent: true,
      };
    }

    return {
      collaborator: collaboratorRowToCollaborator(row),
      created: false,
      resent: false,
    };
  }

  const token = generateToken(16);
  const result = await db.query(
    `INSERT INTO care_collaborators (recipient_id, email, role, status, invite_token, invited_by)
     VALUES ($1, $2, $3, 'pending', $4, $5)
     RETURNING *`,
    [recipientId, normalizedEmail, role, token, invitedByUserId]
  );

  return {
    collaborator: collaboratorRowToCollaborator(result.rows[0] as CollaboratorRow),
    created: true,
    resent: false,
  };
}

export async function listCollaborators(recipientId: number): Promise<Collaborator[]> {
  await ensureCollaboratorSchema();
  const result = await db.query(
    `SELECT * FROM care_collaborators WHERE recipient_id = $1 ORDER BY role DESC, invited_at ASC`,
    [recipientId]
  );
  return result.rows.map((row) => collaboratorRowToCollaborator(row as CollaboratorRow));
}

export async function acceptCollaboratorInvite(token: string, user: User): Promise<Collaborator | null> {
  await ensureCollaboratorSchema();
  const normalizedToken = token.trim();
  const result = await db.query(
    `UPDATE care_collaborators
     SET status = 'accepted', accepted_at = NOW(), user_id = $2
     WHERE invite_token = $1
     RETURNING *`,
    [normalizedToken, user.id]
  );

  if (result.rows.length === 0) {
    return null;
  }

  return collaboratorRowToCollaborator(result.rows[0] as CollaboratorRow);
}

export async function findRecipientForCollaborator(userId: number): Promise<Recipient | undefined> {
  await ensureCollaboratorSchema();
  const result = await db.query(
    `SELECT r.*
     FROM care_collaborators c
     JOIN recipients r ON r.id = c.recipient_id
     WHERE c.user_id = $1 AND c.status = 'accepted'
     ORDER BY c.accepted_at DESC
     LIMIT 1`,
    [userId]
  );

  return result.rows[0] ? recipientRowToRecipient(result.rows[0] as RecipientRow) : undefined;
}

export async function findCollaboratorById(id: number): Promise<Collaborator | undefined> {
  await ensureCollaboratorSchema();
  const result = await db.query('SELECT * FROM care_collaborators WHERE id = $1', [id]);
  return result.rows[0] ? collaboratorRowToCollaborator(result.rows[0] as CollaboratorRow) : undefined;
}

export async function findCollaboratorForRecipient(
  recipientId: number,
  collaboratorId: number
): Promise<Collaborator | undefined> {
  await ensureCollaboratorSchema();
  const result = await db.query(
    `SELECT * FROM care_collaborators WHERE recipient_id = $1 AND id = $2 AND status = 'accepted'`,
    [recipientId, collaboratorId]
  );
  return result.rows[0] ? collaboratorRowToCollaborator(result.rows[0] as CollaboratorRow) : undefined;
}

export async function resolveRecipientContextForUser(
  user: User
): Promise<{ recipient: Recipient; role: 'owner' | 'contributor' } | null> {
  const ownedRecipients = await findRecipientsByUserId(user.id);
  if (ownedRecipients.length > 0) {
    const recipient = ownedRecipients[0];
    await ensureOwnerCollaborator(recipient.id, user);
    return { recipient, role: 'owner' };
  }

  const collaboratorRecipient = await findRecipientForCollaborator(user.id);
  if (!collaboratorRecipient) {
    return null;
  }
  return { recipient: collaboratorRecipient, role: 'contributor' };
}

export async function hasCollaboratorInviteForEmail(email: string): Promise<boolean> {
  await ensureCollaboratorSchema();
  const normalizedEmail = email.trim().toLowerCase();
  const result = await db.query(
    `SELECT 1
     FROM care_collaborators
     WHERE email = $1
       AND status IN ('pending', 'accepted')
     LIMIT 1`,
    [normalizedEmail]
  );
  return result.rows.length > 0;
}

export async function findCollaboratorByToken(token: string): Promise<Collaborator | undefined> {
  await ensureCollaboratorSchema();
  const result = await db.query(
    `SELECT * FROM care_collaborators WHERE invite_token = $1 LIMIT 1`,
    [token]
  );
  return result.rows[0] ? collaboratorRowToCollaborator(result.rows[0] as CollaboratorRow) : undefined;
}

export async function listGoogleConnectedUserIds(): Promise<number[]> {
  await ensureGoogleIntegrationSchema();
  const result = await db.query('SELECT user_id FROM google_credentials');
  return result.rows.map((row) => Number(row.user_id)).filter((id) => Number.isFinite(id));
}

async function touchPlanForItem(itemId: number): Promise<void> {
  await ensurePlanVersionColumns();
  const result = await db.query(
    `UPDATE users u
     SET plan_version = COALESCE(u.plan_version, 0) + 1,
         plan_updated_at = NOW()
    FROM recipients r
    JOIN items i ON i.recipient_id = r.id
     WHERE i.id = $1
       AND r.user_id = u.id
     RETURNING u.id`,
    [itemId]
  );
  const userRow = result.rows[0];
  if (userRow?.id) {
    const realtime = getRealtimeEmitter();
    realtime?.emitPlanUpdate(userRow.id as number);
    await scheduleGoogleSync(userRow.id as number);
  }
}

export const __testTouchPlanForItem = touchPlanForItem;

export async function touchPlanForUser(userId: number): Promise<void> {
  await ensurePlanVersionColumns();
  const result = await db.query(
    `UPDATE users
     SET plan_version = COALESCE(plan_version, 0) + 1,
         plan_updated_at = NOW()
     WHERE id = $1`,
    [userId]
  );
  if (result.rowCount === 0) {
    return;
  }
  const realtime = getRealtimeEmitter();
  realtime?.emitPlanUpdate(userId);
  await scheduleGoogleSync(userId);
}

export async function getPlanVersion(userId: number): Promise<{ planVersion: number; planUpdatedAt: Date | null }> {
  await ensurePlanVersionColumns();
  const result = await db.query(
    'SELECT plan_version, plan_updated_at FROM users WHERE id = $1',
    [userId]
  );

  if (result.rows.length === 0) {
    return { planVersion: 0, planUpdatedAt: null };
  }

  const row = result.rows[0];
  return {
    planVersion: row.plan_version ?? 0,
    planUpdatedAt: row.plan_updated_at ?? null
  };
}

// ========== USERS ==========

export async function createUser(email: string, googleId: string): Promise<User> {
  const planSecret = generateToken(32);
  const result = await db.query(
    `INSERT INTO users (email, google_id, forwarding_address, plan_secret)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [email, googleId, 'temp', planSecret] // Will update forwarding address after we have the ID
  );

  const user = userRowToUser(result.rows[0]);

  // Update with proper forwarding address
  const forwardingAddress = generateForwardingAddress(user.id);
  await db.query(
    'UPDATE users SET forwarding_address = $1 WHERE id = $2',
    [forwardingAddress, user.id]
  );

  user.forwardingAddress = forwardingAddress;
  return user;
}

export async function findUserByGoogleId(googleId: string): Promise<User | undefined> {
  const result = await db.query('SELECT * FROM users WHERE google_id = $1', [googleId]);
  return result.rows[0] ? userRowToUser(result.rows[0]) : undefined;
}

export async function findUserByEmail(email: string): Promise<User | undefined> {
  const result = await db.query('SELECT * FROM users WHERE email = $1', [email]);
  return result.rows[0] ? userRowToUser(result.rows[0]) : undefined;
}

export async function findUserById(id: number): Promise<User | undefined> {
  const result = await db.query('SELECT * FROM users WHERE id = $1', [id]);
  return result.rows[0] ? userRowToUser(result.rows[0]) : undefined;
}

export async function deleteUser(userId: number): Promise<void> {
  // Cascade will handle all related records
  await db.query('DELETE FROM users WHERE id = $1', [userId]);
}

// ========== RECIPIENTS ==========

export async function createRecipient(userId: number, displayName: string): Promise<Recipient> {
  const result = await db.query(
    'INSERT INTO recipients (user_id, display_name) VALUES ($1, $2) RETURNING *',
    [userId, displayName]
  );
  return recipientRowToRecipient(result.rows[0]);
}

export async function findRecipientsByUserId(userId: number): Promise<Recipient[]> {
  const result = await db.query('SELECT * FROM recipients WHERE user_id = $1', [userId]);
  return result.rows.map(recipientRowToRecipient);
}

export async function findRecipientById(id: number): Promise<Recipient | undefined> {
  const result = await db.query('SELECT * FROM recipients WHERE id = $1', [id]);
  return result.rows[0] ? recipientRowToRecipient(result.rows[0]) : undefined;
}

// ========== SOURCES ==========

interface CreateSourceData {
  externalId?: string | null;
  sender?: string | null;
  subject?: string | null;
  shortExcerpt?: string | null;
  storageKey?: string | null;
}

export async function createSource(recipientId: number, kind: SourceKind, data: CreateSourceData): Promise<Source> {
  const { externalId, sender, subject, shortExcerpt, storageKey } = data;
  const result = await db.query(
    `INSERT INTO sources (recipient_id, kind, external_id, sender, subject, short_excerpt, storage_key)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [recipientId, kind, externalId, sender, subject, shortExcerpt, storageKey]
  );
  return sourceRowToSource(result.rows[0]);
}

export async function findSourceById(id: number): Promise<Source | undefined> {
  const result = await db.query('SELECT * FROM sources WHERE id = $1', [id]);
  return result.rows[0] ? sourceRowToSource(result.rows[0]) : undefined;
}

// ========== ITEMS ==========

export async function createItem(recipientId: number, sourceId: number, detectedType: ItemType, confidence: number): Promise<Item> {
  const result = await db.query(
    `INSERT INTO items (recipient_id, source_id, detected_type, confidence)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [recipientId, sourceId, detectedType, confidence]
  );
  return itemRowToItem(result.rows[0]);
}

export async function findItemsByRecipientId(recipientId: number): Promise<Item[]> {
  const result = await db.query('SELECT * FROM items WHERE recipient_id = $1', [recipientId]);
  return result.rows.map(itemRowToItem);
}

// ========== APPOINTMENTS ==========

export async function createAppointment(itemId: number, data: AppointmentCreateRequest): Promise<Appointment> {
  const { startLocal, endLocal, location, prepNote, summary } = data;
  const icsToken = generateToken(32);

  const result = await db.query(
    `INSERT INTO appointments (item_id, start_local, end_local, location, prep_note, summary, ics_token)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [itemId, startLocal, endLocal, location, prepNote, summary, icsToken]
  );
  const appointment = appointmentRowToAppointment(result.rows[0]);
  await touchPlanForItem(appointment.itemId);
  return hydrateAppointmentWithGoogleSync(appointment);
}

export async function findAppointmentByIcsToken(icsToken: string): Promise<Appointment | undefined> {
  await ensureGoogleIntegrationSchema();
  const result = await db.query(
    `SELECT a.*, ${GOOGLE_SYNC_PROJECTION}
     FROM appointments a
     LEFT JOIN google_sync_links gsl ON gsl.item_id = a.item_id
     WHERE a.ics_token = $1`,
    [icsToken]
  );
  return result.rows[0] ? appointmentRowToAppointment(result.rows[0]) : undefined;
}

export async function getUpcomingAppointments(recipientId: number, startDate: Date, endDate: Date): Promise<Appointment[]> {
  await ensureGoogleIntegrationSchema();
  const result = await db.query(
    `SELECT a.*, ${GOOGLE_SYNC_PROJECTION}
     FROM appointments a
     JOIN items i ON a.item_id = i.id
     LEFT JOIN google_sync_links gsl ON gsl.item_id = a.item_id
     WHERE i.recipient_id = $1
       AND a.start_local >= $2
       AND a.start_local < $3
     ORDER BY a.start_local ASC`,
    [recipientId, startDate, endDate]
  );
  return result.rows.map(appointmentRowToAppointment);
}

export async function updateAppointment(id: number, userId: number, data: AppointmentUpdateRequest): Promise<Appointment> {
  await ensureCollaboratorSchema();
  const { startLocal, endLocal, location, prepNote, summary, assignedCollaboratorId } = data;
  const result = await db.query(
    `UPDATE appointments AS a
     SET start_local = $1, end_local = $2, location = $3, prep_note = $4, summary = $5,
         assigned_collaborator_id = $6
     FROM items i
     JOIN recipients r ON i.recipient_id = r.id
     WHERE a.id = $7
       AND a.item_id = i.id
       AND r.user_id = $8
     RETURNING a.*`,
    [startLocal, endLocal, location, prepNote, summary, assignedCollaboratorId ?? null, id, userId]
  );
  if (result.rows.length === 0) {
    throw new Error('Appointment not found');
  }
  const appointment = appointmentRowToAppointment(result.rows[0]);
  await touchPlanForItem(appointment.itemId);
  return hydrateAppointmentWithGoogleSync(appointment);
}

export async function updateAppointmentForRecipient(
  id: number,
  recipientId: number,
  data: AppointmentUpdateRequest
): Promise<Appointment> {
  await ensureCollaboratorSchema();
  const { startLocal, endLocal, location, prepNote, summary, assignedCollaboratorId } = data;
  const result = await db.query(
    `UPDATE appointments AS a
     SET start_local = $1, end_local = $2, location = $3, prep_note = $4, summary = $5,
         assigned_collaborator_id = $6
     FROM items i
     WHERE a.id = $7
       AND a.item_id = i.id
       AND i.recipient_id = $8
     RETURNING a.*`,
    [startLocal, endLocal, location, prepNote, summary, assignedCollaboratorId ?? null, id, recipientId]
  );
  if (result.rows.length === 0) {
    throw new Error('Appointment not found');
  }
  const appointment = appointmentRowToAppointment(result.rows[0]);
  await touchPlanForItem(appointment.itemId);
  return hydrateAppointmentWithGoogleSync(appointment);
}

export async function getAppointmentById(id: number, userId: number): Promise<Appointment | undefined> {
  await ensureGoogleIntegrationSchema();
  const result = await db.query(
    `SELECT a.*, ${GOOGLE_SYNC_PROJECTION}
     FROM appointments a
     JOIN items i ON a.item_id = i.id
     JOIN recipients r ON i.recipient_id = r.id
     LEFT JOIN google_sync_links gsl ON gsl.item_id = a.item_id
     WHERE a.id = $1 AND r.user_id = $2`,
    [id, userId]
  );
  return result.rows[0] ? appointmentRowToAppointment(result.rows[0]) : undefined;
}

export async function getAppointmentByIdForRecipient(id: number, recipientId: number): Promise<Appointment | undefined> {
  await ensureGoogleIntegrationSchema();
  const result = await db.query(
    `SELECT a.*, ${GOOGLE_SYNC_PROJECTION}
     FROM appointments a
     JOIN items i ON a.item_id = i.id
     LEFT JOIN google_sync_links gsl ON gsl.item_id = a.item_id
     WHERE a.id = $1 AND i.recipient_id = $2`,
    [id, recipientId]
  );
  return result.rows[0] ? appointmentRowToAppointment(result.rows[0]) : undefined;
}

export async function getAppointmentByItemId(itemId: number): Promise<Appointment | undefined> {
  await ensureGoogleIntegrationSchema();
  const result = await db.query(
    `SELECT a.*, ${GOOGLE_SYNC_PROJECTION}
     FROM appointments a
     LEFT JOIN google_sync_links gsl ON gsl.item_id = a.item_id
     WHERE a.item_id = $1
     LIMIT 1`,
    [itemId]
  );
  return result.rows[0] ? appointmentRowToAppointment(result.rows[0]) : undefined;
}

export async function deleteAppointment(id: number, userId: number): Promise<void> {
  const result = await db.query(
    `DELETE FROM appointments a
     USING items i
     JOIN recipients r ON i.recipient_id = r.id
     WHERE a.id = $1
       AND a.item_id = i.id
       AND r.user_id = $2
     RETURNING a.item_id`,
    [id, userId]
  );
  if (result.rowCount === 0) {
    throw new Error('Appointment not found');
  }
  await touchPlanForItem(result.rows[0].item_id);
}

// ========== BILLS ==========

export async function createBill(itemId: number, data: BillCreateRequest): Promise<Bill> {
  const { statementDate, amount, dueDate, payUrl, status } = data;
  const taskKey = generateToken(16);
  const sanitizedPayUrl = sanitizePayUrl(payUrl);

  const result = await db.query(
    `INSERT INTO bills (item_id, statement_date, amount, due_date, pay_url, status, task_key)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [itemId, statementDate, amount, dueDate, sanitizedPayUrl, status || 'todo', taskKey]
  );
  const bill = billRowToBill(result.rows[0]);
  await touchPlanForItem(bill.itemId);
  return hydrateBillWithGoogleSync(bill);
}

export async function updateBillStatus(id: number, userId: number, status: BillStatus): Promise<Bill> {
  const result = await db.query(
    `UPDATE bills AS b
     SET status = $1
     FROM items i
     JOIN recipients r ON i.recipient_id = r.id
     WHERE b.id = $2
       AND b.item_id = i.id
       AND r.user_id = $3
     RETURNING b.*`,
    [status, id, userId]
  );

  if (result.rows.length === 0) {
    throw new Error('Bill not found');
  }

  const bill = billRowToBill(result.rows[0]);
  await touchPlanForItem(bill.itemId);
  return hydrateBillWithGoogleSync(bill);
}

export async function updateBillStatusForRecipient(
  id: number,
  recipientId: number,
  status: BillStatus
): Promise<Bill> {
  const result = await db.query(
    `UPDATE bills AS b
     SET status = $1
     FROM items i
     WHERE b.id = $2
       AND b.item_id = i.id
       AND i.recipient_id = $3
     RETURNING b.*`,
    [status, id, recipientId]
  );

  if (result.rows.length === 0) {
    throw new Error('Bill not found');
  }

  const bill = billRowToBill(result.rows[0]);
  await touchPlanForItem(bill.itemId);
  return hydrateBillWithGoogleSync(bill);
}

export async function getUpcomingBills(recipientId: number, startDate: Date, endDate: Date): Promise<Bill[]> {
  await ensureGoogleIntegrationSchema();
  const result = await db.query(
    `SELECT b.*, ${GOOGLE_SYNC_PROJECTION}
     FROM bills b
     JOIN items i ON b.item_id = i.id
     LEFT JOIN google_sync_links gsl ON gsl.item_id = b.item_id
     WHERE i.recipient_id = $1
       AND (
         (b.due_date >= $2 AND b.due_date < $3)
         OR b.due_date IS NULL
         OR b.due_date < $2
       )
     ORDER BY b.due_date ASC NULLS LAST`,
    [recipientId, startDate, endDate]
  );
  return result.rows.map(billRowToBill);
}

export async function updateBill(id: number, userId: number, data: BillUpdateRequest): Promise<Bill> {
  await ensureCollaboratorSchema();
  const { statementDate, amount, dueDate, payUrl, status, assignedCollaboratorId } = data;
  const sanitizedPayUrl = sanitizePayUrl(payUrl);
  const result = await db.query(
    `UPDATE bills AS b
     SET statement_date = $1, amount = $2, due_date = $3, pay_url = $4, status = $5,
         assigned_collaborator_id = $6
     FROM items i
     JOIN recipients r ON i.recipient_id = r.id
     WHERE b.id = $7
       AND b.item_id = i.id
       AND r.user_id = $8
     RETURNING b.*`,
    [statementDate, amount, dueDate, sanitizedPayUrl, status, assignedCollaboratorId ?? null, id, userId]
  );
  if (result.rows.length === 0) {
    throw new Error('Bill not found');
  }
  const bill = billRowToBill(result.rows[0]);
  await touchPlanForItem(bill.itemId);
  return hydrateBillWithGoogleSync(bill);
}

export async function updateBillForRecipient(
  id: number,
  recipientId: number,
  data: BillUpdateRequest
): Promise<Bill> {
  await ensureCollaboratorSchema();
  const { statementDate, amount, dueDate, payUrl, status, assignedCollaboratorId } = data;
  const sanitizedPayUrl = sanitizePayUrl(payUrl);
  const result = await db.query(
    `UPDATE bills AS b
     SET statement_date = $1, amount = $2, due_date = $3, pay_url = $4, status = $5,
         assigned_collaborator_id = $6
     FROM items i
     WHERE b.id = $7
       AND b.item_id = i.id
       AND i.recipient_id = $8
     RETURNING b.*`,
    [statementDate, amount, dueDate, sanitizedPayUrl, status, assignedCollaboratorId ?? null, id, recipientId]
  );
  if (result.rows.length === 0) {
    throw new Error('Bill not found');
  }
  const bill = billRowToBill(result.rows[0]);
  await touchPlanForItem(bill.itemId);
  return hydrateBillWithGoogleSync(bill);
}

export async function getBillById(id: number, userId: number): Promise<Bill | undefined> {
  await ensureGoogleIntegrationSchema();
  const result = await db.query(
    `SELECT b.*, ${GOOGLE_SYNC_PROJECTION}
     FROM bills b
     JOIN items i ON b.item_id = i.id
     JOIN recipients r ON i.recipient_id = r.id
     LEFT JOIN google_sync_links gsl ON gsl.item_id = b.item_id
     WHERE b.id = $1 AND r.user_id = $2`,
    [id, userId]
  );
  return result.rows[0] ? billRowToBill(result.rows[0]) : undefined;
}

export async function getBillByIdForRecipient(id: number, recipientId: number): Promise<Bill | undefined> {
  await ensureGoogleIntegrationSchema();
  const result = await db.query(
    `SELECT b.*, ${GOOGLE_SYNC_PROJECTION}
     FROM bills b
     JOIN items i ON b.item_id = i.id
     LEFT JOIN google_sync_links gsl ON gsl.item_id = b.item_id
     WHERE b.id = $1 AND i.recipient_id = $2`,
    [id, recipientId]
  );
  return result.rows[0] ? billRowToBill(result.rows[0]) : undefined;
}

export async function getBillByItemId(itemId: number): Promise<Bill | undefined> {
  await ensureGoogleIntegrationSchema();
  const result = await db.query(
    `SELECT b.*, ${GOOGLE_SYNC_PROJECTION}
     FROM bills b
     LEFT JOIN google_sync_links gsl ON gsl.item_id = b.item_id
     WHERE b.item_id = $1
     LIMIT 1`,
    [itemId]
  );
  return result.rows[0] ? billRowToBill(result.rows[0]) : undefined;
}

export async function deleteBill(id: number, userId: number): Promise<void> {
  const result = await db.query(
    `DELETE FROM bills b
     USING items i
     JOIN recipients r ON i.recipient_id = r.id
     WHERE b.id = $1
       AND b.item_id = i.id
       AND r.user_id = $2
     RETURNING b.item_id`,
    [id, userId]
  );
  if (result.rowCount === 0) {
    throw new Error('Bill not found');
  }
  await touchPlanForItem(result.rows[0].item_id);
}

// ========== AUDIT ==========

export async function createAuditLog(itemId: number | null, action: string, meta: Record<string, any>): Promise<any> {
  const result = await db.query(
    'INSERT INTO audit (item_id, action, meta) VALUES ($1, $2, $3) RETURNING *',
    [itemId, action, JSON.stringify(meta)]
  );
  return result.rows[0];
}

interface LowConfidenceItemRow extends ItemRow {
  sender: string | null;
  subject: string | null;
  short_excerpt: string | null;
}

export async function getLowConfidenceItems(limit: number = 50): Promise<LowConfidenceItemRow[]> {
  const result = await db.query(
    `SELECT DISTINCT i.*, s.sender, s.subject, s.short_excerpt
     FROM items i
     JOIN sources s ON i.source_id = s.id
     WHERE i.confidence < 0.7
     ORDER BY i.created_at DESC
     LIMIT $1`,
    [limit]
  );
  return result.rows;
}

export async function reclassifyItem(itemId: number, newType: ItemType): Promise<boolean> {
  // Update item's detected_type and set confidence to 1.0 (manually reviewed)
  await db.query(
    'UPDATE items SET detected_type = $1, confidence = 1.0 WHERE id = $2',
    [newType, itemId]
  );

  // Delete existing appointment or bill (if any)
  await db.query('DELETE FROM appointments WHERE item_id = $1', [itemId]);
  await db.query('DELETE FROM bills WHERE item_id = $1', [itemId]);

  return true;
}

export async function findItemById(id: number): Promise<Item | undefined> {
  const result = await db.query('SELECT * FROM items WHERE id = $1', [id]);
  return result.rows[0] ? itemRowToItem(result.rows[0]) : undefined;
}
