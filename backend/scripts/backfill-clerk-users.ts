#!/usr/bin/env node

/**
 * Backfill existing Carebase users into Clerk.
 *
 * Usage (dry run by default):
 *   npx tsx backend/scripts/backfill-clerk-users.ts
 *
 * Actually apply changes:
 *   npx tsx backend/scripts/backfill-clerk-users.ts --apply
 *
 * Optional filters:
 *   --user-id <id>
 *   --email <address>
 *   --limit <n>
 */

import '../src/env.js';

import type { ClerkClient } from '@clerk/backend';
import type { UserBackfillRecord } from '../src/db/queries/users.js';
import {
  listUsersForClerkBackfill,
  setClerkUserId,
  setPasswordResetRequired
} from '../src/db/queries.js';
import {
  buildClerkMetadata,
  getClerkClient,
  mergeMetadata
} from '../src/services/clerkSyncService.js';
import dbClient from '../src/db/client.js';

interface BackfillOptions {
  apply: boolean;
  limit?: number;
  userId?: number;
  email?: string;
}

interface SyncResult {
  action: 'created' | 'updated' | 'metadata' | 'skipped';
  clerkUserId?: string;
  message: string;
}

interface Summary {
  created: number;
  updated: number;
  metadata: number;
  skipped: number;
  errors: number;
}

function parseArgs(argv: string[]): BackfillOptions {
  const options: BackfillOptions = { apply: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '--apply':
        options.apply = true;
        break;
      case '--limit': {
        const next = argv[i + 1];
        if (!next) {
          throw new Error('--limit requires a numeric value');
        }
        options.limit = Number.parseInt(next, 10);
        if (Number.isNaN(options.limit)) {
          throw new Error(`Invalid limit: ${next}`);
        }
        i += 1;
        break;
      }
      case '--user-id': {
        const next = argv[i + 1];
        if (!next) {
          throw new Error('--user-id requires a numeric value');
        }
        const userId = Number.parseInt(next, 10);
        if (Number.isNaN(userId)) {
          throw new Error(`Invalid user id: ${next}`);
        }
        options.userId = userId;
        i += 1;
        break;
      }
      case '--email': {
        const next = argv[i + 1];
        if (!next) {
          throw new Error('--email requires a value');
        }
        options.email = next.toLowerCase();
        i += 1;
        break;
      }
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
        break;
      default:
        if (arg.startsWith('-')) {
          throw new Error(`Unknown option: ${arg}`);
        }
    }
  }
  return options;
}

function printHelp(): void {
  console.log(`
Backfill Clerk users
--------------------

Dry run (default):
  npx tsx backend/scripts/backfill-clerk-users.ts

Apply changes:
  npx tsx backend/scripts/backfill-clerk-users.ts --apply

Optional filters:
  --user-id <id>     Only process a specific Carebase user id
  --email <address>  Only process a matching email (case-insensitive)
  --limit <n>        Process at most <n> users (after filtering)
`);
}

function isNotFoundError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const maybeError = error as { status?: number; errors?: Array<{ code?: string }> };
  if (maybeError.status === 404) {
    return true;
  }
  return Boolean(maybeError.errors?.some((entry) => entry.code === 'resource_not_found'));
}

async function fetchClerkUser(clerkClient: ReturnType<typeof createClerkClient>, userId: string) {
  try {
    return await clerkClient.users.getUser(userId);
  } catch (error) {
    if (isNotFoundError(error)) {
      return null;
    }
    throw error;
  }
}

async function findUserByEmail(
  clerkClient: ReturnType<typeof createClerkClient>,
  email: string
) {
  try {
    const list = await clerkClient.users.getUserList({ emailAddress: [email], limit: 1 });
    if (!Array.isArray(list) || list.length === 0) {
      return null;
    }
    return list[0];
  } catch (error) {
    if (isNotFoundError(error)) {
      const fallback = await clerkClient.users.getUserList({ limit: 100 });
      if (Array.isArray(fallback)) {
        return fallback.find((entry) =>
          entry.emailAddresses?.some((addr: any) => addr.emailAddress?.toLowerCase() === email.toLowerCase())
        ) ?? null;
      }
      return null;
    }
    throw error;
  }
}

