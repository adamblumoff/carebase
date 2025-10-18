// Load environment variables FIRST
import './env.js';

// Now import everything else
import express, { Request, Response } from 'express';
import session from 'express-session';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import connectPgSimple from 'connect-pg-simple';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

import passportConfig from './auth/passport.js';
import { registerRoutes } from './routes/registry.js';

import { attachBearerUser } from './middleware/attachBearerUser.js';
import { initRealtime } from './services/realtime.js';
import { startGoogleSyncPolling } from './services/googleSync.js';
import { databaseSslConfig } from './db/client.js';

const app = express();
const server = createServer(app);
const PORT = process.env.PORT || 3000;
const isProduction = process.env.NODE_ENV === 'production';

const PgSessionStore = connectPgSimple(session);
const sessionStore = new PgSessionStore({
  conObject: {
    connectionString: process.env.DATABASE_URL,
    ...(databaseSslConfig ? { ssl: databaseSslConfig } : {})
  },
  tableName: 'user_sessions',
  createTableIfMissing: true
});

function captureRawBody(req: Request, _res: Response, buffer: Buffer): void {
  if (buffer?.length) {
    (req as any).rawBody = buffer.toString('utf8');
  }
}

const sessionMiddleware = session({
  name: 'carebase.sid',
  store: sessionStore,
  secret: process.env.SESSION_SECRET!,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: isProduction,
    httpOnly: true,
    sameSite: 'strict',
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
});

const initializePassport = passportConfig.initialize();
const passportSession = passportConfig.session();

// Trust proxy (Railway runs behind a proxy)
if (isProduction) {
  app.set('trust proxy', 1);
}

// Middleware
app.use(express.json({ limit: '1mb', verify: captureRawBody }));
app.use(express.urlencoded({ extended: true, limit: '1mb', verify: captureRawBody }));
app.use(sessionMiddleware);
app.use(initializePassport);
app.use(passportSession);
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
io.use((socket, next) => sessionMiddleware(socket.request as any, {} as any, next as any));
io.use((socket, next) => initializePassport(socket.request as any, {} as any, next as any));
io.use((socket, next) => passportSession(socket.request as any, {} as any, next as any));
initRealtime(io);
// Start Google sync polling only when explicitly enabled.
if (process.env.GOOGLE_SYNC_POLLING_ENABLED === 'true') {
  startGoogleSyncPolling();
}

// Start server
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
