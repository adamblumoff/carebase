/**
 * Mobile API: Authentication endpoints
 */
import express, { Request, Response } from 'express';
import { findUserByGoogleId, createUser, findRecipientsByUserId, createRecipient } from '../../db/queries.js';
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

/**
 * POST /api/auth/google
 * Exchange Google ID token for session
 */
router.post('/google', async (req: Request, res: Response) => {
  try {
    const { idToken } = req.body;

    if (!idToken) {
      return res.status(400).json({ error: 'ID token required' });
    }

    // Verify the Google ID token
    const response = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${idToken}`);
    const tokenInfo = await response.json();

    if (!response.ok || tokenInfo.error) {
      return res.status(401).json({ error: 'Invalid Google token' });
    }

    // Check if token is for our app
    if (tokenInfo.aud !== process.env.GOOGLE_CLIENT_ID) {
      return res.status(401).json({ error: 'Token not for this app' });
    }

    const { sub: googleId, email } = tokenInfo;

    // Find or create user
    let user = await findUserByGoogleId(googleId);

    if (!user) {
      user = await createUser(email, googleId);

      // Create default recipient for new user
      await createRecipient(user.id, 'My Care Recipient');
    }

    // Create session
    req.login(user, (err) => {
      if (err) {
        console.error('Session creation error:', err);
        return res.status(500).json({ error: 'Failed to create session' });
      }

      res.json({
        success: true,
        user: {
          id: user.id,
          email: user.email,
          forwardingAddress: user.forwardingAddress,
          planSecret: user.planSecret
        }
      });
    });
  } catch (error) {
    console.error('Google auth error:', error);
    res.status(500).json({ error: 'Authentication failed' });
  }
});

export default router;
