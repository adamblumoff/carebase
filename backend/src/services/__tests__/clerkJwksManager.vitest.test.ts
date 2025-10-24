import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import {
  configureClerkJwks,
  getClerkJwksVerifier,
  prefetchClerkJwks,
  resetClerkJwksForTests
} from '../clerkJwksManager.js';

const mockJwks = {
  keys: [
    {
      kty: 'RSA',
      kid: 'test',
      use: 'sig',
      n: 'sXch1Yw',
      e: 'AQAB'
    }
  ]
};

const originalFetch = global.fetch;

beforeEach(() => {
  resetClerkJwksForTests();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  global.fetch = originalFetch;
});

function mockFetchWithSuccess(): void {
  global.fetch = vi.fn(async () => {
    return new Response(JSON.stringify(mockJwks), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }) as any;
}

describe('clerkJwksManager', () => {
  it('prefetches JWKS and schedules refresh', async () => {
    mockFetchWithSuccess();
    await prefetchClerkJwks('https://example.com', 100);

    expect(global.fetch).toHaveBeenCalledTimes(1);

    // first verification uses cached jwks without new fetch
    await getClerkJwksVerifier('https://example.com');
    expect(global.fetch).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(15 * 60 * 1000);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('retries JWKS download before failing', async () => {
    const error = new Error('network');
    const successResponse = new Response(JSON.stringify(mockJwks), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce(successResponse);
    global.fetch = fetchMock as any;

    await prefetchClerkJwks('https://retry.com', 1000);

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('throws when JWKS payload is malformed', async () => {
    const badResponse = new Response(JSON.stringify({ nope: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
    const fetchMock = vi.fn(async () => badResponse);
    global.fetch = fetchMock as any;

    await expect(getClerkJwksVerifier('https://invalid.com')).rejects.toThrow('Invalid JWKS payload');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('shares in-flight JWKS loads between concurrent requests', async () => {
    mockFetchWithSuccess();

    await Promise.all([
      getClerkJwksVerifier('https://inflight.com'),
      getClerkJwksVerifier('https://inflight.com')
    ]);

    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('warns but does not throw when prefetch times out', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const abortableFetch = vi.fn((_: URL, init?: RequestInit) => {
      return new Promise((_, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const abortError = new Error('Aborted');
          abortError.name = 'AbortError';
          reject(abortError);
        });
      });
    });

    global.fetch = abortableFetch as any;

    const promise = prefetchClerkJwks('https://timeout.com', 50);
    await vi.advanceTimersByTimeAsync(50);
    await promise;

    expect(warnSpy).toHaveBeenCalledWith(
      '[ClerkSync] Failed to prefetch Clerk JWKS',
      expect.objectContaining({ issuer: 'https://timeout.com' })
    );
    expect(abortableFetch).toHaveBeenCalledTimes(1);

    warnSpy.mockRestore();
  });

  it('applies exponential backoff on refresh failure', async () => {
    const success = new Response(JSON.stringify(mockJwks), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
    const failure = new Error('fail');
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(success) // initial prefetch
      .mockRejectedValueOnce(failure) // first refresh fails
      .mockResolvedValueOnce(success); // retry succeeds

    global.fetch = fetchMock as any;

    configureClerkJwks({
      issuer: 'https://backoff.com',
      refreshIntervalMs: 2000,
      prefetchTimeoutMs: 100
    });

    await vi.runAllTimersAsync();
    expect(fetchMock).toHaveBeenCalledTimes(1); // initial prefetch

    // trigger first scheduled refresh (fails)
    await vi.advanceTimersByTimeAsync(2000);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // advance by backoff delay (should double to 4000)
    await vi.advanceTimersByTimeAsync(2000);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(2000);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
