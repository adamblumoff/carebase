import { TRPCError } from '@trpc/server';
import { and, asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';

import { senderSuppressions } from '../../db/schema';
import { ensureCaregiver } from '../../lib/caregiver';
import { authedProcedure, router } from '../../trpc/trpc';

const domainInput = z
  .string()
  .min(3)
  .max(255)
  .transform((value) => value.trim().toLowerCase().replace(/^@+/, ''))
  .refine(
    (value) => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(value),
    'Enter a valid domain like example.com'
  );

export const senderSuppressionsRouter = router({
  list: authedProcedure
    .input(z.object({ includeUnsuppressed: z.boolean().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const caregiverId = await ensureCaregiver(ctx);

      const predicate = input?.includeUnsuppressed
        ? and(
            eq(senderSuppressions.caregiverId, caregiverId),
            eq(senderSuppressions.provider, 'gmail')
          )
        : and(
            eq(senderSuppressions.caregiverId, caregiverId),
            eq(senderSuppressions.provider, 'gmail'),
            eq(senderSuppressions.suppressed, true)
          );

      return ctx.db
        .select()
        .from(senderSuppressions)
        .where(predicate)
        .orderBy(asc(senderSuppressions.senderDomain));
    }),

  suppress: authedProcedure
    .input(z.object({ senderDomain: domainInput }))
    .mutation(async ({ ctx, input }) => {
      const caregiverId = await ensureCaregiver(ctx);
      const now = new Date();

      const [row] = await ctx.db
        .insert(senderSuppressions)
        .values({
          caregiverId,
          provider: 'gmail',
          senderDomain: input.senderDomain,
          ignoreCount: 0,
          suppressed: true,
          lastIgnoredAt: null,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [
            senderSuppressions.caregiverId,
            senderSuppressions.provider,
            senderSuppressions.senderDomain,
          ],
          set: {
            suppressed: true,
            updatedAt: now,
          },
        })
        .returning();

      return row;
    }),

  unsuppress: authedProcedure
    .input(z.object({ id: z.string().uuid(), resetCount: z.boolean().optional() }))
    .mutation(async ({ ctx, input }) => {
      const caregiverId = await ensureCaregiver(ctx);
      const now = new Date();

      const set = input.resetCount
        ? { suppressed: false, ignoreCount: 0, updatedAt: now }
        : { suppressed: false, updatedAt: now };

      const [row] = await ctx.db
        .update(senderSuppressions)
        .set(set)
        .where(
          and(eq(senderSuppressions.id, input.id), eq(senderSuppressions.caregiverId, caregiverId))
        )
        .returning();

      if (!row) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Suppression not found' });
      }

      return row;
    }),

  remove: authedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const caregiverId = await ensureCaregiver(ctx);

      const [row] = await ctx.db
        .delete(senderSuppressions)
        .where(
          and(eq(senderSuppressions.id, input.id), eq(senderSuppressions.caregiverId, caregiverId))
        )
        .returning({ id: senderSuppressions.id });

      if (!row) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Suppression not found' });
      }

      return row;
    }),

  stats: authedProcedure.query(async ({ ctx }) => {
    const caregiverId = await ensureCaregiver(ctx);
    const [row] = await ctx.db
      .select({
        total: sql<number>`count(*)::int`,
        suppressed: sql<number>`sum(case when ${senderSuppressions.suppressed} then 1 else 0 end)::int`,
      })
      .from(senderSuppressions)
      .where(
        and(
          eq(senderSuppressions.caregiverId, caregiverId),
          eq(senderSuppressions.provider, 'gmail')
        )
      );
    return row ?? { total: 0, suppressed: 0 };
  }),
});
