import { google } from 'googleapis';
import { TRPCError } from '@trpc/server';
import { and, desc, eq } from 'drizzle-orm';

import { sources, tasks } from '../../db/schema';

const ensureCalendarClient = (refreshToken: string) => {
  const oauth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
  oauth.setCredentials({ refresh_token: refreshToken });
  return google.calendar({ version: 'v3', auth: oauth });
};

const toTaskPayload = (event: any, caregiverId: string, source: typeof sources.$inferSelect) => {
  const start = event.start?.dateTime ?? event.start?.date ?? null;
  const end = event.end?.dateTime ?? event.end?.date ?? null;
  return {
    title: event.summary ?? 'Appointment',
    type: 'appointment' as const,
    status: 'scheduled' as const,
    reviewState: 'approved' as const,
    provider: 'gmail' as const,
    sourceId: event.id ?? undefined,
    sourceLink: event.htmlLink ?? undefined,
    sender: event.organizer?.email ?? undefined,
    rawSnippet: event.description ?? undefined,
    confidence: 0.9,
    syncedAt: new Date(),
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
  ctx: any;
  sourceId: string;
  caregiverId: string;
}) {
  const [source] = await ctx.db.select().from(sources).where(eq(sources.id, sourceId)).limit(1);
  if (!source) throw new TRPCError({ code: 'NOT_FOUND', message: 'Source not found' });
  if (source.status === 'disconnected') {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Source is disconnected' });
  }

  const calendar = ensureCalendarClient(source.refreshToken);

  const eventsRes = await calendar.events.list({
    calendarId: 'primary',
    syncToken: source.calendarSyncToken ?? undefined,
    maxResults: 20,
    singleEvents: true,
    showDeleted: false,
    orderBy: 'updated',
  });

  const nextSyncToken = eventsRes.data.nextSyncToken ?? source.calendarSyncToken ?? null;
  const items = eventsRes.data.items ?? [];

  let created = 0;
  let updated = 0;

  for (const ev of items) {
    if (!ev.id) continue;
    const payload = toTaskPayload(ev, caregiverId, source);

    const existing = await ctx.db
      .select()
      .from(tasks)
      .where(and(eq(tasks.createdById, caregiverId), eq(tasks.sourceId, ev.id)))
      .orderBy(desc(tasks.createdAt))
      .limit(1);

    if (existing.length > 0) {
      await ctx.db.update(tasks).set(payload).where(eq(tasks.id, existing[0].id));
      updated += 1;
    } else {
      await ctx.db.insert(tasks).values({ ...payload, createdAt: new Date() });
      created += 1;
    }
  }

  await ctx.db
    .update(sources)
    .set({ calendarSyncToken: nextSyncToken ?? source.calendarSyncToken, lastSyncAt: new Date() })
    .where(eq(sources.id, source.id));

  return { created, updated, items: items.length, nextSyncToken };
}
