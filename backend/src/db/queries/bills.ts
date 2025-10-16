import type { Bill, BillCreateRequest, BillStatus, BillUpdateRequest } from '@carebase/shared';
import { db } from './shared.js';
import { generateToken } from './shared.js';
import { ensureCollaboratorSchema } from './collaborators.js';
import {
  GOOGLE_SYNC_PROJECTION,
  ensureGoogleIntegrationSchema,
  hydrateBillWithGoogleSync,
  projectGoogleSyncMetadata
} from './google.js';
import { touchPlanForItem } from './plan.js';

interface BillRow {
  id: number;
  item_id: number;
  statement_date: Date | null;
  amount: string | null;
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
  google_last_sync_direction?: string | null;
  google_local_hash?: string | null;
  google_remote_updated_at?: Date | null;
  google_sync_status?: string | null;
  google_last_error?: string | null;
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

export function billRowToBill(row: BillRow): Bill {
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

export async function createBill(itemId: number, data: BillCreateRequest): Promise<Bill> {
  const { statementDate, amount, dueDate, payUrl, status } = data;
  const taskKey = generateToken(16);
  const sanitizedPayUrl = sanitizePayUrl(payUrl);

  const result = await db.query(
    `INSERT INTO bills (item_id, statement_date, amount, due_date, pay_url, status, task_key)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [itemId, statementDate, amount, dueDate, sanitizedPayUrl, status || 'todo', taskKey]
  );
  const bill = billRowToBill(result.rows[0] as BillRow);
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

  const bill = billRowToBill(result.rows[0] as BillRow);
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

  const bill = billRowToBill(result.rows[0] as BillRow);
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
  return result.rows.map((row) => billRowToBill(row as BillRow));
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
  const bill = billRowToBill(result.rows[0] as BillRow);
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
  const bill = billRowToBill(result.rows[0] as BillRow);
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
  return result.rows[0] ? billRowToBill(result.rows[0] as BillRow) : undefined;
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
  return result.rows[0] ? billRowToBill(result.rows[0] as BillRow) : undefined;
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
  return result.rows[0] ? billRowToBill(result.rows[0] as BillRow) : undefined;
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
  await touchPlanForItem(result.rows[0].item_id as number);
}
