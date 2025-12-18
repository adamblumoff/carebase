import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { careRecipients, handoffNotes } from '../../db/schema';
import { requireCareRecipientMembership, requireOwnerRole } from '../../lib/careRecipient';
import { localDateString } from '../../lib/timezone';
import { authedProcedure, router } from '../../trpc/trpc';

export const handoffRouter = router({
  today: authedProcedure.query(async ({ ctx }) => {
    const membership = await requireCareRecipientMembership(ctx);
    const now = new Date();

    const [row] = await ctx.db
      .select({
        hubTimezone: careRecipients.timezone,
      })
      .from(careRecipients)
      .where(eq(careRecipients.id, membership.careRecipientId))
      .limit(1);

    const hubTimezone = row?.hubTimezone ?? 'UTC';
    const localDate = localDateString({ timeZone: hubTimezone, now });

    const [note] = await ctx.db
      .select({
        id: handoffNotes.id,
        localDate: handoffNotes.localDate,
        body: handoffNotes.body,
        updatedAt: handoffNotes.updatedAt,
        updatedByCaregiverId: handoffNotes.updatedByCaregiverId,
      })
      .from(handoffNotes)
      .where(
        and(
          eq(handoffNotes.careRecipientId, membership.careRecipientId),
          eq(handoffNotes.localDate, localDate)
        )
      )
      .limit(1);

    return {
      hubTimezone,
      localDate,
      note: note ?? null,
    };
  }),

  upsertToday: authedProcedure
    .input(z.object({ body: z.string().min(1).max(8000) }))
    .mutation(async ({ ctx, input }) => {
      const membership = await requireOwnerRole(ctx);
      const now = new Date();

      const [recipient] = await ctx.db
        .select({
          hubTimezone: careRecipients.timezone,
        })
        .from(careRecipients)
        .where(eq(careRecipients.id, membership.careRecipientId))
        .limit(1);

      const hubTimezone = recipient?.hubTimezone ?? 'UTC';
      const localDate = localDateString({ timeZone: hubTimezone, now });

      const [saved] = await ctx.db
        .insert(handoffNotes)
        .values({
          careRecipientId: membership.careRecipientId,
          localDate,
          body: input.body.trim(),
          updatedByCaregiverId: membership.caregiverId,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [handoffNotes.careRecipientId, handoffNotes.localDate],
          set: {
            body: input.body.trim(),
            updatedByCaregiverId: membership.caregiverId,
            updatedAt: now,
          },
        })
        .returning({
          id: handoffNotes.id,
          localDate: handoffNotes.localDate,
          body: handoffNotes.body,
          updatedAt: handoffNotes.updatedAt,
          updatedByCaregiverId: handoffNotes.updatedByCaregiverId,
        });

      if (!saved) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Could not save note' });
      }

      return {
        hubTimezone,
        localDate,
        note: saved,
      };
    }),
});
