import type { Request, Response } from 'express';
import { getGoogleCredential } from '../../db/queries.js';
import type { User } from '@carebase/shared';

export async function getSession(req: Request, res: Response): Promise<void> {
  const user = req.user as User | undefined;

  if (user) {
    try {
      const credential = await getGoogleCredential(user.id);
      res.json({
        authenticated: true,
        user: {
          id: user.id,
          email: user.email,
          forwardingAddress: user.forwardingAddress,
          planSecret: user.planSecret,
          passwordResetRequired: user.passwordResetRequired,
          needsGoogleReauth: credential?.needsReauth ?? false
        }
      });
    } catch (error) {
      console.error('Session lookup failed to load Google credential:', error);
      res.json({
        authenticated: true,
        user: {
          id: user.id,
          email: user.email,
          forwardingAddress: user.forwardingAddress,
          planSecret: user.planSecret,
          passwordResetRequired: user.passwordResetRequired,
          needsGoogleReauth: false
        }
      });
    }
    return;
  }

  res.json({ authenticated: false });
}

export function postLogout(req: Request, res: Response): void {
  res.json({ success: true });
}

export async function getUser(req: Request, res: Response): Promise<void> {
  const user = req.user as User | undefined;
  if (!user) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }

  try {
    const credential = await getGoogleCredential(user.id);
    res.json({
      id: user.id,
      email: user.email,
      forwardingAddress: user.forwardingAddress,
      planSecret: user.planSecret,
      passwordResetRequired: user.passwordResetRequired,
      needsGoogleReauth: credential?.needsReauth ?? false
    });
  } catch (error) {
    console.error('Failed to load Google credential for session user:', error);
    res.json({
      id: user.id,
      email: user.email,
      forwardingAddress: user.forwardingAddress,
      planSecret: user.planSecret,
      passwordResetRequired: user.passwordResetRequired,
      needsGoogleReauth: false
    });
  }
}
