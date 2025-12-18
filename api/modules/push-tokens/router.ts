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

      const [row] = await ctx.db
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
        .onConflictDoUpdate({
          target: [pushTokens.token],
          set: {
            caregiverId,
            platform: input.platform,
            disabledAt: null,
            lastSeenAt: now,
            updatedAt: now,
          },
        })
        .returning({
          id: pushTokens.id,
          token: pushTokens.token,
          platform: pushTokens.platform,
          disabledAt: pushTokens.disabledAt,
          lastSeenAt: pushTokens.lastSeenAt,
        });

      return row;
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
