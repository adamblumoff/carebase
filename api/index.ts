import { config } from 'dotenv';
import fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { fastifyTRPCPlugin } from '@trpc/server/adapters/fastify';
import { appRouter } from './trpc/root';
import { createContext } from './trpc/context';

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

  server.register(fastifyTRPCPlugin, {
    prefix: '/trpc',
    trpcOptions: { router: appRouter, createContext },
  });
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
