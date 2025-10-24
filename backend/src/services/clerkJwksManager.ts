import { createLocalJWKSet, type JWKS } from 'jose';
import { incrementMetric } from '../utils/metrics.js';

type Verifier = ReturnType<typeof createLocalJWKSet>;

type JwksEntry = {
  issuer: string;
  verifier: Verifier;
  jwks: JWKS;
  lastFetchedAt: number;
  refreshTimer: NodeJS.Timeout | null;
  backoffDelayMs: number;
};

const jwksEntries = new Map<string, JwksEntry>();
const jwksLoading = new Map<string, Promise<JwksEntry>>();

const DEFAULT_REFRESH_INTERVAL_MS = 15 * 60 * 1000;
const MAX_BACKOFF_MS = 60 * 60 * 1000;
const DEFAULT_PREFETCH_TIMEOUT_MS = 1000;
const DEFAULT_FETCH_TIMEOUT_MS = 2000;

let refreshIntervalMs = DEFAULT_REFRESH_INTERVAL_MS;

async function fetchWithTimeout(url: URL, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    return response;
  } catch (error) {
    if ((error as Error).name === 'AbortError') {
      throw new Error(`JWKS fetch timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function downloadJwks(
  issuer: string,
  timeoutMs: number,
  attemptCount = 2
): Promise<JWKS> {
  const jwksUrl = new URL('/.well-known/jwks.json', issuer);
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= attemptCount; attempt += 1) {
    try {
      const response = await fetchWithTimeout(jwksUrl, timeoutMs);
      if (!response.ok) {
        throw new Error(`JWKS fetch failed (${response.status})`);
      }
      const data = (await response.json()) as JWKS;
      if (!data || !Array.isArray(data.keys)) {
        throw new Error('Invalid JWKS payload received');
      }
      incrementMetric('clerk.jwks.fetch', 1, { issuer: issuerHash(issuer), outcome: 'success', attempt });
      return data;
    } catch (error) {
      lastError = error as Error;
      incrementMetric('clerk.jwks.fetch', 1, {
        issuer: issuerHash(issuer),
        outcome: attempt === attemptCount ? 'failed' : 'retry',
        attempt
      });
      if (attempt === attemptCount) {
        throw lastError;
      }
    }
  }

  throw lastError ?? new Error('Unknown JWKS fetch error');
}

function issuerHash(issuer: string): string {
  return Buffer.from(issuer).toString('base64').slice(0, 8);
}

function scheduleRefresh(entry: JwksEntry, delayMs?: number): void {
  if (entry.refreshTimer) {
    clearTimeout(entry.refreshTimer);
    entry.refreshTimer = null;
  }

  const nextDelay = delayMs ?? refreshIntervalMs;
  if (nextDelay <= 0) {
    return;
  }

  const timer = setTimeout(() => {
    refreshEntry(entry.issuer).catch((error) => {
      console.warn('[ClerkSync] Failed to refresh JWKS', { issuer: entry.issuer, error });
    });
  }, nextDelay);

  if (typeof timer.unref === 'function') {
    timer.unref();
  }

  entry.refreshTimer = timer;
}

async function refreshEntry(issuer: string): Promise<void> {
  const entry = jwksEntries.get(issuer);
  if (!entry) {
    return;
  }

  try {
    const jwks = await downloadJwks(issuer, DEFAULT_FETCH_TIMEOUT_MS);
    entry.jwks = jwks;
    entry.verifier = createLocalJWKSet(jwks);
    entry.lastFetchedAt = Date.now();
    entry.backoffDelayMs = refreshIntervalMs;
    scheduleRefresh(entry);
    incrementMetric('clerk.jwks.refresh', 1, { issuer: issuerHash(issuer), outcome: 'success' });
  } catch (error) {
    const nextDelay = Math.min(
      Math.max(entry.backoffDelayMs * 2, 60_000),
      MAX_BACKOFF_MS
    );
    entry.backoffDelayMs = nextDelay;
    scheduleRefresh(entry, nextDelay);
    incrementMetric('clerk.jwks.refresh', 1, { issuer: issuerHash(issuer), outcome: 'failed' });
    throw error;
  }
}

async function ensureEntry(
  issuer: string,
  timeoutMs: number
): Promise<JwksEntry> {
  const existing = jwksEntries.get(issuer);
  if (existing) {
    return existing;
  }

  let loader = jwksLoading.get(issuer);
  if (!loader) {
    loader = (async () => {
      const jwks = await downloadJwks(issuer, timeoutMs);
      const entry: JwksEntry = {
        issuer,
        jwks,
        verifier: createLocalJWKSet(jwks),
        lastFetchedAt: Date.now(),
        refreshTimer: null,
        backoffDelayMs: refreshIntervalMs
      };
      jwksEntries.set(issuer, entry);
      scheduleRefresh(entry);
      jwksLoading.delete(issuer);
      return entry;
    })().catch((error) => {
      jwksLoading.delete(issuer);
      throw error;
    });
    jwksLoading.set(issuer, loader);
  }

  return loader;
}

export async function getClerkJwksVerifier(issuer: string): Promise<Verifier> {
  const entry = await ensureEntry(issuer, DEFAULT_FETCH_TIMEOUT_MS);
  return entry.verifier;
}

export async function prefetchClerkJwks(
  issuer: string,
  timeoutMs = DEFAULT_PREFETCH_TIMEOUT_MS
): Promise<void> {
  try {
    await ensureEntry(issuer, timeoutMs);
  } catch (error) {
    console.warn('[ClerkSync] Failed to prefetch Clerk JWKS', { issuer, error });
  }
}

export function configureClerkJwks(options: {
  issuer?: string | null;
  refreshIntervalMs?: number;
  prefetchTimeoutMs?: number;
} = {}): void {
  if (typeof options.refreshIntervalMs === 'number' && options.refreshIntervalMs > 0) {
    refreshIntervalMs = options.refreshIntervalMs;
  }

  if (options.issuer) {
    void prefetchClerkJwks(options.issuer, options.prefetchTimeoutMs ?? DEFAULT_PREFETCH_TIMEOUT_MS);
  }
}

export function resetClerkJwksForTests(): void {
  for (const entry of jwksEntries.values()) {
    if (entry.refreshTimer) {
      clearTimeout(entry.refreshTimer);
    }
  }
  jwksEntries.clear();
  jwksLoading.clear();
  refreshIntervalMs = DEFAULT_REFRESH_INTERVAL_MS;
}
