import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';

import { ingestionEvents, sources } from '../../db/schema';
import { ensureCaregiver } from '../../lib/caregiver';
import { authedProcedure, router } from '../../trpc/trpc';

export const ingestionEventsRouter = router({
  recent: authedProcedure
    .input(z.object({ limit: z.number().min(1).max(20).default(5) }).optional())
    .query(async ({ ctx, input }) => {
      const caregiverId = await ensureCaregiver(ctx);
      const limit = input?.limit ?? 5;

      const rows = await ctx.db
        .select({
          id: ingestionEvents.id,
          sourceId: ingestionEvents.sourceId,
          provider: ingestionEvents.provider,
          type: ingestionEvents.type,
          created: ingestionEvents.createdCount,
          updated: ingestionEvents.updatedCount,
          errors: ingestionEvents.errorCount,
          startedAt: ingestionEvents.startedAt,
          finishedAt: ingestionEvents.finishedAt,
          errorMessage: ingestionEvents.errorMessage,
        })
        .from(ingestionEvents)
        .innerJoin(sources, eq(ingestionEvents.sourceId, sources.id))
        .where(eq(ingestionEvents.caregiverId, caregiverId))
        .orderBy(desc(ingestionEvents.startedAt))
        .limit(limit);

      return rows;
    }),
});
