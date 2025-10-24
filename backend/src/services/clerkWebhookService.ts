import { clearGoogleSyncForUser, deleteGoogleCredential, findUserByClerkUserId } from '../db/queries.js';
import { stopCalendarWatchForUser } from './googleSync.js';

interface ClerkWebhookBaseEvent {
  type: string;
  data: Record<string, any>;
}

type CleanupHooks = {
  clearGoogleSyncForUser: typeof clearGoogleSyncForUser;
  deleteGoogleCredential: typeof deleteGoogleCredential;
  stopCalendarWatchForUser: typeof stopCalendarWatchForUser;
};

let cleanupHooks: CleanupHooks = {
  clearGoogleSyncForUser,
  deleteGoogleCredential,
  stopCalendarWatchForUser
};

export function __setClerkWebhookTestHooks(overrides: Partial<CleanupHooks> | null): void {
  if (!overrides) {
    cleanupHooks = {
      clearGoogleSyncForUser,
      deleteGoogleCredential,
      stopCalendarWatchForUser
    };
    return;
  }
  cleanupHooks = {
    clearGoogleSyncForUser: overrides.clearGoogleSyncForUser ?? clearGoogleSyncForUser,
    deleteGoogleCredential: overrides.deleteGoogleCredential ?? deleteGoogleCredential,
    stopCalendarWatchForUser: overrides.stopCalendarWatchForUser ?? stopCalendarWatchForUser
  };
}

async function handleUserDeleted(clerkUserId: string): Promise<void> {
  const user = await findUserByClerkUserId(clerkUserId);
  if (!user) {
    console.warn('[ClerkWebhook] Received user.deleted for unknown clerk user id', { clerkUserId });
    return;
  }

  try {
    await cleanupHooks.stopCalendarWatchForUser(user.id);
  } catch (error) {
    console.warn('[ClerkWebhook] Failed to stop Google watch channels during Clerk deletion', {
      clerkUserId,
      userId: user.id,
      error: error instanceof Error ? error.message : error
    });
  }

  try {
    await cleanupHooks.deleteGoogleCredential(user.id);
  } catch (error) {
    console.warn('[ClerkWebhook] Failed to delete Google credentials during Clerk deletion', {
      clerkUserId,
      userId: user.id,
      error: error instanceof Error ? error.message : error
    });
  }

  try {
    await cleanupHooks.clearGoogleSyncForUser(user.id);
  } catch (error) {
    console.warn('[ClerkWebhook] Failed to clear Google sync metadata during Clerk deletion', {
      clerkUserId,
      userId: user.id,
      error: error instanceof Error ? error.message : error
    });
  }
}

export async function handleClerkWebhookEvent(event: ClerkWebhookBaseEvent): Promise<void> {
  switch (event.type) {
    case 'user.deleted':
      if (typeof event.data?.id === 'string' && event.data.id.length > 0) {
        await handleUserDeleted(event.data.id);
      } else {
        console.warn('[ClerkWebhook] user.deleted missing data.id');
      }
      break;
    default:
      // Ignore other webhook events for now but log for observability.
      if (process.env.NODE_ENV !== 'test') {
        console.log('[ClerkWebhook] Unhandled event', { type: event.type });
      }
  }
}

