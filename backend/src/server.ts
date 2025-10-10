// Load environment variables FIRST
import './env.js';

// Now import everything else
import express, { Request, Response } from 'express';
import session from 'express-session';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

import passportConfig from './auth/passport.js';
import authRoutes from './routes/auth.js';
import webhookRoutes from './routes/webhook.js';
import planRoutes from './routes/plan.js';
import calendarRoutes from './routes/calendar.js';
import uploadRoutes from './routes/upload.js';
import settingsRoutes from './routes/settings.js';
import reviewRoutes from './routes/review.js';

// Mobile API routes
import apiAuthRoutes from './routes/api/auth.js';
import apiPlanRoutes from './routes/api/plan.js';
import apiAppointmentsRoutes from './routes/api/appointments.js';
import apiBillsRoutes from './routes/api/bills.js';
import apiUploadRoutes from './routes/api/upload.js';

import { scheduleFridayDigest } from './jobs/digest.js';

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
app.get('/', (req: Request, res: Response) => {
  res.render('index', { user: req.user });
});

app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'ok' });
});

// Web routes
app.use('/auth', authRoutes);
app.use('/webhook', webhookRoutes);
app.use('/plan', planRoutes);
app.use('/calendar', calendarRoutes);
app.use('/upload', uploadRoutes);
app.use('/settings', settingsRoutes);
app.use('/review', reviewRoutes);

// Mobile API routes
app.use('/api/auth', apiAuthRoutes);
app.use('/api/plan', apiPlanRoutes);
app.use('/api/appointments', apiAppointmentsRoutes);
app.use('/api/bills', apiBillsRoutes);
app.use('/api/upload', apiUploadRoutes);

// Schedule jobs
scheduleFridayDigest();

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
  console.log(`Access from phone at http://172.27.88.132:${PORT}`);
});
