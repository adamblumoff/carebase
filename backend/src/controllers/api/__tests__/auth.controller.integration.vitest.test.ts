import type { Request, Response, NextFunction } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const queriesMock = vi.hoisted(() => ({
  getGoogleCredential: vi.fn()
}));

vi.mock('../../../db/queries.js', () => queriesMock);

const { getGoogleCredential } = queriesMock;
const module = await import('../auth.js');
const { getSession, postLogout, getUser } = module;

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

const user = {
  id: 7,
  email: 'owner@example.com',
  forwardingAddress: 'owner-forward@example.com',
  planSecret: 'secret',
  passwordResetRequired: false
} as any;

describe('auth controllers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('getSession returns authenticated payload with credential metadata', async () => {
    const req = { user } as Request;
    const res = createResponse();
    getGoogleCredential.mockResolvedValueOnce({ needsReauth: true });

    await getSession(req, res, next);

    expect(getGoogleCredential).toHaveBeenCalledWith(user.id);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        authenticated: true,
        user: expect.objectContaining({ needsGoogleReauth: true })
      })
    );
  });

  it('getSession falls back to default when credential lookup fails', async () => {
    const req = { user } as Request;
    const res = createResponse();
    getGoogleCredential.mockRejectedValueOnce(new Error('boom'));

    await getSession(req, res, next);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        authenticated: true,
        user: expect.objectContaining({ needsGoogleReauth: false })
      })
    );
  });

  it('getSession handles unauthenticated requests', async () => {
    const res = createResponse();
    await getSession({} as Request, res, next);
    expect(res.json).toHaveBeenCalledWith({ authenticated: false });
  });

  it('postLogout responds with success flag', () => {
    const res = createResponse();
    postLogout({} as Request, res);
    expect(res.json).toHaveBeenCalledWith({ success: true });
  });

  it('getUser returns user payload when authenticated', async () => {
    const res = createResponse();
    getGoogleCredential.mockResolvedValueOnce({ needsReauth: false });

    await getUser({ user } as Request, res, next);

    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ id: user.id, needsGoogleReauth: false })
    );
  });

  it('getUser returns 401 when user missing', async () => {
    const res = createResponse();

    await getUser({} as Request, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Not authenticated' });
  });
});
