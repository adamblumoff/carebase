import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { caregivers, tasks } from '../../db/schema';
import { procedure, router } from '../../trpc/trpc';

const statusEnum = z.enum(['todo', 'in_progress', 'done']);

export const taskRouter = router({
  list: procedure.query(async ({ ctx }) => {
    return ctx.db.select().from(tasks).orderBy(desc(tasks.createdAt));
  }),

  byCaregiver: procedure
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

  create: procedure
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
        createdById: input.createdById,
      };

      const [inserted] = await ctx.db.insert(tasks).values(payload).returning();

      return inserted;
    }),

  upsertCaregiver: procedure
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
        const [existing] = await ctx.db
          .update(caregivers)
          .set({ name: input.name, email: input.email })
          .where(eq(caregivers.id, identifier))
          .returning();

        return existing;
      }

      const [created] = await ctx.db
        .insert(caregivers)
        .values({ email: input.email, name: input.name })
        .returning();

      return created;
    }),
});
