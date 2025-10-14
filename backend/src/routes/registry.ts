import type { Express, Router } from 'express';
import authRoutes from './auth.js';
import webhookRoutes from './webhook.js';
import planRoutes from './plan.js';
import calendarRoutes from './calendar.js';
import uploadRoutes from './upload.js';
import settingsRoutes from './settings.js';
import reviewRoutes from './review.js';

import apiAuthRoutes from './api/auth.js';
import apiPlanRoutes from './api/plan.js';
import apiAppointmentsRoutes from './api/appointments.js';
import apiBillsRoutes from './api/bills.js';
import apiUploadRoutes from './api/upload.js';

export interface RouterRegistration {
  basePath: string;
  router: Router;
  scope: 'web' | 'api';
  description: string;
}

export interface RouteDefinition {
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  path: string;
  description: string;
}

export const ROUTER_REGISTRATIONS: RouterRegistration[] = [
  { basePath: '/auth', router: authRoutes, scope: 'web', description: 'Web auth + session management' },
  { basePath: '/webhook', router: webhookRoutes, scope: 'web', description: 'Inbound Postmark webhook' },
  { basePath: '/plan', router: planRoutes, scope: 'web', description: 'Web plan viewer' },
  { basePath: '/calendar', router: calendarRoutes, scope: 'web', description: 'ICS feeds' },
  { basePath: '/upload', router: uploadRoutes, scope: 'web', description: 'Web bill upload' },
  { basePath: '/settings', router: settingsRoutes, scope: 'web', description: 'Web settings' },
  { basePath: '/review', router: reviewRoutes, scope: 'web', description: 'Low-confidence review tools' },
  { basePath: '/api/auth', router: apiAuthRoutes, scope: 'api', description: 'Mobile auth APIs' },
  { basePath: '/api/plan', router: apiPlanRoutes, scope: 'api', description: 'Plan data APIs' },
  { basePath: '/api/appointments', router: apiAppointmentsRoutes, scope: 'api', description: 'Appointment CRUD APIs' },
  { basePath: '/api/bills', router: apiBillsRoutes, scope: 'api', description: 'Bill CRUD APIs' },
  { basePath: '/api/upload', router: apiUploadRoutes, scope: 'api', description: 'Mobile photo upload API' },
];

export const API_ROUTE_MAP: RouteDefinition[] = [
  { method: 'GET', path: '/api/auth/session', description: 'Return auth status and user profile' },
  { method: 'POST', path: '/api/auth/logout', description: 'Invalidate current session (mobile)' },
  { method: 'GET', path: '/api/auth/user', description: 'Return authenticated user details' },
  { method: 'POST', path: '/api/auth/mobile-login', description: 'Exchange OAuth token for bearer access token' },
  { method: 'GET', path: '/api/plan', description: 'Retrieve weekly appointments and bills' },
  { method: 'GET', path: '/api/plan/version', description: 'Retrieve latest plan version number + timestamp' },
  { method: 'GET', path: '/api/appointments/:id', description: 'Fetch appointment by id' },
  { method: 'PATCH', path: '/api/appointments/:id', description: 'Update appointment fields' },
  { method: 'DELETE', path: '/api/appointments/:id', description: 'Delete appointment' },
  { method: 'GET', path: '/api/bills/:id', description: 'Fetch bill by id' },
  { method: 'PATCH', path: '/api/bills/:id', description: 'Update bill fields' },
  { method: 'DELETE', path: '/api/bills/:id', description: 'Delete bill' },
  { method: 'POST', path: '/api/bills/:id/mark-paid', description: 'Mark bill as paid' },
  { method: 'POST', path: '/api/upload/photo', description: 'Upload bill photo for OCR + ingestion' },
];

export function registerRoutes(app: Express): void {
  ROUTER_REGISTRATIONS.forEach(({ basePath, router }) => {
    app.use(basePath, router);
  });
}
