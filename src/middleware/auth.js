/**
 * Middleware to ensure user is authenticated
 */
export function ensureAuthenticated(req, res, next) {
  if (req.isAuthenticated()) {
    return next();
  }
  res.redirect('/');
}

/**
 * Middleware to get user's default recipient
 */
export async function ensureRecipient(req, res, next) {
  try {
    const { findRecipientsByUserId } = await import('../db/queries.js');
    const recipients = await findRecipientsByUserId(req.user.id);

    if (recipients.length === 0) {
      return res.status(404).send('No recipient found. Please contact support.');
    }

    req.recipient = recipients[0]; // Use first recipient for MVP
    next();
  } catch (error) {
    console.error('Error finding recipient:', error);
    res.status(500).send('Error loading recipient');
  }
}
