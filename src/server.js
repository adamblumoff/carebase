import dotenv from 'dotenv';
import { existsSync } from 'fs';
import express from 'express';
import session from 'express-session';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Load environment variables FIRST before any other imports
// .env.local takes precedence over .env for local development
if (existsSync('.env.local')) {
  dotenv.config({ path: '.env.local', override: true });
  console.log('Loaded .env.local (development mode)');
  console.log('Callback URL:', process.env.GOOGLE_CALLBACK_URL);
} else {
  dotenv.config();
  console.log('Loaded .env (production mode)');
}

// NOW import everything else after env vars are loaded
import passportConfig from './auth/passport.js';
import authRoutes from './routes/auth.js';
import webhookRoutes from './routes/webhook.js';
import planRoutes from './routes/plan.js';
import calendarRoutes from './routes/calendar.js';
import uploadRoutes from './routes/upload.js';
import settingsRoutes from './routes/settings.js';
import reviewRoutes from './routes/review.js';
import { scheduleFridayDigest } from './jobs/digest.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Trust proxy (Railway runs behind a proxy)
if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'fallback-secret-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));
app.use(passportConfig.initialize());
app.use(passportConfig.session());

// View engine
app.set('view engine', 'ejs');
app.set('views', join(__dirname, 'views'));

// Static files
app.use(express.static(join(__dirname, 'public')));

// Routes
app.get('/', (req, res) => {
  res.render('index', { user: req.user });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.use('/auth', authRoutes);
app.use('/webhook', webhookRoutes);
app.use('/plan', planRoutes);
app.use('/calendar', calendarRoutes);
app.use('/upload', uploadRoutes);
app.use('/settings', settingsRoutes);
app.use('/review', reviewRoutes);

// Schedule jobs
scheduleFridayDigest();

// Start server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
