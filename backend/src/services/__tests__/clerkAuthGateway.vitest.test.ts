import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const createClerkClientMock = vi.fn();
const jwtDecodeMock = vi.fn();
const jwtVerifyMock = vi.fn();
const getClerkTokenCacheEntryMock = vi.fn();
const setClerkTokenCacheEntryMock = vi.fn();
const deleteClerkTokenCacheEntryMock = vi.fn();
const getClerkJwksVerifierMock = vi.fn();
const incrementMetricMock = vi.fn();

vi.mock('@clerk/backend', () => ({
  createClerkClient: createClerkClientMock
}));

vi.mock('jsonwebtoken', () => ({
  default: { decode: jwtDecodeMock }
}));

vi.mock('jose', () => ({
  jwtVerify: jwtVerifyMock
}));

vi.mock('../clerkTokenCache.js', () => ({
  getClerkTokenCacheEntry: getClerkTokenCacheEntryMock,
  setClerkTokenCacheEntry: setClerkTokenCacheEntryMock,
  deleteClerkTokenCacheEntry: deleteClerkTokenCacheEntryMock
}));

vi.mock('../clerkJwksManager.js', () => ({
  getClerkJwksVerifier: getClerkJwksVerifierMock
}));

vi.mock('../../utils/metrics.js', () => ({
  incrementMetric: incrementMetricMock
}));

const originalEnv = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  process.env = { ...originalEnv };
  delete process.env.CLERK_SECRET_KEY;
  delete process.env.CLERK_API_URL;
  delete process.env.CLERK_API_VERSION;
  delete process.env.CLERK_SESSION_VERIFY_TIMEOUT_MS;
});

afterEach(() => {
  process.env = { ...originalEnv };
});

async function loadGateway() {
  return import('../clerkAuthGateway.js');
}

