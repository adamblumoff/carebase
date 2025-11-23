import { TRPCError } from '@trpc/server';
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { caregivers, tasks } from '../../db/schema';
import { authedProcedure, router } from '../../trpc/trpc';

const statusEnum = z.enum(['todo', 'in_progress', 'done']);

export const taskRouter = router({
  list: authedProcedure.query(async ({ ctx }) => {
    return ctx.db.select().from(tasks).orderBy(desc(tasks.createdAt));
  }),

  byCaregiver: authedProcedure
    .input(
      z.object({
        caregiverId: z.string().uuid(),
      })
    )
    .query(async ({ ctx, input }) => {
      return ctx.db
        .select()
        .from(tasks)
        .where(eq(tasks.createdById, input.caregiverId))
        .orderBy(desc(tasks.createdAt));
    }),

  create: authedProcedure
    .input(
      z.object({
        title: z.string().min(1),
        description: z.string().optional(),
        status: statusEnum.optional(),
        careRecipientId: z.string().uuid().optional(),
        createdById: z.string().uuid().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const payload = {
        title: input.title,
        description: input.description,
        status: input.status ?? 'todo',
        careRecipientId: input.careRecipientId,
        createdById: input.createdById ?? ctx.auth?.userId,
      };

      const [inserted] = await ctx.db.insert(tasks).values(payload).returning();

      return inserted;
    }),

  upsertCaregiver: authedProcedure
    .input(
      z.object({
        email: z.string().email(),
        name: z.string().min(1),
        id: z.string().uuid().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const identifier = input.id;

      if (identifier) {
        const [updated] = await ctx.db
          .update(caregivers)
          .set({ name: input.name, email: input.email })
          .where(eq(caregivers.id, identifier))
          .returning();

        if (!updated) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: `Caregiver not found for id ${identifier}`,
          });
        }

        return updated;
      }

      const [upserted] = await ctx.db
        .insert(caregivers)
        .values({ email: input.email, name: input.name })
        .onConflictDoUpdate({
          target: caregivers.email,
          set: {
            name: input.name,
            email: input.email,
          },
        })
        .returning();

      return upserted;
    }),
});
