import { google } from 'googleapis';
import { TRPCError } from '@trpc/server';
import { eq, sql } from 'drizzle-orm';

import { careRecipientMemberships, sources, tasks } from '../../db/schema';
import { isInvalidGrantError } from '../../lib/google';
import { IngestionCtx } from '../../lib/ingestionTypes';
import { withSourceLock } from '../../lib/sourceLock';

const ensureCalendarClient = (refreshToken: string) => {
  const oauth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
  oauth.setCredentials({ refresh_token: refreshToken });
  return google.calendar({ version: 'v3', auth: oauth });
};

const toTaskPayload = ({
  event,
  caregiverId,
  careRecipientId,
}: {
  event: any;
  caregiverId: string;
  careRecipientId: string;
}) => {
  const start = event.start?.dateTime ?? event.start?.date ?? null;
  const end = event.end?.dateTime ?? event.end?.date ?? null;
  const externalId = event.iCalUID ?? event.id ?? undefined;
  return {
    title: event.summary ?? 'Appointment',
    type: 'appointment' as const,
    status: 'scheduled' as const,
    reviewState: 'approved' as const,
    provider: 'gmail' as const,
    externalId,
    sourceId: event.id ?? undefined,
    sourceLink: event.htmlLink ?? undefined,
    sender: event.organizer?.email ?? undefined,
    rawSnippet: event.description ?? undefined,
    confidence: 0.9,
    syncedAt: new Date(),
    careRecipientId,
    createdById: caregiverId,
    startAt: start ? new Date(start) : null,
    endAt: end ? new Date(end) : null,
    location: event.location ?? null,
    updatedAt: new Date(),
  } satisfies Partial<typeof tasks.$inferInsert>;
};

export async function syncCalendarSource({
  ctx,
  sourceId,
  caregiverId,
}: {
  ctx: IngestionCtx;
  sourceId: string;
  caregiverId: string;
}) {
  return withSourceLock(sourceId, async () => {
    const [source] = await ctx.db.select().from(sources).where(eq(sources.id, sourceId)).limit(1);
    if (!source) throw new TRPCError({ code: 'NOT_FOUND', message: 'Source not found' });
    if (source.caregiverId !== caregiverId) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Source does not belong to caregiver' });
    }
    if (source.status === 'disconnected') {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Source is disconnected' });
    }

    if (!source.isPrimary) {
      return { created: 0, updated: 0, items: 0, nextSyncToken: source.calendarSyncToken ?? null };
    }

    const [membership] = await ctx.db
      .select({ careRecipientId: careRecipientMemberships.careRecipientId })
      .from(careRecipientMemberships)
      .where(eq(careRecipientMemberships.caregiverId, caregiverId))
      .limit(1);

    if (!membership?.careRecipientId) {
      throw new TRPCError({ code: 'FAILED_PRECONDITION', message: 'Care recipient not set up' });
    }

    const calendar = ensureCalendarClient(source.refreshToken);

    const markErrored = async (message: string) => {
      await ctx.db
        .update(sources)
        .set({ status: 'errored', errorMessage: message, updatedAt: new Date() })
        .where(eq(sources.id, source.id));
    };

    const eventsRes = await (async () => {
      try {
        return await calendar.events.list({
          calendarId: 'primary',
          syncToken: source.calendarSyncToken ?? undefined,
          maxResults: 20,
          singleEvents: true,
          showDeleted: false,
          orderBy: 'updated',
        });
      } catch (err) {
        if (isInvalidGrantError(err)) {
          await markErrored('Google calendar access expired; please reconnect');
          throw new TRPCError({
            code: 'FAILED_PRECONDITION',
            message: 'Google connection expired; reconnect to continue syncing calendar',
          });
        }
        throw err;
      }
    })();

    const nextSyncToken = eventsRes.data.nextSyncToken ?? source.calendarSyncToken ?? null;
    const items = eventsRes.data.items ?? [];

    let created = 0;
    let updated = 0;

    for (const ev of items) {
      if (!ev.id) continue;
      const payload = toTaskPayload({
        event: ev,
        caregiverId,
        careRecipientId: membership.careRecipientId,
      });

      const [row] = await ctx.db
        .insert(tasks)
        .values({ ...payload, createdAt: new Date() })
        .onConflictDoUpdate({
          target: [tasks.careRecipientId, tasks.provider, tasks.externalId],
          set: { ...payload, updatedAt: new Date() },
        })
        .returning({ id: tasks.id, isNew: sql<boolean>`(xmax = 0)` });

      if (row?.isNew) created += 1;
      else updated += 1;
    }

    await ctx.db
      .update(sources)
      .set({ calendarSyncToken: nextSyncToken ?? source.calendarSyncToken, lastSyncAt: new Date() })
      .where(eq(sources.id, source.id));

    return { created, updated, items: items.length, nextSyncToken };
  });
}
