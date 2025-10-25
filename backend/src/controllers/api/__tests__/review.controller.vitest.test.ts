import type { Request, Response, NextFunction } from 'express';
import { describe, it, expect, beforeEach, vi } from 'vitest';

const listPendingReviews = vi.fn();
const approvePendingBill = vi.fn();
const rejectPendingItem = vi.fn();
const saveBillDraft = vi.fn();

vi.mock('../../../services/reviewService.js', () => ({
  listPendingReviews,
  approvePendingBill,
  rejectPendingItem,
  saveBillDraft
}));

const mod = await import('../review.js');
const { getPendingReviewsHandler, updatePendingReviewHandler } = mod;

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

function createNext(): NextFunction {
  return vi.fn();
}

describe('review controllers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('getPendingReviewsHandler rejects missing user', async () => {
    const req = { user: undefined } as unknown as Request;
    const res = createResponse();

    await getPendingReviewsHandler(req, res, createNext());

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Not authenticated', details: undefined });
    expect(listPendingReviews).not.toHaveBeenCalled();
  });

  it('getPendingReviewsHandler returns pending items for authenticated user', async () => {
    const user = { id: 1 } as any;
    const req = { user } as unknown as Request;
    const res = createResponse();
    const payload = [{ id: 11 }];
    listPendingReviews.mockResolvedValueOnce(payload);

    await getPendingReviewsHandler(req, res, createNext());

    expect(listPendingReviews).toHaveBeenCalledWith(user);
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(payload);
  });

  it('updatePendingReviewHandler rejects missing user', async () => {
    const req = { user: undefined, params: { itemId: '7' }, body: {} } as unknown as Request;
    const res = createResponse();

    await updatePendingReviewHandler(req, res, createNext());

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Not authenticated', details: undefined });
  });

  it('updatePendingReviewHandler validates bill requirement for approve', async () => {
    const req = {
      user: { id: 9 },
      params: { itemId: '22' },
      body: { action: 'approve' }
    } as unknown as Request;
    const res = createResponse();

    await updatePendingReviewHandler(req, res, createNext());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Validation failed',
      details: { field: 'bill', message: 'Bill payload is required for this action' }
    });
    expect(approvePendingBill).not.toHaveBeenCalled();
  });

  it('updatePendingReviewHandler approves pending bills with normalized payload', async () => {
    const user = { id: 2 } as any;
    const req = {
      user,
      params: { itemId: '45' },
      body: {
        action: 'approve',
        bill: { amount: '42.50', dueDate: '2025-10-25', status: 'todo' }
      }
    } as unknown as Request;
    const res = createResponse();
    const approvedBill = { id: 900, amount: 42.5 };
    approvePendingBill.mockResolvedValueOnce(approvedBill);

    await updatePendingReviewHandler(req, res, createNext());

    expect(approvePendingBill).toHaveBeenCalledWith(
      user,
      45,
      expect.objectContaining({
        amount: 42.5,
        dueDate: '2025-10-25',
        status: 'todo'
      })
    );
    expect(res.json).toHaveBeenCalledWith({ status: 'approved', bill: approvedBill });
  });

  it('updatePendingReviewHandler saves bill drafts', async () => {
    const user = { id: 3 } as any;
    const req = {
      user,
      params: { itemId: '88' },
      body: {
        action: 'save',
        bill: { amount: 99, notes: 'needs review' }
      }
    } as unknown as Request;
    const res = createResponse();
    const draft = { id: 'draft-1' };
    saveBillDraft.mockResolvedValueOnce(draft);

    await updatePendingReviewHandler(req, res, createNext());

    expect(saveBillDraft).toHaveBeenCalledWith(
      user,
      88,
      expect.objectContaining({
        amount: 99,
        notes: 'needs review'
      })
    );
    expect(res.json).toHaveBeenCalledWith({ status: 'saved', draft });
  });

  it('updatePendingReviewHandler rejects pending items with optional reason', async () => {
    const user = { id: 4 } as any;
    const req = {
      user,
      params: { itemId: '77' },
      body: {
        action: 'reject',
        reason: 'duplicated'
      }
    } as unknown as Request;
    const res = createResponse();

    await updatePendingReviewHandler(req, res, createNext());

    expect(rejectPendingItem).toHaveBeenCalledWith(user, 77, 'duplicated');
    expect(res.json).toHaveBeenCalledWith({ status: 'rejected' });
  });

  it('updatePendingReviewHandler validates bill requirement for save action', async () => {
    const req = {
      user: { id: 6 },
      params: { itemId: '13' },
      body: { action: 'save' }
    } as unknown as Request;
    const res = createResponse();

    await updatePendingReviewHandler(req, res, createNext());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Validation failed',
      details: { field: 'bill', message: 'Bill payload is required for this action' }
    });
    expect(saveBillDraft).not.toHaveBeenCalled();
  });
});
