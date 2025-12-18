import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { eq, and, sql } from 'drizzle-orm';

import { pushTokens } from '../../db/schema';
import { ensureCaregiver } from '../../lib/caregiver';
import { authedProcedure, router } from '../../trpc/trpc';

const platformEnum = z.enum(['ios', 'android', 'web']);

export const pushTokensRouter = router({
  register: authedProcedure
    .input(
      z.object({
        token: z.string().min(10),
        platform: platformEnum,
      })
    )
    .mutation(async ({ ctx, input }) => {
      const caregiverId = await ensureCaregiver(ctx);
      const now = new Date();

      const [inserted] = await ctx.db
        .insert(pushTokens)
        .values({
          caregiverId,
          token: input.token,
          platform: input.platform,
          disabledAt: null,
          lastSeenAt: now,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing()
        .returning({
          id: pushTokens.id,
          token: pushTokens.token,
          platform: pushTokens.platform,
          disabledAt: pushTokens.disabledAt,
          lastSeenAt: pushTokens.lastSeenAt,
        });

      if (inserted) return inserted;

      const [existing] = await ctx.db
        .select({
          id: pushTokens.id,
          caregiverId: pushTokens.caregiverId,
          token: pushTokens.token,
          platform: pushTokens.platform,
          disabledAt: pushTokens.disabledAt,
          lastSeenAt: pushTokens.lastSeenAt,
        })
        .from(pushTokens)
        .where(eq(pushTokens.token, input.token))
        .limit(1);

      if (!existing) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Push token not found' });
      }

      if (existing.caregiverId !== caregiverId) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Push token belongs to another user' });
      }

      const [updated] = await ctx.db
        .update(pushTokens)
        .set({
          platform: input.platform,
          disabledAt: null,
          lastSeenAt: now,
          updatedAt: now,
        })
        .where(eq(pushTokens.id, existing.id))
        .returning({
          id: pushTokens.id,
          token: pushTokens.token,
          platform: pushTokens.platform,
          disabledAt: pushTokens.disabledAt,
          lastSeenAt: pushTokens.lastSeenAt,
        });

      if (!updated) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Could not save push token',
        });
      }

      return updated;
    }),

  unregister: authedProcedure
    .input(z.object({ token: z.string().min(10) }))
    .mutation(async ({ ctx, input }) => {
      const caregiverId = await ensureCaregiver(ctx);
      const now = new Date();

      await ctx.db
        .update(pushTokens)
        .set({ disabledAt: now, updatedAt: now })
        .where(and(eq(pushTokens.caregiverId, caregiverId), eq(pushTokens.token, input.token)));

      return { ok: true as const };
    }),

  touch: authedProcedure
    .input(z.object({ token: z.string().min(10) }))
    .mutation(async ({ ctx, input }) => {
      const caregiverId = await ensureCaregiver(ctx);
      const now = new Date();

      await ctx.db
        .update(pushTokens)
        .set({ lastSeenAt: now, updatedAt: now })
        .where(and(eq(pushTokens.caregiverId, caregiverId), eq(pushTokens.token, input.token)));

      return { ok: true as const };
    }),

  active: authedProcedure.query(async ({ ctx }) => {
    const caregiverId = await ensureCaregiver(ctx);
    return ctx.db
      .select({
        id: pushTokens.id,
        token: pushTokens.token,
        platform: pushTokens.platform,
        disabledAt: pushTokens.disabledAt,
        lastSeenAt: pushTokens.lastSeenAt,
      })
      .from(pushTokens)
      .where(and(eq(pushTokens.caregiverId, caregiverId), sql`${pushTokens.disabledAt} IS NULL`))
      .orderBy(sql`${pushTokens.lastSeenAt} DESC`);
  }),
});
