import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import { newDb } from 'pg-mem';

import webhookRoutes from './webhook.js';
import dbClient from '../db/client.js';
import { __setRealtimeEmitterForTests } from '../services/realtime.js';

test('inbound email webhook creates bill, bumps plan version, and emits realtime update', async (t) => {
  const mem = newDb({ autoCreateForeignKeyIndices: true });
  mem.public.registerFunction({
    name: 'now',
    returns: 'timestamp',
    implementation: () => new Date()
  });

  const schema = `
    CREATE TABLE users (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL,
      google_id TEXT NOT NULL,
      forwarding_address TEXT NOT NULL,
      plan_secret TEXT NOT NULL,
      plan_version INTEGER NOT NULL DEFAULT 0,
      plan_updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE recipients (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      display_name TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE sources (
      id SERIAL PRIMARY KEY,
      recipient_id INTEGER NOT NULL REFERENCES recipients(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      external_id TEXT,
      sender TEXT,
      subject TEXT,
      short_excerpt TEXT,
      storage_key TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE items (
      id SERIAL PRIMARY KEY,
      recipient_id INTEGER NOT NULL REFERENCES recipients(id) ON DELETE CASCADE,
      source_id INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
      detected_type TEXT NOT NULL,
      confidence NUMERIC NOT NULL,
      review_status TEXT NOT NULL DEFAULT 'auto',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE bills (
      id SERIAL PRIMARY KEY,
      item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
      statement_date DATE,
      amount NUMERIC,
      due_date DATE,
      pay_url TEXT,
      status TEXT NOT NULL DEFAULT 'todo',
      task_key TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE appointments (
      id SERIAL PRIMARY KEY,
      item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
      start_local TIMESTAMP NOT NULL,
      end_local TIMESTAMP NOT NULL,
      location TEXT,
      prep_note TEXT,
      summary TEXT NOT NULL,
      ics_token TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE audit (
      id SERIAL PRIMARY KEY,
      item_id INTEGER REFERENCES items(id) ON DELETE CASCADE,
      action TEXT NOT NULL,
      meta JSONB,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `;
  mem.public.none(schema);

  const adapter = mem.adapters.createPg();
  const { Pool } = adapter;
  const pool = new Pool();

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
    if (text.includes('UPDATE users u') && text.includes('FROM recipients r') && text.includes('JOIN items i')) {
      const itemId = params?.[0];
      if (itemId == null) {
        return pool.query(text, params);
      }
      const owningUser = await pool.query(
        `SELECT r.user_id FROM items i JOIN recipients r ON i.recipient_id = r.id WHERE i.id = $1`,
        [itemId]
      );
      if (owningUser.rows.length === 0) {
        return { rows: [], rowCount: 0, command: 'UPDATE', fields: [], oid: 0 };
      }
      const userId = owningUser.rows[0].user_id;
      await pool.query(
        `UPDATE users
         SET plan_version = COALESCE(plan_version, 0) + 1,
             plan_updated_at = NOW()
         WHERE id = $1`,
        [userId]
      );
      return pool.query('SELECT id FROM users WHERE id = $1', [userId]);
    }
    return pool.query(text, params);
  };
  dbAny.getClient = async () => pool.connect();
  dbAny.end = async () => pool.end();
  dbAny.pool = pool;

  t.after(async () => {
    dbAny.query = originalQuery;
    dbAny.getClient = originalGetClient;
    dbAny.end = originalEnd;
    dbAny.pool = originalPool;
    await pool.end();
    __setRealtimeEmitterForTests(null);
  });

  const { rows: [user] } = await pool.query(
    `INSERT INTO users (email, google_id, forwarding_address, plan_secret)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    ['caregiver@example.com', 'google-123', 'user-forward@carebase.test', 'secret-token']
  );

  const { rows: [recipient] } = await pool.query(
    `INSERT INTO recipients (user_id, display_name)
     VALUES ($1, $2)
     RETURNING *`,
    [user.id, 'Alex Patient']
  );

  let emittedUserId: number | null = null;
  __setRealtimeEmitterForTests({
    emitPlanUpdate(id: number) {
      emittedUserId = id;
    }
  });

  const app = express();
  app.use(express.json());
  app.use('/webhook', webhookRoutes);

  const payload = {
    From: 'billing@clinic.com',
    To: user.forwarding_address,
    Subject: 'Billing Reminder',
    TextBody: 'Your amount due is $150.00. Please pay by October 31, 2025.',
    MessageID: 'msg-123'
  };

  const response = await request(app)
    .post('/webhook/inbound-email')
    .send(payload);

  assert.equal(response.status, 200);
  assert.equal(response.body.success, true);

  const { rows: userRows } = await pool.query(
    'SELECT plan_version, plan_updated_at FROM users WHERE id = $1',
    [user.id]
  );

  assert.equal(userRows[0].plan_version, 1);
  assert.ok(userRows[0].plan_updated_at instanceof Date);

  const { rows: bills } = await pool.query(
    'SELECT * FROM bills WHERE item_id IN (SELECT id FROM items WHERE recipient_id = $1)',
    [recipient.id]
  );

  assert.equal(bills.length, 1);
  assert.equal(emittedUserId, user.id);
});
