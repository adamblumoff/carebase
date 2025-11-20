import type { Request, Response } from 'express';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';

const buildPlanPayload = vi.fn();
const getPlanVersionForUser = vi.fn();

vi.mock('../../../services/planService.js', () => ({
  buildPlanPayload,
  getPlanVersionForUser
}));

const { getPlan, getPlanVersionHandler } = await import('../plan.js');

function createResponse() {
  const res = {
    status: vi.fn(function (this: Response) {
      return this;
    }),
    json: vi.fn(function (this: Response) {
      return this;
    })
  } as unknown as Response & { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> };

  // re-bind to ensure `this` is the response mock
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

describe('plan controllers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete (globalThis as any).__status;
    delete (globalThis as any).__json;
  });

  it('responds with 401 when user is missing', async () => {
    const req = { query: {} } as unknown as Request;
    const res = createResponse();

    await getPlan(req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Not authenticated' });
    expect(buildPlanPayload).not.toHaveBeenCalled();
  });

  it('coerces day range and returns plan payload', async () => {
    const user = { id: 7 } as any;
    const req = { user, query: { days: '5' } } as unknown as Request;
    const res = createResponse();
    const payload = { appointments: [], bills: [], planVersion: 3 };
    buildPlanPayload.mockResolvedValueOnce(payload);

    await getPlan(req, res, vi.fn());

    expect(buildPlanPayload).toHaveBeenCalledWith(user, 5);
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(payload);
  });

  it('handles collaborator view automatically when days omitted', async () => {
    const user = { id: 11 } as any;
    const req = { user, query: {} } as unknown as Request;
    const res = createResponse();
    const payload = { appointments: [], bills: [], planVersion: 4 };
    buildPlanPayload.mockResolvedValueOnce(payload);

    await getPlan(req, res, vi.fn());

    expect(buildPlanPayload).toHaveBeenCalledWith(user, undefined);
    expect(res.json).toHaveBeenCalledWith(payload);
  });

  it('returns 400 when days query is out of range', async () => {
    const user = { id: 3 } as any;
    const req = { user, query: { days: '99' } } as unknown as Request;
    const res = createResponse();

    await getPlan(req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'Validation failed' })
    );
    expect(buildPlanPayload).not.toHaveBeenCalled();
  });

  it('getPlanVersionHandler returns metadata for authenticated user', async () => {
    const user = { id: 5 } as any;
    const req = { user, query: {} } as unknown as Request;
    const res = createResponse();
    const metadata = { planVersion: 9, planUpdatedAt: '2025-10-15T12:00:00.000Z' };
    getPlanVersionForUser.mockResolvedValueOnce(metadata);

    await getPlanVersionHandler(req, res, vi.fn());

    expect(getPlanVersionForUser).toHaveBeenCalledWith(user);
    expect(res.json).toHaveBeenCalledWith(metadata);
  });

  it('getPlanVersionHandler rejects missing user', async () => {
    const req = { query: {} } as unknown as Request;
    const res = createResponse();

    await getPlanVersionHandler(req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Not authenticated' });
    expect(getPlanVersionForUser).not.toHaveBeenCalled();
  });
});
