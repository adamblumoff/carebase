import type { Request, Response, NextFunction } from 'express';
import { verifyMobileAccessToken } from '../auth/mobileTokenService.js';
import { findUserById, findUserByClerkUserId } from '../db/queries.js';
import { verifyClerkSessionToken } from '../services/clerkSyncService.js';

export async function attachBearerUser(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
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
        return next();
      }
    }
  } catch (error) {
    console.error('Bearer auth error:', error);
  }

  next();
}
