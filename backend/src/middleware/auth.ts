import type { Request, Response, NextFunction } from 'express';
import type { User, Recipient } from '@carebase/shared';

// Extend Express Request type to include user and recipient
declare global {
  namespace Express {
    interface User extends import('@carebase/shared').User {}
    interface Request {
      recipient?: Recipient;
    }
  }
}

/**
 * Middleware to ensure user is authenticated
 */
export function ensureAuthenticated(req: Request, res: Response, next: NextFunction): void {
  if (req.user) {
    return next();
  }
  res.status(401).send('Not authenticated');
}

/**
 * Middleware to get user's default recipient
 */
export async function ensureRecipient(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { findRecipientsByUserId } = await import('../db/queries.js');

    if (!req.user) {
      res.status(401).send('Not authenticated');
      return;
    }

    const recipients = await findRecipientsByUserId(req.user.id);

    if (recipients.length === 0) {
      res.status(404).send('No recipient found. Please contact support.');
      return;
    }

    req.recipient = recipients[0]; // Use first recipient for MVP
    next();
  } catch (error) {
    console.error('Error finding recipient:', error);
    res.status(500).send('Error loading recipient');
  }
}
