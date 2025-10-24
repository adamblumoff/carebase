import type { ClerkClient } from '@clerk/backend';
import { createClerkClient } from '@clerk/backend';
import jwt from 'jsonwebtoken';
import { jwtVerify } from 'jose';
import { incrementMetric } from '../utils/metrics.js';
import {
  deleteClerkTokenCacheEntry,
  getClerkTokenCacheEntry,
  setClerkTokenCacheEntry
} from './clerkTokenCache.js';
import { getClerkJwksVerifier } from './clerkJwksManager.js';

let cachedClient: ClerkClient | null = null;
let warnedMissingSecret = false;

export interface ClerkTokenVerification {
  userId: string;
  sessionId: string | null;
  expiresAt?: number;
}

export function logClerk(message: string, meta?: Record<string, unknown>): void {
  if (meta) {
    console.log(`[ClerkSync] ${message}`, meta);
  } else {
    console.log(`[ClerkSync] ${message}`);
  }
}

export function getClerkClient(): ClerkClient | null {
  if (cachedClient) {
    return cachedClient;
  }
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) {
    if (!warnedMissingSecret && process.env.NODE_ENV !== 'test') {
      console.warn('[ClerkSync] CLERK_SECRET_KEY is not configured; skipping Clerk integration.');
      warnedMissingSecret = true;
    }
    return null;
  }

  cachedClient = createClerkClient({
    secretKey,
    apiUrl: process.env.CLERK_API_URL,
    apiVersion: process.env.CLERK_API_VERSION ?? '2021-02-01'
  });

  return cachedClient;
}

export async function verifyClerkSessionToken(token: string): Promise<ClerkTokenVerification | null> {
  const clerkClient = getClerkClient();
  if (!clerkClient) {
    return null;
  }

  const cached = getClerkTokenCacheEntry(token);
  if (cached) {
    incrementMetric('clerk.token.cache', 1, { outcome: 'hit' });
    return {
      userId: cached.userId,
      sessionId: cached.sessionId,
      expiresAt: cached.expiresAt ?? undefined
    };
  } else {
    incrementMetric('clerk.token.cache', 1, { outcome: 'miss' });
  }

  let decoded: { sid?: string; exp?: number; sub?: string; iss?: string } | null = null;
  try {
    decoded = jwt.decode(token, { json: true }) as { sid?: string; exp?: number; sub?: string; iss?: string } | null;
    console.log('[ClerkSync] Decoded token payload', decoded);
  } catch (error) {
    console.warn('[ClerkSync] Failed to decode Clerk session token:', (error as Error).message);
    incrementMetric('clerk.token.verify', 1, { outcome: 'decode_error' });
    return null;
  }

  if (!decoded?.sid || !decoded?.iss) {
    incrementMetric('clerk.token.verify', 1, { outcome: 'missing_sid' });
    return null;
  }

  const sessionId = decoded.sid;

  try {
    const verifier = await getClerkJwksVerifier(decoded.iss);
    const { payload } = await jwtVerify(token, verifier, {
      issuer: decoded.iss
    });

    const payloadSessionId = (payload as any).sid ?? null;
    const expiresAt = typeof (payload as any).exp === 'number' ? ((payload as any).exp as number) * 1000 : undefined;

    logClerk('Verified Clerk token via JWKS', {
      clerkUserId: payload.sub,
      sessionId: payloadSessionId,
      expiresAt: expiresAt ?? null
    });

    incrementMetric('clerk.token.verify', 1, {
      hasSession: payloadSessionId ? 'yes' : 'no',
      via: 'jwks'
    });

    if (payload.sub) {
      setClerkTokenCacheEntry(token, {
        userId: String(payload.sub),
        sessionId: payloadSessionId ? String(payloadSessionId) : null,
        expiresAt
      });
    }

    return {
      userId: String(payload.sub),
      sessionId: payloadSessionId ? String(payloadSessionId) : null,
      expiresAt
    };
  } catch (error) {
    console.warn('[ClerkSync] Clerk token verification via JWKS failed:', (error as Error).message);
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[ClerkSync] JWKS verification error details:', error);
    }
    deleteClerkTokenCacheEntry(token);
    incrementMetric('clerk.token.verify', 1, { outcome: 'jwks_error' });
  }

  try {
    const controller = new AbortController();
    const timeoutMs = Number.parseInt(process.env.CLERK_SESSION_VERIFY_TIMEOUT_MS ?? '2000', 10);
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const session = await clerkClient.sessions.verifySession(sessionId, token, {
        signal: controller.signal
      } as any);

      const expiresAt = session.expireAt ? new Date(session.expireAt).getTime() : decoded.exp ? decoded.exp * 1000 : undefined;

      logClerk('Verified Clerk session via API', {
        clerkUserId: session.userId,
        sessionId: session.id,
        expiresAt: expiresAt ?? null
      });

      incrementMetric('clerk.token.verify', 1, {
        hasSession: 'yes',
        via: 'api'
      });

      setClerkTokenCacheEntry(token, {
        userId: session.userId,
        sessionId: session.id,
        expiresAt
      });

      return {
        userId: session.userId,
        sessionId: session.id,
        expiresAt
      };
    } finally {
      clearTimeout(timer);
    }
  } catch (error) {
    if ((error as Error).name === 'AbortError') {
      console.warn('[ClerkSync] Clerk session verify via API timed out after', process.env.CLERK_SESSION_VERIFY_TIMEOUT_MS ?? '2000', 'ms');
      incrementMetric('clerk.token.verify', 1, { outcome: 'timeout' });
    } else {
      const status = (error as { status?: number }).status;
      console.warn('[ClerkSync] Clerk session verify via API failed:', (error as Error).message);
      if (status !== 404 && status !== 403) {
        incrementMetric('clerk.token.verify', 1, { outcome: 'error' });
        return null;
      }
    }
    deleteClerkTokenCacheEntry(token);
  }

  if (decoded?.sub) {
    incrementMetric('clerk.token.verify', 1, { outcome: 'error' });
    console.warn('[ClerkSync] Falling back to decoded token payload (verification skipped)');
    setClerkTokenCacheEntry(token, {
      userId: String(decoded.sub),
      sessionId: decoded.sid ? String(decoded.sid) : null,
      expiresAt: decoded.exp ? decoded.exp * 1000 : undefined
    });
    return {
      userId: String(decoded.sub),
      sessionId: decoded.sid ? String(decoded.sid) : null,
      expiresAt: decoded.exp ? decoded.exp * 1000 : undefined
    };
  }

  return null;
}
