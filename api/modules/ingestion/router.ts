import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import { google } from 'googleapis';
import { z } from 'zod';

import { ingestionEvents, sources, tasks } from '../../db/schema';
import { ensureCaregiver } from '../../lib/caregiver';
import { createGmailClient, gmailQuery } from '../../lib/google';
import { authedProcedure, router } from '../../trpc/trpc';

type Classification = {
  type: 'appointment' | 'bill' | 'medication' | 'general';
  confidence: number;
  title: string;
  amount?: number;
  vendor?: string;
  medicationName?: string;
};

const classify = (subject: string, snippet: string): Classification => {
  const text = `${subject} ${snippet}`.toLowerCase();

  if (text.includes('appointment') || text.includes('appt') || text.includes('calendar')) {
    return { type: 'appointment', confidence: 0.9, title: subject.trim() || 'Appointment' };
  }

  if (text.includes('bill') || text.includes('invoice') || text.includes('statement')) {
    const amountMatch = text.match(/\$([0-9]+(?:\.[0-9]{2})?)/);
    return {
      type: 'bill',
      confidence: 0.82,
      title: subject.trim() || 'Bill',
      amount: amountMatch ? Number(amountMatch[1]) : undefined,
    };
  }

  if (text.includes('medication') || text.includes('prescription') || text.includes('rx')) {
    return {
      type: 'medication',
      confidence: 0.78,
      title: subject.trim() || 'Medication',
      medicationName: subject,
    };
  }

  return { type: 'general', confidence: 0.5, title: subject.trim() || 'Task' };
};

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
  const subject =
    message.payload?.headers?.find((h) => h.name?.toLowerCase() === 'subject')?.value ?? 'Task';
  const fromHeader = message.payload?.headers?.find((h) => h.name?.toLowerCase() === 'from')?.value;
  const snippet = message.snippet ?? '';

  const classification = classify(subject, snippet);

  const confidence = classification.confidence;
  const reviewState = confidence >= 0.75 ? 'approved' : 'pending';

  const payload = {
    title: classification.title,
    type: classification.type,
    status: 'todo' as const,
    reviewState,
    provider: 'gmail' as const,
    sourceId: message.id ?? undefined,
    sourceLink: message.id ? gmailMessageLink(source.accountEmail, message.id) : undefined,
    sender: fromHeader ?? undefined,
    rawSnippet: snippet,
    confidence,
    syncedAt: new Date(),
    ingestionId: undefined,
    amount: classification.amount,
    vendor: classification.vendor,
    medicationName: classification.medicationName,
    createdById: caregiverId,
    updatedAt: new Date(),
  } satisfies Partial<typeof tasks.$inferInsert>;

  const [result] = await ctx.db
    .insert(tasks)
    .values({
      ...payload,
      createdAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [tasks.createdById, tasks.sourceId],
      set: {
        ...payload,
        updatedAt: new Date(),
      },
    })
    .returning({ id: tasks.id });

  return { action: 'upserted', id: result.id };
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

  const { messageIds, nextHistoryId } = await fetchMessages(
    gmail,
    source.accountEmail,
    source.historyId
  );

  const results = { created: 0, updated: 0, skipped: 0, errors: 0 };

  for (const id of messageIds) {
    try {
      const { data } = await gmail.users.messages.get({
        userId: 'me',
        id,
        format: 'metadata',
        metadataHeaders: ['Subject', 'From', 'Date'],
      });

      const outcome = await upsertTaskFromMessage({ ctx, source, caregiverId, message: data });
      if (outcome.action === 'created') results.created += 1;
      if (outcome.action === 'updated') results.updated += 1;
    } catch (error) {
      ctx.req?.log?.error({ err: error }, 'sync message failed');
      results.errors += 1;
    }
  }

  await ctx.db
    .update(sources)
    .set({ historyId: nextHistoryId ?? source.historyId, lastSyncAt: new Date() })
    .where(eq(sources.id, source.id));

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
