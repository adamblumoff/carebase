import { test } from 'vitest';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import type {
  MedicationDeleteResponse,
  MedicationIntakeDeleteResponse,
  MedicationWithDetails,
  User
} from '@carebase/shared';
import { applySchema, wireDbClient } from './helpers/db.js';

process.env.NODE_ENV = 'test';

import medicationsRouter from '../../backend/src/routes/api/medications.js';
import dbClient from '../../backend/src/db/client.js';

const queriesModule = await import('../../backend/src/db/queries.js');
const { __setGoogleSyncSchedulerForTests } = queriesModule as unknown as {
  __setGoogleSyncSchedulerForTests: (scheduler: ((userId: number) => void) | null) => void;
};

__setGoogleSyncSchedulerForTests(() => {});

function createOwner(): User {
  const now = new Date();
  return {
    id: 900,
    email: 'owner@example.com',
    googleId: null,
    legacyGoogleId: null,
    clerkUserId: null,
    passwordResetRequired: false,
    forwardingAddress: 'owner-forward@example.com',
    planSecret: 'owner-secret',
    planVersion: 1,
    planUpdatedAt: now,
    createdAt: now
  };
}

async function seedMedicationFixture(pool: any) {
  const owner = createOwner();

  await pool.query(
    `INSERT INTO users (id, email, forwarding_address, plan_secret, plan_version, plan_updated_at, created_at, password_reset_required)
     VALUES ($1, $2, $3, $4, $5, $6, $7, false)` ,
    [
      owner.id,
      owner.email,
      owner.forwardingAddress,
      owner.planSecret,
      owner.planVersion,
      owner.planUpdatedAt,
      owner.createdAt
    ]
  );

  const recipientInsert = await pool.query(
    `INSERT INTO recipients (user_id, display_name, created_at)
     VALUES ($1, $2, NOW()) RETURNING *`,
    [owner.id, 'Alex Patient']
  );
  const recipientId = recipientInsert.rows[0].id as number;

  const ownerCollaboratorInsert = await pool.query(
    `INSERT INTO care_collaborators (recipient_id, user_id, email, role, status, invite_token, invited_by, invited_at, accepted_at)
     VALUES ($1, $2, $3, 'owner', 'accepted', 'owner-token', $2, NOW(), NOW())
     RETURNING *`,
    [recipientId, owner.id, owner.email]
  );
  const ownerCollaboratorId = ownerCollaboratorInsert.rows[0].id as number;

  const medicationInsert = await pool.query(
    `INSERT INTO medications (recipient_id, owner_id, name, strength_value, strength_unit, form, instructions, start_date, quantity_on_hand, refill_threshold, preferred_pharmacy, created_at, updated_at)
     VALUES ($1, $2, 'Lipitor', 5, 'mg', 'tablet', 'Take daily', NOW()::date, 30, 10, 'CVS', NOW(), NOW())
     RETURNING *`,
    [recipientId, ownerCollaboratorId]
  );
  const medicationId = medicationInsert.rows[0].id as number;

  await pool.query(
    `INSERT INTO medication_doses (medication_id, label, time_of_day, timezone, reminder_window_minutes, is_active, created_at, updated_at)
     VALUES ($1, 'Morning', '08:00:00', 'America/New_York', 120, true, NOW(), NOW())`,
    [medicationId]
  );

  await pool.query(
    `INSERT INTO medication_intakes (medication_id, dose_id, scheduled_for, acknowledged_at, status, actor_user_id, created_at, updated_at)
     VALUES ($1, NULL, NOW(), NOW(), 'taken', $2, NOW(), NOW())`,
    [medicationId, owner.id]
  );

  await pool.query(
    `INSERT INTO medication_refill_forecasts (medication_id, expected_run_out_on, calculated_at)
     VALUES ($1, NOW()::date + INTERVAL '30 days', NOW())`,
    [medicationId]
  );

  return { owner, recipientId };
}

function createApp(user: User) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as express.Request & { user?: User }).user = user;
    next();
  });
  app.use('/api/medications', medicationsRouter);
  return app;
}

test('GET /api/medications returns payload compatible with MedicationWithDetails', async ({ onTestFinished }) => {
  const mem = applySchema();
  const { pool, restore } = wireDbClient(mem);
  const { owner } = await seedMedicationFixture(pool);

  const app = createApp(owner);

  const response = await request(app).get('/api/medications');
  assert.equal(response.status, 200);
  const payload = response.body as { medications: MedicationWithDetails[] };
  assert.ok(Array.isArray(payload.medications));
  const medication = payload.medications[0];
  assert.ok(medication);
  assert.equal(medication.name, 'Lipitor');
  assert.ok(Array.isArray(medication.doses));
  assert.ok(Array.isArray(medication.upcomingIntakes));
  assert.equal(medication.refillProjection?.medicationId, medication.id);

  onTestFinished(async () => {
    restore();
    await pool.end();
  });
});