async function syncUser(
  clerkClient: ClerkClient,
  record: UserBackfillRecord,
  apply: boolean
): Promise<SyncResult> {
  const desiredExternalId = String(record.id);
  const { publicMetadata, privateMetadata } = buildClerkMetadata(record);

  let clerkUser = record.clerkUserId
    ? await fetchClerkUser(clerkClient, record.clerkUserId)
    : null;

  if (!clerkUser) {
    const byEmail = await findUserByEmail(clerkClient, record.email);
    clerkUser = byEmail;
  }

  const summary = `roles=${JSON.stringify(publicMetadata.carebase)}|legacyGoogleId=${
    record.legacyGoogleId ?? 'null'
  }`;

  if (!clerkUser) {
    if (!apply) {
      return {
        action: 'created',
        message: `DRY-RUN create ${record.email} (${summary})`
      };
    }

    const created = await clerkClient.users.createUser({
      emailAddress: [record.email],
      externalId: desiredExternalId,
      publicMetadata,
      privateMetadata,
      skipPasswordRequirement: true
    });

    await setClerkUserId(record.id, created.id);
    await setPasswordResetRequired(record.id, true);

    return {
      action: 'created',
      clerkUserId: created.id,
      message: `Created user ${record.email} (${summary})`
    };
  }

  const updates: Array<Promise<unknown>> = [];
  let action: SyncResult['action'] = 'skipped';
  let note = 'no changes';

  const metadataTarget = {
    publicMetadata: mergeMetadata(clerkUser.publicMetadata as Record<string, unknown> | undefined, publicMetadata),
    privateMetadata: mergeMetadata(clerkUser.privateMetadata as Record<string, unknown> | undefined, privateMetadata)
  };

  const metadataChanged =
    JSON.stringify(metadataTarget.publicMetadata) !== JSON.stringify(clerkUser.publicMetadata) ||
    JSON.stringify(metadataTarget.privateMetadata) !== JSON.stringify(clerkUser.privateMetadata);

  const externalIdChanged = clerkUser.externalId !== desiredExternalId;

  if (metadataChanged || externalIdChanged) {
    if (!apply) {
      action = metadataChanged ? 'metadata' : 'updated';
      note = `DRY-RUN ${metadataChanged ? 'metadata update' : 'externalId sync'} (${summary})`;
    } else {
      if (metadataChanged) {
        updates.push(
          clerkClient.users.updateUserMetadata(clerkUser.id, {
            publicMetadata: metadataTarget.publicMetadata,
            privateMetadata: metadataTarget.privateMetadata
          })
        );
        action = 'metadata';
        note = `Updated metadata (${summary})`;
      }
      if (externalIdChanged) {
        updates.push(
          clerkClient.users.updateUser(clerkUser.id, {
            externalId: desiredExternalId
          })
        );
        action = action === 'metadata' ? 'updated' : 'updated';
        note = metadataChanged
          ? `Updated metadata & externalId (${summary})`
          : `Updated externalId (${summary})`;
      }
    }
  }

  if (apply) {
    await Promise.all(updates);
    await setPasswordResetRequired(record.id, true);
    if (!record.clerkUserId || record.clerkUserId !== clerkUser.id) {
      await setClerkUserId(record.id, clerkUser.id);
    }
  } else if (!record.clerkUserId) {
    // Dry-run: indicate we'd link the ID.
    note += ' | would set clerk_user_id';
  }

  return {
    action,
    clerkUserId: clerkUser.id,
    message: action === 'skipped' ? `No change (${summary})` : note
  };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) {
    throw new Error('CLERK_SECRET_KEY must be configured');
  }

  const clerkClient = getClerkClient();
  if (!clerkClient) {
    throw new Error('Failed to initialize Clerk client. Ensure CLERK_SECRET_KEY is set.');
  }

  let users = await listUsersForClerkBackfill();

  if (options.userId != null) {
    users = users.filter((user) => user.id === options.userId);
  }
  if (options.email) {
    users = users.filter((user) => user.email.toLowerCase() === options.email);
  }
  if (options.limit != null) {
    users = users.slice(0, options.limit);
  }

  if (users.length === 0) {
    console.log('No users matched the provided filters. Nothing to do.');
    return;
  }

  console.log(
    `${options.apply ? 'Applying' : 'Dry run for'} ${users.length} user(s). ${
      options.apply ? '' : 'Use --apply to persist changes.'
    }`
  );

  const summary: Summary = {
    created: 0,
    updated: 0,
    metadata: 0,
    skipped: 0,
    errors: 0
  };

  for (const user of users) {
    try {
      const result = await syncUser(clerkClient, user, options.apply);
      console.log(`• [${user.id}] ${user.email} -> ${result.message}`);
      summary[result.action] += 1;
    } catch (error) {
      summary.errors += 1;
      console.error(`• [${user.id}] ${user.email} -> ERROR`, error);
    }
  }

  console.log('\nSummary:', summary);
}

main()
  .then(() => dbClient.end())
  .catch(async (error) => {
    console.error('Backfill failed:', error);
    await dbClient.end();
    process.exit(1);
  });
