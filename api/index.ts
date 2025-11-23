import { config } from 'dotenv';
import fastify from 'fastify';
import cors from '@fastify/cors';
import { fastifyTRPCPlugin } from '@trpc/server/adapters/fastify';
import { appRouter } from './trpc/root';
import { createContext } from './trpc/context';

config({ path: '.env' });

const server = fastify({
  logger: true,
});

await server.register(cors, {
  origin:
    process.env.CORS_ORIGIN?.split(',')
      .map((o) => o.trim())
      .filter(Boolean) || '*',
});

server.get('/healthz', async () => ({ ok: true }));

server.register(fastifyTRPCPlugin, {
  prefix: '/trpc',
  trpcOptions: { router: appRouter, createContext },
});

const port = Number(process.env.PORT ?? process.env.API_PORT ?? 3000);
const host = process.env.API_HOST ?? '0.0.0.0';

const start = async () => {
  try {
    await server.listen({ port, host });
    server.log.info(`API running on http://${host}:${port}`);
  } catch (error) {
    server.log.error(error);
    process.exit(1);
  }
};

void start();
