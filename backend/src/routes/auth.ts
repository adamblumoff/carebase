import express, { Request, Response } from 'express';
import passport from '../auth/passport.js';
import { createRecipient, findRecipientsByUserId } from '../db/queries.js';

const router = express.Router();

// Initiate Google OAuth
router.get('/google', passport.authenticate('google', { scope: ['profile', 'email'] }));

// Google OAuth callback (web)
router.get(
  '/google/callback',
  passport.authenticate('google', { failureRedirect: '/' }),
  async (req: Request, res: Response) => {
    try {
      if (!req.user) {
        return res.redirect('/');
      }

      // Create default recipient if this is a new user
      const recipients = await findRecipientsByUserId(req.user.id);

      if (recipients.length === 0) {
        await createRecipient(req.user.id, 'My Care Recipient');
      }

      res.redirect('/plan');
    } catch (error) {
      console.error('Error creating default recipient:', error);
      res.redirect('/');
    }
  }
);

// Google OAuth callback for mobile (returns JSON)
router.get(
  '/google/callback/mobile',
  passport.authenticate('google', { failureRedirect: '/', session: true }),
  async (req: Request, res: Response) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Authentication failed' });
      }

      // Create default recipient if this is a new user
      const recipients = await findRecipientsByUserId(req.user.id);

      if (recipients.length === 0) {
        await createRecipient(req.user.id, 'My Care Recipient');
      }

      // Return user data as JSON for mobile
      res.json({
        success: true,
        user: {
          id: req.user.id,
          email: req.user.email,
          forwardingAddress: req.user.forwardingAddress,
          planSecret: req.user.planSecret
        }
      });
    } catch (error) {
      console.error('Error in mobile auth callback:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// Logout
router.get('/logout', (req: Request, res: Response) => {
  req.logout((err) => {
    if (err) {
      console.error('Logout error:', err);
    }
    res.redirect('/');
  });
});

export default router;
