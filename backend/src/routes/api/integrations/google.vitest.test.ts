import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import googleIntegrationRouter from './google.js';

const createApp = () => {
  const app = express();
  app.use(express.json());
  app.use('/api/integrations/google', googleIntegrationRouter);
  return app;
};

describe('google integration routes', () => {
  it('requires authentication', async () => {
    const app = createApp();

    const statusResponse = await request(app).get('/api/integrations/google/status');
    expect(statusResponse.status).toBe(401);
    expect(statusResponse.body).toEqual({ error: 'Not authenticated' });

    const connectResponse = await request(app)
      .post('/api/integrations/google/connect')
      .send({});
    expect(connectResponse.status).toBe(401);
    expect(connectResponse.body).toEqual({ error: 'Not authenticated' });

    const deleteResponse = await request(app).delete('/api/integrations/google/connect');
    expect(deleteResponse.status).toBe(401);
    expect(deleteResponse.body).toEqual({ error: 'Not authenticated' });

    const syncResponse = await request(app)
      .post('/api/integrations/google/sync')
      .send({});
    expect(syncResponse.status).toBe(401);
    expect(syncResponse.body).toEqual({ error: 'Not authenticated' });
  });
});
