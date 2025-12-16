import { TRPCError } from '@trpc/server';
import { and, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { caregivers, senderSuppressions, tasks } from '../../db/schema';
import { authedProcedure, router } from '../../trpc/trpc';
import { ensureCaregiver } from '../../lib/caregiver';
import {
  parseSenderDomain,
  SENDER_SUPPRESSION_IGNORE_THRESHOLD,
} from '../../lib/senderSuppression';

const statusEnum = z.enum(['todo', 'in_progress', 'scheduled', 'snoozed', 'done']);
const typeEnum = z.enum(['appointment', 'bill', 'medication', 'general']);
const reviewStateEnum = z.enum(['pending', 'approved', 'ignored']);

const recordSenderSuppression = async ({
  ctx,
  caregiverId,
  provider,
  sender,
  senderDomain,
}: {
  ctx: { db: any };
  caregiverId: string;
  provider: string | null;
  sender: string | null;
  senderDomain: string | null;
}) => {
  if (provider !== 'gmail') return;
  const domain = parseSenderDomain(sender, senderDomain);
  if (!domain) return;
  const now = new Date();

  await ctx.db
    .insert(senderSuppressions)
    .values({
      caregiverId,
      provider: 'gmail',
      senderDomain: domain,
      ignoreCount: 1,
      suppressed: SENDER_SUPPRESSION_IGNORE_THRESHOLD <= 1,
      lastIgnoredAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        senderSuppressions.caregiverId,
        senderSuppressions.provider,
        senderSuppressions.senderDomain,
      ],
      set: {
        ignoreCount: sql`${senderSuppressions.ignoreCount} + 1`,
        suppressed: sql<boolean>`(CASE WHEN ${senderSuppressions.ignoreCount} + 1 >= ${SENDER_SUPPRESSION_IGNORE_THRESHOLD} THEN true ELSE ${senderSuppressions.suppressed} END)`,
        lastIgnoredAt: now,
        updatedAt: now,
      },
    });
};

export const taskRouter = router({
  list: authedProcedure
    .input(
      z
        .object({
          type: typeEnum.optional(),
          reviewState: reviewStateEnum.optional(),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      const caregiverId = await ensureCaregiver(ctx);

      const conditions = [eq(tasks.createdById, caregiverId)];

      if (input?.type) {
        conditions.push(eq(tasks.type, input.type));
      }

      if (input?.reviewState) {
        conditions.push(eq(tasks.reviewState, input.reviewState));
      } else {
        // Hide ignored tasks by default unless explicitly requested.
        conditions.push(sql`${tasks.reviewState} != 'ignored'`);
      }

      const predicate = conditions.length === 1 ? conditions[0] : and(...conditions);

      return ctx.db.select().from(tasks).where(predicate).orderBy(desc(tasks.createdAt));
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
        type: typeEnum.optional(),
        careRecipientId: z.string().uuid().optional(),
        dueAt: z.coerce.date().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const caregiverId = await ensureCaregiver(ctx);

      const payload = {
        title: input.title,
        description: input.description,
        status: input.status ?? 'todo',
        type: input.type ?? 'general',
        careRecipientId: input.careRecipientId,
        createdById: caregiverId,
        dueAt: input.dueAt,
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

      const [updated] = await ctx.db
        .update(tasks)
        .set({ reviewState: 'ignored', status: 'done', updatedAt: new Date() })
        .where(and(eq(tasks.id, input.id), eq(tasks.createdById, caregiverId)))
        .returning({
          id: tasks.id,
          provider: tasks.provider,
          sender: tasks.sender,
          senderDomain: tasks.senderDomain,
        });

      if (!updated) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Task not found' });
      }

      await recordSenderSuppression({
        ctx,
        caregiverId,
        provider: updated.provider ?? null,
        sender: updated.sender ?? null,
        senderDomain: updated.senderDomain ?? null,
      });

      return { id: updated.id };
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

  updateDetails: authedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        title: z.string().min(1).max(160).optional(),
        description: z.string().max(2000).optional(),
        type: typeEnum.optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const caregiverId = await ensureCaregiver(ctx);

      if (!input.title && !input.description && !input.type) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Nothing to update' });
      }

      const payload: Partial<typeof tasks.$inferInsert> = {
        updatedAt: new Date(),
      };

      if (input.title !== undefined) payload.title = input.title.trim();
      if (input.description !== undefined) payload.description = input.description.trim();
      if (input.type !== undefined) payload.type = input.type;

      const [updated] = await ctx.db
        .update(tasks)
        .set(payload)
        .where(and(eq(tasks.id, input.id), eq(tasks.createdById, caregiverId)))
        .returning();

      if (!updated) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Task not found' });
      }

      return updated;
    }),

  review: authedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        action: z.enum(['approve', 'ignore']),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const caregiverId = await ensureCaregiver(ctx);

      if (input.action === 'ignore') {
        const [ignored] = await ctx.db
          .update(tasks)
          .set({ reviewState: 'ignored', status: 'done', updatedAt: new Date() })
          .where(and(eq(tasks.id, input.id), eq(tasks.createdById, caregiverId)))
          .returning({
            id: tasks.id,
            provider: tasks.provider,
            sender: tasks.sender,
            senderDomain: tasks.senderDomain,
          });

        if (!ignored) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Task not found' });
        }

        await recordSenderSuppression({
          ctx,
          caregiverId,
          provider: ignored.provider ?? null,
          sender: ignored.sender ?? null,
          senderDomain: ignored.senderDomain ?? null,
        });

        return { id: ignored.id, action: 'ignored' as const };
      }

      const [updated] = await ctx.db
        .update(tasks)
        .set({ reviewState: 'approved', updatedAt: new Date() })
        .where(and(eq(tasks.id, input.id), eq(tasks.createdById, caregiverId)))
        .returning();

      if (!updated) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Task not found' });
      }

      return { ...updated, action: 'approved' as const };
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
