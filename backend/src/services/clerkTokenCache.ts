const MAX_CACHE_SIZE = Number.parseInt(process.env.CLERK_TOKEN_CACHE_SIZE ?? '500', 10);
const CLOCK_SKEW_MS = 60_000;
const DEFAULT_TTL_MS = 5 * 60_000;

type CacheEntry = {
  userId: string;
  sessionId: string | null;
  expiresAt: number | null;
  cachedAt: number;
};

const cache = new Map<string, CacheEntry>();

function isExpired(entry: CacheEntry, now: number): boolean {
  if (!entry.expiresAt) {
    return false;
  }
  return entry.expiresAt - CLOCK_SKEW_MS <= now;
}

export function getClerkTokenCacheStats(): { size: number } {
  return { size: cache.size };
}

export function clearClerkTokenCache(): void {
  cache.clear();
}

export function deleteClerkTokenCacheEntry(token: string): void {
  cache.delete(token);
}

export function getClerkTokenCacheEntry(token: string): CacheEntry | null {
  const entry = cache.get(token);
  if (!entry) {
    return null;
  }
  const now = Date.now();
  if (isExpired(entry, now)) {
    cache.delete(token);
    return null;
  }
  // Touch LRU
  cache.delete(token);
  cache.set(token, entry);
  return entry;
}

function evictIfNeeded(): void {
  if (cache.size < MAX_CACHE_SIZE) {
    return;
  }
  const keys = cache.keys();
  const firstKey = keys.next().value;
  if (firstKey) {
    cache.delete(firstKey);
  }
}

export function setClerkTokenCacheEntry(
  token: string,
  value: { userId: string; sessionId: string | null; expiresAt?: number | null }
): void {
  const now = Date.now();
  const expiresAt =
    typeof value.expiresAt === 'number' ? value.expiresAt : now + DEFAULT_TTL_MS;

  if (expiresAt && expiresAt - CLOCK_SKEW_MS <= now) {
    cache.delete(token);
    return;
  }

  evictIfNeeded();
  cache.set(token, {
    userId: value.userId,
    sessionId: value.sessionId ?? null,
    expiresAt: expiresAt ?? null,
    cachedAt: now
  });
}

export function __resetClerkTokenCacheForTests(): void {
  cache.clear();
}
