import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import { newDb } from 'pg-mem';
import type { User } from '@carebase/shared';

import collaboratorRouter from './collaborators.js';
import dbClient from '../../db/client.js';

function createTestUser(overrides: Partial<User> = {}): User {
  const now = new Date();
  return {
    id: overrides.id ?? 1,
    email: overrides.email ?? 'user@example.com',
    googleId: overrides.googleId ?? `google-${overrides.id ?? 1}`,
    forwardingAddress: overrides.forwardingAddress ?? `forward+${overrides.id ?? 1}@example.com`,
    planSecret: overrides.planSecret ?? `secret-${overrides.id ?? 1}`,
    planVersion: overrides.planVersion ?? 0,
    planUpdatedAt: overrides.planUpdatedAt ?? now,
    createdAt: overrides.createdAt ?? now
  };
}

function createApp(user: User) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).user = user;
    next();
  });
  app.use('/api/collaborators', collaboratorRouter);
  return app;
}

const baseSchema = `
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

  CREATE TABLE care_collaborators (
    id SERIAL PRIMARY KEY,
    recipient_id INTEGER NOT NULL REFERENCES recipients(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    email TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'contributor',
    status TEXT NOT NULL DEFAULT 'pending',
    invite_token TEXT NOT NULL UNIQUE,
    invited_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    invited_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    accepted_at TIMESTAMP
  );
`;

test('POST /api/collaborators/accept updates collaborator and returns payload', async (t) => {
  const mem = newDb({ autoCreateForeignKeyIndices: true });
  mem.public.registerFunction({
    name: 'now',
    returns: 'timestamp',
    implementation: () => new Date()
  });
  mem.public.none(baseSchema);

  const adapter = mem.adapters.createPg();
  const { Pool } = adapter;
  const pool = new Pool();

  const dbAny = dbClient as unknown as {
    query: (text: string, params?: any[]) => Promise<any>;
    getClient: () => Promise<any>;
    end: () => Promise<void>;
    pool: any;
  };
  const originalQuery = dbAny.query;
  const originalGetClient = dbAny.getClient;
  const originalEnd = dbAny.end;
  const originalPool = dbAny.pool;

  dbAny.query = (text: string, params?: any[]) => pool.query(text, params);
  dbAny.getClient = () => pool.connect();
  dbAny.end = () => pool.end();
  dbAny.pool = pool;

  t.after(async () => {
    dbAny.query = originalQuery;
    dbAny.getClient = originalGetClient;
    dbAny.end = originalEnd;
    dbAny.pool = originalPool;
    await pool.end();
  });

  const owner = createTestUser({ id: 10, email: 'owner@example.com' });
  const invitee = createTestUser({ id: 11, email: 'invitee@example.com' });

  await pool.query(
    `INSERT INTO users (id, email, google_id, forwarding_address, plan_secret)
     VALUES ($1, $2, $3, $4, $5)`,
    [owner.id, owner.email, owner.googleId, owner.forwardingAddress, owner.planSecret]
  );
  await pool.query(
    `INSERT INTO users (id, email, google_id, forwarding_address, plan_secret)
     VALUES ($1, $2, $3, $4, $5)`,
    [invitee.id, invitee.email, invitee.googleId, invitee.forwardingAddress, invitee.planSecret]
  );

  const { rows: [recipient] } = await pool.query(
    `INSERT INTO recipients (user_id, display_name) VALUES ($1, $2) RETURNING id`,
    [owner.id, 'Alex Patient']
  );

  await pool.query(
    `INSERT INTO care_collaborators (recipient_id, email, role, status, invite_token, invited_by)
     VALUES ($1, $2, 'contributor', 'pending', $3, $4)`,
    [recipient.id, invitee.email, 'accept-token', owner.id]
  );

  const app = createApp(invitee);

  const response = await request(app)
    .post('/api/collaborators/accept')
    .send({ token: 'accept-token' });

  assert.equal(response.status, 200);
  assert.equal(response.body.collaborator.email, invitee.email);
  assert.equal(response.body.collaborator.status, 'accepted');
  assert.equal(response.body.collaborator.userId, invitee.id);

  const { rows } = await pool.query(
    `SELECT status, user_id, accepted_at FROM care_collaborators WHERE email = $1`,
    [invitee.email]
  );
  assert.equal(rows[0].status, 'accepted');
  assert.equal(rows[0].user_id, invitee.id);
  assert.ok(rows[0].accepted_at instanceof Date);
});

