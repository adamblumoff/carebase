import { config } from 'dotenv';
import fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { fastifyTRPCPlugin, fastifyRequestHandler } from '@trpc/server/adapters/fastify';
import { sql, eq } from 'drizzle-orm';
import { appRouter } from './trpc/root';
import { createContext } from './trpc/context';
import { posthog } from './lib/posthog';
import { db } from './db/client';
import {
  createOAuthClient,
  googleScope,
  verifyState,
  signWebhookToken,
  setOAuthRedirectUri,
} from './lib/google';
import { careRecipientMemberships, sources } from './db/schema';
import { syncSource } from './modules/ingestion/router';
import { syncCalendarSource } from './modules/ingestion/calendar';
import { debounceRun, verifyPubsubJwt } from './lib/pubsub';
import { renewSource, fallbackPoll } from './lib/watch';
import { Ticker } from './lib/scheduler';
import { WebSocketServer } from 'ws';
import { applyWSSHandler } from '@trpc/server/adapters/ws';

config({ path: '.env' });

const isProd = process.env.NODE_ENV === 'production';
const enablePrettyLogs =
  process.env.LOG_PRETTY === 'true' ||
  (!isProd && process.stdout.isTTY && process.env.NO_PRETTY_LOGS !== 'true');

const server = fastify({
  logger: enablePrettyLogs
    ? {
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'HH:MM:ss.l',
            singleLine: false,
            ignore: 'pid,hostname',
          },
        },
      }
    : true,
});

