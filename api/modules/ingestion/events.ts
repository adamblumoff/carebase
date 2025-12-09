import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';

import { ingestionEvents, sources } from '../../db/schema';
import { ensureCaregiver } from '../../lib/caregiver';
import { authedProcedure, router } from '../../trpc/trpc';
import { ingestionEventBus, IngestionPushEvent } from '../../lib/eventBus';
import { observable } from '@trpc/server/observable';

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
  onPush: authedProcedure.subscription(async ({ ctx }) => {
    // Map authenticated user -> caregiver id to match emitted events.
    const caregiverId = await ensureCaregiver(ctx);
    return observable<IngestionPushEvent>((emit) => {
      const handler = (event: IngestionPushEvent) => {
        if (event.caregiverId !== caregiverId) return;
        (ctx.req?.log ?? console).info({ event, caregiverId }, 'onPush emit to subscriber');
        emit.next(event);
      };
      ingestionEventBus.on('push', handler);
      return () => {
        ingestionEventBus.off('push', handler);
      };
    });
  }),
});
