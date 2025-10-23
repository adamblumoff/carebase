import type { Request, Response, NextFunction } from 'express';
import { findUserByClerkUserId } from '../db/queries.js';
import { verifyClerkSessionToken, ensureLocalUserForClerk } from '../services/clerkSyncService.js';
import { incrementMetric } from '../utils/metrics.js';

export async function attachBearerUser(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user && typeof (req as any).auth === 'function') {
      try {
        const authState = (req as any).auth();
        console.log('[Auth] Clerk middleware auth state', authState);
        if (authState?.userId) {
          let user = await findUserByClerkUserId(authState.userId);
          if (!user) {
            await ensureLocalUserForClerk(authState.userId);
            user = await findUserByClerkUserId(authState.userId);
          }
          if (user) {
            (req as any).user = user;
            (req as any).clerkAuth = {
              userId: authState.userId,
              sessionId: authState.sessionId ?? null,
              expiresAt: authState.sessionClaims?.exp ? authState.sessionClaims.exp * 1000 : null
            };
            incrementMetric('auth.clerk.http', 1, { via: 'clerk-middleware' });
            console.log('[Auth] Request authenticated via Clerk middleware', {
              userId: user.id,
              clerkUserId: authState.userId,
              sessionId: authState.sessionId ?? null
            });
            return next();
          }
        }
      } catch (error) {
        console.warn('[Auth] Failed to resolve Clerk middleware auth state', error);
      }
    }

    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return next();
    }

    const token = authHeader.slice(7).trim();
    const clerkVerification = await verifyClerkSessionToken(token);
    if (clerkVerification) {
      let user = await findUserByClerkUserId(clerkVerification.userId);
      if (!user) {
        await ensureLocalUserForClerk(clerkVerification.userId);
        user = await findUserByClerkUserId(clerkVerification.userId);
      }
      if (user) {
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
      }
    }
  } catch (error) {
    console.error('Bearer auth error:', error);
  }

  next();
}
