/**
 * Mobile API: Authentication endpoints
 */
import express, { Request, Response } from 'express';
import { findUserByEmail } from '../../db/queries.js';
import type { User } from '@carebase/shared';

const router = express.Router();

/**
 * GET /api/auth/session
 * Check if user is authenticated and return user data
 */
router.get('/session', (req: Request, res: Response) => {
  if (req.isAuthenticated() && req.user) {
    return res.json({
      authenticated: true,
      user: {
        id: req.user.id,
        email: req.user.email,
        forwardingAddress: req.user.forwardingAddress,
        planSecret: req.user.planSecret
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
  if (!req.isAuthenticated()) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  res.json({
    id: req.user.id,
    email: req.user.email,
    forwardingAddress: req.user.forwardingAddress,
    planSecret: req.user.planSecret
  });
});

export default router;
