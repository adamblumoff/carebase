import express, { Request, Response } from 'express';
import passport from '../auth/passport.js';
import { createRecipient, findRecipientsByUserId, hasCollaboratorInviteForEmail } from '../db/queries.js';
import { issueMobileLoginToken } from '../auth/mobileTokenService.js';
import type { User } from '@carebase/shared';

const router = express.Router();

// Initiate Google OAuth
router.get('/google', (req: Request, res: Response, next) => {
  const isMobile = req.query.mobile === 'true';
  const state = isMobile ? 'mobile' : undefined;

  passport.authenticate('google', {
    scope: ['profile', 'email'],
    state
  })(req, res, next);
});

// Google OAuth callback (web and mobile)
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
        const skipDefaultRecipient = await hasCollaboratorInviteForEmail(req.user.email);
        if (!skipDefaultRecipient) {
          await createRecipient(req.user.id, 'My Care Recipient');
        }
      }

      // Decide redirect target based on OAuth state param or legacy session flag
      const isMobile = req.query.state === 'mobile' || req.session?.mobile === true;

      if (isMobile) {
        if (req.session?.mobile) {
          delete req.session.mobile;
        }
        const loginToken = issueMobileLoginToken(req.user as User);
        const redirectUrl = `carebase://auth/success?loginToken=${encodeURIComponent(loginToken)}`;
        res.redirect(redirectUrl);
      } else {
        // Redirect to web app
        res.redirect('/plan');
      }
    } catch (error) {
      console.error('Error creating default recipient:', error);
      res.redirect('/');
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
