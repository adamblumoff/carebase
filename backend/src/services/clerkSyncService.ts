import type { ClerkClient } from '@clerk/backend';
import { createClerkClient } from '@clerk/backend';
import jwt from 'jsonwebtoken';
import { jwtVerify } from 'jose';
import type { UserBackfillRecord, User } from '../db/queries/users.js';
import {
  createUserWithEmail,
  findUserByClerkUserId,
  findUserByEmail,
  findUserById,
  getUserForClerkBackfill,
  listUsersForClerkBackfill,
  setClerkUserId,
  setPasswordResetRequired
} from '../db/queries.js';
import { incrementMetric } from '../utils/metrics.js';
import {
  fetchClerkUserByEmail as restFetchClerkUserByEmail,
  fetchClerkUserById as restFetchClerkUserById,
  listClerkUsers as restListClerkUsers
} from './clerkRestClient.js';
import {
  getClerkTokenCacheEntry,
  setClerkTokenCacheEntry,
  deleteClerkTokenCacheEntry
} from './clerkTokenCache.js';

let cachedClient: ClerkClient | null = null;
let warnedMissingSecret = false;
import { getClerkJwksVerifier } from './clerkJwksManager.js';

function logClerk(message: string, meta?: Record<string, unknown>): void {
  if (meta) {
    console.log(`[ClerkSync] ${message}`, meta);
  } else {
    console.log(`[ClerkSync] ${message}`);
  }
}

export interface ClerkEmailAddress {
  id: string;
  emailAddress?: string;
  email_address?: string;
}

export interface ClerkUser {
  id: string;
  emailAddresses?: ClerkEmailAddress[];
  email_addresses?: ClerkEmailAddress[];
  primaryEmailAddressId?: string | null;
  primary_email_address_id?: string | null;
  publicMetadata?: Record<string, unknown>;
  public_metadata?: Record<string, unknown>;
  privateMetadata?: Record<string, unknown>;
  private_metadata?: Record<string, unknown>;
  externalId?: string | null;
  external_id?: string | null;
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

function getClerkEmailAddresses(user: ClerkUser): ClerkEmailAddress[] {
  const modern = Array.isArray(user.email_addresses) ? user.email_addresses : [];
  if (modern.length > 0) {
    return modern;
  }
  const legacy = Array.isArray(user.emailAddresses) ? user.emailAddresses : [];
  return legacy;
}

function getPrimaryEmail(user: ClerkUser): string | null {
  const addresses = getClerkEmailAddresses(user);
  if (addresses.length === 0) {
    return null;
  }
  const primaryId = user.primary_email_address_id ?? user.primaryEmailAddressId;
  if (primaryId) {
    const match = addresses.find((entry) => (entry.id ?? entry.id) === primaryId);
    const email = match?.email_address ?? match?.emailAddress;
    if (email) {
      return email.toLowerCase();
    }
  }
  const fallback = addresses[0];
  const email = fallback?.email_address ?? fallback?.emailAddress;
  return email ? email.toLowerCase() : null;
}

function getPublicMetadata(user: ClerkUser): Record<string, unknown> {
  return (user.public_metadata ?? user.publicMetadata ?? {}) as Record<string, unknown>;
}

function getPrivateMetadata(user: ClerkUser): Record<string, unknown> {
  return (user.private_metadata ?? user.privateMetadata ?? {}) as Record<string, unknown>;
}

function getExternalId(user: ClerkUser): string | null {
  return (user.external_id ?? user.externalId ?? null) as string | null;
}

async function resolveClerkUserById(clerkUserId: string): Promise<ClerkUser | null> {
  try {
    return await restFetchClerkUserById(clerkUserId);
  } catch (error) {
    if (isNotFoundError(error)) {
      return null;
    }
    throw error;
  }
}

async function resolveClerkUserByEmail(email: string): Promise<ClerkUser | null> {
  try {
    const direct = await restFetchClerkUserByEmail(email);
    if (direct) {
      return direct;
    }
  } catch (error) {
    if (!isNotFoundError(error)) {
      throw error;
    }
  }

  const list = await restListClerkUsers();
  return list.find((entry) => getPrimaryEmail(entry) === email.toLowerCase()) ?? null;
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

async function fetchClerkUser(_clerkClient: ClerkClient, userId: string): Promise<ClerkUser | null> {
  return await resolveClerkUserById(userId);
}

export async function ensureLocalUserForClerk(clerkUserId: string): Promise<User | null> {
  const clerkUser = await resolveClerkUserById(clerkUserId);
  if (!clerkUser) {
    console.warn('[ClerkSync] Unable to resolve Clerk user for provisioning', { clerkUserId });
    return null;
  }

  const email = getPrimaryEmail(clerkUser);
  if (!email) {
    console.warn('[ClerkSync] Clerk user missing primary email', { clerkUserId });
    return null;
  }

  let user = await findUserByClerkUserId(clerkUserId);
  if (!user) {
    user = await findUserByEmail(email);
  }

  if (!user) {
    user = await createUserWithEmail(email);
    logClerk('Provisioned local user from Clerk sign-in', { clerkUserId, userId: user.id, email });
  }

  if (!user.clerkUserId || user.clerkUserId !== clerkUserId) {
    await setClerkUserId(user.id, clerkUserId);
  }
  await setPasswordResetRequired(user.id, true);

  const refreshed = await findUserByClerkUserId(clerkUserId);
  if (refreshed) {
    return refreshed;
  }
  const fallback = await findUserById(user.id);
  return fallback ?? user;
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
    clerkUser = await resolveClerkUserByEmail(record.email);
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
    const existingPublic = getPublicMetadata(clerkUser);
    const existingPrivate = getPrivateMetadata(clerkUser);
    const targetPublic = mergeMetadata(existingPublic, publicMetadata);
    const targetPrivate = mergeMetadata(existingPrivate, privateMetadata);

    const needsMetadataUpdate =
      metadataChanged(existingPublic, targetPublic) || metadataChanged(existingPrivate, targetPrivate);

    const needsExternalIdUpdate = getExternalId(clerkUser) !== desiredExternalId;

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
