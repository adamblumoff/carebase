import { describe, expect, it, beforeEach, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';

const findUserByClerkUserId = vi.fn();
const ensureLocalUserForClerk = vi.fn();
const verifyClerkSessionToken = vi.fn();

vi.mock('../../db/queries.js', () => ({
  findUserByClerkUserId
}));

vi.mock('../../services/clerkSyncService.js', () => ({
  ensureLocalUserForClerk
}));

vi.mock('../../services/clerkAuthGateway.js', () => ({
  verifyClerkSessionToken
}));

const { attachBearerUser } = await import('../attachBearerUser.js');

describe('attachBearerUser', () => {
  beforeEach(() => {
    findUserByClerkUserId.mockReset();
    ensureLocalUserForClerk.mockReset();
    verifyClerkSessionToken.mockReset();
  });

  it('uses Clerk middleware auth when available', async () => {
    const mockUser = { id: 42, email: 'demo@example.com' };
    findUserByClerkUserId.mockResolvedValue(mockUser);

    const req = {
      headers: {},
      auth: vi.fn(() => ({
        isAuthenticated: true,
        userId: 'user_123',
        sessionId: 'sess_abc',
        sessionClaims: { exp: 1700000000 }
      }))
    } as unknown as Request;
    const res = {} as Response;
    const next = vi.fn<Parameters<NextFunction>, void>();

    await attachBearerUser(req, res, next);

    expect(req.auth).toHaveBeenCalledTimes(1);
    expect(findUserByClerkUserId).toHaveBeenCalledWith('user_123');
    expect(verifyClerkSessionToken).not.toHaveBeenCalled();
    expect((req as any).user).toBe(mockUser);
    expect((req as any).clerkAuth).toEqual({
      userId: 'user_123',
      sessionId: 'sess_abc',
      expiresAt: 1700000000 * 1000
    });
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('falls back to bearer token verification when middleware auth is absent', async () => {
    const userAfterEnsure = { id: 99, email: 'fallback@example.com' };
    findUserByClerkUserId
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(userAfterEnsure);
    ensureLocalUserForClerk.mockResolvedValue(userAfterEnsure);
    verifyClerkSessionToken.mockResolvedValue({
      userId: 'user_fallback',
      sessionId: 'sess_fallback',
      expiresAt: 1234567890
    });

    const req = {
      headers: {
        authorization: 'Bearer test-token'
      },
      auth: vi.fn(() => ({
        isAuthenticated: false,
        userId: null
      }))
    } as unknown as Request;
    const res = {} as Response;
    const next = vi.fn<Parameters<NextFunction>, void>();

    await attachBearerUser(req, res, next);

    expect(req.auth).toHaveBeenCalledTimes(1);
    expect(verifyClerkSessionToken).toHaveBeenCalledWith('test-token');
    expect(ensureLocalUserForClerk).toHaveBeenCalledWith('user_fallback');
    expect((req as any).user).toBe(userAfterEnsure);
    expect((req as any).clerkAuth).toEqual({
      userId: 'user_fallback',
      sessionId: 'sess_fallback',
      expiresAt: 1234567890
    });
    expect(next).toHaveBeenCalledTimes(1);
  });
});
