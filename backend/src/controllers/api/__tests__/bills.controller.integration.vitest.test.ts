import type { Request, Response, NextFunction } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const serviceMocks = vi.hoisted(() => ({
  deleteBillAsOwner: vi.fn(),
  fetchBillForUser: vi.fn(),
  markBillPaid: vi.fn(),
  updateBillAsCollaborator: vi.fn(),
  updateBillAsOwner: vi.fn()
}));

const validationMocks = vi.hoisted(() => ({
  validateBody: vi.fn(),
  validateParams: vi.fn()
}));

vi.mock('../../../services/billService.js', () => serviceMocks);
vi.mock('../../../utils/validation.js', () => validationMocks);

const { deleteBillAsOwner, fetchBillForUser, markBillPaid, updateBillAsCollaborator, updateBillAsOwner } =
  serviceMocks;
const { validateBody, validateParams } = validationMocks;

const module = await import('../bills.js');
const { getBill, patchBill, removeBill, markBillPaid: markBillPaidHandler } = module;

function createResponse() {
  const res = {
    status: vi.fn(function (this: Response) {
      return this;
    }),
    json: vi.fn(function (this: Response) {
      return this;
    })
  } as unknown as Response & {
    status: ReturnType<typeof vi.fn>;
    json: ReturnType<typeof vi.fn>;
  };

  res.status = vi.fn((code: number) => {
    (res as any).__status = code;
    return res;
  });
  res.json = vi.fn((payload: unknown) => {
    (res as any).__json = payload;
    return res;
  });
  return res;
}

const next: NextFunction = vi.fn();

const user = { id: 10 } as any;

describe('bill controllers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    validateBody.mockReset();
    validateParams.mockReset();
    validateParams.mockReturnValue({ id: 5 });
  });

  it('getBill returns bill data for authenticated user', async () => {
    const res = createResponse();
    fetchBillForUser.mockResolvedValueOnce({ id: 5, amount: 42 });

    await getBill({ user } as Request, res, next);

    expect(validateParams).toHaveBeenCalled();
    expect(fetchBillForUser).toHaveBeenCalledWith(user, 5);
    expect(res.json).toHaveBeenCalledWith({ id: 5, amount: 42 });
  });

  it('patchBill routes collaborator updates via status field', async () => {
    const res = createResponse();
    validateBody.mockReturnValue({ status: 'paid' });
    updateBillAsCollaborator.mockResolvedValueOnce({ id: 5, status: 'paid' });

    await patchBill({ user, body: { status: 'paid' } } as Request, res, next);

    expect(updateBillAsCollaborator).toHaveBeenCalledWith(user, 5, 'paid');
    expect(res.json).toHaveBeenCalledWith({ id: 5, status: 'paid' });
  });

  it('patchBill routes owner updates when status absent', async () => {
    const res = createResponse();
    validateBody.mockReturnValue({ amount: 120 });
    updateBillAsOwner.mockResolvedValueOnce({ id: 5, amount: 120 });

    await patchBill({ user, body: { amount: 120 } } as Request, res, next);

    expect(updateBillAsOwner).toHaveBeenCalledWith(user, 5, { amount: 120 });
    expect(res.json).toHaveBeenCalledWith({ id: 5, amount: 120 });
  });

  it('removeBill deletes and returns success payload', async () => {
    const res = createResponse();

    await removeBill({ user } as Request, res, next);

    expect(deleteBillAsOwner).toHaveBeenCalledWith(user, 5);
    expect(res.json).toHaveBeenCalledWith({ success: true });
  });

  it('markBillPaid delegates to service', async () => {
    const res = createResponse();
    markBillPaid.mockResolvedValueOnce({ id: 5, status: 'paid' });

    await markBillPaidHandler({ user } as Request, res, next);

    expect(markBillPaid).toHaveBeenCalledWith(user, 5);
    expect(res.json).toHaveBeenCalledWith({ id: 5, status: 'paid' });
  });

  it('handlers respond with 401 when user missing', async () => {
    const res1 = createResponse();

    await getBill({} as Request, res1, next);
    expect(res1.status).toHaveBeenCalledWith(401);

    const res2 = createResponse();
    await patchBill({ body: {} } as Request, res2, next);
    expect(res2.status).toHaveBeenCalledWith(401);
  });
});
