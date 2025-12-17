import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { caregivers } from '../../db/schema';
import { ensureCaregiver } from '../../lib/caregiver';
import { authedProcedure, router } from '../../trpc/trpc';

export const caregiversRouter = router({
  me: authedProcedure.query(async ({ ctx }) => {
    const caregiverId = await ensureCaregiver(ctx);
    const [row] = await ctx.db
      .select({ id: caregivers.id, name: caregivers.name, email: caregivers.email })
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
});