const registerPlugins = async () => {
  await server.register(cors, {
    origin: '*',
  });

  await server.register(rateLimit, {
    max: Number(process.env.RATE_LIMIT_MAX ?? 100),
    timeWindow: process.env.RATE_LIMIT_WINDOW ?? '1 minute',
  });

  server.addHook('onError', async (request, _reply, error) => {
    request.log.error({ err: error }, 'request error');
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
        setOAuthRedirectUri(client, process.env.GOOGLE_REDIRECT_URI ?? '');

        const tokenResponse = client.getToken(code);
        const tokens = (await tokenResponse).tokens;

        if (!tokens.refresh_token) {
          throw new Error(
            'No refresh token returned. Ensure prompt=consent & access_type=offline.'
          );
        }

        const tokenInfo = await client.getTokenInfo(tokens.access_token ?? '');
        const accountEmail = tokenInfo.email ?? 'unknown';

        const [membership] = await db
          .select({
            careRecipientId: careRecipientMemberships.careRecipientId,
            role: careRecipientMemberships.role,
          })
          .from(careRecipientMemberships)
          .where(eq(careRecipientMemberships.caregiverId, caregiverId))
          .limit(1);

        const shouldBecomePrimary = await (async () => {
          if (membership?.careRecipientId && membership?.role === 'owner') {
            const [existingPrimary] = await db
              .select({ id: sources.id })
              .from(sources)
              .innerJoin(
                careRecipientMemberships,
                eq(careRecipientMemberships.caregiverId, sources.caregiverId)
              )
              .where(
                sql`${careRecipientMemberships.careRecipientId} = ${membership.careRecipientId} AND ${sources.provider} = 'gmail' AND ${sources.isPrimary} = true`
              )
              .limit(1);
            return !existingPrimary;
          }

          const [anyForCaregiver] = await db
            .select({ id: sources.id })
            .from(sources)
            .where(sql`${sources.caregiverId} = ${caregiverId} AND ${sources.provider} = 'gmail'`)
            .limit(1);
          return !anyForCaregiver;
        })();

        await db
          .insert(sources)
          .values({
            caregiverId,
            provider: 'gmail',
            accountEmail,
            refreshToken: tokens.refresh_token,
            scopes: googleScope,
            status: 'active',
            isPrimary: shouldBecomePrimary,
          })
          .onConflictDoUpdate({
            target: [sources.caregiverId, sources.provider, sources.accountEmail],
            set: {
              refreshToken: tokens.refresh_token,
              scopes: googleScope,
              status: 'active',
              isPrimary: shouldBecomePrimary ? true : sources.isPrimary,
              updatedAt: new Date(),
            },
          });
      } catch (err: any) {
        _request.log.error({ err }, 'oauth callback failed');
        message = `Google connect failed: ${err?.message ?? 'unknown error'}`;
      }
    }

    const escapeHtml = (str: string) =>
      str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');

    const html = `<!doctype html>
<html>
  <head><title>Carebase</title></head>
  <body style="font-family: sans-serif; display:flex; align-items:center; justify-content:center; height:100vh;">
    <div>
      <h2>${escapeHtml(message)}</h2>
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

  server.post('/webhooks/google/push', { logLevel: 'info' }, async (request, reply) => {
    request.log.info({ headers: request.headers }, 'push webhook received');
    const authHeader = request.headers.authorization;
    const audience = `https://${request.headers.host}/webhooks/google/push`;

    const headerToken = request.headers['x-goog-channel-token'] as string | undefined;

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

    if (!source.isPrimary) {
      if (process.env.DEBUG_PUSH_LOGS === 'true') {
        request.log.debug({ sourceId: source.id }, 'skip push: non-primary source');
      }
      return reply.status(202).send({ ok: true });
    }

    const isPubsubPush = Boolean(pubsubMessage);

    if (isPubsubPush) {
      if (!authHeader) {
        return reply.status(401).send({ ok: false, message: 'missing jwt' });
      }
      try {
        await verifyPubsubJwt(authHeader, audience);
      } catch (err) {
        request.log.error({ err }, 'pubsub jwt verification failed');
        return reply.status(401).send({ ok: false });
      }
    } else {
      const expectedToken = signWebhookToken(source.id);
      if (!headerToken || headerToken !== expectedToken) {
        request.log.warn('calendar webhook token mismatch');
        return reply.status(401).send({ ok: false });
      }
    }

    debounceRun(source.id, 100, () => {
      const runner = source.calendarChannelId === channelId ? syncCalendarSource : syncSource;
      runner({
        ctx: { db, req: request },
        sourceId: source.id,
        caregiverIdOverride: source.caregiverId,
        caregiverId: source.caregiverId,
        reason: 'push',
      } as any)
        .then((res: any) => {
          request.log.info({ sourceId: source.id, result: res }, 'push sync completed');
        })
        .catch((err: any) => {
          request.log.error({ err }, 'sync push failed');
        });
    });

    // record last push time
    db.update(sources)
      .set({ lastPushAt: new Date(), updatedAt: new Date() })
      .where(eq(sources.id, source.id))
      .catch((err) => request.log.error({ err }, 'update lastPushAt failed'));

    return reply.status(202).send({ ok: true });
  });

  // Pub/Sub may probe with GET; respond 200 to avoid noisy 404s
  server.get('/webhooks/google/push', async (_request, reply) => {
    return reply.status(200).send({ ok: true });
  });

  // Mount tRPC under /trpc without double-prefixing.
  (fastifyTRPCPlugin as any).default = (fastifyTRPCPlugin as any).default ?? fastifyTRPCPlugin;
  server.register(
    async (app) => {
      app.register(fastifyTRPCPlugin as any, {
        trpcOptions: { router: appRouter, createContext },
      });
    },
    { prefix: '/trpc' }
  );

  // Safety net: if no route matched but path starts with /trpc/, forward to tRPC handler.
  server.setNotFoundHandler(async (req, res) => {
    const url = req.raw.url ?? '';
    const prefix = '/trpc/';
    if (url.startsWith(prefix)) {
      const path = url.slice(prefix.length).split('?')[0];
      await fastifyRequestHandler({
        path,
        req,
        res,
        router: appRouter,
        createContext,
      });
      return;
    }
    res.status(404).send({ ok: false });
  });

  // telemetry hook
  server.addHook('onResponse', async (request, reply) => {
    if (!posthog) return;

    const durationMs = reply.elapsedTime;
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
        server.log.info({ sourceId: src.id }, 'renew watch succeeded');
      } catch (err) {
        server.log.error({ err, sourceId: src.id }, 'renew watch failed');
      }
    }
  });

  const fallbackTicker = new Ticker(5 * 60 * 1000, async () => {
    const stale = new Date(Date.now() - 6 * 60 * 1000);
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

  renewalTicker.start(true);
  fallbackTicker.start(true);

  // one-time bootstrap to ensure watches exist for all active sources
  try {
    const activeSources = await db
      .select()
      .from(sources)
      .where(sql`${sources.status} = 'active'`);
    for (const src of activeSources) {
      try {
        await renewSource(src);
        server.log.info({ sourceId: src.id }, 'bootstrap renew succeeded');
      } catch (err) {
        server.log.error({ err, sourceId: src.id }, 'bootstrap renew failed');
      }
    }
  } catch (err) {
    server.log.error({ err }, 'bootstrap renew sweep failed');
  }
};

const port = Number(process.env.PORT ?? process.env.API_PORT ?? 8080);
const host = process.env.API_HOST ?? '0.0.0.0';

const start = async () => {
  try {
    await registerPlugins();
    await server.listen({ port, host });

    const wss = new WebSocketServer({ server: server.server });
    applyWSSHandler({
      wss,
      router: appRouter,
      path: '/trpc',
      createContext: (opts) =>
        createContext({
          // Attach Fastify logger so downstream ctx.req.log works.
          req: Object.assign(opts.req, { log: server.log }) as any,
          info: { connectionParams: opts.info?.connectionParams },
        } as any),
      onError: (err) => {
        server.log.error({ err }, 'ws handler error');
      },
      onConnect: (info) => {
        server.log.info({ url: info.req.url }, 'ws connect');
      },
    });

    server.log.info(`API running on http://${host}:${port}`);
  } catch (error) {
    server.log.error(error);
    process.exit(1);
  }
};

void start();
