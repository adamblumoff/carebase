import type { Request, Response } from 'express';
import type { User } from '@carebase/shared';
import { z } from 'zod';
import { buildPlanPayload, getPlanVersionForUser } from '../../services/planService.js';
import { validateQuery } from '../../utils/validation.js';
import { UnauthorizedError } from '../../utils/errors.js';
import { route } from '../../utils/httpHandler.js';

export const getPlan = route(async (req: Request, res: Response) => {
  const user = req.user as User | undefined;
  if (!user) {
    throw new UnauthorizedError();
  }

  const { days } = validateQuery(
    req,
    z.object({
      days: z.coerce.number().int().min(1).max(30).optional()
    })
  );

  const payload = await buildPlanPayload(user, days ?? 7);
  res.json(payload);
});

export const getPlanVersionHandler = route(async (req: Request, res: Response) => {
  const user = req.user as User | undefined;
  if (!user) {
    throw new UnauthorizedError();
  }

  const { planVersion, planUpdatedAt } = await getPlanVersionForUser(user);
  res.json({ planVersion, planUpdatedAt });
});
