import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import planRouter from './plan.js';

const createApp = () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    next();
  });
  app.use('/api/plan', planRouter);
  return app;
};

test('GET /api/plan requires authentication', async () => {
  const app = createApp();
  const response = await request(app).get('/api/plan');
  assert.equal(response.status, 401);
  assert.deepEqual(response.body, { error: 'Not authenticated' });
});

test('GET /api/plan/version requires authentication', async () => {
  const app = createApp();
  const response = await request(app).get('/api/plan/version');
  assert.equal(response.status, 401);
  assert.deepEqual(response.body, { error: 'Not authenticated' });
});
