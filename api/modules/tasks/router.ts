import { TRPCError } from '@trpc/server';
import { and, desc, eq, sql } from 'drizzle-orm';
import { v5 as uuidv5 } from 'uuid';
import { z } from 'zod';
import { caregivers, tasks } from '../../db/schema';
import { authedProcedure, router } from '../../trpc/trpc';

const statusEnum = z.enum(['todo', 'in_progress', 'done']);
const USER_NAMESPACE = '6ba7b810-9dad-11d1-80b4-00c04fd430c8'; // DNS namespace; stable for deriving UUIDs

export const taskRouter = router({
  list: authedProcedure.query(async ({ ctx }) => {
    const caregiverId = await ensureCaregiver(ctx);
    return ctx.db
      .select()
      .from(tasks)
      .where(eq(tasks.createdById, caregiverId))
      .orderBy(desc(tasks.createdAt));
  }),

  byCaregiver: authedProcedure
    .input(
      z.object({
        caregiverId: z.string().uuid(),
      })
    )
    .query(async ({ ctx, input }) => {
      const caregiverId = await ensureCaregiver(ctx);
      if (input.caregiverId !== caregiverId) {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }
      return ctx.db
        .select()
        .from(tasks)
        .where(eq(tasks.createdById, caregiverId))
        .orderBy(desc(tasks.createdAt));
    }),

  create: authedProcedure
    .input(
      z.object({
        title: z.string().min(1),
        description: z.string().optional(),
        status: statusEnum.optional(),
        careRecipientId: z.string().uuid().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const caregiverId = await ensureCaregiver(ctx);

      const payload = {
        title: input.title,
        description: input.description,
        status: input.status ?? 'todo',
        careRecipientId: input.careRecipientId,
        createdById: caregiverId,
      };

      const [inserted] = await ctx.db.insert(tasks).values(payload).returning();

      return inserted;
    }),

  delete: authedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const caregiverId = await ensureCaregiver(ctx);

      const [deleted] = await ctx.db
        .delete(tasks)
        .where(and(eq(tasks.id, input.id), eq(tasks.createdById, caregiverId)))
        .returning();

      if (!deleted) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Task not found' });
      }

      return { id: deleted.id };
    }),

  toggleStatus: authedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const caregiverId = await ensureCaregiver(ctx);

      try {
        const [updated] = await ctx.db
          .update(tasks)
          .set({
            status: sql`(CASE WHEN ${tasks.status} = 'done' THEN 'todo' ELSE 'done' END)::task_status`,
            updatedAt: new Date(),
          })
          .where(and(eq(tasks.id, input.id), eq(tasks.createdById, caregiverId)))
          .returning();

        if (!updated) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Task not found' });
        }

        return updated;
      } catch (error) {
        ctx.req?.log?.error({ err: error }, 'toggleStatus failed');
        throw error;
      }
    }),

  updateTitle: authedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        title: z.string().min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const caregiverId = await ensureCaregiver(ctx);

      const [updated] = await ctx.db
        .update(tasks)
        .set({ title: input.title, updatedAt: new Date() })
        .where(and(eq(tasks.id, input.id), eq(tasks.createdById, caregiverId)))
        .returning();

      if (!updated) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Task not found' });
      }

      return updated;
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

async function ensureCaregiver(ctx: any) {
  const userId = ctx.auth?.userId;
  if (!userId) {
    throw new TRPCError({ code: 'UNAUTHORIZED' });
  }
  const caregiverId = uuidv5(userId, USER_NAMESPACE);
  await ctx.db
    .insert(caregivers)
    .values({
      id: caregiverId,
      name: userId,
      email: `${userId}@local`,
    })
    .onConflictDoNothing();
  return caregiverId;
}
