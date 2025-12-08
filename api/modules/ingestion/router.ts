import { TRPCError } from '@trpc/server';
import { eq, sql } from 'drizzle-orm';
import { google } from 'googleapis';
import { z } from 'zod';

import { ingestionEvents, sources, tasks } from '../../db/schema';
import { ensureCaregiver } from '../../lib/caregiver';
import { createGmailClient, gmailQuery, isInvalidGrantError } from '../../lib/google';
import { parseMessage } from '../../lib/emailParser';
import { classifyEmailWithVertex } from '../../lib/vertexClassifier';
import { authedProcedure, router } from '../../trpc/trpc';

const gmailMessageLink = (accountEmail: string, messageId: string) =>
  `https://mail.google.com/mail/u/${encodeURIComponent(accountEmail)}/#all/${messageId}`;

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
  message,
}: {
  ctx: any;
  source: typeof sources.$inferSelect;
  caregiverId: string;
  message: google.gmail_v1.Schema$Message;
}) {
  const log = ctx.req?.log ?? console;

  if (message.sizeEstimate && message.sizeEstimate > 200_000) {
    log.warn?.({ sizeEstimate: message.sizeEstimate, id: message.id }, 'skip large email');
    return { action: 'skipped' as const, id: message.id };
  }
  const subject =
    message.payload?.headers?.find((h) => h.name?.toLowerCase() === 'subject')?.value ?? 'Task';
  const fromHeader = message.payload?.headers?.find((h) => h.name?.toLowerCase() === 'from')?.value;
  const snippet = message.snippet ?? '';

  const parsed = parseMessage({ message, subject, sender: fromHeader, snippet });

  const classification = await classifyEmailWithVertex({
    subject,
    snippet,
    body: parsed.description ?? snippet,
  });

  if ('error' in classification) {
    log.error?.({ err: classification.error, messageId: message.id }, 'vertex classification failed');
    log.info?.(
      { messageId: message.id, projectId: classification.projectId ?? 'unknown' },
      'vertex classification fallback'
    );
  } else {
    log.info?.(
      {
        messageId: message.id,
        projectId: classification.projectId ?? 'unknown',
        label: classification.label,
        confidence: classification.confidence,
      },
      'vertex classification success'
    );
  }

  const classificationFailed = 'error' in classification;
  const bucket = classificationFailed ? null : classification.label;
  const modelConfidence = classificationFailed ? null : classification.confidence;

  const confidence = modelConfidence ?? parsed.confidence;

  // Drop very low-confidence items (<60%) entirely.
  if (!classificationFailed && confidence < 0.6 && bucket !== 'needs_review' && bucket !== 'ignore') {
    return { action: 'skipped_low_confidence' as const, id: message.id };
  }

  let reviewState: 'pending' | 'approved' | 'ignored' = 'approved';
  if (bucket === 'ignore') {
    reviewState = 'ignored';
  } else if (bucket === 'needs_review' || classificationFailed || confidence < 0.8) {
    reviewState = 'pending';
  }

  const taskType =
    bucket === 'appointments'
      ? 'appointment'
      : bucket === 'bills'
        ? 'bill'
        : bucket === 'medications'
          ? 'medication'
          : parsed.type;

  const description =
    classificationFailed && (parsed.description || snippet)
      ? `[model failed] ${parsed.description ?? snippet}`
      : parsed.description;

  const payload = {
    title: parsed.title,
    type: taskType,
    status: taskType === 'appointment' ? 'scheduled' : 'todo',
    reviewState,
    provider: 'gmail' as const,
    sourceId: message.id ?? undefined,
    sourceLink: message.id ? gmailMessageLink(source.accountEmail, message.id) : undefined,
    sender: fromHeader ?? undefined,
    rawSnippet: snippet,
    description,
    confidence: Number(confidence.toFixed(2)),
    syncedAt: new Date(),
    ingestionId: undefined,
    amount: parsed.amount,
    currency: parsed.amount ? (parsed.currency ?? 'USD') : undefined,
    vendor: parsed.vendor,
    referenceNumber: parsed.referenceNumber,
    statementPeriod: parsed.statementPeriod,
    medicationName: parsed.medicationName,
    dosage: parsed.dosage,
    frequency: parsed.frequency,
    route: parsed.route,
    nextDoseAt: parsed.nextDoseAt,
    prescribingProvider: parsed.prescribingProvider,
    startAt: parsed.startAt,
    endAt: parsed.endAt,
    location: parsed.location,
    organizer: parsed.organizer,
    dueAt: parsed.dueAt,
    createdById: caregiverId,
    updatedAt: new Date(),
  } satisfies Partial<typeof tasks.$inferInsert>;

  const now = new Date();
  const [result] = await ctx.db
    .insert(tasks)
    .values({
      ...payload,
      createdAt: now,
    })
    .onConflictDoUpdate({
      target: [tasks.createdById, tasks.sourceId],
      set: {
        ...payload,
        updatedAt: now,
      },
    })
    .returning({ id: tasks.id, isNew: sql<boolean>`(xmax = 0)` });

  return { action: (result.isNew ? 'created' : 'updated') as const, id: result.id };
}

export async function syncSource({
  ctx,
  sourceId,
  caregiverIdOverride,
  reason = 'manual',
}: {
  ctx: any;
  sourceId: string;
  caregiverIdOverride?: string;
  reason?: string;
}) {
  const [source] = await ctx.db.select().from(sources).where(eq(sources.id, sourceId)).limit(1);

  if (!source) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Source not found' });
  }

  const caregiverId = caregiverIdOverride ?? source.caregiverId;

  if (source.status === 'disconnected') {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Source is disconnected' });
  }

  const { gmail } = createGmailClient(source.refreshToken);

  const startedAt = new Date();

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

  const results = { created: 0, updated: 0, skipped: 0, errors: 0 };

  const concurrency = 3;
  for (let i = 0; i < messageIds.length; i += concurrency) {
    const batch = messageIds.slice(i, i + concurrency);
    await Promise.all(
      batch.map(async (id) => {
        try {
          const { data } = await gmail.users.messages.get({
            userId: 'me',
            id,
            format: 'full',
          });

          const outcome = await upsertTaskFromMessage({ ctx, source, caregiverId, message: data });
          if (outcome.action === 'created') results.created += 1;
          if (outcome.action === 'updated') results.updated += 1;
          if (outcome.action === 'skipped' || outcome.action === 'skipped_low_confidence')
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
    await ctx.db.insert(ingestionEvents).values({
      sourceId: source.id,
      caregiverId,
      provider: source.provider,
      type: 'gmail',
      ingestionId: `${reason}-${Date.now()}`,
      historyId: nextHistoryId ?? source.historyId ?? undefined,
      startedAt,
      finishedAt: new Date(),
      createdCount: results.created,
      updatedCount: results.updated,
      skippedCount: results.skipped,
      errorCount: results.errors,
      durationMs: new Date().getTime() - startedAt.getTime(),
    });
  }

  return {
    ...results,
    historyId: nextHistoryId ?? source.historyId,
    messageCount: messageIds.length,
  };
}

export const ingestionRouter = router({
  syncNow: authedProcedure
    .input(z.object({ sourceId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const caregiverId = await ensureCaregiver(ctx);
      return syncSource({
        ctx,
        sourceId: input.sourceId,
        caregiverIdOverride: caregiverId,
        reason: 'manual',
      });
    }),
});
