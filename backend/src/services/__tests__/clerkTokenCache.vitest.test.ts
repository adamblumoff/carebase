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

  it('stores and retrieves entries when expiration is sufficiently in the future', () => {
    const now = 1_000_000;
    mockNow(now);
    setClerkTokenCacheEntry('token', {
      userId: 'user_1',
      sessionId: 'sess_1',
      expiresAt: now + 120_000
    });

    const entry = getClerkTokenCacheEntry('token');
    expect(entry).toEqual({
      userId: 'user_1',
      sessionId: 'sess_1',
      expiresAt: now + 120_000,
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

  it('applies default TTL when expiresAt not provided', () => {
    const now = 2_000_000;
    mockNow(now);
    setClerkTokenCacheEntry('token', { userId: 'user_2', sessionId: null });

    mockNow(now + 10_000);
    const entry = getClerkTokenCacheEntry('token');
    expect(entry).toEqual({
      userId: 'user_2',
      sessionId: null,
      expiresAt: now + 300_000,
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

  it('evicts the oldest entry when cache exceeds max size', () => {
    const now = 1_000_000;
    mockNow(now);
    for (let i = 0; i < 500; i += 1) {
      setClerkTokenCacheEntry(`token-${i}`, { userId: `user_${i}`, sessionId: null, expiresAt: now + 600_000 });
    }

    setClerkTokenCacheEntry('token-overflow', {
      userId: 'user_overflow',
      sessionId: null,
      expiresAt: now + 600_000
    });

    expect(getClerkTokenCacheEntry('token-0')).toBeNull();
    expect(getClerkTokenCacheEntry('token-overflow')).not.toBeNull();
    expect(getClerkTokenCacheStats().size).toBe(500);
  });

  it('refreshes LRU order when entry is read', () => {
    const now = 3_000_000;
    mockNow(now);
    for (let i = 0; i < 500; i += 1) {
      setClerkTokenCacheEntry(`token-${i}`, { userId: `user_${i}`, sessionId: null, expiresAt: now + 600_000 });
    }

    expect(getClerkTokenCacheEntry('token-0')).not.toBeNull();

    mockNow(now + 1_000);
    setClerkTokenCacheEntry('token-overflow', {
      userId: 'user_overflow',
      sessionId: null,
      expiresAt: now + 600_000
    });

    expect(getClerkTokenCacheEntry('token-1')).toBeNull();
    expect(getClerkTokenCacheEntry('token-0')).not.toBeNull();
    expect(getClerkTokenCacheEntry('token-overflow')).not.toBeNull();
  });
});
