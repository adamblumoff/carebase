import type { Request, Response } from 'express';
import { verifyMobileLoginToken, issueMobileAccessToken } from '../../auth/mobileTokenService.js';
import { findUserById } from '../../db/queries.js';
import { createClerkBridgeSession } from '../../services/clerkSyncService.js';
import type { User } from '@carebase/shared';

export function getSession(req: Request, res: Response): void {
  const user = req.user as User | undefined;

  if (user) {
    res.json({
      authenticated: true,
      user: {
        id: user.id,
        email: user.email,
        forwardingAddress: user.forwardingAddress,
        planSecret: user.planSecret,
      },
    });
    return;
  }

  res.json({ authenticated: false });
}

export function postLogout(req: Request, res: Response): void {
  req.logout((err) => {
    if (err) {
      res.status(500).json({ error: 'Logout failed' });
      return;
    }
    res.json({ success: true });
  });
}

export function getUser(req: Request, res: Response): void {
  const user = req.user as User | undefined;
  if (!user) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }

  res.json({
    id: user.id,
    email: user.email,
    forwardingAddress: user.forwardingAddress,
    planSecret: user.planSecret,
  });
}

export async function postMobileLogin(req: Request, res: Response): Promise<void> {
  try {
    const { authToken } = req.body as { authToken?: string };
    if (!authToken) {
      res.status(400).json({ error: 'authToken required' });
      return;
    }

    const payload = verifyMobileLoginToken(authToken);
    if (!payload) {
      res.status(401).json({ error: 'invalid or expired token' });
      return;
    }

    const user = await findUserById(payload.sub);
    if (!user) {
      res.status(404).json({ error: 'user not found' });
      return;
    }

    const accessToken = issueMobileAccessToken(user as User);
    const clerkBridge = await createClerkBridgeSession(user.id);

    const responsePayload: Record<string, unknown> = {
      authenticated: true,
      accessToken,
      user: {
        id: user.id,
        email: user.email,
        forwardingAddress: user.forwardingAddress,
        planSecret: user.planSecret,
        passwordResetRequired: user.passwordResetRequired,
      },
    };

    if (clerkBridge) {
      (responsePayload as any).clerk = {
        userId: clerkBridge.clerkUserId,
        sessionId: clerkBridge.sessionId,
        sessionToken: clerkBridge.sessionToken,
      };
      console.log('[Auth] Issued Clerk bridge session from mobile login', {
        userId: user.id,
        clerkUserId: clerkBridge.clerkUserId,
        sessionId: clerkBridge.sessionId
      });
    }

    res.json(responsePayload);
  } catch (error) {
    console.error('Mobile login exchange error:', error);
    res.status(500).json({ error: 'internal error' });
  }
}
