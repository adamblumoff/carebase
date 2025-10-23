import type { ClerkClient } from '@clerk/backend';
import { createClerkClient } from '@clerk/backend';
import jwt from 'jsonwebtoken';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { UserBackfillRecord } from '../db/queries/users.js';
import {
  getUserForClerkBackfill,
  listUsersForClerkBackfill,
  setClerkUserId,
  setPasswordResetRequired
} from '../db/queries.js';
import { incrementMetric } from '../utils/metrics.js';

let cachedClient: ClerkClient | null = null;
let warnedMissingSecret = false;
let cachedJwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function logClerk(message: string, meta?: Record<string, unknown>): void {
  if (meta) {
    console.log(`[ClerkSync] ${message}`, meta);
  } else {
    console.log(`[ClerkSync] ${message}`);
  }
}

interface ClerkSyncMetadata {
  publicMetadata: Record<string, unknown>;
  privateMetadata: Record<string, unknown>;
}

export interface ClerkSyncResult {
  clerkUserId: string;
  created: boolean;
  metadataUpdated: boolean;
}

export interface ClerkTokenVerification {
  userId: string;
  sessionId: string | null;
  expiresAt?: number;
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

export function buildClerkMetadata(record: UserBackfillRecord): ClerkSyncMetadata {
  const roles = {
    owner: record.roles.owner,
    contributor: record.roles.contributor
  };

  const publicMetadata = {
    carebase: {
      roles,
      googleConnected: record.hasGoogleCredential
    }
  };

  const privateMetadata = {
    carebase: {
      localUserId: record.id,
      legacyGoogleId: record.legacyGoogleId,
      googleConnected: record.hasGoogleCredential,
      passwordResetRequired: true
    }
  };

  return { publicMetadata, privateMetadata };
}

export function mergeMetadata(
  existing: Record<string, unknown> | undefined,
  next: Record<string, unknown>
): Record<string, unknown> {
  const target: Record<string, unknown> = { ...(existing ?? {}) };

  for (const [key, value] of Object.entries(next)) {
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      !(value instanceof Date)
    ) {
      const existingValue = target[key];
      target[key] = mergeMetadata(
        typeof existingValue === 'object' && existingValue !== null
          ? (existingValue as Record<string, unknown>)
          : {},
        value as Record<string, unknown>
      );
    } else {
      target[key] = value;
    }
  }

  return target;
}

async function resolveBackfillRecord(userId: number): Promise<UserBackfillRecord | undefined> {
  const record = await getUserForClerkBackfill(userId);
  if (record) {
    return record;
  }

  // Fallback for unexpected cases (e.g., new user inserted without projection columns populated)
  const match = (await listUsersForClerkBackfill()).find((entry) => entry.id === userId);
  return match;
}

function metadataChanged(
  existing: Record<string, unknown> | undefined,
  next: Record<string, unknown>
): boolean {
  return JSON.stringify(existing ?? {}) !== JSON.stringify(next);
}

async function findUserByEmail(clerkClient: ClerkClient, email: string) {
  try {
    const response = await clerkClient.users.getUserList({ emailAddress: [email], limit: 1 });
    if (Array.isArray(response) && response.length > 0) {
      return response[0];
    }
    return null;
  } catch (error) {
    if (isNotFoundError(error)) {
      const fallback = await clerkClient.users.getUserList({ limit: 100 });
      if (Array.isArray(fallback)) {
        return fallback.find((entry) => entry.emailAddresses?.some((addr: any) => addr.emailAddress?.toLowerCase() === email.toLowerCase())) ?? null;
      }
      return null;
    }
    throw error;
  }
}

function isNotFoundError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const maybe = error as { status?: number; errors?: Array<{ code?: string }> };
  if (maybe.status === 404) {
    return true;
  }
  return Boolean(maybe.errors?.some((entry) => entry.code === 'resource_not_found'));
}

async function fetchClerkUser(clerkClient: ClerkClient, userId: string) {
  try {
    return await clerkClient.users.getUser(userId);
  } catch (error) {
    if (isNotFoundError(error)) {
      return null;
    }
    throw error;
  }
}

