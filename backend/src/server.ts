// Load environment variables FIRST
import './env.js';

// Now import everything else
import express, { Request, Response, type RequestHandler } from 'express';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { clerkMiddleware } from '@clerk/express';

import { registerRoutes } from './routes/registry.js';

import { attachBearerUser } from './middleware/attachBearerUser.js';
import { initRealtime } from './services/realtime.js';
import { startGoogleSyncPolling } from './services/googleSync.js';
import { getClerkClient } from './services/clerkAuthGateway.js';
import { configureClerkJwks } from './services/clerkJwksManager.js';
import { bootstrapDatabase } from './db/bootstrap.js';

const app = express();
const server = createServer(app);
const PORT = process.env.PORT || 3000;
const isProduction = process.env.NODE_ENV === 'production';

function captureRawBody(req: Request, _res: Response, buffer: Buffer): void {
  if (buffer?.length) {
    (req as any).rawBody = buffer.toString('utf8');
  }
}

let clerkMiddlewareHandler: RequestHandler | null = null;
const clerkClient = getClerkClient();
if (clerkClient) {
  clerkMiddlewareHandler = clerkMiddleware({
    clerkClient,
    debug: process.env.NODE_ENV !== 'production',
    jwtKey: process.env.CLERK_JWT_TEMPLATE_NAME ?? undefined
  });
  configureClerkJwks({
    issuer: process.env.CLERK_JWKS_ISSUER ?? null,
    refreshIntervalMs: process.env.CLERK_JWKS_REFRESH_INTERVAL_MS
      ? Number.parseInt(process.env.CLERK_JWKS_REFRESH_INTERVAL_MS, 10)
      : undefined,
    prefetchTimeoutMs: process.env.CLERK_JWKS_PREFETCH_TIMEOUT_MS
      ? Number.parseInt(process.env.CLERK_JWKS_PREFETCH_TIMEOUT_MS, 10)
      : undefined
  });
}

await bootstrapDatabase().catch((error) => {
  console.error('[Bootstrap] Database bootstrap failed', error);
});

// Trust proxy (Railway runs behind a proxy)
if (isProduction) {
  app.set('trust proxy', 1);
}

// Middleware
app.use(express.json({ limit: '1mb', verify: captureRawBody }));
app.use(express.urlencoded({ extended: true, limit: '1mb', verify: captureRawBody }));
if (clerkMiddlewareHandler) {
  app.use(clerkMiddlewareHandler);
}
app.use(attachBearerUser);

// View engine
// Routes
app.get('/', (_req: Request, res: Response) => {
  res.json({ status: 'ok', message: 'Carebase API is running' });
});

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok' });
});

registerRoutes(app);

// Initialize realtime
const io = new SocketIOServer(server, {
  cors: {
    origin: '*',
    credentials: true
  }
});
initRealtime(io);
// Start Google sync polling only when explicitly enabled.
if (process.env.GOOGLE_SYNC_POLLING_ENABLED === 'true') {
  startGoogleSyncPolling();
}

// Start server
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
