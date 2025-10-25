import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const dbMocks = vi.hoisted(() => ({
  clearGoogleSyncForUser: vi.fn(),
  deleteGoogleCredential: vi.fn(),
  findUserById: vi.fn(),
  getGoogleIntegrationStatus: vi.fn(),
  getUserMfaStatus: vi.fn(),
  queueGoogleSyncForUser: vi.fn(),
  upsertGoogleCredential: vi.fn()
}));

const googleSyncMocks = vi.hoisted(() => ({
  syncUserWithGoogle: vi.fn(),
  exchangeGoogleAuthorizationCode: vi.fn(),
  exchangeGoogleAuthorizationCodeServer: vi.fn(),
  stopCalendarWatchForUser: vi.fn(),
  ensureManagedCalendarForUser: vi.fn(),
  migrateEventsToManagedCalendar: vi.fn(),
  refreshManagedCalendarWatch: vi.fn(),
  ensureManagedCalendarAclForUser: vi.fn()
}));

vi.mock('../../db/queries.js', () => dbMocks);
vi.mock('../googleSync.js', () => googleSyncMocks);
vi.mock('jsonwebtoken', () => ({
  default: {
    sign: vi.fn().mockReturnValue('signed-state'),
    verify: vi.fn().mockReturnValue({ userId: 7, nonce: 'nonce' })
  }
}));
vi.mock('crypto', () => ({
  default: {
    randomBytes: vi.fn().mockReturnValue(Buffer.from('randombytesrandom'))
  }
}));

const {
  clearGoogleSyncForUser,
  deleteGoogleCredential,
  findUserById,
  getGoogleIntegrationStatus,
  getUserMfaStatus,
  queueGoogleSyncForUser,
  upsertGoogleCredential
} = dbMocks;
const {
  syncUserWithGoogle,
  exchangeGoogleAuthorizationCode,
  exchangeGoogleAuthorizationCodeServer,
  stopCalendarWatchForUser,
  ensureManagedCalendarForUser,
  migrateEventsToManagedCalendar,
  refreshManagedCalendarWatch,
  ensureManagedCalendarAclForUser
} = googleSyncMocks;

const jwt = await import('jsonwebtoken');
const { sign, verify } = jwt.default as { sign: vi.Mock; verify: vi.Mock };
const { default: crypto } = await import('crypto') as { randomBytes: vi.Mock };
const { ValidationError } = await import('../../utils/errors.js');

const module = await import('../googleIntegrationService.js');
const {
  startGoogleIntegration,
  handleGoogleCallback,
  connectGoogleIntegration,
  disconnectGoogleIntegration,
  manualGoogleSync,
  loadGoogleIntegrationStatus,
  verifyUser
} = module;

const user = {
  id: 7,
  email: 'owner@example.com',
  clerkUserId: 'clerk_1'
} as any;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.GOOGLE_REQUIRE_MFA = 'false';
  process.env.GOOGLE_OAUTH_CLIENT_ID = 'client-id';
  process.env.GOOGLE_AUTH_STATE_SECRET = 'state-secret';
  process.env.BASE_URL = 'https://api.carebase.dev';
  getUserMfaStatus.mockResolvedValue({ status: 'enrolled' });
  syncUserWithGoogle.mockResolvedValue({ pulled: 1, pushed: 0 });
  ensureManagedCalendarForUser.mockResolvedValue({ calendarId: 'carebase-calendar' });
  migrateEventsToManagedCalendar.mockResolvedValue({ previousCalendarIds: [] });
  refreshManagedCalendarWatch.mockResolvedValue(undefined);
  ensureManagedCalendarAclForUser.mockResolvedValue(undefined);
  queueGoogleSyncForUser.mockResolvedValue(undefined);
  upsertGoogleCredential.mockResolvedValue({ id: 99 });
  findUserById.mockResolvedValue(user);
  verify.mockReset();
  verify.mockReturnValue({ userId: 7, nonce: 'nonce' });
});

afterEach(() => {
  delete process.env.GOOGLE_REQUIRE_MFA;
  delete process.env.GOOGLE_OAUTH_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_AUTH_STATE_SECRET;
  delete process.env.BASE_URL;
});

