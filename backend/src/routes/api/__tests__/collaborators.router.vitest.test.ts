import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest';
import collaboratorsRouter, { emailsMatch } from '../collaborators.js';

const queriesMock = vi.hoisted(() => ({
  resolveRecipientContextForUser: vi.fn(),
  listCollaborators: vi.fn(),
  createCollaboratorInvite: vi.fn(),
  acceptCollaboratorInvite: vi.fn(),
  findCollaboratorByToken: vi.fn(),
  touchPlanForUser: vi.fn(),
  findRecipientById: vi.fn()
}));

vi.mock('../../../db/queries.js', () => queriesMock);

const emailMock = vi.hoisted(() => ({
  sendCollaboratorInviteEmail: vi.fn()
}));

vi.mock('../../../services/email.js', () => emailMock);

const {
  resolveRecipientContextForUser,
  listCollaborators,
  createCollaboratorInvite,
  acceptCollaboratorInvite,
  findCollaboratorByToken,
  touchPlanForUser,
  findRecipientById
} = queriesMock;

const { sendCollaboratorInviteEmail } = emailMock;

function createApp(user?: any) {
  const app = express();
  app.use(express.json());
  if (user) {
    app.use((req, _res, next) => {
      (req as any).user = user;
      next();
    });
  }
  app.use(collaboratorsRouter);
  return app;
}

