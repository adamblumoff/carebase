import { TRPCError } from '@trpc/server';
import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { google } from 'googleapis';
import { z } from 'zod';

import {
  careRecipientMemberships,
  ingestionEvents,
  senderSuppressions,
  sources,
  tasks,
} from '../../db/schema';
import { createGmailClient, gmailQuery, isInvalidGrantError } from '../../lib/google';
import { parseMessage } from '../../lib/emailParser';
import { shouldTombstoneMessage } from '../../lib/ingestionHeuristics';
import { processGmailMessageToTask } from '../../lib/ingestionPipeline';
import { classifyEmailWithVertex } from '../../lib/vertexClassifier';
import { authedProcedure, router } from '../../trpc/trpc';
import { withSourceLock } from '../../lib/sourceLock';
import { IngestionCtx } from '../../lib/ingestionTypes';
import { ingestionEventBus } from '../../lib/eventBus';
import { requireOwnerRole } from '../../lib/careRecipient';

type FetchedMessages = {
  messageIds: string[];
  nextHistoryId: string | null;
  stats?: {
    historyCount?: number;
    historyAddedCount?: number;
    fallbackListCount?: number;
  };
};

const fetchMessages = async (
  gmail: ReturnType<typeof google.gmail>,
  accountEmail: string,
  historyId?: string | null
): Promise<FetchedMessages> => {
  if (historyId) {
    const history = await gmail.users.history.list({
      userId: 'me',
      startHistoryId: historyId,
      // Include label changes because some messages only surface via label events.
      historyTypes: ['messageAdded', 'labelAdded'],
      maxResults: 50,
    });

    const added = history.data.history?.flatMap((h) => h.messagesAdded ?? []) ?? [];

    // Fallback: occasionally Gmail history returns no messageAdded for new mail; do a direct query pass.
    let fallbackListIds: string[] = [];
    if (added.length === 0) {
      const list = await gmail.users.messages.list({
        userId: 'me',
        q: gmailQuery,
        maxResults: 20,
      });
      fallbackListIds = list.data.messages?.map((m) => m.id!).filter(Boolean) ?? [];
    }

    const uniqueIds = Array.from(
      new Set(
        [...added.map((m) => m.message?.id).filter(Boolean), ...fallbackListIds].filter(
          Boolean
        ) as string[]
      )
    );

    return {
      messageIds: uniqueIds,
      nextHistoryId: history.data.historyId ?? historyId,
      stats: {
        historyCount: history.data.history?.length ?? 0,
        historyAddedCount: added.length,
        fallbackListCount: fallbackListIds.length,
      },
    };
  }

  const list = await gmail.users.messages.list({
    userId: 'me',
    q: gmailQuery,
    maxResults: 20,
  });

  return {
    messageIds: list.data.messages?.map((m) => m.id!).filter(Boolean) ?? [],
    nextHistoryId: list.data.historyId ?? null,
    stats: {
      historyCount: 0,
      historyAddedCount: 0,
      fallbackListCount: list.data.messages?.length ?? 0,
    },
  };
};

async function upsertTaskFromMessage({
  ctx,
  source,
  caregiverId,
  careRecipientId,
  message,
  ignoredExternalIds,
  suppressedSenderDomains,
  classify = classifyEmailWithVertex,
}: {
  ctx: IngestionCtx;
  source: typeof sources.$inferSelect;
  caregiverId: string;
  careRecipientId: string;
  message: google.gmail_v1.Schema$Message;
  ignoredExternalIds: Set<string>;
  suppressedSenderDomains?: Set<string>;
  classify?: typeof classifyEmailWithVertex;
}) {
  const log = ctx.req?.log ?? console;

  const now = new Date();
  const result = await processGmailMessageToTask({
    message,
    accountEmail: source.accountEmail,
    caregiverId,
    careRecipientId,
    ignoredExternalIds,
    suppressedSenderDomains,
    classify,
    parse: ({ message: msg, subject, sender, snippet }) =>
      parseMessage({ message: msg as any, subject, sender, snippet }),
    now,
  });

  if (result.action === 'skipped_ignored') {
    log.info?.({ messageId: message.id }, 'skip ignored message');
    return { action: 'skipped_ignored' as const, id: message.id };
  }

  if (result.action === 'skipped_non_inbox') {
    log.info?.({ messageId: message.id, labels: message.labelIds }, 'skip non-inbox/draft message');
    return { action: 'skipped_non_inbox' as const, id: message.id ?? 'unknown' };
  }

  if (result.action === 'skipped') {
    log.warn?.({ sizeEstimate: message.sizeEstimate, id: message.id }, 'skip large email');
    return { action: 'skipped' as const, id: message.id };
  }

  if (result.action === 'skipped_low_confidence') {
    return { action: 'skipped_low_confidence' as const, id: message.id };
  }

  if (result.action === 'tombstoned') {
    const payload = result.payload ?? {};
    await ctx.db
      .insert(tasks)
      .values({ ...payload, createdAt: now })
      .onConflictDoUpdate({
        target: [tasks.careRecipientId, tasks.provider, tasks.externalId],
        set: { ...payload, updatedAt: now },
      });

    log.info?.(
      { messageId: message.id, labels: message.labelIds },
      'tombstoned promotional message'
    );
    return { action: 'tombstoned' as const, id: message.id };
  }

  // upsert
  if ('error' in result.classification) {
    log.error?.(
      { err: result.classification.error, messageId: message.id },
      'vertex classification failed'
    );
  } else {
    log.info?.(
      {
        messageId: message.id,
        label: result.classification.label,
        confidence: result.classification.confidence,
      },
      'vertex classification success'
    );
  }

  const payload = result.payload;
  const [row] = await ctx.db
    .insert(tasks)
    .values({ ...payload, createdAt: now })
    .onConflictDoUpdate({
      target: [tasks.careRecipientId, tasks.provider, tasks.externalId],
      set: { ...payload, updatedAt: now },
    })
    .returning({ id: tasks.id, isNew: sql<boolean>`(xmax = 0)` });

  return { action: (row.isNew ? 'created' : 'updated') as const, id: row.id };
}

