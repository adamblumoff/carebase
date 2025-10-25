import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type QueryResponse = { rows: any[]; rowCount: number } | { error: Error };

const queryMock = vi.fn();
const tokenMock = vi.fn(() => 'token-default');

vi.mock('../shared.js', () => ({
  db: { query: queryMock },
  generateToken: tokenMock,
  getRealtimeEmitter: vi.fn()
}));

const collaborators = await import('../collaborators.js');

const ownerRow = {
  id: 1,
  recipient_id: 10,
  user_id: 7,
  email: 'owner@example.com',
  role: 'owner' as const,
  status: 'accepted' as const,
  invite_token: 'owner-token',
  invited_by: 7,
  invited_at: new Date('2030-10-01T12:00:00Z'),
  accepted_at: new Date('2030-10-01T12:05:00Z')
};

function setQueryResponses(...responses: QueryResponse[]) {
  const queue = [...responses];
  queryMock.mockImplementation(() => {
    if (queue.length === 0) {
      return { rows: [], rowCount: 0 };
    }
    const next = queue.shift()!;
    if ('error' in next) {
      throw next.error;
    }
    return next;
  });
}

beforeEach(async () => {
  queryMock.mockReset();
  queryMock.mockImplementation(() => ({ rows: [], rowCount: 0 }));
  tokenMock.mockReset();
  tokenMock.mockReturnValue('token-default');
  collaborators.__resetCollaboratorSchemaForTests();
  await collaborators.ensureCollaboratorSchema();
  queryMock.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ensureCollaboratorSchema', () => {
  it('runs bootstrap queries only once even when called in parallel', async () => {
    collaborators.__resetCollaboratorSchemaForTests();
    queryMock.mockReset();
    queryMock.mockImplementation(() => ({ rows: [], rowCount: 0 }));

    await Promise.all([
      collaborators.ensureCollaboratorSchema(),
      collaborators.ensureCollaboratorSchema()
    ]);

    const createTableCalls = queryMock.mock.calls.filter(([sql]) =>
      typeof sql === 'string' && sql.includes('CREATE TABLE IF NOT EXISTS care_collaborators')
    );
    expect(createTableCalls).toHaveLength(1);

    await collaborators.ensureCollaboratorSchema();
    const totalCalls = queryMock.mock.calls.filter(([sql]) =>
      typeof sql === 'string' && sql.includes('CREATE TABLE IF NOT EXISTS care_collaborators')
    );
    expect(totalCalls).toHaveLength(1);
  });

  it('logs failures when schema bootstrap encounters errors', async () => {
    collaborators.__resetCollaboratorSchemaForTests();
    const error = new Error('migration failed');
    queryMock.mockImplementation(() => {
      throw error;
    });
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await collaborators.ensureCollaboratorSchema();

    expect(consoleSpy).toHaveBeenCalledWith('Failed to ensure collaborator schema:', error);
    consoleSpy.mockRestore();
  });
});

