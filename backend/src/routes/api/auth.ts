/**
 * Mobile API: Authentication endpoints
 */
import express, { Request, Response } from 'express';
import { verifyMobileLoginToken, issueMobileAccessToken } from '../../auth/mobileTokenService.js';
import { findUserById } from '../../db/queries.js';
import type { User } from '@carebase/shared';

const router = express.Router();

/**
 * GET /api/auth/session
 * Check if user is authenticated and return user data
 */
router.get('/session', (req: Request, res: Response) => {
  const user = req.user as User | undefined;

  if (user) {
    return res.json({
      authenticated: true,
      user: {
        id: user.id,
        email: user.email,
        forwardingAddress: user.forwardingAddress,
        planSecret: user.planSecret
      }
    });
  }

  res.json({ authenticated: false });
});

/**
 * POST /api/auth/logout
 * Log out the current user
 */
router.post('/logout', (req: Request, res: Response) => {
  req.logout((err) => {
    if (err) {
      return res.status(500).json({ error: 'Logout failed' });
    }
    res.json({ success: true });
  });
});

/**
 * GET /api/auth/user
 * Get current user info (requires authentication)
 */
router.get('/user', (req: Request, res: Response) => {
  const user = req.user as User | undefined;
  if (!user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  res.json({
    id: user.id,
    email: user.email,
    forwardingAddress: user.forwardingAddress,
    planSecret: user.planSecret
  });
});

/**
 * POST /api/auth/mobile-login
 * Exchange a one-time login token (created during Google OAuth) for an access token
 */
router.post('/mobile-login', async (req: Request, res: Response) => {
  try {
    const { authToken } = req.body as { authToken?: string };
    if (!authToken) {
      return res.status(400).json({ error: 'authToken required' });
    }

    const payload = verifyMobileLoginToken(authToken);
    if (!payload) {
      return res.status(401).json({ error: 'invalid or expired token' });
    }

    const user = await findUserById(payload.sub);
    if (!user) {
      return res.status(404).json({ error: 'user not found' });
    }

    const accessToken = issueMobileAccessToken(user as User);

    res.json({
      authenticated: true,
      accessToken,
      user: {
        id: user.id,
        email: user.email,
        forwardingAddress: user.forwardingAddress,
        planSecret: user.planSecret
      }
    });
  } catch (error) {
    console.error('Mobile login exchange error:', error);
    res.status(500).json({ error: 'internal error' });
  }
});

export default router;
