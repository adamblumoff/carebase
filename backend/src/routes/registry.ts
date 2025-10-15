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
import apiCollaboratorRoutes from './api/collaborators.js';
import { ROUTER_METADATA, API_ROUTE_METADATA, type RouterMeta, type RouteMeta } from './registry.metadata.js';

export interface RouterRegistration {
  basePath: string;
  router: Router;
  scope: 'web' | 'api';
  description: string;
}

export interface RouteDefinition extends RouteMeta {}

const routerLookup: Record<string, Router> = {
  '/auth': authRoutes,
  '/webhook': webhookRoutes,
  '/plan': planRoutes,
  '/calendar': calendarRoutes,
  '/upload': uploadRoutes,
  '/settings': settingsRoutes,
  '/review': reviewRoutes,
  '/api/auth': apiAuthRoutes,
  '/api/plan': apiPlanRoutes,
  '/api/appointments': apiAppointmentsRoutes,
  '/api/bills': apiBillsRoutes,
  '/api/upload': apiUploadRoutes,
  '/api/collaborators': apiCollaboratorRoutes,
};

export const ROUTER_REGISTRATIONS: RouterRegistration[] = ROUTER_METADATA.map((meta) => ({
  ...meta,
  router: routerLookup[meta.basePath],
}));

export const API_ROUTE_MAP: RouteDefinition[] = [...API_ROUTE_METADATA];

export function registerRoutes(app: Express): void {
  ROUTER_REGISTRATIONS.forEach(({ basePath, router }) => {
    app.use(basePath, router);
  });
}
