import express from 'express';
import passport from '../auth/passport.js';
import { createRecipient, findRecipientsByUserId } from '../db/queries.js';

const router = express.Router();

// Initiate Google OAuth
router.get('/google', passport.authenticate('google', { scope: ['profile', 'email'] }));

// Google OAuth callback
router.get(
  '/google/callback',
  passport.authenticate('google', { failureRedirect: '/' }),
  async (req, res) => {
    try {
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

// Logout
router.get('/logout', (req, res) => {
  req.logout((err) => {
    if (err) {
      console.error('Logout error:', err);
    }
    res.redirect('/');
  });
});

export default router;
