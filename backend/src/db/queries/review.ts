import type { BillStatus, ItemType } from '@carebase/shared';
import { db } from './shared.js';
import { ensureCollaboratorSchema } from './collaborators.js';

let billDraftSchemaEnsured = false;
let billDraftEnsurePromise: Promise<void> | null = null;

async function ensureBillDraftSchema(): Promise<void> {
  if (billDraftSchemaEnsured) {
    return;
  }

  if (!billDraftEnsurePromise) {
    billDraftEnsurePromise = (async () => {
      try {
        await db.query(`
          CREATE TABLE IF NOT EXISTS bill_drafts (
            id SERIAL PRIMARY KEY,
            item_id INTEGER NOT NULL UNIQUE REFERENCES items(id) ON DELETE CASCADE,
            amount DECIMAL(10, 2),
            due_date DATE,
            statement_date DATE,
            pay_url TEXT,
            status VARCHAR(20) NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'overdue', 'paid')),
            notes TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          )
        `);
      } catch (error) {
        console.error('Failed to ensure bill_drafts schema:', error);
      } finally {
        billDraftSchemaEnsured = true;
      }
    })();
  }

  await billDraftEnsurePromise;
}

export interface BillDraftUpsertData {
  amount?: number | null;
  dueDate?: string | null;
  statementDate?: string | null;
  payUrl?: string | null;
  status?: BillStatus | null;
  notes?: string | null;
}

interface BillDraftRow {
  item_id: number;
  amount: string | null;
  due_date: Date | null;
  statement_date: Date | null;
  pay_url: string | null;
  status: BillStatus;
  notes: string | null;
  updated_at: Date;
}

export async function upsertBillDraft(itemId: number, data: BillDraftUpsertData): Promise<void> {
  await ensureBillDraftSchema();

  const { amount, dueDate, statementDate, payUrl, status, notes } = data;
  await db.query(
    `INSERT INTO bill_drafts (item_id, amount, due_date, statement_date, pay_url, status, notes, updated_at)
     VALUES ($1, $2, $3, $4, $5, COALESCE($6, 'todo'), $7, NOW())
     ON CONFLICT (item_id)
     DO UPDATE SET
       amount = EXCLUDED.amount,
       due_date = EXCLUDED.due_date,
       statement_date = EXCLUDED.statement_date,
       pay_url = EXCLUDED.pay_url,
       status = EXCLUDED.status,
       notes = EXCLUDED.notes,
       updated_at = NOW()`,
    [
      itemId,
      amount ?? null,
      dueDate ?? null,
      statementDate ?? null,
      payUrl ?? null,
      status ?? null,
      notes ?? null
    ]
  );
}

export async function deleteBillDraft(itemId: number): Promise<void> {
  await ensureBillDraftSchema();
  await db.query(`DELETE FROM bill_drafts WHERE item_id = $1`, [itemId]);
}

export async function getBillDraftByItemId(itemId: number): Promise<BillDraftRow | null> {
  await ensureBillDraftSchema();
  const result = await db.query(`SELECT * FROM bill_drafts WHERE item_id = $1 LIMIT 1`, [itemId]);
  return result.rows[0] ? (result.rows[0] as BillDraftRow) : null;
}

export interface PendingReviewRow {
  item_id: number;
  recipient_id: number;
  recipient_name: string;
  source_id: number;
  source_subject: string | null;
  source_sender: string | null;
  source_short_excerpt: string | null;
  source_storage_key: string | null;
  detected_type: ItemType;
  confidence: number;
  created_at: Date;
  draft_amount: string | null;
  draft_due_date: Date | null;
  draft_statement_date: Date | null;
  draft_pay_url: string | null;
  draft_status: BillStatus | null;
  draft_notes: string | null;
}

export async function listPendingReviewItemsForUser(userId: number): Promise<PendingReviewRow[]> {
  await ensureBillDraftSchema();
  await ensureCollaboratorSchema();

  const result = await db.query(
    `SELECT
       i.id AS item_id,
       r.id AS recipient_id,
       r.display_name AS recipient_name,
       s.id AS source_id,
       s.subject AS source_subject,
       s.sender AS source_sender,
       s.short_excerpt AS source_short_excerpt,
       s.storage_key AS source_storage_key,
       i.detected_type,
       i.confidence,
       i.created_at,
       d.amount AS draft_amount,
       d.due_date AS draft_due_date,
       d.statement_date AS draft_statement_date,
       d.pay_url AS draft_pay_url,
       d.status AS draft_status,
       d.notes AS draft_notes
     FROM items i
     JOIN recipients r ON r.id = i.recipient_id
     JOIN sources s ON s.id = i.source_id
     LEFT JOIN bill_drafts d ON d.item_id = i.id
     LEFT JOIN care_collaborators c
       ON c.recipient_id = r.id
      AND c.user_id = $1
      AND c.status = 'accepted'
     WHERE i.review_status = 'pending_review'
       AND (r.user_id = $1 OR c.user_id = $1)
     ORDER BY i.created_at DESC`,
    [userId]
  );

  return result.rows as PendingReviewRow[];
}

export async function getPendingReviewItemForUser(
  userId: number,
  itemId: number
): Promise<PendingReviewRow | null> {
  await ensureBillDraftSchema();
  await ensureCollaboratorSchema();

  const result = await db.query(
    `SELECT
       i.id AS item_id,
       r.id AS recipient_id,
       r.display_name AS recipient_name,
       s.id AS source_id,
       s.subject AS source_subject,
       s.sender AS source_sender,
       s.short_excerpt AS source_short_excerpt,
       s.storage_key AS source_storage_key,
       i.detected_type,
       i.confidence,
       i.created_at,
       d.amount AS draft_amount,
       d.due_date AS draft_due_date,
       d.statement_date AS draft_statement_date,
       d.pay_url AS draft_pay_url,
       d.status AS draft_status,
       d.notes AS draft_notes
     FROM items i
     JOIN recipients r ON r.id = i.recipient_id
     JOIN sources s ON s.id = i.source_id
     LEFT JOIN bill_drafts d ON d.item_id = i.id
     LEFT JOIN care_collaborators c
       ON c.recipient_id = r.id
      AND c.user_id = $1
      AND c.status = 'accepted'
     WHERE i.review_status = 'pending_review'
       AND i.id = $2
       AND (r.user_id = $1 OR c.user_id = $1)
     LIMIT 1`,
    [userId, itemId]
  );

  return result.rows[0] ? (result.rows[0] as PendingReviewRow) : null;
}

export async function updateItemReviewStatus(itemId: number, status: 'auto' | 'pending_review'): Promise<void> {
  await db.query(`UPDATE items SET review_status = $2 WHERE id = $1`, [itemId, status]);
}

