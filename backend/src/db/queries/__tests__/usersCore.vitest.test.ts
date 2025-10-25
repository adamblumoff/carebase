import { beforeEach, describe, expect, it, vi } from 'vitest';

const tokenMock = vi.hoisted(() => vi.fn(() => 'plan-secret'));
const forwardingMock = vi.hoisted(() => vi.fn(() => 'user-1-forward@carebase.dev'));

const dbMocks = vi.hoisted(() => ({
  query: vi.fn()
}));

vi.mock('../shared.js', () => ({
  db: dbMocks,
  generateToken: tokenMock,
  generateForwardingAddress: forwardingMock
}));

const {
  userRowToUser,
  createUser,
  createUserWithEmail,
  findUserByEmail,
  findUserByGoogleId,
  findUserByLegacyGoogleId,
  findUserById,
  findUserByClerkUserId,
  setClerkUserId,
  setPasswordResetRequired,
  deleteUser,
  listUsersForClerkBackfill,
  getUserForClerkBackfill,
  getUserMfaStatus,
  upsertUserMfaStatus
} = await import('../users.js');

const baseRow = {
  id: 1,
  email: 'owner@example.com',
  google_id: 'google-1',
  legacy_google_id: null,
  clerk_user_id: null,
  password_reset_required: false,
  forwarding_address: '',
  plan_secret: 'plan-secret',
  plan_version: 3,
  plan_updated_at: new Date('2025-10-20T00:00:00.000Z'),
  created_at: new Date('2025-09-01T00:00:00.000Z')
};

beforeEach(() => {
  vi.clearAllMocks();
  dbMocks.query.mockResolvedValue({ rows: [], rowCount: 0 });
});

describe('user queries', () => {
  it('maps raw rows to domain user', () => {
    expect(userRowToUser(baseRow)).toMatchObject({
      id: 1,
      email: 'owner@example.com',
      forwardingAddress: '',
      planVersion: 3
    });
  });

  it('creates user with google id and assigns forwarding address', async () => {
    dbMocks.query
      .mockResolvedValueOnce({ rows: [{ ...baseRow }], rowCount: 1 }) // insert
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }); // update forwarding

    const user = await createUser('owner@example.com', 'google-1');

    expect(tokenMock).toHaveBeenCalledWith(32);
    expect(dbMocks.query).toHaveBeenNthCalledWith(1, expect.stringContaining('INSERT INTO users'), [
      'owner@example.com',
      'google-1',
      'temp',
      'plan-secret'
    ]);
    expect(dbMocks.query).toHaveBeenNthCalledWith(2, 'UPDATE users SET forwarding_address = $1 WHERE id = $2', [
      'user-1-forward@carebase.dev',
      1
    ]);
    expect(user.forwardingAddress).toBe('user-1-forward@carebase.dev');
  });

  it('creates user with email only', async () => {
    dbMocks.query
      .mockResolvedValueOnce({ rows: [{ ...baseRow }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const user = await createUserWithEmail('new@example.com');

    expect(dbMocks.query).toHaveBeenNthCalledWith(1, expect.stringContaining('INSERT INTO users (email, forwarding_address'), [
      'new@example.com',
      'plan-secret'
    ]);
    expect(forwardingMock).toHaveBeenCalled();
    expect(user.forwardingAddress).toBe('user-1-forward@carebase.dev');
  });

  it('finds users by identifiers and updates flags', async () => {
    dbMocks.query.mockResolvedValue({ rows: [{ ...baseRow }], rowCount: 1 });

    await findUserByEmail('owner@example.com');
    await findUserByGoogleId('google-1');
    await findUserByLegacyGoogleId('legacy-1');
    await findUserById(1);
    await findUserByClerkUserId('clerk_1');

    expect(dbMocks.query).toHaveBeenCalledTimes(5);
  });

  it('updates clerk id, password reset, and delete calls', async () => {
    await setClerkUserId(1, 'clerk_1');
    await setPasswordResetRequired(1, true);
    await deleteUser(1);

    expect(dbMocks.query).toHaveBeenNthCalledWith(1, 'UPDATE users SET clerk_user_id = $1 WHERE id = $2', [
      'clerk_1',
      1
    ]);
    expect(dbMocks.query).toHaveBeenNthCalledWith(2, 'UPDATE users SET password_reset_required = $1 WHERE id = $2', [
      true,
      1
    ]);
    expect(dbMocks.query).toHaveBeenNthCalledWith(3, 'DELETE FROM users WHERE id = $1', [1]);
  });

  it('lists users for clerk backfill with role flags', async () => {
    dbMocks.query.mockResolvedValueOnce({
      rows: [{
        ...baseRow,
        is_owner: true,
        is_contributor: false,
        has_google_credential: true
      }],
      rowCount: 1
    });

    const result = await listUsersForClerkBackfill();
    expect(result[0]).toMatchObject({
      roles: { owner: true, contributor: false },
      hasGoogleCredential: true
    });
  });

  it('fetches single user for backfill', async () => {
    dbMocks.query.mockResolvedValueOnce({
      rows: [{
        ...baseRow,
        is_owner: false,
        is_contributor: true,
        has_google_credential: false
      }],
      rowCount: 1
    });

    const result = await getUserForClerkBackfill(1);
    expect(result?.roles.contributor).toBe(true);
  });

  it('gets and upserts MFA status', async () => {
    const statusRow = {
      user_id: 1,
      status: 'enrolled' as const,
      last_transition_at: new Date('2025-10-01T12:00:00.000Z'),
      grace_expires_at: null
    };
    dbMocks.query.mockResolvedValueOnce({ rows: [statusRow], rowCount: 1 });

    const status = await getUserMfaStatus(1);
    expect(status).toEqual({
      userId: 1,
      status: 'enrolled',
      lastTransitionAt: statusRow.last_transition_at,
      graceExpiresAt: null
    });

    dbMocks.query.mockResolvedValueOnce({ rows: [{ ...statusRow, grace_expires_at: new Date('2025-11-01') }], rowCount: 1 });
    const updated = await upsertUserMfaStatus(1, 'pending', new Date('2025-11-01'));
    expect(updated.graceExpiresAt).toEqual(new Date('2025-11-01'));
  });
});
