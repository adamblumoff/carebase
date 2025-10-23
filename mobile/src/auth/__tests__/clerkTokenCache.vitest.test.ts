import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clerkTokenCache,
  setClerkTokenFetcher,
  fetchClerkSessionToken,
  clearClerkTokenCache
} from '../clerkTokenCache';

const originalAtob = globalThis.atob;

function base64UrlEncode(value: string): string {
  return Buffer.from(value, 'utf8')
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function makeToken(expirationSecondsFromNow: number): string {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64UrlEncode(JSON.stringify({ exp: nowSeconds + expirationSecondsFromNow }));
  return `${header}.${payload}.signature`;
}

describe('clerkTokenCache', () => {
  beforeEach(async () => {
    setClerkTokenFetcher(null);
    clearClerkTokenCache();
    if (!globalThis.atob) {
      globalThis.atob = (input: string) => Buffer.from(input, 'base64').toString('binary');
    }
  });

  afterEach(() => {
    if (originalAtob) {
      globalThis.atob = originalAtob;
    }
  });

  it('reuses cached token without re-fetching', async () => {
    const token = makeToken(600);
    const fetcher = vi.fn().mockResolvedValue(token);
    setClerkTokenFetcher(fetcher);

    const first = await fetchClerkSessionToken();
    expect(first).toBe(token);
    expect(fetcher).toHaveBeenCalledTimes(1);

    const second = await fetchClerkSessionToken();
    expect(second).toBe(token);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('refreshes token when cached value is expired', async () => {
    const expired = makeToken(-60);
    await clerkTokenCache.saveToken('session', expired);

    const fresh = makeToken(600);
    const fetcher = vi.fn().mockResolvedValue(fresh);
    setClerkTokenFetcher(fetcher);

    const token = await fetchClerkSessionToken();
    expect(token).not.toBe(expired);
    const result = await fetcher.mock.results[0]?.value;
    expect(token).toBe(result);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
