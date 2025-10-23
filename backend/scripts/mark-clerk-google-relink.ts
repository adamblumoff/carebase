#!/usr/bin/env node

import '../src/env.js';

import { createClerkClient } from '@clerk/backend';
import type { User } from '@clerk/backend/dist/api/resources/User';

import dbClient from '../src/db/client.js';
import {
  listGoogleCredentialUsers,
  setGoogleCredentialReauth
} from '../src/db/queries.js';
import { getClerkClient, mergeMetadata } from '../src/services/clerkSyncService.js';

interface Options {
  apply: boolean;
  limit?: number;
  userId?: number;
  email?: string;
}

interface Summary {
  flagged: number;
  cleared: number;
  skipped: number;
  errors: number;
}

function parseArgs(argv: string[]): Options {
  const options: Options = { apply: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '--apply':
        options.apply = true;
        break;
      case '--limit': {
        const value = argv[++i];
        if (!value) throw new Error('--limit requires a number');
        options.limit = Number.parseInt(value, 10);
        if (Number.isNaN(options.limit)) throw new Error(`Invalid limit: ${value}`);
        break;
      }
      case '--user-id': {
        const value = argv[++i];
        if (!value) throw new Error('--user-id requires a number');
        options.userId = Number.parseInt(value, 10);
        if (Number.isNaN(options.userId)) throw new Error(`Invalid user id: ${value}`);
        break;
      }
      case '--email': {
        const value = argv[++i];
        if (!value) throw new Error('--email requires a value');
        options.email = value.toLowerCase();
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
Mark Clerk Google re-link requirements
-------------------------------------

Dry run (default):
  npx tsx backend/scripts/mark-clerk-google-relink.ts

Apply updates:
  npx tsx backend/scripts/mark-clerk-google-relink.ts --apply

Filters:
  --user-id <id>     Only process a single CareBase user
  --email <address>  Only process a matching email
  --limit <n>        Process at most <n> credential rows
`);
}

function hasGoogleExternalAccount(clerkUser: User | null): boolean {
  if (!clerkUser?.externalAccounts) {
    return false;
  }
  return clerkUser.externalAccounts.some((account) =>
    typeof account.provider === 'string' && account.provider.toLowerCase().includes('google')
  );
}

async function loadClerkUser(
  clerkClient: ReturnType<typeof createClerkClient>,
  email: string,
  clerkUserId: string | null
): Promise<User | null> {
  try {
    if (clerkUserId) {
      return await clerkClient.users.getUser(clerkUserId);
    }
  } catch (error) {
    if ((error as any)?.status !== 404) {
      throw error;
    }
  }

  const list = await clerkClient.users.getUserList({ emailAddress: [email], limit: 1 });
  return Array.isArray(list) && list.length > 0 ? list[0] : null;
}

async function updateClerkMetadata(
  clerkClient: ReturnType<typeof createClerkClient>,
  clerkUser: User,
  needsReauth: boolean
): Promise<void> {
  const publicMetadata = mergeMetadata(clerkUser.publicMetadata as Record<string, unknown> | undefined, {
    carebase: {
      googleReauthRequired: needsReauth
    }
  });

  const privateMetadata = mergeMetadata(clerkUser.privateMetadata as Record<string, unknown> | undefined, {
    carebase: {
      googleReauthRequired: needsReauth
    }
  });

  await clerkClient.users.updateUserMetadata(clerkUser.id, {
    publicMetadata,
    privateMetadata
  });
}

async function process(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const clerkClient = getClerkClient();
  if (!clerkClient) {
    throw new Error('CLERK_SECRET_KEY not configured; unable to inspect Clerk users');
  }

  let rows = await listGoogleCredentialUsers();
  if (options.userId != null) {
    rows = rows.filter((row) => row.userId === options.userId);
  }
  if (options.email) {
    rows = rows.filter((row) => row.email.toLowerCase() === options.email);
  }
  if (options.limit != null) {
    rows = rows.slice(0, options.limit);
  }

  if (rows.length === 0) {
    console.log('No google_credentials rows matched filters.');
    return;
  }

  const summary: Summary = { flagged: 0, cleared: 0, skipped: 0, errors: 0 };

  console.log(
    `${options.apply ? 'Applying' : 'Dry run for'} ${rows.length} user(s). Use --apply to persist changes.`
  );

  for (const row of rows) {
    try {
      const clerkUser = await loadClerkUser(clerkClient, row.email, row.clerkUserId);
      const hasClerkGoogle = hasGoogleExternalAccount(clerkUser);
      const shouldRequire = !hasClerkGoogle;

      if (shouldRequire === row.needsReauth) {
        summary.skipped += 1;
        console.log(
          `• [${row.userId}] ${row.email} -> no change (needsReauth=${row.needsReauth}, clerkGoogle=${hasClerkGoogle})`
        );
        continue;
      }

      if (options.apply) {
        await setGoogleCredentialReauth(row.userId, shouldRequire);
        if (clerkUser) {
          await updateClerkMetadata(clerkClient, clerkUser, shouldRequire);
        }
      }

      if (shouldRequire) {
        summary.flagged += 1;
      } else {
        summary.cleared += 1;
      }

      console.log(
        `• [${row.userId}] ${row.email} -> ${shouldRequire ? 'FLAGGED' : 'CLEARED'} (clerkGoogle=${hasClerkGoogle})`
      );
    } catch (error) {
      summary.errors += 1;
      console.error(`• [${row.userId}] ${row.email} -> ERROR`, error);
    }
  }

  console.log('Summary:', summary);
}

process()
  .then(() => dbClient.end())
  .catch(async (error) => {
    console.error('Fatal error while marking Clerk Google re-link flags:', error);
    await dbClient.end();
    process.exit(1);
  });
