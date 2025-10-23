import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import type { User } from '@carebase/shared';
import uploadRouter from '../../backend/src/routes/api/upload.js';
import { applySchema, wireDbClient } from './helpers/db.js';

process.env.NODE_ENV = 'test';

async function seedUserAndRecipient(pool: any): Promise<{ user: User; recipientId: number }> {
  const googleId = 'google-upload-owner';
  const userResult = await pool.query(
    `INSERT INTO users (email, google_id, legacy_google_id, forwarding_address, plan_secret)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    ['upload-owner@example.com', googleId, googleId, 'owner-forward@example.com', 'owner-secret']
  );
  const userRow = userResult.rows[0];
  const recipientResult = await pool.query(
    `INSERT INTO recipients (user_id, display_name)
     VALUES ($1, $2) RETURNING *`,
    [userRow.id, 'Upload Recipient']
  );
  const recipientRow = recipientResult.rows[0];
  return {
    user: {
      id: userRow.id as number,
      email: userRow.email as string,
      googleId: userRow.google_id as string | null,
      legacyGoogleId: userRow.legacy_google_id as string | null,
      clerkUserId: userRow.clerk_user_id as string | null,
      passwordResetRequired: Boolean(userRow.password_reset_required),
      forwardingAddress: userRow.forwarding_address as string,
      planSecret: userRow.plan_secret as string,
      planVersion: (userRow.plan_version as number) ?? 0,
      planUpdatedAt: userRow.plan_updated_at as Date,
      createdAt: userRow.created_at as Date
    },
    recipientId: recipientRow.id as number
  };
}

function createUploadApp(testUser: User) {
  const app = express();
  app.use((req, _res, next) => {
    (req as any).user = testUser;
    next();
  });
  app.use('/api/upload', uploadRouter);
  return app;
}

test('POST /api/upload/photo skips bill creation without supporting fields', async (t) => {
  const mem = applySchema();
  const wiring = wireDbClient(mem);
  t.after(() => wiring.restore());

  const { pool } = wiring;
  const { user } = await seedUserAndRecipient(pool);
  const testUser = user;

  const ocrModule = await import('../../backend/src/services/ocr.js');
  const storageModule = await import('../../backend/src/services/storage.js');

  const extractTextMock = mock.method(ocrModule, 'extractTextFromImage', async () => {
    return `
      STATEMENT
      Amount Due: $145.00
      Please pay soon
    `;
  });
  const storeFileMock = mock.method(storageModule, 'storeFile', async () => 'file-key');
  const storeTextMock = mock.method(storageModule, 'storeText', async () => 'text-key');

  const app = createUploadApp(testUser);

  const response = await request(app)
    .post('/api/upload/photo')
    .attach('photo', Buffer.from('fake image'), {
      filename: 'car.jpg',
      contentType: 'image/jpeg'
    });

  assert.equal(response.status, 200);
  assert.equal(response.body.bill, null);
  assert.equal(response.body.classification.detectedType, 'bill');
  assert.ok(response.body.item);
  assert.equal(response.body.item.reviewStatus, 'pending_review');

  const billCount = await pool.query('SELECT COUNT(*) FROM bills');
  assert.equal(Number(billCount.rows[0].count), 0);
  const itemRows = await pool.query('SELECT detected_type FROM items');
  assert.equal(itemRows.rowCount, 1);
  assert.equal(itemRows.rows[0].detected_type, 'bill');

  assert.equal(extractTextMock.mock.callCount(), 1);
  assert.equal(storeFileMock.mock.callCount(), 1);
  assert.equal(storeTextMock.mock.callCount(), 1);

  mock.restoreAll();
});

test('POST /api/upload/photo creates bill when supporting fields present', async (t) => {
  const mem = applySchema();
  const wiring = wireDbClient(mem);
  t.after(() => wiring.restore());

  const { pool } = wiring;
  const { user } = await seedUserAndRecipient(pool);
  const testUser = user;

  const ocrModule = await import('../../backend/src/services/ocr.js');
  const storageModule = await import('../../backend/src/services/storage.js');

  const extractTextMock = mock.method(ocrModule, 'extractTextFromImage', async () => {
    return `
      MEDICAL BILL STATEMENT
      Amount Due: $240.50
      Pay by 10/25/2025
      Visit https://billing.example.com/pay
    `;
  });
  const storeFileMock = mock.method(storageModule, 'storeFile', async () => 'file-key');
  const storeTextMock = mock.method(storageModule, 'storeText', async () => 'text-key');

  const app = createUploadApp(testUser);

  const response = await request(app)
    .post('/api/upload/photo')
    .attach('photo', Buffer.from('fake image'), {
      filename: 'bill.jpg',
      contentType: 'image/jpeg'
    });

  assert.equal(response.status, 200);
  assert.ok(response.body.bill);
  assert.equal(response.body.bill.amount, 240.5);
  assert.equal(response.body.bill.status, 'todo');
  assert.equal(response.body.extracted.amount, 240.5);
  assert.equal(response.body.extracted.dueDate, '2025-10-25');
  assert.equal(response.body.classification.detectedType, 'bill');
  assert.equal(response.body.item.reviewStatus, 'auto');

  const billCount = await pool.query('SELECT COUNT(*) FROM bills');
  assert.equal(Number(billCount.rows[0].count), 1);

  assert.equal(extractTextMock.mock.callCount(), 1);
  assert.equal(storeFileMock.mock.callCount(), 1);
  assert.equal(storeTextMock.mock.callCount(), 1);

  mock.restoreAll();
});
