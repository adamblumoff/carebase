import type { Source, SourceKind } from '@carebase/shared';
import { db } from './shared.js';

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

export interface CreateSourceData {
  externalId?: string | null;
  sender?: string | null;
  subject?: string | null;
  shortExcerpt?: string | null;
  storageKey?: string | null;
}

export function sourceRowToSource(row: SourceRow): Source {
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

export async function createSource(recipientId: number, kind: SourceKind, data: CreateSourceData): Promise<Source> {
  const { externalId, sender, subject, shortExcerpt, storageKey } = data;
  const result = await db.query(
    `INSERT INTO sources (recipient_id, kind, external_id, sender, subject, short_excerpt, storage_key)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [recipientId, kind, externalId, sender, subject, shortExcerpt, storageKey]
  );
  return sourceRowToSource(result.rows[0] as SourceRow);
}

export async function findSourceById(id: number): Promise<Source | undefined> {
  const result = await db.query('SELECT * FROM sources WHERE id = $1', [id]);
  return result.rows[0] ? sourceRowToSource(result.rows[0] as SourceRow) : undefined;
}
