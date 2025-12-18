import { TRPCError } from '@trpc/server';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';

import { caregivers, taskEvents, tasks } from '../../db/schema';
import { requireCareRecipientMembership } from '../../lib/careRecipient';
import { authedProcedure, router } from '../../trpc/trpc';

export const taskEventsRouter = router({
  list: authedProcedure
    .input(
      z.object({
        taskId: z.string().uuid(),
        limit: z.number().int().min(1).max(100).default(40).optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const membership = await requireCareRecipientMembership(ctx);
      const limit = input.limit ?? 40;

      const [task] = await ctx.db
        .select({ id: tasks.id })
        .from(tasks)
        .where(
          and(eq(tasks.id, input.taskId), eq(tasks.careRecipientId, membership.careRecipientId))
        )
        .limit(1);

      if (!task) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Task not found' });
      }

      return ctx.db
        .select({
          id: taskEvents.id,
          type: taskEvents.type,
          payload: taskEvents.payload,
          createdAt: taskEvents.createdAt,
          actor: {
            id: caregivers.id,
            name: caregivers.name,
            email: caregivers.email,
          },
        })
        .from(taskEvents)
        .innerJoin(caregivers, eq(caregivers.id, taskEvents.actorCaregiverId))
        .where(eq(taskEvents.taskId, input.taskId))
        .orderBy(desc(taskEvents.createdAt))
        .limit(limit);
    }),
});