test('POST /api/medications creates medication with doses', async ({ onTestFinished }) => {
  const mem = applySchema();
  const { pool, restore } = wireDbClient(mem);
  const { owner, recipientId } = await seedMedicationFixture(pool);

  const app = createApp(owner);

  const response = await request(app)
    .post('/api/medications')
    .send({
      recipientId,
      name: 'Metformin',
      strengthValue: 500,
      doses: [
        {
          label: 'Evening',
          timeOfDay: '20:00',
          timezone: 'America/New_York'
        }
      ]
    });

  assert.equal(response.status, 201);
  const medication = response.body as MedicationWithDetails;
  assert.equal(medication.name, 'Metformin');
  assert.equal(medication.doses.length, 1);

  const countResult = await pool.query('SELECT COUNT(*)::int AS count FROM medications WHERE name = $1', ['Metformin']);
  assert.equal(countResult.rows[0].count, 1);

  onTestFinished(async () => {
    restore();
    await pool.end();
  });
});

test('DELETE /api/medications/:id removes medication and logs audit', async ({ onTestFinished }) => {
  const mem = applySchema();
  const { pool, restore } = wireDbClient(mem);
  const { owner } = await seedMedicationFixture(pool);

  const existingMedication = await pool.query<{ id: number }>(
    'SELECT id FROM medications ORDER BY id DESC LIMIT 1'
  );
  const medicationId = existingMedication.rows[0]?.id;
  assert.ok(medicationId);

  const app = createApp(owner);

  const response = await request(app).delete(`/api/medications/${medicationId}`);
  assert.equal(response.status, 200);
  const payload = response.body as MedicationDeleteResponse;
  assert.equal(payload.deletedMedicationId, medicationId);
  assert.ok(Number.isInteger(payload.auditLogId));

  const remaining = await pool.query('SELECT COUNT(*)::int AS count FROM medications WHERE id = $1', [medicationId]);
  assert.equal(remaining.rows[0]?.count, 0);

  const auditRow = await pool.query(
    `SELECT action, meta->>'medicationId' AS medication_id
     FROM audit
     WHERE id = $1`,
    [payload.auditLogId]
  );
  assert.equal(auditRow.rows[0]?.action, 'medication_deleted');
  assert.equal(Number(auditRow.rows[0]?.medication_id), medicationId);

  onTestFinished(async () => {
    restore();
    await pool.end();
  });
});

test('DELETE /api/medications/:id/intakes/:intakeId removes intake and returns refreshed medication', async ({ onTestFinished }) => {
  const mem = applySchema();
  const { pool, restore } = wireDbClient(mem);
  const { owner } = await seedMedicationFixture(pool);

  const details = await pool.query<{ id: number }>(
    `SELECT id FROM medications ORDER BY id DESC LIMIT 1`
  );
  const medicationId = details.rows[0]?.id;
  assert.ok(medicationId);

  const intakeResult = await pool.query<{ id: number }>(
    `SELECT id FROM medication_intakes WHERE medication_id = $1 ORDER BY id DESC LIMIT 1`,
    [medicationId]
  );
  const intakeId = intakeResult.rows[0]?.id;
  assert.ok(intakeId);

  const app = createApp(owner);

  const response = await request(app).delete(`/api/medications/${medicationId}/intakes/${intakeId}`);
  assert.equal(response.status, 200);
  const payload = response.body as MedicationIntakeDeleteResponse;
  assert.equal(payload.deletedIntakeId, intakeId);
  assert.equal(payload.medication.id, medicationId);
  assert.ok(Array.isArray(payload.medication.upcomingIntakes));
  assert.ok(payload.medication.upcomingIntakes.every((intake) => intake.id !== intakeId));

  const intakeCount = await pool.query(
    `SELECT COUNT(*)::int AS count FROM medication_intakes WHERE id = $1`,
    [intakeId]
  );
  assert.equal(intakeCount.rows[0]?.count, 0);

  const auditRow = await pool.query(
    `SELECT action, meta->>'intakeId' AS intake_id
     FROM audit
     WHERE id = $1`,
    [payload.auditLogId]
  );
  assert.equal(auditRow.rows[0]?.action, 'medication_intake_deleted');
  assert.equal(Number(auditRow.rows[0]?.intake_id), intakeId);

  onTestFinished(async () => {
    restore();
    await pool.end();
  });
});
