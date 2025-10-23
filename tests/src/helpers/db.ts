import { newDb } from 'pg-mem';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dbClient from '../../../backend/src/db/client.js';

export function createMemDatabase() {
  const mem = newDb({ autoCreateForeignKeyIndices: true, noAstCoverageCheck: true });
  mem.public.registerFunction({
    name: 'now',
    returns: 'timestamp',
    implementation: () => new Date()
  });
  return mem;
}

export function applySchema(mem = createMemDatabase()) {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const schemaPath = path.resolve(__dirname, '../../../backend/src/db/schema.sql');
  const schemaSql = readFileSync(schemaPath, 'utf8');
  const sanitizedSchema = schemaSql
    .replace(
      /ALTER TABLE appointments\s+ALTER COLUMN start_local[^;]+;/g,
      ''
    )
    .replace(
      /ALTER TABLE appointments\s+ALTER COLUMN end_local[^;]+;/g,
      ''
    )
    .replace(
      /UPDATE users\s+SET legacy_google_id = google_id[\s\S]*?;/g,
      ''
    );
  mem.public.none(sanitizedSchema);
  return mem;
}

export function wireDbClient(mem: ReturnType<typeof createMemDatabase>) {
  const adapter = mem.adapters.createPg();
  const { Pool } = adapter;
  const pool = new Pool();
  const dbAny = dbClient as unknown as {
    query: (text: string, params?: any[]) => Promise<any>;
    getClient: () => Promise<any>;
    end: () => Promise<void>;
    pool: any;
  };
  const original = {
    query: dbAny.query,
    getClient: dbAny.getClient,
    end: dbAny.end,
    pool: dbAny.pool
  };

  dbAny.query = (text: string, params?: any[]) => pool.query(text, params);
  dbAny.getClient = () => pool.connect();
  dbAny.end = () => pool.end();
  dbAny.pool = pool;

  return {
    pool,
    restore() {
      dbAny.query = original.query;
      dbAny.getClient = original.getClient;
      dbAny.end = original.end;
      dbAny.pool = original.pool;
    }
  };
}