describe('googleIntegrationService', () => {
  it('startGoogleIntegration builds auth URL and enforces MFA when required', async () => {
    process.env.GOOGLE_REQUIRE_MFA = 'true';
    getUserMfaStatus.mockResolvedValueOnce({ status: 'enrolled' });

    const result = await startGoogleIntegration(user);

    expect(sign).toHaveBeenCalled();
    expect(result.authUrl).toContain('client_id=client-id');
    expect(result.redirectUri).toBe('https://api.carebase.dev/api/integrations/google/callback');
  });

  it('startGoogleIntegration throws when client id missing', async () => {
    delete process.env.GOOGLE_OAUTH_CLIENT_ID;
    process.env.GOOGLE_CLIENT_ID = '';
    await expect(startGoogleIntegration(user)).rejects.toThrow('GOOGLE_OAUTH_CLIENT_ID or GOOGLE_CLIENT_ID must be configured');
  });

  it('handleGoogleCallback short-circuits on explicit error', async () => {
    const result = await handleGoogleCallback({ error: 'access_denied' });
    expect(result.redirect).toContain('status=error');
  });

  it('handleGoogleCallback rejects missing code/state', async () => {
    const result = await handleGoogleCallback({ code: undefined, state: undefined });
    expect(result.redirect).toContain('missing_code');
  });

  it('handleGoogleCallback rejects invalid state', async () => {
    verify.mockImplementationOnce(() => {
      throw new Error('invalid');
    });
    const result = await handleGoogleCallback({ code: 'abc', state: 'bad' });
    expect(result.redirect).toContain('invalid_state');
    verify.mockReset();
    verify.mockReturnValue({ userId: 7, nonce: 'nonce' });
  });

  it('handleGoogleCallback returns unknown user error', async () => {
    findUserById.mockResolvedValueOnce(null);
    const result = await handleGoogleCallback({ code: 'abc', state: 'signed-state' });
    expect(result.redirect).toContain('unknown_user');
  });

  it('handleGoogleCallback propagates MFA requirement', async () => {
    process.env.GOOGLE_REQUIRE_MFA = 'true';
    getUserMfaStatus.mockResolvedValueOnce({ status: 'pending' });
    const result = await handleGoogleCallback({ code: 'abc', state: 'signed-state' });
    expect(result.redirect).toContain('mfa_required');
    process.env.GOOGLE_REQUIRE_MFA = 'false';
  });

  it('handleGoogleCallback exchanges code and queues sync on success', async () => {
    exchangeGoogleAuthorizationCodeServer.mockResolvedValueOnce({
      accessToken: 'access',
      refreshToken: 'refresh',
      scope: ['openid'],
      expiresIn: 3600,
      tokenType: 'Bearer',
      idToken: 'id'
    });

    const result = await handleGoogleCallback({ code: 'abc', state: 'signed-state' });

    expect(upsertGoogleCredential).toHaveBeenCalled();
    expect(queueGoogleSyncForUser).toHaveBeenCalledWith(user.id, 'carebase-calendar');
    expect(result.redirect).toContain('status=success');
  });

  it('connectGoogleIntegration requires tokens and hits migrate path', async () => {
    await expect(connectGoogleIntegration(user, {})).rejects.toBeInstanceOf(ValidationError);

    exchangeGoogleAuthorizationCode.mockResolvedValueOnce({
      accessToken: 'new-access',
      refreshToken: 'new-refresh',
      scope: ['email'],
      expiresIn: 3600,
      tokenType: 'Bearer',
      idToken: 'id'
    });

    const result = await connectGoogleIntegration(user, {
      authorizationCode: 'auth',
      codeVerifier: 'verifier',
      redirectUri: 'https://app'
    });

    expect(upsertGoogleCredential).toHaveBeenCalledWith(
      user.id,
      expect.objectContaining({ accessToken: 'new-access' }),
      expect.any(Object)
    );
    expect(syncUserWithGoogle).toHaveBeenCalled();
    expect(result.connected).toBe(true);
  });

  it('disconnectGoogleIntegration clears credentials gracefully', async () => {
    stopCalendarWatchForUser.mockRejectedValueOnce(new Error('network'));

    const result = await disconnectGoogleIntegration(user);

    expect(stopCalendarWatchForUser).toHaveBeenCalledWith(user.id);
    expect(deleteGoogleCredential).toHaveBeenCalledWith(user.id);
    expect(clearGoogleSyncForUser).toHaveBeenCalledWith(user.id);
    expect(result).toEqual({ disconnected: true });
  });

  it('manualGoogleSync proxies to sync service', async () => {
    syncUserWithGoogle.mockResolvedValueOnce({ pulled: 2 });
    const result = await manualGoogleSync(user, { forceFull: true });
    expect(syncUserWithGoogle).toHaveBeenCalledWith(user.id, {
      forceFull: true,
      calendarId: null,
      pullRemote: undefined
    });
    expect(result).toEqual({ pulled: 2 });
  });

  it('loadGoogleIntegrationStatus returns database status', async () => {
    getGoogleIntegrationStatus.mockResolvedValueOnce({ connected: false });
    const result = await loadGoogleIntegrationStatus(user);
    expect(result).toEqual({ connected: false });
  });

  it('verifyUser throws when unauthenticated', async () => {
    await expect(verifyUser(undefined)).rejects.toThrow('Not authenticated');
  });
});
