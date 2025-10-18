import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { newDb } from 'pg-mem';

import dbClient from '../../db/client.js';
import {
  queueGoogleSyncForUser,
  __setGoogleIntegrationSchemaEnsuredForTests,
  __setGoogleSyncSchedulerForTests
} from '../queries/google.js';

interface PgMemContext {
  pool: any;
  insertCalls: Array<{ params?: unknown[]; rowCount: number }>;
  restore: () => Promise<void>;
}

async function setupPgMem(): Promise<PgMemContext> {
  const mem = newDb({ autoCreateForeignKeyIndices: true });
  mem.public.registerFunction({
    name: 'now',
    returns: 'timestamp',
    implementation: () => new Date()
  });

  mem.public.none(`
    CREATE TABLE users (
      id SERIAL PRIMARY KEY
    );

    CREATE TABLE recipients (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE items (
      id SERIAL PRIMARY KEY,
      recipient_id INTEGER NOT NULL REFERENCES recipients(id) ON DELETE CASCADE,
      detected_type TEXT NOT NULL
    );

    CREATE TABLE appointments (
      id SERIAL PRIMARY KEY,
      item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE
    );

    CREATE TABLE bills (
      id SERIAL PRIMARY KEY,
      item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE
    );

    CREATE TABLE google_sync_links (
      id SERIAL PRIMARY KEY,
      item_id INTEGER NOT NULL UNIQUE,
      calendar_id TEXT,
      event_id TEXT,
      etag TEXT,
      last_synced_at TIMESTAMPTZ,
      last_sync_direction VARCHAR(10),
      local_hash VARCHAR(128),
      remote_updated_at TIMESTAMPTZ,
      sync_status VARCHAR(20) NOT NULL DEFAULT 'idle',
      last_error TEXT,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const adapter = mem.adapters.createPg();
  const { Pool } = adapter;
  const pool = new Pool();
  const insertCalls: Array<{ params?: unknown[]; rowCount: number }> = [];

  const dbAny = dbClient as unknown as {
    query: typeof dbClient.query;
    getClient: typeof dbClient.getClient;
    end: typeof dbClient.end;
    pool: any;
  };
  const originalQuery = dbAny.query;
  const originalGetClient = dbAny.getClient;
  const originalEnd = dbAny.end;
  const originalPool = dbAny.pool;

  dbAny.query = async (text: string, params?: any[]) => {
    if (typeof text === 'string' && text.includes('INSERT INTO google_sync_links')) {
      const result = await pool.query(text, params);
      insertCalls.push({ params, rowCount: result.rowCount });
      return result;
    }
    return pool.query(text, params);
  };
  dbAny.getClient = async () => pool.connect();
  dbAny.end = async () => pool.end();
  dbAny.pool = pool;

  __setGoogleIntegrationSchemaEnsuredForTests(true);

  return {
    pool,
    insertCalls,
    restore: async () => {
      dbAny.query = originalQuery;
      dbAny.getClient = originalGetClient;
      dbAny.end = originalEnd;
      dbAny.pool = originalPool;
      await pool.end();
    }
  };
}

describe('queueGoogleSyncForUser targeted queueing', () => {
  let context: PgMemContext;
  const scheduler = vi.fn();

  beforeEach(async () => {
    context = await setupPgMem();
    __setGoogleSyncSchedulerForTests(scheduler);
  });

  afterEach(async () => {
    __setGoogleSyncSchedulerForTests(null);
    __setGoogleIntegrationSchemaEnsuredForTests(false);
    scheduler.mockReset();
    await context.restore();
  });

  async function seedPlan(pool: PgMemContext['pool']): Promise<{
    userId: number;
    appointmentItemId: number;
    billItemId: number;
  }> {
    const {
      rows: [user]
    } = await pool.query(`INSERT INTO users (id) VALUES (DEFAULT) RETURNING id`);

    const {
      rows: [recipient]
    } = await pool.query(`INSERT INTO recipients (user_id) VALUES ($1) RETURNING id`, [user.id]);

    const {
      rows: [appointmentItem]
    } = await pool.query(
      `INSERT INTO items (recipient_id, detected_type) VALUES ($1, 'appointment') RETURNING id`,
      [recipient.id]
    );
    await pool.query(`INSERT INTO appointments (item_id) VALUES ($1)`, [appointmentItem.id]);

    const {
      rows: [billItem]
    } = await pool.query(
      `INSERT INTO items (recipient_id, detected_type) VALUES ($1, 'bill') RETURNING id`,
      [recipient.id]
    );
    await pool.query(`INSERT INTO bills (item_id) VALUES ($1)`, [billItem.id]);

    return {
      userId: Number(user.id),
      appointmentItemId: Number(appointmentItem.id),
      billItemId: Number(billItem.id)
    };
  }

  it('queues only specified items when itemIds are provided', async () => {
    const { pool } = context;
    const { userId, appointmentItemId, billItemId } = await seedPlan(pool);

    await queueGoogleSyncForUser({
      userId,
      itemIds: [appointmentItemId],
      schedule: false
    });

    const firstInsert = await pool.query(
      `SELECT item_id, sync_status FROM google_sync_links ORDER BY item_id`
    );
    expect(firstInsert.rows).toEqual([{ item_id: appointmentItemId, sync_status: 'pending' }]);

    await queueGoogleSyncForUser({
      userId,
      itemIds: [billItemId],
      schedule: false
    });

    const secondInsert = await pool.query(
      `SELECT item_id, sync_status FROM google_sync_links ORDER BY item_id`
    );
    expect(secondInsert.rows).toEqual([
      { item_id: appointmentItemId, sync_status: 'pending' },
      { item_id: billItemId, sync_status: 'pending' }
    ]);

    expect(context.insertCalls).toHaveLength(2);
    expect(context.insertCalls[0].rowCount).toBeGreaterThan(0);
    expect(context.insertCalls[1].rowCount).toBeGreaterThan(0);
    expect(scheduler).not.toHaveBeenCalled();
  });

  it('schedules sync by default and queues all items when forceFull is true', async () => {
    const { pool } = context;
    const { userId, appointmentItemId, billItemId } = await seedPlan(pool);

    await queueGoogleSyncForUser({
      userId,
      forceFull: true
    });

    expect(scheduler).toHaveBeenCalledWith(userId, 0);
    const pending = await pool.query(`SELECT item_id FROM google_sync_links ORDER BY item_id`);
    expect(pending.rows.map((row: { item_id: number }) => row.item_id)).toEqual([
      appointmentItemId,
      billItemId
    ]);
  });
});
