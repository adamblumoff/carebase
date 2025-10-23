import type { Request, Response, NextFunction } from 'express';
import { verifyMobileAccessToken } from '../auth/mobileTokenService.js';
import { findUserById, findUserByClerkUserId } from '../db/queries.js';
import { verifyClerkSessionToken } from '../services/clerkSyncService.js';
import { incrementMetric } from '../utils/metrics.js';

export async function attachBearerUser(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user && typeof (req as any).auth === 'function') {
      try {
        const authState = (req as any).auth();
        console.log('[Auth] Clerk middleware auth state', authState);
        if (authState?.userId) {
          const user = await findUserByClerkUserId(authState.userId);
          if (user) {
            (req as any).user = user;
            (req as any).clerkAuth = {
              userId: authState.userId,
              sessionId: authState.sessionId ?? null,
              expiresAt: authState.sessionClaims?.exp ? authState.sessionClaims.exp * 1000 : null
            };
            if (typeof req.isAuthenticated === 'function') {
              (req as any).isAuthenticated = () => true;
            }
            incrementMetric('auth.bridge.http', 1, { via: 'clerk-middleware' });
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

    if (typeof req.isAuthenticated === 'function' && req.isAuthenticated()) {
      return next();
    }

    const token = authHeader.slice(7).trim();
    const payload = verifyMobileAccessToken(token);

    if (payload) {
      const user = await findUserById(payload.sub);
      if (user) {
        (req as any).user = user;
        if (typeof req.isAuthenticated === 'function') {
          (req as any).isAuthenticated = () => true;
        }
        console.log('[Auth] Bearer token resolved via mobile access token', { userId: user.id });
        incrementMetric('auth.bridge.bearer', 1, { via: 'mobile-token' });
        return next();
      }
    }

    const clerkVerification = await verifyClerkSessionToken(token);
    if (clerkVerification) {
      const user = await findUserByClerkUserId(clerkVerification.userId);
      if (user) {
        (req as any).user = user;
        (req as any).clerkAuth = {
          userId: clerkVerification.userId,
          sessionId: clerkVerification.sessionId,
          expiresAt: clerkVerification.expiresAt ?? null
        };
        if (typeof req.isAuthenticated === 'function') {
          (req as any).isAuthenticated = () => true;
        }
        console.log('[Auth] Bearer token resolved via Clerk session', {
          userId: user.id,
          clerkUserId: clerkVerification.userId,
          sessionId: clerkVerification.sessionId
        });
        incrementMetric('auth.bridge.bearer', 1, { via: 'clerk-session' });
        return next();
      }
    }
  } catch (error) {
    console.error('Bearer auth error:', error);
  }

  next();
}
