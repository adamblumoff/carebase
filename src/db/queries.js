import db from './client.js';
import crypto from 'crypto';

// Helper to generate random tokens
function generateToken(length = 32) {
  return crypto.randomBytes(length).toString('hex');
}

// Helper to generate unique forwarding address
function generateForwardingAddress(userId) {
  const randomPart = crypto.randomBytes(8).toString('hex');
  return `user-${userId}-${randomPart}@${process.env.INBOUND_EMAIL_DOMAIN}`;
}

// ========== USERS ==========

export async function createUser(email, googleId) {
  const planSecret = generateToken(32);
  const result = await db.query(
    `INSERT INTO users (email, google_id, forwarding_address, plan_secret)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [email, googleId, 'temp', planSecret] // Will update forwarding address after we have the ID
  );

  const user = result.rows[0];

  // Update with proper forwarding address
  const forwardingAddress = generateForwardingAddress(user.id);
  await db.query(
    'UPDATE users SET forwarding_address = $1 WHERE id = $2',
    [forwardingAddress, user.id]
  );

  user.forwarding_address = forwardingAddress;
  return user;
}

export async function findUserByGoogleId(googleId) {
  const result = await db.query('SELECT * FROM users WHERE google_id = $1', [googleId]);
  return result.rows[0];
}

export async function findUserByEmail(email) {
  const result = await db.query('SELECT * FROM users WHERE email = $1', [email]);
  return result.rows[0];
}

export async function findUserById(id) {
  const result = await db.query('SELECT * FROM users WHERE id = $1', [id]);
  return result.rows[0];
}

export async function deleteUser(userId) {
  // Cascade will handle all related records
  await db.query('DELETE FROM users WHERE id = $1', [userId]);
}

// ========== RECIPIENTS ==========

export async function createRecipient(userId, displayName) {
  const result = await db.query(
    'INSERT INTO recipients (user_id, display_name) VALUES ($1, $2) RETURNING *',
    [userId, displayName]
  );
  return result.rows[0];
}

export async function findRecipientsByUserId(userId) {
  const result = await db.query('SELECT * FROM recipients WHERE user_id = $1', [userId]);
  return result.rows;
}

export async function findRecipientById(id) {
  const result = await db.query('SELECT * FROM recipients WHERE id = $1', [id]);
  return result.rows[0];
}

// ========== SOURCES ==========

export async function createSource(recipientId, kind, data) {
  const { externalId, sender, subject, shortExcerpt, storageKey } = data;
  const result = await db.query(
    `INSERT INTO sources (recipient_id, kind, external_id, sender, subject, short_excerpt, storage_key)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [recipientId, kind, externalId, sender, subject, shortExcerpt, storageKey]
  );
  return result.rows[0];
}

export async function findSourceById(id) {
  const result = await db.query('SELECT * FROM sources WHERE id = $1', [id]);
  return result.rows[0];
}

// ========== ITEMS ==========

export async function createItem(recipientId, sourceId, detectedType, confidence) {
  const result = await db.query(
    `INSERT INTO items (recipient_id, source_id, detected_type, confidence)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [recipientId, sourceId, detectedType, confidence]
  );
  return result.rows[0];
}

export async function findItemsByRecipientId(recipientId) {
  const result = await db.query('SELECT * FROM items WHERE recipient_id = $1', [recipientId]);
  return result.rows;
}

// ========== APPOINTMENTS ==========

export async function createAppointment(itemId, data) {
  const { startLocal, endLocal, location, prepNote, summary } = data;
  const icsToken = generateToken(32);

  const result = await db.query(
    `INSERT INTO appointments (item_id, start_local, end_local, location, prep_note, summary, ics_token)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [itemId, startLocal, endLocal, location, prepNote, summary, icsToken]
  );
  return result.rows[0];
}

export async function findAppointmentByIcsToken(icsToken) {
  const result = await db.query('SELECT * FROM appointments WHERE ics_token = $1', [icsToken]);
  return result.rows[0];
}

export async function getUpcomingAppointments(recipientId, startDate, endDate) {
  const result = await db.query(
    `SELECT a.* FROM appointments a
     JOIN items i ON a.item_id = i.id
     WHERE i.recipient_id = $1
       AND a.start_local >= $2
       AND a.start_local < $3
     ORDER BY a.start_local ASC`,
    [recipientId, startDate, endDate]
  );
  return result.rows;
}

// ========== BILLS ==========

export async function createBill(itemId, data) {
  const { statementDate, amountCents, dueDate, payUrl, status } = data;
  const taskKey = generateToken(16);

  const result = await db.query(
    `INSERT INTO bills (item_id, statement_date, amount_cents, due_date, pay_url, status, task_key)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [itemId, statementDate, amountCents, dueDate, payUrl, status || 'todo', taskKey]
  );
  return result.rows[0];
}

export async function updateBillStatus(id, status) {
  const result = await db.query(
    'UPDATE bills SET status = $1 WHERE id = $2 RETURNING *',
    [status, id]
  );
  return result.rows[0];
}

export async function getUpcomingBills(recipientId, startDate, endDate) {
  const result = await db.query(
    `SELECT b.* FROM bills b
     JOIN items i ON b.item_id = i.id
     WHERE i.recipient_id = $1
       AND (b.due_date >= $2 AND b.due_date < $3 OR b.due_date IS NULL)
       AND b.status != 'ignore'
     ORDER BY b.due_date ASC NULLS LAST`,
    [recipientId, startDate, endDate]
  );
  return result.rows;
}

// ========== AUDIT ==========

export async function createAuditLog(itemId, action, meta) {
  const result = await db.query(
    'INSERT INTO audit (item_id, action, meta) VALUES ($1, $2, $3) RETURNING *',
    [itemId, action, JSON.stringify(meta)]
  );
  return result.rows[0];
}

export async function getLowConfidenceItems(limit = 50) {
  const result = await db.query(
    `SELECT i.*, s.sender, s.subject, a.meta
     FROM items i
     JOIN sources s ON i.source_id = s.id
     LEFT JOIN audit a ON i.id = a.item_id
     WHERE i.confidence < 0.7
     ORDER BY i.created_at DESC
     LIMIT $1`,
    [limit]
  );
  return result.rows;
}
