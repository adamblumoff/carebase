import type { NextFunction, Request, Response } from 'express';
import { findUserByClerkUserId } from '../db/queries.js';
import { ensureLocalUserForClerk } from '../services/clerkSyncService.js';
import { verifyClerkSessionToken } from '../services/clerkAuthGateway.js';
import { incrementMetric } from '../utils/metrics.js';

type ClerkAuthState = {
  isAuthenticated?: boolean;
  userId?: string | null;
  sessionId?: string | null;
  sessionClaims?: { exp?: number | null } | null;
};

function resolveClerkAuthState(req: Request): ClerkAuthState | null {
  const maybeAuth = (req as Request & { auth?: () => ClerkAuthState }).auth;
  if (typeof maybeAuth !== 'function') {
    return null;
  }

  try {
    const state = maybeAuth();
    console.log('[Auth] Clerk middleware auth state', state);
    return state ?? null;
  } catch (error) {
    console.warn('[Auth] Failed to resolve Clerk middleware auth state', error);
    return null;
  }
}

async function attachFromClerkState(req: Request, state: ClerkAuthState): Promise<boolean> {
  if (!state?.isAuthenticated || !state.userId) {
    return false;
  }

  let user = await findUserByClerkUserId(state.userId);
  if (!user) {
    await ensureLocalUserForClerk(state.userId);
    user = await findUserByClerkUserId(state.userId);
  }

  if (!user) {
    return false;
  }

  const expiresAt =
    typeof state.sessionClaims?.exp === 'number' ? state.sessionClaims.exp * 1000 : null;

  (req as any).user = user;
  (req as any).clerkAuth = {
    userId: state.userId,
    sessionId: state.sessionId ?? null,
    expiresAt
  };

  incrementMetric('auth.clerk.http', 1, { via: 'clerk-middleware' });
  console.log('[Auth] Request authenticated via Clerk middleware', {
    userId: user.id,
    clerkUserId: state.userId,
    sessionId: state.sessionId ?? null
  });

  return true;
}

export async function attachBearerUser(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) {
      const clerkState = resolveClerkAuthState(req);
      if (clerkState && (await attachFromClerkState(req, clerkState))) {
        return next();
      }
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return next();
    }

    const token = authHeader.slice(7).trim();
    if (!token) {
      return next();
    }

    const clerkVerification = await verifyClerkSessionToken(token);
    if (!clerkVerification) {
      return next();
    }

    let user = await findUserByClerkUserId(clerkVerification.userId);
    if (!user) {
      await ensureLocalUserForClerk(clerkVerification.userId);
      user = await findUserByClerkUserId(clerkVerification.userId);
    }
    if (!user) {
      return next();
    }

    (req as any).user = user;
    (req as any).clerkAuth = {
      userId: clerkVerification.userId,
      sessionId: clerkVerification.sessionId,
      expiresAt: clerkVerification.expiresAt ?? null
    };

    console.log('[Auth] Bearer token resolved via Clerk session', {
      userId: user.id,
      clerkUserId: clerkVerification.userId,
      sessionId: clerkVerification.sessionId
    });
    incrementMetric('auth.clerk.http', 1, { via: 'clerk-session' });
    return next();
  } catch (error) {
    console.error('Bearer auth error:', error);
  }

  next();
}
