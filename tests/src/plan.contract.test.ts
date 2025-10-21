import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import { applySchema, wireDbClient } from './helpers/db.js';

process.env.GOOGLE_SYNC_ENABLE_TEST = 'true';
process.env.NODE_ENV = 'test';

import planRouter from '../../backend/src/routes/api/plan.js';
import collaboratorsRouter from '../../backend/src/routes/api/collaborators.js';
import dbClient from '../../backend/src/db/client.js';
import type { PlanPayload, User } from '@carebase/shared';

const queriesModule = await import('../../backend/src/db/queries.js');
const { __setGoogleSyncSchedulerForTests } = queriesModule as unknown as {
  __setGoogleSyncSchedulerForTests: (scheduler: ((userId: number) => void) | null) => void;
};

__setGoogleSyncSchedulerForTests(() => {});

interface TestUsers {
  owner: User;
  collaborator: User;
}

async function seedPlanFixture(pool: any): Promise<TestUsers> {
  const now = new Date();
  const owner = {
    id: 10,
    email: 'owner@example.com',
    googleId: 'google-owner',
    forwardingAddress: 'owner-forward@example.com',
    planSecret: 'secret-owner',
    planVersion: 3,
    planUpdatedAt: now,
    createdAt: now
  } satisfies User;

  const collaborator = {
    id: 11,
    email: 'collaborator@example.com',
    googleId: 'google-collaborator',
    forwardingAddress: 'collab-forward@example.com',
    planSecret: 'secret-collaborator',
    planVersion: 1,
    planUpdatedAt: now,
    createdAt: now
  } satisfies User;

  await pool.query(
    `INSERT INTO users (id, email, google_id, forwarding_address, plan_secret, plan_version, plan_updated_at, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      owner.id,
      owner.email,
      owner.googleId,
      owner.forwardingAddress,
      owner.planSecret,
      owner.planVersion,
      owner.planUpdatedAt,
      owner.createdAt
    ]
  );

  await pool.query(
    `INSERT INTO users (id, email, google_id, forwarding_address, plan_secret, plan_version, plan_updated_at, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      collaborator.id,
      collaborator.email,
      collaborator.googleId,
      collaborator.forwardingAddress,
      collaborator.planSecret,
      collaborator.planVersion,
      collaborator.planUpdatedAt,
      collaborator.createdAt
    ]
  );

  const recipient = await pool.query(
    `INSERT INTO recipients (user_id, display_name)
     VALUES ($1, $2) RETURNING *`,
    [owner.id, 'Alex Patient']
  );
  const recipientId = recipient.rows[0].id as number;

  await pool.query(
    `INSERT INTO care_collaborators (recipient_id, email, role, status, invite_token, invited_by, user_id, invited_at, accepted_at)
     VALUES ($1, $2, 'contributor', 'accepted', $3, $4, $5, NOW(), NOW())`,
    [recipientId, collaborator.email, 'accepted-token', owner.id, collaborator.id]
  );

  await pool.query(
    `INSERT INTO care_collaborators (recipient_id, email, role, status, invite_token, invited_by, invited_at)
     VALUES ($1, $2, 'contributor', 'pending', $3, $4, NOW())`,
    [recipientId, 'pending@example.com', 'pending-token', owner.id]
  );

  const sourceAppointment = await pool.query(
    `INSERT INTO sources (recipient_id, kind, sender, subject, short_excerpt)
     VALUES ($1, 'email', $2, $3, $4) RETURNING *`,
    [recipientId, 'clinic@example.com', 'Follow-up Reminder', 'Please arrive 15 minutes early']
  );
  const sourceBill = await pool.query(
    `INSERT INTO sources (recipient_id, kind, sender, subject, short_excerpt)
     VALUES ($1, 'email', $2, $3, $4) RETURNING *`,
    [recipientId, 'billing@example.com', 'Statement', 'Amount due: $150']
  );

  const appointmentItem = await pool.query(
    `INSERT INTO items (recipient_id, source_id, detected_type, confidence)
     VALUES ($1, $2, 'appointment', 0.95) RETURNING *`,
    [recipientId, sourceAppointment.rows[0].id]
  );

  const billItem = await pool.query(
    `INSERT INTO items (recipient_id, source_id, detected_type, confidence)
     VALUES ($1, $2, 'bill', 0.9) RETURNING *`,
    [recipientId, sourceBill.rows[0].id]
  );

  const appointmentStart = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() + 2,
      14,
      0,
      0
    )
  );
  const appointmentEnd = new Date(appointmentStart.getTime() + 60 * 60 * 1000);

  await pool.query(
    `INSERT INTO appointments (item_id, start_local, end_local, location, prep_note, summary, ics_token, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
    [
      appointmentItem.rows[0].id,
      appointmentStart,
      appointmentEnd,
      'Valley Medical Center',
      'Bring insurance card',
      'Follow-up visit',
      'ics-token-123'
    ]
  );

  await pool.query(
    `INSERT INTO bills (item_id, statement_date, amount, due_date, pay_url, status, task_key, created_at)
     VALUES ($1, $2, $3, $4, $5, 'todo', 'task-bill-1', NOW())`,
    [
      billItem.rows[0].id,
      new Date('2025-10-10T00:00:00.000Z'),
      150,
      new Date('2025-10-12T00:00:00.000Z'),
      'https://clinic.example.com/pay'
    ]
  );

  return { owner, collaborator };
}

function createApp(user: User) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as express.Request & { user?: User }).user = user;
    next();
  });
  app.use('/api/plan', planRouter);
  app.use('/api/collaborators', collaboratorsRouter);
  return app;
}

function assertIsIsoString(value: string | null, message: string) {
  if (value === null) {
    return;
  }
  assert.doesNotThrow(() => new Date(value).toISOString(), message);
}

test('GET /api/plan returns payload compatible with shared PlanPayload for owner view', async (t) => {
  const mem = applySchema();
  const client = wireDbClient(mem);
  const { owner } = await seedPlanFixture(client.pool);
  const app = createApp(owner);

  t.after(async () => {
    await client.pool.end();
    client.restore();
  });

  const response = await request(app).get('/api/plan');
  assert.equal(response.status, 200);

  const payload = response.body as PlanPayload;
  assert.equal(payload.recipient.displayName, 'Alex Patient');
  assert.equal(Array.isArray(payload.appointments), true);
  assert.equal(Array.isArray(payload.bills), true);
  assert.equal(typeof payload.planVersion, 'number');
  assertIsIsoString(payload.planUpdatedAt, 'planUpdatedAt should be iso string');

  assert.equal(payload.collaborators.length, 3);
  const accepted = payload.collaborators.find((collab) => collab.status === 'accepted');
  const pending = payload.collaborators.find((collab) => collab.status === 'pending');
  assert.ok(accepted);
  assert.ok(pending);
  assert.equal(accepted?.inviteToken, '');
  assert.equal(pending?.inviteToken, 'pending-token');

  const appointment = payload.appointments[0];
  assert.ok(appointment, 'should include appointment');
  assert.ok(appointment.summary.includes('Follow-up'));
  assert.ok(new Date(appointment.startLocal).getTime());

  const bill = payload.bills[0];
  assert.ok(bill, 'should include bill');
  assert.equal(bill.status, 'todo');
  assert.ok(bill.amount);
});

test('GET /api/plan filters collaborator view and hides invite tokens', async (t) => {
  const mem = applySchema();
  const client = wireDbClient(mem);
  const { collaborator } = await seedPlanFixture(client.pool);
  const app = createApp(collaborator);

  t.after(async () => {
    await client.pool.end();
    client.restore();
  });

  const response = await request(app).get('/api/plan');
  assert.equal(response.status, 200);

  const payload = response.body as PlanPayload;
  assert.equal(payload.collaborators.every((collab) => collab.status === 'accepted'), true);
  assert.equal(payload.collaborators.length, 1);
  assert.equal(payload.collaborators[0].inviteToken, '');
});

test('GET /api/collaborators mirrors shared collaborator payload expectations', async (t) => {
  const mem = applySchema();
  const client = wireDbClient(mem);
  const { owner } = await seedPlanFixture(client.pool);
  const app = createApp(owner);

  t.after(async () => {
    await client.pool.end();
    client.restore();
  });

  const response = await request(app).get('/api/collaborators');
  assert.equal(response.status, 200);
  assert.ok(Array.isArray(response.body.collaborators));
  const pending = response.body.collaborators.find((collab: any) => collab.status === 'pending');
  assert.equal(pending?.inviteToken, 'pending-token');
});
