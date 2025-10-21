import type { Express, Router } from 'express';
import authRoutes from './auth.js';
import webhookRoutes from './webhook.js';
import collaboratorsWebRoutes from './collaborators.js';

import apiAuthRoutes from './api/auth.js';
import apiPlanRoutes from './api/plan.js';
import apiAppointmentsRoutes from './api/appointments.js';
import apiBillsRoutes from './api/bills.js';
import apiUploadRoutes from './api/upload.js';
import apiCollaboratorRoutes from './api/collaborators.js';
import apiGoogleIntegrationRoutes from './api/integrations/google.js';
import apiReviewRoutes from './api/review.js';
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
  '/collaborators': collaboratorsWebRoutes,
  '/api/auth': apiAuthRoutes,
  '/api/plan': apiPlanRoutes,
  '/api/appointments': apiAppointmentsRoutes,
  '/api/bills': apiBillsRoutes,
  '/api/upload': apiUploadRoutes,
  '/api/collaborators': apiCollaboratorRoutes,
  '/api/integrations/google': apiGoogleIntegrationRoutes,
  '/api/review': apiReviewRoutes,
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
