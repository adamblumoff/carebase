import type { Request, Response, NextFunction } from 'express';
import { verifyMobileAccessToken } from '../auth/mobileTokenService.js';
import { findUserById } from '../db/queries.js';

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

    if (!payload) {
      return next();
    }

    const user = await findUserById(payload.sub);

    if (user) {
      (req as any).user = user;
      if (typeof req.isAuthenticated === 'function') {
        (req as any).isAuthenticated = () => true;
      }
    }
  } catch (error) {
    console.error('Bearer auth error:', error);
  }

  next();
}
