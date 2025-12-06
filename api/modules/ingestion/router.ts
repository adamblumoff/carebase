import { TRPCError } from '@trpc/server';
import { eq, sql } from 'drizzle-orm';
import { google } from 'googleapis';
import { z } from 'zod';

import { ingestionEvents, sources, tasks } from '../../db/schema';
import { ensureCaregiver } from '../../lib/caregiver';
import { createGmailClient, gmailQuery, isInvalidGrantError } from '../../lib/google';
import { parseMessage } from '../../lib/emailParser';
import { authedProcedure, router } from '../../trpc/trpc';

const gmailMessageLink = (accountEmail: string, messageId: string) =>
  `https://mail.google.com/mail/u/${encodeURIComponent(accountEmail)}/#all/${messageId}`;

const fetchMessages = async (
  gmail: ReturnType<typeof google.gmail>,
  accountEmail: string,
  historyId?: string | null
) => {
  if (historyId) {
    const history = await gmail.users.history.list({
      userId: 'me',
      startHistoryId: historyId,
      historyTypes: ['messageAdded'],
      maxResults: 50,
    });

    const added = history.data.history?.flatMap((h) => h.messagesAdded ?? []) ?? [];
    return {
      messageIds: added.map((m) => m.message?.id).filter(Boolean) as string[],
      nextHistoryId: history.data.historyId ?? historyId,
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
  if (message.sizeEstimate && message.sizeEstimate > 200_000) {
    ctx.req?.log?.warn?.(
      { sizeEstimate: message.sizeEstimate, id: message.id },
      'skip large email'
    );
    return { action: 'skipped' as const, id: message.id };
  }
  const subject =
    message.payload?.headers?.find((h) => h.name?.toLowerCase() === 'subject')?.value ?? 'Task';
  const fromHeader = message.payload?.headers?.find((h) => h.name?.toLowerCase() === 'from')?.value;
  const snippet = message.snippet ?? '';

  const parsed = parseMessage({ message, subject, sender: fromHeader, snippet });

  const confidence = parsed.confidence;

  // Drop very low-confidence items (<60%) entirely.
  if (confidence < 0.6) {
    return { action: 'skipped_low_confidence' as const, id: message.id };
  }

  const reviewState = confidence < 0.8 ? 'pending' : 'approved';

  const payload = {
    title: parsed.title,
    type: parsed.type,
    status: parsed.type === 'appointment' ? 'scheduled' : 'todo',
    reviewState,
    provider: 'gmail' as const,
    sourceId: message.id ?? undefined,
    sourceLink: message.id ? gmailMessageLink(source.accountEmail, message.id) : undefined,
    sender: fromHeader ?? undefined,
    rawSnippet: snippet,
    description: parsed.description,
    confidence,
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

  const { messageIds, nextHistoryId } = await (async () => {
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
