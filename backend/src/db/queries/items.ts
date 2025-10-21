import type { Item, ItemType, ItemReviewStatus } from '@carebase/shared';
import { db } from './shared.js';

interface ItemRow {
  id: number;
  recipient_id: number;
  source_id: number;
  detected_type: ItemType;
  confidence: number;
  review_status: ItemReviewStatus;
  created_at: Date;
}

export function itemRowToItem(row: ItemRow): Item {
  return {
    id: row.id,
    recipientId: row.recipient_id,
    sourceId: row.source_id,
    detectedType: row.detected_type,
    confidence: row.confidence,
    reviewStatus: row.review_status,
    createdAt: row.created_at
  };
}

export async function createItem(
  recipientId: number,
  sourceId: number,
  detectedType: ItemType,
  confidence: number,
  reviewStatus: ItemReviewStatus = 'auto'
): Promise<Item> {
  const result = await db.query(
    `INSERT INTO items (recipient_id, source_id, detected_type, confidence, review_status)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [recipientId, sourceId, detectedType, confidence, reviewStatus]
  );
  return itemRowToItem(result.rows[0] as ItemRow);
}

export async function findItemsByRecipientId(recipientId: number): Promise<Item[]> {
  const result = await db.query('SELECT * FROM items WHERE recipient_id = $1', [recipientId]);
  return result.rows.map((row) => itemRowToItem(row as ItemRow));
}

export async function findItemById(id: number): Promise<Item | undefined> {
  const result = await db.query('SELECT * FROM items WHERE id = $1', [id]);
  return result.rows[0] ? itemRowToItem(result.rows[0] as ItemRow) : undefined;
}
