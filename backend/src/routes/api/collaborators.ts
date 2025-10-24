import express from 'express';
import type { Request, Response } from 'express';
import type { CollaboratorRole, User } from '@carebase/shared';
import {
  acceptCollaboratorInvite,
  createCollaboratorInvite,
  listCollaborators,
  resolveRecipientContextForUser,
  findCollaboratorByToken,
  touchPlanForUser,
  findRecipientById
} from '../../db/queries.js';
import { sendCollaboratorInviteEmail } from '../../services/email.js';

export function emailsMatch(inviteEmail: string, userEmail: string): boolean {
  return inviteEmail.trim().toLowerCase() === userEmail.trim().toLowerCase();
}

function formatAppLink(template: string, token: string): string {
  if (!template) return '';
  if (!token) return template;
  if (template.includes('{token}')) {
    return template.replace('{token}', encodeURIComponent(token));
  }
  const hasQuery = template.includes('?');
  const endsWithQuery = template.endsWith('?') || template.endsWith('&');
  const separator = endsWithQuery ? '' : hasQuery ? '&' : '?';
  return `${template}${separator}token=${encodeURIComponent(token)}`;
}

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
    const context = await resolveRecipientContextForUser(user.id);
    const { recipient, collaborator: existingCollaborator } = context;

    if (!recipient) {
      res.status(404).json({ error: 'No recipient found' });
      return;
    }

    const role: 'owner' | 'collaborator' = existingCollaborator ? 'collaborator' : 'owner';

    const collaborators = await listCollaborators(recipient.id);
    const response = collaborators.map((collab) => ({
      ...collab,
      inviteToken: role === 'owner' && collab.status === 'pending' ? collab.inviteToken : ''
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
    const context = await resolveRecipientContextForUser(user.id);
    const { recipient, collaborator: existingCollaborator } = context;

    if (!recipient) {
      res.status(404).json({ error: 'No recipient found' });
      return;
    }

    const contextRole: 'owner' | 'collaborator' = existingCollaborator ? 'collaborator' : 'owner';
    if (contextRole !== 'owner') {
      res.status(403).json({ error: 'Only the owner can invite collaborators' });
      return;
    }

    const { email, role } = req.body as { email?: string; role?: CollaboratorRole };
    if (!email) {
      res.status(400).json({ error: 'Email is required' });
      return;
    }

    const { collaborator, created, resent } = await createCollaboratorInvite(
      recipient.id,
      user.id,
      email,
      role
    );

    const baseUrl =
      process.env.COLLABORATOR_INVITE_BASE_URL || process.env.BASE_URL || 'http://localhost:3000';
    const acceptUrl = `${baseUrl.replace(/\/$/, '')}/collaborators/accept?token=${collaborator.inviteToken}`;
    const rawAppOpenUrl = process.env.COLLABORATOR_APP_OPEN_URL || '';
    const appDownloadUrl = process.env.COLLABORATOR_APP_DOWNLOAD_URL || '';
    const resolvedAppOpenUrl = formatAppLink(rawAppOpenUrl, collaborator.inviteToken);

    if (created || resent) {
      await sendCollaboratorInviteEmail(collaborator.email, {
        inviterEmail: user.email,
        acceptUrl,
        appOpenUrl: resolvedAppOpenUrl,
        appDownloadUrl,
      }).catch((err) => {
        console.warn('Failed to send collaborator invite email:', err);
      });
    }

    await touchPlanForUser(recipient.userId, {
      queueGoogleSync: false,
      delta: {
        itemType: 'plan',
        entityId: recipient.id,
        action: 'updated',
        source: 'rest',
        data: { section: 'collaborators' }
      }
    });

    res.status(201).json({ collaborator, resent });
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

    const invite = await findCollaboratorByToken(token.trim());
    if (!invite) {
      res.status(404).json({ error: 'Invite not found' });
      return;
    }

    if (!emailsMatch(invite.email, user.email)) {
      res.status(403).json({ error: 'Invite belongs to a different email' });
      return;
    }

    const collaborator = await acceptCollaboratorInvite(token, user);
    if (!collaborator) {
      res.status(404).json({ error: 'Invite not found' });
      return;
    }

    const recipient = await findRecipientById(collaborator.recipientId);
    if (recipient) {
      await touchPlanForUser(recipient.userId, {
        queueGoogleSync: false,
        delta: {
          itemType: 'plan',
          entityId: recipient.id,
          action: 'updated',
          source: 'rest',
          data: { section: 'collaborators' }
        }
      });
    }

    res.json({ collaborator });
  } catch (error) {
    console.error('Accept collaborator error:', error);
    res.status(500).json({ error: 'Failed to accept invite' });
  }
});

export default router;
