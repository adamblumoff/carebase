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
  BillUpdateRequest
} from '@carebase/shared';

let planVersionColumnsEnsured = false;
let planVersionEnsurePromise: Promise<void> | null = null;

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

// Helper to generate random tokens
function generateToken(length: number = 32): string {
  return crypto.randomBytes(length).toString('hex');
}

// Helper to generate unique forwarding address
function generateForwardingAddress(userId: number): string {
  const randomPart = crypto.randomBytes(8).toString('hex');
  return `user-${userId}-${randomPart}@${process.env.INBOUND_EMAIL_DOMAIN}`;
}

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
  created_at: Date;
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
  created_at: Date;
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
    createdAt: row.created_at
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
    createdAt: row.created_at
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

async function touchPlanForItem(itemId: number): Promise<void> {
  await ensurePlanVersionColumns();
  await db.query(
    `UPDATE users u
     SET plan_version = COALESCE(u.plan_version, 0) + 1,
         plan_updated_at = NOW()
    FROM recipients r
     JOIN items i ON i.recipient_id = r.id
     WHERE i.id = $1
       AND r.user_id = u.id`,
    [itemId]
  );
}

export async function touchPlanForUser(userId: number): Promise<void> {
  await ensurePlanVersionColumns();
  await db.query(
    `UPDATE users
     SET plan_version = COALESCE(plan_version, 0) + 1,
         plan_updated_at = NOW()
     WHERE id = $1`,
    [userId]
  );
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
  return appointment;
}

export async function findAppointmentByIcsToken(icsToken: string): Promise<Appointment | undefined> {
  const result = await db.query('SELECT * FROM appointments WHERE ics_token = $1', [icsToken]);
  return result.rows[0] ? appointmentRowToAppointment(result.rows[0]) : undefined;
}

export async function getUpcomingAppointments(recipientId: number, startDate: Date, endDate: Date): Promise<Appointment[]> {
  const result = await db.query(
    `SELECT a.* FROM appointments a
     JOIN items i ON a.item_id = i.id
     WHERE i.recipient_id = $1
       AND a.start_local >= $2
       AND a.start_local < $3
     ORDER BY a.start_local ASC`,
    [recipientId, startDate, endDate]
  );
  return result.rows.map(appointmentRowToAppointment);
}

export async function updateAppointment(id: number, userId: number, data: AppointmentUpdateRequest): Promise<Appointment> {
  const { startLocal, endLocal, location, prepNote, summary } = data;
  const result = await db.query(
    `UPDATE appointments AS a
     SET start_local = $1, end_local = $2, location = $3, prep_note = $4, summary = $5
     FROM items i
     JOIN recipients r ON i.recipient_id = r.id
     WHERE a.id = $6
       AND a.item_id = i.id
       AND r.user_id = $7
     RETURNING a.*`,
    [startLocal, endLocal, location, prepNote, summary, id, userId]
  );
  if (result.rows.length === 0) {
    throw new Error('Appointment not found');
  }
  const appointment = appointmentRowToAppointment(result.rows[0]);
  await touchPlanForItem(appointment.itemId);
  return appointment;
}

export async function getAppointmentById(id: number, userId: number): Promise<Appointment | undefined> {
  const result = await db.query(
    `SELECT a.*
     FROM appointments a
     JOIN items i ON a.item_id = i.id
     JOIN recipients r ON i.recipient_id = r.id
     WHERE a.id = $1 AND r.user_id = $2`,
    [id, userId]
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
  return bill;
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
  return bill;
}

export async function getUpcomingBills(recipientId: number, startDate: Date, endDate: Date): Promise<Bill[]> {
  const result = await db.query(
    `SELECT b.* FROM bills b
     JOIN items i ON b.item_id = i.id
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
  const { statementDate, amount, dueDate, payUrl, status } = data;
  const sanitizedPayUrl = sanitizePayUrl(payUrl);
  const result = await db.query(
    `UPDATE bills AS b
     SET statement_date = $1, amount = $2, due_date = $3, pay_url = $4, status = $5
     FROM items i
     JOIN recipients r ON i.recipient_id = r.id
     WHERE b.id = $6
       AND b.item_id = i.id
       AND r.user_id = $7
     RETURNING b.*`,
    [statementDate, amount, dueDate, sanitizedPayUrl, status, id, userId]
  );
  if (result.rows.length === 0) {
    throw new Error('Bill not found');
  }
  const bill = billRowToBill(result.rows[0]);
  await touchPlanForItem(bill.itemId);
  return bill;
}

export async function getBillById(id: number, userId: number): Promise<Bill | undefined> {
  const result = await db.query(
    `SELECT b.*
     FROM bills b
     JOIN items i ON b.item_id = i.id
     JOIN recipients r ON i.recipient_id = r.id
     WHERE b.id = $1 AND r.user_id = $2`,
    [id, userId]
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
