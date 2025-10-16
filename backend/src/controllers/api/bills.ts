import type { Request, Response } from 'express';
import type { BillStatus, User } from '@carebase/shared';
import {
  deleteBillAsOwner,
  fetchBillForUser,
  markBillPaid as markBillPaidService,
  updateBillAsCollaborator,
  updateBillAsOwner
} from '../../services/billService.js';
import { billContributorUpdateSchema, billIdParamsSchema, billOwnerUpdateSchema } from '../../validators/bills.ts';
import { validateBody, validateParams } from '../../utils/validation.js';
import { route } from '../../utils/httpHandler.js';
import { UnauthorizedError } from '../../utils/errors.js';

export const getBill = route(async (req: Request, res: Response) => {
  const user = req.user as User | undefined;
  if (!user) {
    throw new UnauthorizedError();
  }

  const { id } = validateParams(req, billIdParamsSchema);
  const bill = await fetchBillForUser(user, id);
  res.json(bill);
});

export const patchBill = route(async (req: Request, res: Response) => {
  const user = req.user as User | undefined;
  if (!user) {
    throw new UnauthorizedError();
  }

  const { id } = validateParams(req, billIdParamsSchema);
  const body = req.body;

  if ((body as { status?: BillStatus }).status !== undefined) {
    const contributorPayload = validateBody(req, billContributorUpdateSchema);
    const updated = await updateBillAsCollaborator(user, id, contributorPayload.status);
    res.json(updated);
    return;
  }

  const ownerPayload = validateBody(req, billOwnerUpdateSchema);
  const updated = await updateBillAsOwner(user, id, ownerPayload);
  res.json(updated);
});

export const removeBill = route(async (req: Request, res: Response) => {
  const user = req.user as User | undefined;
  if (!user) {
    throw new UnauthorizedError();
  }

  const { id } = validateParams(req, billIdParamsSchema);
  await deleteBillAsOwner(user, id);
  res.json({ success: true });
});

export const markBillPaid = route(async (req: Request, res: Response) => {
  const user = req.user as User | undefined;
  if (!user) {
    throw new UnauthorizedError();
  }

  const { id } = validateParams(req, billIdParamsSchema);
  const updated = await markBillPaidService(user, id);
  res.json(updated);
});
