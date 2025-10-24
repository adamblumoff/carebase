import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  __resetClerkTokenCacheForTests,
  clearClerkTokenCache,
  deleteClerkTokenCacheEntry,
  getClerkTokenCacheEntry,
  getClerkTokenCacheStats,
  setClerkTokenCacheEntry
} from '../clerkTokenCache.js';

const originalNow = Date.now;

afterEach(() => {
  __resetClerkTokenCacheForTests();
  Date.now = originalNow;
});

function mockNow(timestamp: number): void {
  Date.now = vi.fn(() => timestamp);
}

describe('clerkTokenCache', () => {
  it('returns null when entry missing', () => {
    expect(getClerkTokenCacheEntry('missing')).toBeNull();
  });

  it('stores and retrieves entries', () => {
    const now = 1_000_000;
    mockNow(now);
    setClerkTokenCacheEntry('token', { userId: 'user_1', sessionId: 'sess_1', expiresAt: now + 10_000 });

    const entry = getClerkTokenCacheEntry('token');
    expect(entry).toEqual({
      userId: 'user_1',
      sessionId: 'sess_1',
      expiresAt: now + 10_000,
      cachedAt: now
    });
  });

  it('evicts expired entries', () => {
    const now = 1_000_000;
    mockNow(now);
    setClerkTokenCacheEntry('token', { userId: 'user_1', sessionId: 'sess_1', expiresAt: now + 30_000 });

    mockNow(now + 40_000);
    expect(getClerkTokenCacheEntry('token')).toBeNull();
    expect(getClerkTokenCacheStats().size).toBe(0);
  });

  it('retains entries without expiresAt', () => {
    const now = 2_000_000;
    mockNow(now);
    setClerkTokenCacheEntry('token', { userId: 'user_2', sessionId: null, expiresAt: null });

    mockNow(now + 10_000);
    const entry = getClerkTokenCacheEntry('token');
    expect(entry).toEqual({
      userId: 'user_2',
      sessionId: null,
      expiresAt: null,
      cachedAt: now
    });
    expect(getClerkTokenCacheStats().size).toBe(1);
  });

  it('drops entries that are already expired', () => {
    const now = 1_000_000;
    mockNow(now);
    setClerkTokenCacheEntry('token', { userId: 'user_1', sessionId: 'sess_1', expiresAt: now - 1000 });
    expect(getClerkTokenCacheEntry('token')).toBeNull();
  });

  it('allows manual deletion and clearing', () => {
    const now = 1_000_000;
    mockNow(now);
    setClerkTokenCacheEntry('token', { userId: 'user_1', sessionId: 'sess_1', expiresAt: now + 10_000 });
    deleteClerkTokenCacheEntry('token');
    expect(getClerkTokenCacheEntry('token')).toBeNull();

    setClerkTokenCacheEntry('t1', { userId: 'user_a', sessionId: null });
    setClerkTokenCacheEntry('t2', { userId: 'user_b', sessionId: null });
    clearClerkTokenCache();
    expect(getClerkTokenCacheStats().size).toBe(0);
  });

  it('limits cache size by evicting oldest entry', () => {
    process.env.CLERK_TOKEN_CACHE_SIZE = '2';
    const now = 1_000_000;
    mockNow(now);
    setClerkTokenCacheEntry('a', { userId: 'user_a', sessionId: null });
    setClerkTokenCacheEntry('b', { userId: 'user_b', sessionId: null });
    setClerkTokenCacheEntry('c', { userId: 'user_c', sessionId: null });

    expect(getClerkTokenCacheEntry('a')).toBeNull();
    expect(getClerkTokenCacheEntry('b')).not.toBeNull();
    expect(getClerkTokenCacheEntry('c')).not.toBeNull();
    delete process.env.CLERK_TOKEN_CACHE_SIZE;
  });

  it('treats recently read entry as most-recent for eviction', () => {
    process.env.CLERK_TOKEN_CACHE_SIZE = '2';
    const now = 3_000_000;
    mockNow(now);
    setClerkTokenCacheEntry('a', { userId: 'user_a', sessionId: null });
    setClerkTokenCacheEntry('b', { userId: 'user_b', sessionId: null });

    // Touch "a" so it becomes most recent
    expect(getClerkTokenCacheEntry('a')).not.toBeNull();

    // Advance time slightly to ensure cachedAt differs
    mockNow(now + 1_000);
    setClerkTokenCacheEntry('c', { userId: 'user_c', sessionId: null });

    expect(getClerkTokenCacheEntry('a')).not.toBeNull();
    expect(getClerkTokenCacheEntry('c')).not.toBeNull();
    expect(getClerkTokenCacheEntry('b')).toBeNull();
    delete process.env.CLERK_TOKEN_CACHE_SIZE;
  });
});
