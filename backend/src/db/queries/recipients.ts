import type { Recipient } from '@carebase/shared';
import { db } from './shared.js';

interface RecipientRow {
  id: number;
  user_id: number;
  display_name: string;
  created_at: Date;
}

export function recipientRowToRecipient(row: RecipientRow): Recipient {
  return {
    id: row.id,
    userId: row.user_id,
    displayName: row.display_name,
    createdAt: row.created_at
  };
}

export async function createRecipient(userId: number, displayName: string): Promise<Recipient> {
  const result = await db.query(
    'INSERT INTO recipients (user_id, display_name) VALUES ($1, $2) RETURNING *',
    [userId, displayName]
  );
  return recipientRowToRecipient(result.rows[0] as RecipientRow);
}

export async function findRecipientsByUserId(userId: number): Promise<Recipient[]> {
  const result = await db.query('SELECT * FROM recipients WHERE user_id = $1', [userId]);
  return result.rows.map((row) => recipientRowToRecipient(row as RecipientRow));
}

export async function findRecipientById(id: number): Promise<Recipient | undefined> {
  const result = await db.query('SELECT * FROM recipients WHERE id = $1', [id]);
  return result.rows[0] ? recipientRowToRecipient(result.rows[0] as RecipientRow) : undefined;
}
