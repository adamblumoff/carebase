import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { caregivers } from '../../db/schema';
import { ensureCaregiver } from '../../lib/caregiver';
import { authedProcedure, router } from '../../trpc/trpc';

const themePreferenceEnum = z.enum(['light', 'dark']);

export const userThemeRouter = router({
  get: authedProcedure.query(async ({ ctx }) => {
    const caregiverId = await ensureCaregiver(ctx);

    const [record] = await ctx.db
      .select({ themePreference: caregivers.themePreference })
      .from(caregivers)
      .where(eq(caregivers.id, caregiverId));

    return { themePreference: record?.themePreference ?? 'light' } as const;
  }),

  set: authedProcedure
    .input(
      z.object({
        themePreference: themePreferenceEnum,
      })
    )
    .mutation(async ({ ctx, input }) => {
      const caregiverId = await ensureCaregiver(ctx);

      const [updated] = await ctx.db
        .update(caregivers)
        .set({ themePreference: input.themePreference })
        .where(eq(caregivers.id, caregiverId))
        .returning({ themePreference: caregivers.themePreference });

      return updated ?? { themePreference: input.themePreference };
    }),
});