export async function syncSource({
  ctx,
  sourceId,
  caregiverIdOverride,
  reason = 'manual',
}: {
  ctx: IngestionCtx;
  sourceId: string;
  caregiverIdOverride?: string;
  reason?: string;
}) {
  return withSourceLock(sourceId, async () => {
    const [source] = await ctx.db.select().from(sources).where(eq(sources.id, sourceId)).limit(1);

    if (!source) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Source not found' });
    }

    const caregiverId = caregiverIdOverride ?? source.caregiverId;

    if (caregiverId !== source.caregiverId) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Source does not belong to caregiver' });
    }

    if (source.status === 'disconnected') {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Source is disconnected' });
    }

    if (!source.isPrimary) {
      ctx.req?.log?.info?.({ sourceId: source.id }, 'skip sync: non-primary source');
      return {
        created: 0,
        updated: 0,
        skipped: 0,
        errors: 0,
        historyId: source.historyId,
        messageCount: 0,
      };
    }

    const { gmail } = createGmailClient(source.refreshToken);

    const startedAt = new Date();

    const [membership] = await ctx.db
      .select({ careRecipientId: careRecipientMemberships.careRecipientId })
      .from(careRecipientMemberships)
      .where(eq(careRecipientMemberships.caregiverId, caregiverId))
      .limit(1);

    if (!membership?.careRecipientId) {
      ctx.req?.log?.warn?.(
        { sourceId: source.id, caregiverId },
        'skip sync: missing care recipient'
      );
      return {
        created: 0,
        updated: 0,
        skipped: 0,
        errors: 0,
        historyId: source.historyId,
        messageCount: 0,
      };
    }

    const careRecipientId = membership.careRecipientId;

    const markErrored = async (message: string) => {
      await ctx.db
        .update(sources)
        .set({ status: 'errored', errorMessage: message, updatedAt: new Date() })
        .where(eq(sources.id, source.id));
    };

    const { messageIds, nextHistoryId, stats } = await (async () => {
      try {
        return await fetchMessages(gmail, source.accountEmail, source.historyId);
      } catch (err) {
        if (isInvalidGrantError(err)) {
          await markErrored('Google access revoked or expired; reconnect this account');
          throw new TRPCError({
            code: 'FAILED_PRECONDITION',
            message: 'Google connection expired; reconnect to resume syncing',
          });
        }
        throw err;
      }
    })();

    const log = ctx.req?.log ?? console;
    log.info?.(
      {
        sourceId: source.id,
        accountEmail: source.accountEmail,
        messageCount: messageIds.length,
        nextHistoryId,
        reason,
        fetchStats: stats,
      },
      'gmail sync fetched messages'
    );

    // Preload tombstoned (ignored) external IDs so ignored items never resurrect across connectors.
    const ignoredExternalIds = new Set<string>();
    const ignoredRows = await ctx.db
      .select({ externalId: tasks.externalId })
      .from(tasks)
      .where(
        and(
          eq(tasks.careRecipientId, careRecipientId),
          eq(tasks.provider, 'gmail'),
          eq(tasks.reviewState, 'ignored'),
          isNotNull(tasks.externalId)
        )
      );
    ignoredRows.forEach((row) => {
      if (row.externalId) ignoredExternalIds.add(row.externalId);
    });

    const suppressedSenderDomains = new Set<string>();
    const suppressionRows = await ctx.db
      .select({ senderDomain: senderSuppressions.senderDomain })
      .from(senderSuppressions)
      .where(
        and(
          eq(senderSuppressions.caregiverId, caregiverId),
          eq(senderSuppressions.provider, 'gmail'),
          eq(senderSuppressions.suppressed, true)
        )
      );
    suppressionRows.forEach((row) => {
      if (row.senderDomain) suppressedSenderDomains.add(row.senderDomain.toLowerCase());
    });

    const results = { created: 0, updated: 0, skipped: 0, errors: 0 };

    const concurrency = 3;
    for (let i = 0; i < messageIds.length; i += concurrency) {
      const batch = messageIds.slice(i, i + concurrency);
      await Promise.all(
        batch.map(async (id) => {
          try {
            const { data: meta } = await gmail.users.messages.get({
              userId: 'me',
              id,
              format: 'metadata',
              metadataHeaders: [
                'Subject',
                'From',
                'To',
                'Reply-To',
                'List-Id',
                'List-Unsubscribe',
                'Precedence',
                'Auto-Submitted',
                'X-Auto-Response-Suppress',
              ],
            });

            if (shouldTombstoneMessage(meta.labelIds ?? [])) {
              const outcome = await upsertTaskFromMessage({
                ctx,
                source,
                caregiverId,
                careRecipientId,
                message: meta,
                ignoredExternalIds,
                suppressedSenderDomains,
              });
              if (outcome.action === 'created') results.created += 1;
              if (outcome.action === 'updated') results.updated += 1;
              if (outcome.action === 'tombstoned') results.skipped += 1;
              return;
            }

            const { data } = await gmail.users.messages.get({
              userId: 'me',
              id,
              format: 'full',
            });

            const outcome = await upsertTaskFromMessage({
              ctx,
              source,
              caregiverId,
              careRecipientId,
              message: data,
              ignoredExternalIds,
              suppressedSenderDomains,
            });
            if (outcome.action === 'created') results.created += 1;
            if (outcome.action === 'updated') results.updated += 1;
            if (
              outcome.action === 'skipped' ||
              outcome.action === 'skipped_low_confidence' ||
              outcome.action === 'skipped_ignored' ||
              outcome.action === 'skipped_non_inbox' ||
              outcome.action === 'tombstoned'
            )
              results.skipped += 1;
          } catch (error) {
            ctx.req?.log?.error({ err: error }, 'sync message failed');
            results.errors += 1;
          }
        })
      );
    }

    await ctx.db
      .update(sources)
      .set({ historyId: nextHistoryId ?? source.historyId, lastSyncAt: new Date() })
      .where(eq(sources.id, source.id));

    const changed = results.created + results.updated + results.errors;
    if (changed > 0) {
      const finishedAt = new Date();
      await ctx.db.insert(ingestionEvents).values({
        sourceId: source.id,
        caregiverId,
        provider: source.provider,
        type: 'gmail',
        ingestionId: `${reason}-${Date.now()}`,
        historyId: nextHistoryId ?? source.historyId ?? undefined,
        startedAt,
        finishedAt,
        createdCount: results.created,
        updatedCount: results.updated,
        skippedCount: results.skipped,
        errorCount: results.errors,
        durationMs: new Date().getTime() - startedAt.getTime(),
      });
      ctx.req?.log?.info?.(
        { sourceId: source.id, caregiverId, reason },
        'emitting ingestion push event'
      );
      ingestionEventBus.emit('push', {
        caregiverId,
        sourceId: source.id,
        startedAt,
        finishedAt,
      });
    }

    return {
      ...results,
      historyId: nextHistoryId ?? source.historyId,
      messageCount: messageIds.length,
    };
  });
}

export const ingestionRouter = router({
  syncNow: authedProcedure
    .input(z.object({ sourceId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const membership = await requireOwnerRole(ctx);

      const memberRows = await ctx.db
        .select({ caregiverId: careRecipientMemberships.caregiverId })
        .from(careRecipientMemberships)
        .where(eq(careRecipientMemberships.careRecipientId, membership.careRecipientId));
      const caregiverIds = memberRows.map((m) => m.caregiverId);

      const [source] = await ctx.db
        .select()
        .from(sources)
        .where(and(eq(sources.id, input.sourceId), inArray(sources.caregiverId, caregiverIds)))
        .limit(1);

      if (!source) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Source not found' });
      }

      if (!source.isPrimary) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Only the Primary inbox can sync' });
      }

      return syncSource({
        ctx,
        sourceId: input.sourceId,
        caregiverIdOverride: source.caregiverId,
        reason: 'manual',
      });
    }),
});
