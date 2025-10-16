import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import googleIntegrationRouter from './integrations/google.js';

const createApp = () => {
  const app = express();
  app.use(express.json());
  app.use('/api/integrations/google', googleIntegrationRouter);
  return app;
};

test('Google integration routes require authentication', async () => {
  const app = createApp();

  const statusResponse = await request(app).get('/api/integrations/google/status');
  assert.equal(statusResponse.status, 401);
  assert.deepEqual(statusResponse.body, { error: 'Not authenticated' });

  const connectResponse = await request(app)
    .post('/api/integrations/google/connect')
    .send({});
  assert.equal(connectResponse.status, 401);
  assert.deepEqual(connectResponse.body, { error: 'Not authenticated' });

  const deleteResponse = await request(app).delete('/api/integrations/google/connect');
  assert.equal(deleteResponse.status, 401);
  assert.deepEqual(deleteResponse.body, { error: 'Not authenticated' });

  const syncResponse = await request(app)
    .post('/api/integrations/google/sync')
    .send({});
  assert.equal(syncResponse.status, 401);
  assert.deepEqual(syncResponse.body, { error: 'Not authenticated' });
});