describe('collaborators router', () => {
  const user = {
    id: 10,
    email: 'owner@example.com'
  };

  beforeEach(() => {
    vi.clearAllMocks();
    Object.values(queriesMock).forEach((mockFn) => mockFn.mockReset());
    Object.values(emailMock).forEach((mockFn) => mockFn.mockReset());
    process.env.COLLABORATOR_INVITE_BASE_URL = 'https://carebase.dev';
    process.env.COLLABORATOR_APP_OPEN_URL = 'carebase://invite?token={token}';
    process.env.COLLABORATOR_APP_DOWNLOAD_URL = 'https://apps.example.com/carebase';
  });

  afterEach(() => {
    delete process.env.COLLABORATOR_INVITE_BASE_URL;
    delete process.env.COLLABORATOR_APP_OPEN_URL;
    delete process.env.COLLABORATOR_APP_DOWNLOAD_URL;
  });

  it('rejects unauthenticated requests', async () => {
    const app = createApp();
    const response = await request(app).get('/');
    expect(response.status).toBe(401);
    expect(response.body.error).toBe('Not authenticated');
  });

  it('returns 404 when no recipient context exists', async () => {
    resolveRecipientContextForUser.mockResolvedValueOnce({ recipient: null, collaborator: null });
    const app = createApp(user);

    const response = await request(app).get('/');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: 'No recipient found' });
    expect(listCollaborators).not.toHaveBeenCalled();
  });

  it('redacts pending invite tokens for collaborators and shows for owners', async () => {
    resolveRecipientContextForUser.mockResolvedValueOnce({
      recipient: { id: 1, userId: user.id },
      collaborator: null
    });
    listCollaborators.mockResolvedValueOnce([
      { id: 1, status: 'pending', inviteToken: 'pending-token' },
      { id: 2, status: 'accepted', inviteToken: 'accepted-token' }
    ]);
    const app = createApp(user);

    const responseOwner = await request(app).get('/');

    expect(responseOwner.status).toBe(200);
    expect(responseOwner.body.collaborators).toEqual([
      { id: 1, status: 'pending', inviteToken: 'pending-token' },
      { id: 2, status: 'accepted', inviteToken: '' }
    ]);

    resolveRecipientContextForUser.mockResolvedValueOnce({
      recipient: { id: 1, userId: user.id },
      collaborator: { id: 99 }
    });
    listCollaborators.mockResolvedValueOnce([
      { id: 1, status: 'pending', inviteToken: 'pending-token' },
      { id: 2, status: 'accepted', inviteToken: 'accepted-token' }
    ]);

    const responseCollaborator = await request(createApp(user)).get('/');

    expect(responseCollaborator.status).toBe(200);
    expect(responseCollaborator.body.collaborators).toEqual([
      { id: 1, status: 'pending', inviteToken: '' },
      { id: 2, status: 'accepted', inviteToken: '' }
    ]);
  });

  it('prevents collaborator invites from non-owners', async () => {
    resolveRecipientContextForUser.mockResolvedValueOnce({
      recipient: { id: 1, userId: user.id },
      collaborator: { id: 99 }
    });

    const response = await request(createApp(user))
      .post('/')
      .send({ email: 'friend@example.com', role: 'contributor' });

    expect(response.status).toBe(403);
    expect(response.body.error).toBe('Only the owner can invite collaborators');
    expect(createCollaboratorInvite).not.toHaveBeenCalled();
  });

  it('validates invite payload email', async () => {
    resolveRecipientContextForUser.mockResolvedValueOnce({
      recipient: { id: 1, userId: user.id },
      collaborator: null
    });

    const response = await request(createApp(user)).post('/').send({});

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Email is required');
  });

  it('creates collaborator invite, sends email, and touches plan', async () => {
    resolveRecipientContextForUser.mockResolvedValueOnce({
      recipient: { id: 1, userId: user.id },
      collaborator: null
    });
    createCollaboratorInvite.mockResolvedValueOnce({
      collaborator: { email: 'friend@example.com', inviteToken: 'abc123' },
      created: true,
      resent: false
    });
    listCollaborators.mockResolvedValueOnce([]);
    touchPlanForUser.mockResolvedValueOnce(undefined);
    sendCollaboratorInviteEmail.mockResolvedValueOnce(undefined);

    const response = await request(createApp(user))
      .post('/')
      .send({ email: 'friend@example.com', role: 'contributor' });

    expect(response.status).toBe(201);
    expect(createCollaboratorInvite).toHaveBeenCalledWith(1, user.id, 'friend@example.com', 'contributor');
    expect(sendCollaboratorInviteEmail).toHaveBeenCalledWith('friend@example.com', expect.objectContaining({
      inviterEmail: 'owner@example.com',
      acceptUrl: 'https://carebase.dev/collaborators/accept?token=abc123',
      appOpenUrl: 'carebase://invite?token=abc123',
      appDownloadUrl: 'https://apps.example.com/carebase'
    }));
    expect(touchPlanForUser).toHaveBeenCalledWith(user.id, expect.any(Object));
  });

  it('accepts collaborator invite when token and email match', async () => {
    resolveRecipientContextForUser.mockResolvedValue({ recipient: null, collaborator: null });
    findCollaboratorByToken.mockResolvedValueOnce({
      email: 'friend@example.com'
    });
    acceptCollaboratorInvite.mockResolvedValueOnce({
      recipientId: 1,
      status: 'accepted'
    });
    findRecipientById.mockResolvedValueOnce({ id: 1, userId: 50 });

    const response = await request(createApp({ id: 12, email: 'friend@example.com' }))
      .post('/accept')
      .send({ token: 'abc123' });

    expect(response.status).toBe(200);
    expect(acceptCollaboratorInvite).toHaveBeenCalledWith('abc123', {
      id: 12,
      email: 'friend@example.com'
    });
    expect(touchPlanForUser).toHaveBeenCalledWith(50, expect.any(Object));
  });

  it('rejects invite acceptance when token missing or mismatched email', async () => {
    let response = await request(createApp(user)).post('/accept').send({});
    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Token is required');

    findCollaboratorByToken.mockResolvedValueOnce({ email: 'other@example.com' });
    response = await request(createApp(user)).post('/accept').send({ token: 'abc123' });
    expect(response.status).toBe(403);
    expect(response.body.error).toBe('Invite belongs to a different email');
  });

  it('exposes helper emailsMatch for backwards compatibility', () => {
    expect(emailsMatch(' Owner@Example.com ', 'owner@example.com')).toBe(true);
    expect(emailsMatch('friend@example.com', 'owner@example.com')).toBe(false);
  });
});
