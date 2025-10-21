import type { Request, Response } from 'express';
import { z } from 'zod';
import type { User } from '@carebase/shared';
import {
  listPendingReviews,
  approvePendingBill,
  rejectPendingItem,
  saveBillDraft
} from '../../services/reviewService.js';
import { route } from '../../utils/httpHandler.js';
import { UnauthorizedError, ValidationError } from '../../utils/errors.js';
import { validateBody, validateParams } from '../../utils/validation.js';

const itemIdParamsSchema = z.object({
  itemId: z.coerce.number().int().positive()
});

const draftSchema = z
  .object({
    amount: z
      .union([z.number(), z.string()])
      .transform((value) => (value === '' ? null : Number(value)))
      .pipe(z.number().finite().nullable())
      .optional(),
    dueDate: z
      .union([z.string().min(1), z.null(), z.undefined()])
      .transform((value) => (value ? value : null))
      .optional(),
    statementDate: z
      .union([z.string().min(1), z.null(), z.undefined()])
      .transform((value) => (value ? value : null))
      .optional(),
    payUrl: z
      .union([z.string().url(), z.string().length(0), z.null(), z.undefined()])
      .transform((value) => (value ? value : null))
      .optional(),
    status: z
      .union([z.literal('todo'), z.literal('overdue'), z.literal('paid'), z.null(), z.undefined()])
      .transform((value) => (value ?? null))
      .optional(),
    notes: z
      .union([z.string(), z.null(), z.undefined()])
      .transform((value) => (value ?? null))
      .optional()
  })
  .partial();

const reviewActionSchema = z.object({
  action: z.enum(['approve', 'reject', 'save']),
  bill: draftSchema.optional(),
  reason: z
    .union([z.string().max(500), z.null(), z.undefined()])
    .transform((value) => (value ?? null))
    .optional()
});

export const getPendingReviewsHandler = route(async (req: Request, res: Response) => {
  const user = req.user as User | undefined;
  if (!user) {
    throw new UnauthorizedError();
  }

  const payload = await listPendingReviews(user);
  res.json(payload);
});

export const updatePendingReviewHandler = route(async (req: Request, res: Response) => {
  const user = req.user as User | undefined;
  if (!user) {
    throw new UnauthorizedError();
  }

  const { itemId } = validateParams(req, itemIdParamsSchema);
  const { action, bill, reason } = validateBody(req, reviewActionSchema);

  if ((action === 'approve' || action === 'save') && !bill) {
    throw new ValidationError({ field: 'bill', message: 'Bill payload is required for this action' });
  }

  if (action === 'approve') {
    const result = await approvePendingBill(user, itemId, bill ?? {});
    res.json({ status: 'approved', bill: result });
    return;
  }

  if (action === 'save') {
    const draft = await saveBillDraft(user, itemId, bill ?? {});
    res.json({ status: 'saved', draft });
    return;
  }

  await rejectPendingItem(user, itemId, reason ?? null);
  res.json({ status: 'rejected' });
});