export async function syncClerkUser(userId: number): Promise<ClerkSyncResult | null> {
  const clerkClient = getClerkClient();
  if (!clerkClient) {
    return null;
  }

  const record = await resolveBackfillRecord(userId);
  if (!record) {
    return null;
  }

  const { publicMetadata, privateMetadata } = buildClerkMetadata(record);
  const desiredExternalId = String(record.id);

  let clerkUser =
    record.clerkUserId && record.clerkUserId.length > 0
      ? await fetchClerkUser(clerkClient, record.clerkUserId)
      : null;

  if (!clerkUser) {
    const byEmail = await findUserByEmail(clerkClient, record.email);
    if (byEmail) {
      clerkUser = byEmail;
    }
  }

  let created = false;
  let metadataUpdated = false;

  if (!clerkUser) {
    const createdUser = await clerkClient.users.createUser({
      emailAddress: [record.email],
      externalId: desiredExternalId,
      publicMetadata,
      privateMetadata,
      skipPasswordRequirement: true
    });
    clerkUser = createdUser;
    created = true;
    metadataUpdated = true;
  } else {
    const targetPublic = mergeMetadata(clerkUser.publicMetadata as Record<string, unknown> | undefined, publicMetadata);
    const targetPrivate = mergeMetadata(
      clerkUser.privateMetadata as Record<string, unknown> | undefined,
      privateMetadata
    );

    const needsMetadataUpdate =
      metadataChanged(clerkUser.publicMetadata as Record<string, unknown> | undefined, targetPublic) ||
      metadataChanged(clerkUser.privateMetadata as Record<string, unknown> | undefined, targetPrivate);

    const needsExternalIdUpdate = clerkUser.externalId !== desiredExternalId;

    if (needsMetadataUpdate) {
      await clerkClient.users.updateUserMetadata(clerkUser.id, {
        publicMetadata: targetPublic,
        privateMetadata: targetPrivate
      });
      metadataUpdated = true;
    }

    if (needsExternalIdUpdate) {
      await clerkClient.users.updateUser(clerkUser.id, {
        externalId: desiredExternalId
      });
    }
  }

  if (!record.clerkUserId || record.clerkUserId !== clerkUser.id) {
    await setClerkUserId(record.id, clerkUser.id);
  }
  await setPasswordResetRequired(record.id, true);

  logClerk(created ? 'Created/linked Clerk user' : 'Synced Clerk user', {
    userId,
    clerkUserId: clerkUser.id,
    metadataUpdated
  });
  incrementMetric('clerk.sync.user', 1, {
    outcome: created ? 'created' : metadataUpdated ? 'updated' : 'no_change'
  });

  return {
    clerkUserId: clerkUser.id,
    created,
    metadataUpdated
  };
}

export async function verifyClerkSessionToken(token: string): Promise<ClerkTokenVerification | null> {
  const clerkClient = getClerkClient();
  if (!clerkClient) {
    return null;
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
    if (!cachedJwks) {
      const issuerUrl = new URL(decoded.iss);
      cachedJwks = createRemoteJWKSet(new URL('/.well-known/jwks.json', issuerUrl));
    }
    const { payload } = await jwtVerify(token, cachedJwks, {
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
    incrementMetric('clerk.token.verify', 1, { outcome: 'jwks_error' });
  }

  try {
    const session = await clerkClient.sessions.verifySession(sessionId, token);
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

    return {
      userId: session.userId,
      sessionId: session.id,
      expiresAt
    };
  } catch (error) {
    const status = (error as { status?: number }).status;
    console.warn('[ClerkSync] Clerk session verify via API failed:', (error as Error).message);
    if (status !== 404 && status !== 403) {
      incrementMetric('clerk.token.verify', 1, { outcome: 'error' });
      return null;
    }
  }

  if (decoded?.sub) {
    incrementMetric('clerk.token.verify', 1, { outcome: 'error' });
    console.warn('[ClerkSync] Falling back to decoded token payload (verification skipped)');
    return {
      userId: String(decoded.sub),
      sessionId: decoded.sid ? String(decoded.sid) : null,
      expiresAt: decoded.exp ? decoded.exp * 1000 : undefined
    };
  }

  return null;
}