describe('clerkAuthGateway', () => {
  it('logs diagnostic output only when CLERK_DEBUG is enabled', async () => {
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const { logClerk } = await loadGateway();

    // Should no-op when debug flag disabled
    logClerk('hello');
    expect(debugSpy).not.toHaveBeenCalled();

    process.env.CLERK_DEBUG = 'true';
    logClerk('world');
    logClerk('metadata', { ok: true });

    expect(debugSpy).toHaveBeenNthCalledWith(1, '[ClerkSync] world');
    expect(debugSpy).toHaveBeenNthCalledWith(2, '[ClerkSync] metadata', { ok: true });

    debugSpy.mockRestore();
  });

  it('returns null and warns once when secret missing', async () => {
    process.env.NODE_ENV = 'development';
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { getClerkClient } = await loadGateway();

    expect(getClerkClient()).toBeNull();
    expect(getClerkClient()).toBeNull();
    expect(warnSpy).toHaveBeenCalledTimes(1);

    warnSpy.mockRestore();
  });

  it('creates and caches client when secret present', async () => {
    const fakeClient = { sessions: { verifySession: vi.fn() } } as any;
    process.env.CLERK_SECRET_KEY = 'sekret';
    process.env.CLERK_API_URL = 'https://api.example';
    createClerkClientMock.mockReturnValue(fakeClient);

    const { getClerkClient } = await loadGateway();

    expect(getClerkClient()).toBe(fakeClient);
    expect(getClerkClient()).toBe(fakeClient);
    expect(createClerkClientMock).toHaveBeenCalledTimes(1);
    expect(createClerkClientMock).toHaveBeenCalledWith({
      secretKey: 'sekret',
      apiUrl: 'https://api.example',
      apiVersion: '2021-02-01'
    });
  });

  it('returns cached verification when available', async () => {
    const fakeClient = { sessions: { verifySession: vi.fn() } } as any;
    process.env.CLERK_SECRET_KEY = 'sekret';
    createClerkClientMock.mockReturnValue(fakeClient);
    getClerkTokenCacheEntryMock.mockReturnValue({
      userId: 'user_1',
      sessionId: 'sess_1',
      expiresAt: 50
    });

    const { verifyClerkSessionToken } = await loadGateway();

    const result = await verifyClerkSessionToken('token-1');
    expect(result).toEqual({ userId: 'user_1', sessionId: 'sess_1', expiresAt: 50 });
    expect(incrementMetricMock).toHaveBeenCalledWith('clerk.token.cache', 1, { outcome: 'hit' });
    expect(setClerkTokenCacheEntryMock).not.toHaveBeenCalled();
  });

  it('handles token decode errors gracefully', async () => {
    const fakeClient = { sessions: { verifySession: vi.fn() } } as any;
    process.env.CLERK_SECRET_KEY = 'sekret';
    createClerkClientMock.mockReturnValue(fakeClient);
    getClerkTokenCacheEntryMock.mockReturnValue(null);
    jwtDecodeMock.mockImplementation(() => {
      throw new Error('bad token');
    });

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { verifyClerkSessionToken } = await loadGateway();

    const result = await verifyClerkSessionToken('broken');
    expect(result).toBeNull();
    expect(incrementMetricMock).toHaveBeenCalledWith('clerk.token.cache', 1, { outcome: 'miss' });
    expect(incrementMetricMock).toHaveBeenCalledWith('clerk.token.verify', 1, { outcome: 'decode_error' });
    expect(warnSpy).toHaveBeenCalledWith('[ClerkSync] Failed to decode Clerk session token:', 'bad token');

    warnSpy.mockRestore();
  });

  it('requires decoded session id and issuer', async () => {
    const fakeClient = { sessions: { verifySession: vi.fn() } } as any;
    process.env.CLERK_SECRET_KEY = 'sekret';
    createClerkClientMock.mockReturnValue(fakeClient);
    getClerkTokenCacheEntryMock.mockReturnValue(null);
    jwtDecodeMock.mockReturnValue({ sub: 'user_1' });

    const { verifyClerkSessionToken } = await loadGateway();

    expect(await verifyClerkSessionToken('no-session')).toBeNull();
    expect(incrementMetricMock).toHaveBeenCalledWith('clerk.token.verify', 1, { outcome: 'missing_sid' });
  });

  it('verifies via JWKS and caches result', async () => {
    const fakeClient = { sessions: { verifySession: vi.fn() } } as any;
    process.env.CLERK_SECRET_KEY = 'sekret';
    createClerkClientMock.mockReturnValue(fakeClient);
    getClerkTokenCacheEntryMock.mockReturnValue(null);
    jwtDecodeMock.mockReturnValue({ iss: 'https://issuer', sid: 'sid_1', sub: 'user_1', exp: 123 });
    getClerkJwksVerifierMock.mockResolvedValue('verifier');
    jwtVerifyMock.mockResolvedValue({ payload: { sub: 'user_1', sid: 'sid_1', exp: 456 } });

    process.env.CLERK_DEBUG = 'true';
    const logSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const { verifyClerkSessionToken } = await loadGateway();

    const result = await verifyClerkSessionToken('jwt-token');
    expect(result).toEqual({ userId: 'user_1', sessionId: 'sid_1', expiresAt: 456_000 });
    expect(getClerkJwksVerifierMock).toHaveBeenCalledWith('https://issuer');
    expect(setClerkTokenCacheEntryMock).toHaveBeenCalledWith('jwt-token', {
      userId: 'user_1',
      sessionId: 'sid_1',
      expiresAt: 456_000
    });
    expect(incrementMetricMock).toHaveBeenCalledWith('clerk.token.verify', 1, {
      hasSession: 'yes',
      via: 'jwks'
    });
    expect(logSpy).toHaveBeenCalledWith('[ClerkSync] Verified Clerk token via JWKS', {
      clerkUserId: 'user_1',
      sessionId: 'sid_1',
      expiresAt: 456_000
    });

    logSpy.mockRestore();
  });

  it('falls back to Clerk API when JWKS verification fails', async () => {
    const apiSession = { id: 'sess_api', userId: 'user_api', expireAt: '2025-01-01T00:00:00.000Z' };
    const fakeClient = { sessions: { verifySession: vi.fn().mockResolvedValue(apiSession) } } as any;
    process.env.CLERK_SECRET_KEY = 'sekret';
    createClerkClientMock.mockReturnValue(fakeClient);
    getClerkTokenCacheEntryMock.mockReturnValue(null);
    jwtDecodeMock.mockReturnValue({ iss: 'https://issuer', sid: 'sid_api', sub: 'user_api' });
    getClerkJwksVerifierMock.mockResolvedValue('verifier');
    jwtVerifyMock.mockRejectedValue(new Error('jwks fail'));

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { verifyClerkSessionToken } = await loadGateway();

    const result = await verifyClerkSessionToken('api-token');
    expect(fakeClient.sessions.verifySession).toHaveBeenCalledWith('sid_api', 'api-token', expect.any(Object));
    expect(result).toEqual({
      userId: 'user_api',
      sessionId: 'sess_api',
      expiresAt: new Date(apiSession.expireAt).getTime()
    });
    expect(deleteClerkTokenCacheEntryMock).toHaveBeenCalledWith('api-token');
    expect(setClerkTokenCacheEntryMock).toHaveBeenCalledWith('api-token', {
      userId: 'user_api',
      sessionId: 'sess_api',
      expiresAt: new Date(apiSession.expireAt).getTime()
    });
    expect(incrementMetricMock).toHaveBeenCalledWith('clerk.token.verify', 1, {
      hasSession: 'yes',
      via: 'api'
    });
    expect(incrementMetricMock).toHaveBeenCalledWith('clerk.token.verify', 1, { outcome: 'jwks_error' });

    warnSpy.mockRestore();
  });

  it('returns null when Clerk API verification times out', async () => {
    const fakeClient = {
      sessions: {
        verifySession: vi.fn((_: string, __: string, options: { signal: AbortSignal }) => {
          return new Promise((_, reject) => {
            options.signal.addEventListener('abort', () => {
              const abortError = new Error('aborted');
              abortError.name = 'AbortError';
              reject(abortError);
            });
          });
        })
      }
    } as any;
    process.env.CLERK_SECRET_KEY = 'sekret';
    process.env.CLERK_SESSION_VERIFY_TIMEOUT_MS = '10';
    createClerkClientMock.mockReturnValue(fakeClient);
    getClerkTokenCacheEntryMock.mockReturnValue(null);
    jwtDecodeMock.mockReturnValue({ iss: 'https://issuer', sid: 'timeout', sub: 'user_1' });
    getClerkJwksVerifierMock.mockResolvedValue('verifier');
    jwtVerifyMock.mockRejectedValue(new Error('jwks fail'));

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { verifyClerkSessionToken } = await loadGateway();

    vi.useFakeTimers();
    const promise = verifyClerkSessionToken('timeout-token');
    await vi.advanceTimersByTimeAsync(10);
    const result = await promise;
    vi.useRealTimers();

    expect(result).toBeNull();
    expect(deleteClerkTokenCacheEntryMock).toHaveBeenCalledWith('timeout-token');
    expect(incrementMetricMock).toHaveBeenCalledWith('clerk.token.verify', 1, { outcome: 'timeout' });
    expect(setClerkTokenCacheEntryMock).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith('[ClerkSync] Clerk session verify via API timed out after', '10', 'ms');

    warnSpy.mockRestore();
  });

  it('returns null when Clerk API responds with 404', async () => {
    const error: any = new Error('not found');
    error.status = 404;
    const fakeClient = {
      sessions: {
        verifySession: vi.fn().mockRejectedValue(error)
      }
    } as any;
    process.env.CLERK_SECRET_KEY = 'sekret';
    createClerkClientMock.mockReturnValue(fakeClient);
    getClerkTokenCacheEntryMock.mockReturnValue(null);
    jwtDecodeMock.mockReturnValue({ iss: 'https://issuer', sid: 'sid_404', sub: 'user_404', exp: 99 });
    getClerkJwksVerifierMock.mockResolvedValue('verifier');
    jwtVerifyMock.mockRejectedValue(new Error('jwks fail'));

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { verifyClerkSessionToken } = await loadGateway();

    const result = await verifyClerkSessionToken('404-token');
    expect(result).toBeNull();
    expect(setClerkTokenCacheEntryMock).not.toHaveBeenCalled();
    expect(incrementMetricMock).toHaveBeenCalledWith('clerk.token.verify', 1, { outcome: 'not_found' });
    expect(deleteClerkTokenCacheEntryMock).toHaveBeenCalledWith('404-token');

    warnSpy.mockRestore();
  });
});
