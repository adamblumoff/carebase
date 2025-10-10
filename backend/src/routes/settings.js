import express from 'express';
import { ensureAuthenticated, ensureRecipient } from '../middleware/auth.js';
import { deleteUser } from '../db/queries.js';

const router = express.Router();

/**
 * Settings page
 */
router.get('/', ensureAuthenticated, ensureRecipient, (req, res) => {
  const planShareUrl = `${process.env.BASE_URL}/plan?token=${req.user.plan_secret}`;

  res.render('settings', {
    user: req.user,
    recipient: req.recipient,
    planShareUrl
  });
});

/**
 * Delete account
 */
router.post('/delete-account', ensureAuthenticated, async (req, res) => {
  try {
    const { confirm } = req.body;

    if (confirm !== 'DELETE') {
      return res.status(400).send('Invalid confirmation. Please type DELETE to confirm.');
    }

    const userId = req.user.id;

    // Log out user
    req.logout((err) => {
      if (err) {
        console.error('Logout error during account deletion:', err);
      }
    });

    // Delete user and all related data (cascades)
    await deleteUser(userId);

    console.log(`User ${userId} deleted their account`);

    res.redirect('/?deleted=true');
  } catch (error) {
    console.error('Account deletion error:', error);
    res.status(500).send('Error deleting account');
  }
});

export default router;
