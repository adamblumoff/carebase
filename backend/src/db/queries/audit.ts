import type { Item, ItemType } from '@carebase/shared';
import { db } from './shared.js';
import { itemRowToItem } from './items.js';

export interface LowConfidenceItemRow extends Item {
  sender: string | null;
  subject: string | null;
  shortExcerpt: string | null;
}

export async function createAuditLog(itemId: number | null, action: string, meta: Record<string, any>): Promise<any> {
  const result = await db.query(
    'INSERT INTO audit (item_id, action, meta) VALUES ($1, $2, $3) RETURNING *',
    [itemId, action, JSON.stringify(meta)]
  );
  return result.rows[0];
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
  return result.rows.map((row) => ({
    ...itemRowToItem(row as any),
    sender: row.sender as string | null,
    subject: row.subject as string | null,
    shortExcerpt: row.short_excerpt as string | null
  }));
}

export async function reclassifyItem(itemId: number, newType: ItemType): Promise<boolean> {
  await db.query(
    `UPDATE items
       SET detected_type = $1,
           confidence = 1.0,
           review_status = 'auto'
     WHERE id = $2`,
    [newType, itemId]
  );
  await db.query('DELETE FROM appointments WHERE item_id = $1', [itemId]);
  await db.query('DELETE FROM bills WHERE item_id = $1', [itemId]);
  return true;
}

export async function findItemById(id: number): Promise<Item | undefined> {
  const result = await db.query('SELECT * FROM items WHERE id = $1', [id]);
  return result.rows[0] ? itemRowToItem(result.rows[0] as any) : undefined;
}
