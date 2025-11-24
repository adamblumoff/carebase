import { config } from 'dotenv';
import fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { fastifyTRPCPlugin } from '@trpc/server/adapters/fastify';
import { sql } from 'drizzle-orm';
import { appRouter } from './trpc/root';
import { createContext } from './trpc/context';
import { posthog } from './lib/posthog';
import { db } from './db/client';
import { createOAuthClient, googleScope, verifyState } from './lib/google';
import { sources } from './db/schema';
import { syncSource } from './modules/ingestion/router';
import { syncCalendarSource } from './modules/ingestion/calendar';
import { debounceRun, verifyPubsubJwt } from './lib/pubsub';
import { renewSource, fallbackPoll } from './lib/watch';
import { Ticker } from './lib/scheduler';

config({ path: '.env' });

const server = fastify({
  logger: true,
});

const registerPlugins = async () => {
  await server.register(cors, {
    origin: '*',
  });

  await server.register(rateLimit, {
    max: Number(process.env.RATE_LIMIT_MAX ?? 100),
    timeWindow: process.env.RATE_LIMIT_WINDOW ?? '1 minute',
    hook: 'onSend',
  });

  server.get('/healthz', async () => ({ ok: true }));

  // OAuth redirect catcher for Expo/WebBrowser flows
  server.get('/auth/google/callback', async (_request, reply) => {
    const url = new URL(_request.url ?? '', `https://${_request.headers.host ?? 'localhost'}`);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    let message = 'Google connected. You can close this window.';

    if (code && state) {
      try {
        const { caregiverId } = verifyState(state);
        const client = createOAuthClient();
        client.redirectUri = process.env.GOOGLE_REDIRECT_URI;

        const { tokens } = await client.getToken({ code, scope: googleScope });

        if (!tokens.refresh_token) {
          throw new Error(
            'No refresh token returned. Ensure prompt=consent & access_type=offline.'
          );
        }

        const tokenInfo = await client.getTokenInfo(tokens.access_token ?? '');
        const accountEmail = tokenInfo.email ?? 'unknown';

        await db
          .insert(sources)
          .values({
            caregiverId,
            provider: 'gmail',
            accountEmail,
            refreshToken: tokens.refresh_token,
            scopes: googleScope,
            status: 'active',
          })
          .onConflictDoUpdate({
            target: [sources.caregiverId, sources.provider, sources.accountEmail],
            set: {
              refreshToken: tokens.refresh_token,
              scopes: googleScope,
              status: 'active',
              updatedAt: new Date(),
            },
          });
      } catch (err: any) {
        _request.log.error({ err }, 'oauth callback failed');
        message = `Google connect failed: ${err?.message ?? 'unknown error'}`;
      }
    }

    const html = `<!doctype html>
<html>
  <head><title>Carebase</title></head>
  <body style="font-family: sans-serif; display:flex; align-items:center; justify-content:center; height:100vh;">
    <div>
      <h2>${message}</h2>
      <p>You can close this window.</p>
    </div>
    <script>
      try {
        if (window.ReactNativeWebView) {
          window.ReactNativeWebView.postMessage(window.location.href);
        }
        window.close();
      } catch (e) {}
    </script>
  </body>
</html>`;

    return reply.header('Content-Type', 'text/html').send(html);
  });

  server.post('/webhooks/google/push', { logLevel: 'warn' }, async (request, reply) => {
    const authHeader = request.headers.authorization;
    const audience = `https://${request.headers.host}/webhooks/google/push`;

    // Gmail Pub/Sub push includes a JWT; Calendar web_hook does not. Only verify when present.
    if (authHeader) {
      try {
        await verifyPubsubJwt(authHeader, audience);
      } catch (err) {
        request.log.error({ err }, 'pubsub jwt verification failed');
        return reply.status(401).send({ ok: false });
      }
    }

    const token = process.env.GOOGLE_PUBSUB_VERIFICATION_TOKEN;
    const headerToken = request.headers['x-goog-channel-token'];
    if (token && headerToken && token !== headerToken) {
      request.log.warn('pubsub verification token mismatch');
      return reply.status(401).send({ ok: false });
    }

    const channelId = request.headers['x-goog-channel-id'] as string | undefined;
    const resourceId = request.headers['x-goog-resource-id'] as string | undefined;

    // Pub/Sub push payload (Gmail) comes in the body and lacks channel headers.
    const pubsubMessage = (request.body as any)?.message;
    let pubsubEmail: string | undefined;
    if (pubsubMessage?.data) {
      try {
        const decoded = JSON.parse(Buffer.from(pubsubMessage.data, 'base64').toString('utf8'));
        pubsubEmail = decoded?.emailAddress;
      } catch (err) {
        if (process.env.DEBUG_PUSH_LOGS === 'true') {
          request.log.debug({ err }, 'pubsub decode failed');
        }
      }
    }

    if (!channelId && !resourceId && !pubsubEmail) {
      if (process.env.DEBUG_PUSH_LOGS === 'true') {
        request.log.debug('push missing channel/resource id');
      }
      return reply.status(202).send({ ok: true, message: 'missing channel/resource id' });
    }

    const [source] = await db
      .select()
      .from(sources)
      .where(
        pubsubEmail
          ? sql`${sources.accountEmail} = ${pubsubEmail}`
          : sql`${sources.watchId} = ${channelId} OR ${sources.calendarChannelId} = ${channelId}`
      )
      .limit(1);

    if (!source) {
      if (process.env.DEBUG_PUSH_LOGS === 'true') {
        request.log.debug({ channelId }, 'no source for channel');
      }
      return reply.status(202).send({ ok: true });
    }

    debounceRun(source.id, 2000, () => {
      const runner = source.calendarChannelId === channelId ? syncCalendarSource : syncSource;
      runner({
        ctx: { db, req: request },
        sourceId: source.id,
        caregiverIdOverride: source.caregiverId,
        caregiverId: source.caregiverId,
        reason: 'push',
      } as any).catch((err: any) => {
        request.log.error({ err }, 'sync push failed');
      });
    });

    return reply.status(202).send({ ok: true });
  });

  // Pub/Sub may probe with GET; respond 200 to avoid noisy 404s
  server.get('/webhooks/google/push', async (_request, reply) => {
    return reply.status(200).send({ ok: true });
  });

  server.register(fastifyTRPCPlugin, {
    prefix: '/trpc',
    trpcOptions: { router: appRouter, createContext },
  });

  // telemetry hook
  server.addHook('onResponse', async (request, reply) => {
    if (!posthog) return;

    const durationMs = reply.getResponseTime();
    posthog.capture({
      distinctId: request.headers['x-user-id']?.toString() ?? 'anonymous',
      event: 'api_request',
      properties: {
        path: request.url,
        method: request.method,
        status: reply.statusCode,
        duration_ms: durationMs,
        request_id: request.id,
      },
    });
  });

  const renewalTicker = new Ticker(60 * 60 * 1000, async () => {
    const soon = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const candidates = await db
      .select()
      .from(sources)
      .where(
        sql`${sources.status} = 'active' AND (${sources.watchExpiration} IS NULL OR ${sources.watchExpiration} < ${soon})`
      );
    for (const src of candidates) {
      try {
        await renewSource(src);
      } catch (err) {
        server.log.error({ err, sourceId: src.id }, 'renew watch failed');
      }
    }
  });

  const fallbackTicker = new Ticker(3 * 60 * 1000, async () => {
    const stale = new Date(Date.now() - 10 * 60 * 1000);
    const list = await db
      .select()
      .from(sources)
      .where(
        sql`${sources.status} = 'active' AND (${sources.watchExpiration} IS NULL OR ${sources.watchExpiration} < NOW() OR ${sources.lastSyncAt} IS NULL OR ${sources.lastSyncAt} < ${stale})`
      );
    for (const src of list) {
      try {
        await fallbackPoll(src);
      } catch (err) {
        server.log.error({ err, sourceId: src.id }, 'fallback poll failed');
      }
    }
  });

  renewalTicker.start();
  fallbackTicker.start();
};

const port = Number(process.env.PORT ?? process.env.API_PORT ?? 8080);
const host = process.env.API_HOST ?? '0.0.0.0';

const start = async () => {
  try {
    await registerPlugins();
    await server.listen({ port, host });
    server.log.info(`API running on http://${host}:${port}`);
  } catch (error) {
    server.log.error(error);
    process.exit(1);
  }
};

void start();
