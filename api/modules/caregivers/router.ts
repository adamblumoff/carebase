import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { careRecipientMemberships, careRecipients, caregivers } from '../../db/schema';
import { ensureCaregiver } from '../../lib/caregiver';
import { isValidIanaTimeZone } from '../../lib/timezone';
import { authedProcedure, router } from '../../trpc/trpc';

export const caregiversRouter = router({
  me: authedProcedure.query(async ({ ctx }) => {
    const caregiverId = await ensureCaregiver(ctx);
    const [row] = await ctx.db
      .select({
        id: caregivers.id,
        name: caregivers.name,
        email: caregivers.email,
        timezone: caregivers.timezone,
      })
      .from(caregivers)
      .where(eq(caregivers.id, caregiverId))
      .limit(1);

    if (!row) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Caregiver not found' });
    }

    return row;
  }),

  setName: authedProcedure
    .input(z.object({ name: z.string().min(1).max(80) }))
    .mutation(async ({ ctx, input }) => {
      const caregiverId = await ensureCaregiver(ctx);
      const [updated] = await ctx.db
        .update(caregivers)
        .set({ name: input.name.trim() })
        .where(eq(caregivers.id, caregiverId))
        .returning({ id: caregivers.id, name: caregivers.name, email: caregivers.email });

      if (!updated) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Caregiver not found' });
      }

      return updated;
    }),

  setTimezone: authedProcedure
    .input(z.object({ timezone: z.string().min(1).max(64) }))
    .mutation(async ({ ctx, input }) => {
      const caregiverId = await ensureCaregiver(ctx);
      if (!isValidIanaTimeZone(input.timezone)) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid timezone' });
      }

      const [ownerMembership] = await ctx.db
        .select({
          careRecipientId: careRecipientMemberships.careRecipientId,
        })
        .from(careRecipientMemberships)
        .where(
          and(
            eq(careRecipientMemberships.caregiverId, caregiverId),
            eq(careRecipientMemberships.role, 'owner')
          )
        )
        .limit(1);

      // If the owner reports a timezone and the hub timezone is still "unset", bump it to match so
      // shared Daily note day-boundaries make sense. Avoid rewriting hubs whose timezone was explicitly set.
      if (ownerMembership) {
        await ctx.db
          .update(careRecipients)
          .set({ timezone: input.timezone, timezoneSource: 'owner_device' })
          .where(
            and(
              eq(careRecipients.id, ownerMembership.careRecipientId),
              eq(careRecipients.timezoneSource, 'unset')
            )
          );
      }

      const [updated] = await ctx.db
        .update(caregivers)
        .set({ timezone: input.timezone })
        .where(eq(caregivers.id, caregiverId))
        .returning({
          id: caregivers.id,
          name: caregivers.name,
          email: caregivers.email,
          timezone: caregivers.timezone,
        });

      if (!updated) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Caregiver not found' });
      }

      return updated;
    }),
});