test('POST /api/collaborators/accept rejects mismatched email', async (t) => {
  const mem = newDb({ autoCreateForeignKeyIndices: true });
  mem.public.registerFunction({
    name: 'now',
    returns: 'timestamp',
    implementation: () => new Date()
  });
  mem.public.none(baseSchema);

  const adapter = mem.adapters.createPg();
  const { Pool } = adapter;
  const pool = new Pool();

  const dbAny = dbClient as unknown as {
    query: (text: string, params?: any[]) => Promise<any>;
    getClient: () => Promise<any>;
    end: () => Promise<void>;
    pool: any;
  };
  const originalQuery = dbAny.query;
  const originalGetClient = dbAny.getClient;
  const originalEnd = dbAny.end;
  const originalPool = dbAny.pool;

  dbAny.query = (text: string, params?: any[]) => pool.query(text, params);
  dbAny.getClient = () => pool.connect();
  dbAny.end = () => pool.end();
  dbAny.pool = pool;

  t.after(async () => {
    dbAny.query = originalQuery;
    dbAny.getClient = originalGetClient;
    dbAny.end = originalEnd;
    dbAny.pool = originalPool;
    await pool.end();
  });

  const owner = createTestUser({ id: 20, email: 'owner@example.com' });
  const invitee = createTestUser({ id: 21, email: 'invitee@example.com' });

  await pool.query(
    `INSERT INTO users (id, email, google_id, forwarding_address, plan_secret)
     VALUES ($1, $2, $3, $4, $5)`,
    [owner.id, owner.email, owner.googleId, owner.forwardingAddress, owner.planSecret]
  );
  await pool.query(
    `INSERT INTO users (id, email, google_id, forwarding_address, plan_secret)
     VALUES ($1, $2, $3, $4, $5)`,
    [invitee.id, invitee.email, invitee.googleId, invitee.forwardingAddress, invitee.planSecret]
  );

  const { rows: [recipient] } = await pool.query(
    `INSERT INTO recipients (user_id, display_name) VALUES ($1, $2) RETURNING id`,
    [owner.id, 'Alex Patient']
  );

  await pool.query(
    `INSERT INTO care_collaborators (recipient_id, email, role, status, invite_token, invited_by)
     VALUES ($1, $2, 'contributor', 'pending', $3, $4)`,
    [recipient.id, invitee.email, 'reject-token', owner.id]
  );

  const mismatchedUser = createTestUser({ id: invitee.id, email: 'other@example.com' });
  const app = createApp(mismatchedUser);

  const response = await request(app)
    .post('/api/collaborators/accept')
    .send({ token: 'reject-token' });

  assert.equal(response.status, 403);
  assert.deepEqual(response.body, { error: 'Invite belongs to a different email' });

  const { rows } = await pool.query(
    `SELECT status, user_id FROM care_collaborators WHERE invite_token = $1`,
    ['reject-token']
  );
  assert.equal(rows[0].status, 'pending');
  assert.equal(rows[0].user_id, null);
});

test('POST /api/collaborators/accept returns 404 for unknown token', async (t) => {
  const mem = newDb({ autoCreateForeignKeyIndices: true });
  mem.public.none(baseSchema);
  const adapter = mem.adapters.createPg();
  const { Pool } = adapter;
  const pool = new Pool();

  const dbAny = dbClient as unknown as {
    query: (text: string, params?: any[]) => Promise<any>;
    getClient: () => Promise<any>;
    end: () => Promise<void>;
    pool: any;
  };
  const originalQuery = dbAny.query;
  const originalGetClient = dbAny.getClient;
  const originalEnd = dbAny.end;
  const originalPool = dbAny.pool;

  dbAny.query = (text: string, params?: any[]) => pool.query(text, params);
  dbAny.getClient = () => pool.connect();
  dbAny.end = () => pool.end();
  dbAny.pool = pool;

  const invitee = createTestUser({ id: 31, email: 'invitee@example.com' });
  const app = createApp(invitee);

  const response = await request(app)
    .post('/api/collaborators/accept')
    .send({ token: 'missing-token' });

  assert.equal(response.status, 404);
  assert.deepEqual(response.body, { error: 'Invite not found' });

  dbAny.query = originalQuery;
  dbAny.getClient = originalGetClient;
  dbAny.end = originalEnd;
  dbAny.pool = originalPool;
  await pool.end();
});
