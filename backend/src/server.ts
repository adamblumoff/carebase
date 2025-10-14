// Load environment variables FIRST
import './env.js';

// Now import everything else
import express, { Request, Response } from 'express';
import session from 'express-session';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

import passportConfig from './auth/passport.js';
import { registerRoutes } from './routes/registry.js';

import { scheduleFridayDigest } from './jobs/digest.js';
import { attachBearerUser } from './middleware/attachBearerUser.js';
import { initRealtime } from './services/realtime.js';

const app = express();
const server = createServer(app);
const PORT = process.env.PORT || 3000;

const sessionMiddleware = session({
  secret: process.env.SESSION_SECRET || 'fallback-secret-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
});

const initializePassport = passportConfig.initialize();
const passportSession = passportConfig.session();

// Trust proxy (Railway runs behind a proxy)
if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(sessionMiddleware);
app.use(initializePassport);
app.use(passportSession);
app.use(attachBearerUser);

// View engine
app.set('view engine', 'ejs');
app.set('views', join(__dirname, 'views'));

// Static files
app.use(express.static(join(__dirname, 'public')));

// Routes
app.get('/', (req: Request, res: Response) => {
  res.render('index', { user: req.user });
});

app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'ok' });
});

registerRoutes(app);

// Schedule jobs
scheduleFridayDigest();

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

// Start server
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