describe('collaborator operations', () => {
  it('creates owner collaborator when none exists and reuses existing rows', async () => {
    const ensureSpy = vi.spyOn(collaborators, 'ensureCollaboratorSchema').mockResolvedValue();
    tokenMock.mockReturnValueOnce('owner-token');

    setQueryResponses(
      { rows: [], rowCount: 0 },
      { rows: [ownerRow], rowCount: 1 }
    );
    const created = await collaborators.ensureOwnerCollaborator(10, {
      id: 7,
      email: 'owner@example.com'
    } as any);

    expect(created.role).toBe('owner');
    expect(created.inviteToken).toBe('owner-token');

    setQueryResponses({ rows: [ownerRow], rowCount: 1 });
    const existing = await collaborators.ensureOwnerCollaborator(10, {
      id: 7,
      email: 'owner@example.com'
    } as any);

    expect(existing.inviteToken).toBe('owner-token');
    expect(tokenMock).toHaveBeenCalledTimes(1);
    ensureSpy.mockRestore();
  });

  it('refreshes pending invites and returns accepted collaborators', async () => {
    const ensureSpy = vi.spyOn(collaborators, 'ensureCollaboratorSchema').mockResolvedValue();
    const pendingRow = {
      ...ownerRow,
      id: 2,
      user_id: null,
      status: 'pending' as const,
      invite_token: 'stale-token',
      role: 'contributor' as const,
      email: 'helper@example.com'
    };

    tokenMock.mockReturnValueOnce('token-1');
    setQueryResponses(
      { rows: [pendingRow], rowCount: 1 },
      { rows: [{ ...pendingRow, invite_token: 'token-1', invited_by: 42 }], rowCount: 1 }
    );
    const refreshed = await collaborators.createCollaboratorInvite(10, 42, 'helper@example.com');
    expect(refreshed).toMatchObject({ created: false, resent: true });

    setQueryResponses({
      rows: [{ ...pendingRow, status: 'accepted', email: 'accepted@example.com', invite_token: 'accepted-token' }],
      rowCount: 1
    });
    const accepted = await collaborators.createCollaboratorInvite(10, 42, 'accepted@example.com');
    expect(accepted).toMatchObject({ created: false, resent: false });

    tokenMock.mockReturnValueOnce('token-2');
    setQueryResponses(
      { rows: [], rowCount: 0 },
      { rows: [{ ...pendingRow, id: 3, email: 'new@example.com', invite_token: 'token-2' }], rowCount: 1 }
    );
    const created = await collaborators.createCollaboratorInvite(10, 42, 'new@example.com');
    expect(created).toMatchObject({ created: true, collaborator: expect.objectContaining({ email: 'new@example.com' }) });

    ensureSpy.mockRestore();
  });

  it('lists collaborators and accepts invites', async () => {
    const ensureSpy = vi.spyOn(collaborators, 'ensureCollaboratorSchema').mockResolvedValue();

    setQueryResponses({ rows: [ownerRow], rowCount: 1 });
    const list = await collaborators.listCollaborators(10);
    expect(list).toHaveLength(1);

    setQueryResponses({ rows: [ownerRow], rowCount: 1 });
    const accepted = await collaborators.acceptCollaboratorInvite('owner-token', { id: 7 } as any);
    expect(accepted?.status).toBe('accepted');

    setQueryResponses({ rows: [], rowCount: 0 });
    const missing = await collaborators.acceptCollaboratorInvite('missing-token', { id: 7 } as any);
    expect(missing).toBeNull();

    ensureSpy.mockRestore();
  });

  it('resolves collaborator context for owners, collaborators, and none', async () => {
    const ensureSpy = vi.spyOn(collaborators, 'ensureCollaboratorSchema').mockResolvedValue();

    setQueryResponses({ rows: [{ id: 99, user_id: 7, display_name: 'Owner', created_at: new Date() }], rowCount: 1 });
    const ownerContext = await collaborators.resolveRecipientContextForUser(7);
    expect(ownerContext.recipient?.id).toBe(99);
    expect(ownerContext.collaborator).toBeNull();

    setQueryResponses(
      { rows: [], rowCount: 0 },
      { rows: [{ id: 55, user_id: 8, display_name: 'Recipient', created_at: new Date() }], rowCount: 1 },
      { rows: [{ ...ownerRow, id: 9, user_id: 8, role: 'contributor' }], rowCount: 1 }
    );
    const collaboratorContext = await collaborators.resolveRecipientContextForUser(8);
    expect(collaboratorContext.recipient?.id).toBe(55);
    expect(collaboratorContext.collaborator?.userId).toBe(8);

    setQueryResponses(
      { rows: [], rowCount: 0 },
      { rows: [], rowCount: 0 }
    );
    const noneContext = await collaborators.resolveRecipientContextForUser(999);
    expect(noneContext).toEqual({ recipient: null, collaborator: null });

    ensureSpy.mockRestore();
  });

  it('handles invite lookups and swallows unsupported schema errors', async () => {
    const ensureSpy = vi.spyOn(collaborators, 'ensureCollaboratorSchema').mockResolvedValue();

    queryMock.mockImplementation((sql, params) => {
      const statement = sql as string;
      if (statement.includes('SELECT 1 FROM care_collaborators WHERE email = $1')) {
        return { rows: [{ 1: 1 }], rowCount: 1 };
      }
      if (statement.includes('SELECT DISTINCT LOWER(c.email) AS email')) {
        return { rows: [{ email: 'friend@example.com' }, { email: null }], rowCount: 2 };
      }
      if (statement.includes('SELECT * FROM care_collaborators WHERE recipient_id = $1 AND email = $2')) {
        return { rows: [{ ...ownerRow, email: params?.[1], role: 'contributor' }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });

    const hasInvite = await collaborators.hasCollaboratorInviteForEmail(' friend@example.com ');
    expect(hasInvite).toBe(true);

    const emails = await collaborators.listAcceptedCollaboratorEmailsForOwner(7);
    expect(emails).toEqual(['friend@example.com']);
    ensureSpy.mockRestore();

    collaborators.__resetCollaboratorSchemaForTests();
    const suppressSpy = vi
      .spyOn(collaborators, 'ensureCollaboratorSchema')
      .mockRejectedValueOnce(new Error('Not supported in sqlite'));
    queryMock.mockImplementation(() => ({ rows: [{ email: 'friend@example.com' }], rowCount: 1 }));

    const safeEmails = await collaborators.listAcceptedCollaboratorEmailsForOwner(7);
    expect(safeEmails).toEqual(['friend@example.com']);
    suppressSpy.mockRestore();

    collaborators.__resetCollaboratorSchemaForTests();
    queryMock.mockImplementation(() => {
      throw new Error('Unexpected failure');
    });
    await expect(collaborators.listAcceptedCollaboratorEmailsForOwner(7)).rejects.toThrow('Unexpected failure');
  });
});
