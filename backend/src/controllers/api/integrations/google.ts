import type { Request, Response } from 'express';
import type { User } from '@carebase/shared';
import { route } from '../../../utils/httpHandler.js';
import { validateBody } from '../../../utils/validation.js';
import { googleConnectSchema, googleManualSyncSchema } from '../../../validators/googleIntegration.ts';
import {
  connectGoogleIntegration,
  disconnectGoogleIntegration,
  handleGoogleCallback,
  loadGoogleIntegrationStatus,
  manualGoogleSync,
  startGoogleIntegration,
  verifyUser
} from '../../../services/googleIntegrationService.js';
import { UnauthorizedError } from '../../../utils/errors.js';

export const startGoogleIntegrationHandler = route(async (req: Request, res: Response) => {
  const user = req.user as User | undefined;
  if (!user) {
    throw new UnauthorizedError();
  }
  const result = await startGoogleIntegration(user);
  res.json(result);
});

export async function googleIntegrationCallbackHandler(req: Request, res: Response): Promise<void> {
  const redirect = await handleGoogleCallback(req.query as Record<string, string>);
  res.redirect(redirect.redirect);
}

export const getGoogleIntegrationStatusHandler = route(async (req: Request, res: Response) => {
  const user = await verifyUser(req.user as User | undefined);
  const status = await loadGoogleIntegrationStatus(user);
  res.json(status);
});

export const connectGoogleIntegrationHandler = route(async (req: Request, res: Response) => {
  const user = await verifyUser(req.user as User | undefined);
  const payload = validateBody(req, googleConnectSchema);
  const result = await connectGoogleIntegration(user, payload);
  res.json(result);
});

export const disconnectGoogleIntegrationHandler = route(async (req: Request, res: Response) => {
  const user = await verifyUser(req.user as User | undefined);
  const result = await disconnectGoogleIntegration(user);
  res.json(result);
});

export const manualGoogleSyncHandler = route(async (req: Request, res: Response) => {
  const user = await verifyUser(req.user as User | undefined);
  const payload = validateBody(req, googleManualSyncSchema);
  const summary = await manualGoogleSync(user, {
    forceFull: payload.forceFull,
    calendarId: payload.calendarId ?? null,
    pullRemote: payload.pullRemote
  });
  res.json(summary);
});
