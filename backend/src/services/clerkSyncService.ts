import type { ClerkClient } from '@clerk/backend';
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
  getClerkClient,
  logClerk
} from './clerkAuthGateway.js';

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
