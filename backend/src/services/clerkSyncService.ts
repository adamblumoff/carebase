import type { ClerkClient, Session } from '@clerk/backend';
import { createClerkClient, verifyToken } from '@clerk/backend';
import type { UserBackfillRecord } from '../db/queries/users.js';
import {
  getUserForClerkBackfill,
  listUsersForClerkBackfill,
  setClerkUserId,
  setPasswordResetRequired
} from '../db/queries.js';

let cachedClient: ClerkClient | null = null;
let warnedMissingSecret = false;

interface ClerkSyncMetadata {
  publicMetadata: Record<string, unknown>;
  privateMetadata: Record<string, unknown>;
}

export interface ClerkSyncResult {
  clerkUserId: string;
  created: boolean;
  metadataUpdated: boolean;
}

export interface ClerkSessionResult {
  clerkUserId: string;
  sessionId: string;
  sessionToken: string;
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
  const response = await clerkClient.users.getUserList({ emailAddress: [email], limit: 1 });
  if (Array.isArray(response) && response.length > 0) {
    return response[0];
  }
  return null;
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

  return {
    clerkUserId: clerkUser.id,
    created,
    metadataUpdated
  };
}

async function issueSessionToken(
  clerkClient: ClerkClient,
  session: Session,
  templateName?: string
): Promise<string> {
  if (!templateName) {
    const token = await clerkClient.sessions.getToken(session.id);
    return token.jwt;
  }
  const token = await clerkClient.sessions.getToken(session.id, templateName);
  return token.jwt;
}

export async function createClerkBridgeSession(userId: number): Promise<ClerkSessionResult | null> {
  const clerkClient = getClerkClient();
  if (!clerkClient) {
    return null;
  }

  const syncResult = await syncClerkUser(userId);
  if (!syncResult) {
    return null;
  }

  const session = await clerkClient.sessions.createSession({ userId: syncResult.clerkUserId });
  const templateName = process.env.CLERK_JWT_TEMPLATE_NAME;
  const sessionToken = await issueSessionToken(clerkClient, session, templateName);

  return {
    clerkUserId: syncResult.clerkUserId,
    sessionId: session.id,
    sessionToken,
    created: syncResult.created,
    metadataUpdated: syncResult.metadataUpdated
  };
}

export async function verifyClerkSessionToken(token: string): Promise<ClerkTokenVerification | null> {
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) {
    return null;
  }

  try {
    const payload = await verifyToken(token, {
      secretKey,
      apiUrl: process.env.CLERK_API_URL,
      apiVersion: process.env.CLERK_API_VERSION ?? '2021-02-01'
    });

    if (!payload) {
      return null;
    }

    const userId = (payload as any).sub ?? (payload as any).userId ?? (payload as any).user_id;
    if (!userId) {
      return null;
    }

    const sessionId = (payload as any).sid ?? (payload as any).session_id ?? null;
    const expiresAt =
      typeof (payload as any).exp === 'number' ? ((payload as any).exp as number) * 1000 : undefined;

    return {
      userId: String(userId),
      sessionId: sessionId ? String(sessionId) : null,
      expiresAt
    };
  } catch (error) {
    if (process.env.NODE_ENV === 'development') {
      console.warn('[ClerkSync] Clerk token verification failed:', (error as Error).message);
    }
    return null;
  }
}
