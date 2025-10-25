import { describe, it, expect } from 'vitest';
import express, { type Request, type Response } from 'express';
import request from 'supertest';
import { Webhook } from 'svix';
import { newDb } from 'pg-mem';

import clerkWebhookRoutes from './webhook.clerk.js';
import dbClient from '../db/client.js';
import { __setClerkWebhookTestHooks } from '../services/clerkWebhookService.js';

describe('clerk webhook routes', () => {
  it('Clerk user.deleted webhook clears Google data for known user', async ({ onTestFinished }) => {
    const cleanups: Array<() => Promise<void> | void> = [];
    onTestFinished(async () => {
      for (const cleanup of cleanups.reverse()) {
        await cleanup();
      }
    });

    const secret = 'whsec_' + Buffer.from('test_secret').toString('base64');
    process.env.CLERK_WEBHOOK_SECRET = secret;
    cleanups.push(() => {
      delete process.env.CLERK_WEBHOOK_SECRET;
    });

    const mem = newDb({ autoCreateForeignKeyIndices: true });
    mem.public.none(`
      CREATE TABLE users (
        id SERIAL PRIMARY KEY,
        email TEXT NOT NULL,
        clerk_user_id TEXT UNIQUE
      );
    `);

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

    dbAny.query = async (text: string, params?: any[]) => pool.query(text, params);
    dbAny.getClient = async () => pool.connect();
    dbAny.end = async () => pool.end();
    dbAny.pool = pool;

    cleanups.push(async () => {
      dbAny.query = originalQuery;
      dbAny.getClient = originalGetClient;
      dbAny.end = originalEnd;
      dbAny.pool = originalPool;
      await pool.end();
    });

    await pool.query('INSERT INTO users (email, clerk_user_id) VALUES ($1, $2)', [
      'caregiver@example.com',
      'user_123'
    ]);

    let stopCount = 0;
    let credentialDeleteCount = 0;
    let syncClearCount = 0;
    __setClerkWebhookTestHooks({
      stopCalendarWatchForUser: async () => {
        stopCount += 1;
      },
      deleteGoogleCredential: async () => {
        credentialDeleteCount += 1;
      },
      clearGoogleSyncForUser: async () => {
        syncClearCount += 1;
      }
    });
    cleanups.push(() => {
      __setClerkWebhookTestHooks(null);
    });

    const captureRawBody = (req: Request, _res: Response, buffer: Buffer): void => {
      if (buffer?.length) {
        (req as any).rawBody = buffer.toString('utf8');
      }
    };

    const app = express();
    app.use(express.json({ verify: captureRawBody }));
    app.use('/webhook/clerk', clerkWebhookRoutes);

    const payload = JSON.stringify({
      type: 'user.deleted',
      data: { id: 'user_123' }
    });

    const webhook = new Webhook(secret);
    const msgId = 'msg_' + Math.random().toString(36).slice(2);
    const timestamp = new Date();
    const signature = webhook.sign(msgId, timestamp, payload);
    const headers = {
      'svix-id': msgId,
      'svix-timestamp': Math.floor(timestamp.getTime() / 1000).toString(),
      'svix-signature': signature
    };

    const response = await request(app)
      .post('/webhook/clerk')
      .set('Content-Type', 'application/json')
      .set(headers)
      .send(payload);

    expect(response.status).toBe(204);
    expect(stopCount).toBe(1);
    expect(credentialDeleteCount).toBe(1);
    expect(syncClearCount).toBe(1);
  });
});
