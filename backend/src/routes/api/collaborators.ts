import express from 'express';
import type { Request, Response } from 'express';
import type { CollaboratorRole, User } from '@carebase/shared';
import {
  acceptCollaboratorInvite,
  createCollaboratorInvite,
  listCollaborators,
  resolveRecipientContextForUser,
} from '../../db/queries.js';
import { sendCollaboratorInviteEmail } from '../../services/email.js';

const router = express.Router();

router.use((req, res, next) => {
  const user = req.user as User | undefined;
  if (!user) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }
  next();
});

router.get('/', async (req: Request, res: Response) => {
  try {
    const user = req.user as User;
    const context = await resolveRecipientContextForUser(user);
    if (!context) {
      res.status(404).json({ error: 'No recipient found' });
      return;
    }

    const collaborators = await listCollaborators(context.recipient.id);
    const response = collaborators.map((collaborator) => ({
      ...collaborator,
      inviteToken:
        context.role === 'owner' && collaborator.status === 'pending' ? collaborator.inviteToken : ''
    }));
    res.json({ collaborators: response });
  } catch (error) {
    console.error('List collaborators error:', error);
    res.status(500).json({ error: 'Failed to load collaborators' });
  }
});

router.post('/', async (req: Request, res: Response) => {
  try {
    const user = req.user as User;
    const context = await resolveRecipientContextForUser(user);
    if (!context) {
      res.status(404).json({ error: 'No recipient found' });
      return;
    }
    if (context.role !== 'owner') {
      res.status(403).json({ error: 'Only the owner can invite collaborators' });
      return;
    }

    const { email, role } = req.body as { email?: string; role?: CollaboratorRole };
    if (!email) {
      res.status(400).json({ error: 'Email is required' });
      return;
    }

    const { collaborator, created } = await createCollaboratorInvite(
      context.recipient.id,
      user.id,
      email,
      role
    );

    if (created) {
      const baseUrl =
        process.env.COLLABORATOR_INVITE_BASE_URL || process.env.BASE_URL || 'http://localhost:3000';
      const acceptUrl = `${baseUrl.replace(/\/$/, '')}/collaborators/accept?token=${collaborator.inviteToken}`;
      await sendCollaboratorInviteEmail(collaborator.email, {
        inviterEmail: user.email,
        acceptUrl,
      }).catch((err) => {
        console.warn('Failed to send collaborator invite email:', err);
      });
    }

    res.status(201).json({ collaborator });
  } catch (error) {
    console.error('Create collaborator invite error:', error);
    res.status(500).json({ error: 'Failed to invite collaborator' });
  }
});

router.post('/accept', async (req: Request, res: Response) => {
  try {
    const user = req.user as User;
    const { token } = req.body as { token?: string };
    if (!token) {
      res.status(400).json({ error: 'Token is required' });
      return;
    }

    const collaborator = await acceptCollaboratorInvite(token, user);
    if (!collaborator) {
      res.status(404).json({ error: 'Invite not found' });
      return;
    }

    res.json({ collaborator });
  } catch (error) {
    console.error('Accept collaborator error:', error);
    res.status(500).json({ error: 'Failed to accept invite' });
  }
});

export default router;
