import { TRPCError } from '@trpc/server';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';

import { careRecipientMemberships, sources } from '../../db/schema';
import { createGmailClient } from '../../lib/google';
import { google } from 'googleapis';
import { registerCalendarWatch, registerGmailWatch } from '../../lib/watch';
import { authedProcedure, router } from '../../trpc/trpc';
import { requireOwnerRole } from '../../lib/careRecipient';

export const watchRouter = router({
  register: authedProcedure
    .input(z.object({ sourceId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const membership = await requireOwnerRole(ctx);

      try {
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
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Only the Primary inbox can register watches',
          });
        }

        const { gmail, auth } = createGmailClient(source.refreshToken);
        const calendar = google.calendar({ version: 'v3', auth });

        const gmailWatch = await registerGmailWatch(gmail);
        const calendarWatch = await registerCalendarWatch(calendar, source.id);

        let nextSyncToken: string | null = null;
        try {
          const resList = await calendar.events.list({
            calendarId: 'primary',
            maxResults: 1,
            singleEvents: false,
          });
          nextSyncToken = resList.data.nextSyncToken ?? null;
        } catch (listErr) {
          ctx.req?.log?.warn({ err: listErr }, 'calendar list for syncToken failed');
        }
        const resolvedSyncToken = nextSyncToken ?? source.calendarSyncToken ?? null;

        const [updated] = await ctx.db
          .update(sources)
          .set({
            watchId: gmailWatch.watchId ?? source.watchId,
            watchExpiration: gmailWatch.expiration ?? source.watchExpiration,
            historyId: gmailWatch.historyId ?? source.historyId,
            calendarChannelId: calendarWatch.channelId ?? source.calendarChannelId,
            calendarResourceId: calendarWatch.resourceId ?? source.calendarResourceId,
            calendarSyncToken: resolvedSyncToken,
            updatedAt: new Date(),
          })
          .where(eq(sources.id, source.id))
          .returning();

        return updated;
      } catch (err: any) {
        if (err instanceof TRPCError) throw err;
        ctx.req?.log?.error({ err }, 'watch.register failed');
        const hint =
          err?.code === 403
            ? ' Grant Pub/Sub Publisher to gmail-api-push@system.gserviceaccount.com on the Pub/Sub topic.'
            : '';
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: (err?.message ?? 'watch register failed') + hint,
        });
      }
    }),
});
