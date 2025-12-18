import { TRPCError } from '@trpc/server';
import { and, desc, eq, gte, lte, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  careRecipientMemberships,
  caregivers,
  senderSuppressions,
  taskAssignments,
  tasks,
} from '../../db/schema';
import { authedProcedure, router } from '../../trpc/trpc';
import { ensureCaregiver } from '../../lib/caregiver';
import { requireCareRecipientMembership, requireOwnerRole } from '../../lib/careRecipient';
import { recordTaskEvent } from '../../lib/taskEvents';
import { sendPushToCaregiver } from '../../lib/push';
import {
  parseSenderDomain,
  SENDER_SUPPRESSION_IGNORE_THRESHOLD,
} from '../../lib/senderSuppression';

const statusEnum = z.enum(['todo', 'in_progress', 'scheduled', 'snoozed', 'done']);
const typeEnum = z.enum(['appointment', 'bill', 'medication', 'general']);
const reviewStateEnum = z.enum(['pending', 'approved', 'ignored']);

const listThinInput = z
  .object({
    type: typeEnum.optional(),
    reviewState: reviewStateEnum.optional(),
  })
  .optional();

const selectTaskThin = {
  id: tasks.id,
  title: tasks.title,
  description: tasks.description,
  type: tasks.type,
  status: tasks.status,
  reviewState: tasks.reviewState,
  assigneeId: taskAssignments.caregiverId,
  confidence: tasks.confidence,
  provider: tasks.provider,
  sourceLink: tasks.sourceLink,
  sender: tasks.sender,
  senderDomain: tasks.senderDomain,
  rawSnippet: tasks.rawSnippet,
  startAt: tasks.startAt,
  endAt: tasks.endAt,
  location: tasks.location,
  dueAt: tasks.dueAt,
  amount: tasks.amount,
  currency: tasks.currency,
  vendor: tasks.vendor,
  referenceNumber: tasks.referenceNumber,
  statementPeriod: tasks.statementPeriod,
  medicationName: tasks.medicationName,
  dosage: tasks.dosage,
  frequency: tasks.frequency,
  route: tasks.route,
  prescribingProvider: tasks.prescribingProvider,
  createdAt: tasks.createdAt,
  updatedAt: tasks.updatedAt,
} as const;

const buildListPredicate = ({
  careRecipientId,
  type,
  reviewState,
}: {
  careRecipientId: string;
  type?: z.infer<typeof typeEnum>;
  reviewState?: z.infer<typeof reviewStateEnum>;
}) => {
  const conditions = [eq(tasks.careRecipientId, careRecipientId)];

  if (type) {
    conditions.push(eq(tasks.type, type));
  }

  if (reviewState) {
    conditions.push(eq(tasks.reviewState, reviewState));
  } else {
    conditions.push(sql`${tasks.reviewState} != 'ignored'`);
  }

  return conditions.length === 1 ? conditions[0] : and(...conditions);
};

const upcomingWindow = (days: number) => {
  const now = new Date();
  const end = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
  return { now, end };
};

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
  listThin: authedProcedure.input(listThinInput).query(async ({ ctx, input }) => {
    const membership = await requireCareRecipientMembership(ctx);
    const predicate = buildListPredicate({
      careRecipientId: membership.careRecipientId,
      type: input?.type,
      reviewState: input?.reviewState,
    });

    return ctx.db
      .select(selectTaskThin)
      .from(tasks)
      .leftJoin(taskAssignments, eq(taskAssignments.taskId, tasks.id))
      .where(predicate)
      .orderBy(desc(tasks.createdAt));
  }),

  byId: authedProcedure.input(z.object({ id: z.string().uuid() })).query(async ({ ctx, input }) => {
    const membership = await requireCareRecipientMembership(ctx);

    const [row] = await ctx.db
      .select({
        task: tasks,
        assigneeId: taskAssignments.caregiverId,
      })
      .from(tasks)
      .leftJoin(taskAssignments, eq(taskAssignments.taskId, tasks.id))
      .where(and(eq(tasks.id, input.id), eq(tasks.careRecipientId, membership.careRecipientId)))
      .limit(1);

    if (!row) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Task not found' });
    }

    return { ...row.task, assigneeId: row.assigneeId ?? null };
  }),

  upcoming: authedProcedure
    .input(z.object({ days: z.number().int().min(1).max(30).default(7) }).optional())
    .query(async ({ ctx, input }) => {
      const membership = await requireCareRecipientMembership(ctx);
      const { now, end } = upcomingWindow(input?.days ?? 7);

      const appointmentPredicate = and(
        eq(tasks.type, 'appointment'),
        gte(tasks.startAt, now),
        lte(tasks.startAt, end)
      );
      const billPredicate = and(
        eq(tasks.type, 'bill'),
        gte(tasks.dueAt, now),
        lte(tasks.dueAt, end)
      );

      const predicate = and(
        eq(tasks.careRecipientId, membership.careRecipientId),
        sql`${tasks.reviewState} != 'ignored'`,
        sql`${tasks.status} != 'done'`,
        or(appointmentPredicate, billPredicate)
      );

      return ctx.db
        .select(selectTaskThin)
        .from(tasks)
        .leftJoin(taskAssignments, eq(taskAssignments.taskId, tasks.id))
        .where(predicate)
        .orderBy(desc(tasks.createdAt));
    }),

  stats: authedProcedure
    .input(z.object({ upcomingDays: z.number().int().min(1).max(30).default(7) }).optional())
    .query(async ({ ctx, input }) => {
      const membership = await requireCareRecipientMembership(ctx);
      const { now, end } = upcomingWindow(input?.upcomingDays ?? 7);

      const [pendingReview] = await ctx.db
        .select({ count: sql<number>`count(*)::int` })
        .from(tasks)
        .where(
          and(
            eq(tasks.careRecipientId, membership.careRecipientId),
            eq(tasks.reviewState, 'pending'),
            sql`${tasks.reviewState} != 'ignored'`
          )
        );

      const appointmentPredicate = and(
        eq(tasks.type, 'appointment'),
        gte(tasks.startAt, now),
        lte(tasks.startAt, end)
      );
      const billPredicate = and(
        eq(tasks.type, 'bill'),
        gte(tasks.dueAt, now),
        lte(tasks.dueAt, end)
      );

      const [upcoming] = await ctx.db
        .select({ count: sql<number>`count(*)::int` })
        .from(tasks)
        .where(
          and(
            eq(tasks.careRecipientId, membership.careRecipientId),
            sql`${tasks.reviewState} != 'ignored'`,
            sql`${tasks.status} != 'done'`,
            or(appointmentPredicate, billPredicate)
          )
        );

      return {
        pendingReviewCount: pendingReview?.count ?? 0,
        upcomingCount: upcoming?.count ?? 0,
      };
    }),

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
      const membership = await requireCareRecipientMembership(ctx);

      const predicate = buildListPredicate({
        careRecipientId: membership.careRecipientId,
        type: input?.type,
        reviewState: input?.reviewState,
      });

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
        dueAt: z.coerce.date().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const membership = await requireOwnerRole(ctx);
      const caregiverId = membership.caregiverId;

      const payload = {
        title: input.title,
        description: input.description,
        status: input.status ?? 'todo',
        type: input.type ?? 'general',
        careRecipientId: membership.careRecipientId,
        createdById: caregiverId,
        dueAt: input.dueAt,
      };

      const [inserted] = await ctx.db.insert(tasks).values(payload).returning();

      await recordTaskEvent({
        db: ctx.db,
        taskId: inserted.id,
        careRecipientId: membership.careRecipientId,
        actorCaregiverId: caregiverId,
        type: 'created',
        payload: {
          title: inserted.title,
          type: inserted.type,
          status: inserted.status,
        },
      });

      return inserted;
    }),

  assign: authedProcedure
    .input(
      z.object({
        taskId: z.string().uuid(),
        caregiverId: z.string().uuid().nullable(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const membership = await requireOwnerRole(ctx);
      const now = new Date();

      const [task] = await ctx.db
        .select({ id: tasks.id, title: tasks.title })
        .from(tasks)
        .where(
          and(eq(tasks.id, input.taskId), eq(tasks.careRecipientId, membership.careRecipientId))
        )
        .limit(1);

      if (!task) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Task not found' });
      }

      const [existingAssignment] = await ctx.db
        .select({ caregiverId: taskAssignments.caregiverId })
        .from(taskAssignments)
        .where(eq(taskAssignments.taskId, input.taskId))
        .limit(1);
      const fromAssigneeId = existingAssignment?.caregiverId ?? null;

      if (input.caregiverId === null) {
        await ctx.db.delete(taskAssignments).where(eq(taskAssignments.taskId, input.taskId));

        if (fromAssigneeId !== null) {
          await recordTaskEvent({
            db: ctx.db,
            taskId: input.taskId,
            careRecipientId: membership.careRecipientId,
            actorCaregiverId: membership.caregiverId,
            type: 'assigned',
            payload: { fromAssigneeId, toAssigneeId: null },
          });
        }
        return { taskId: input.taskId, assigneeId: null };
      }

      const [assigneeMembership] = await ctx.db
        .select({ caregiverId: careRecipientMemberships.caregiverId })
        .from(careRecipientMemberships)
        .where(
          and(
            eq(careRecipientMemberships.careRecipientId, membership.careRecipientId),
            eq(careRecipientMemberships.caregiverId, input.caregiverId)
          )
        )
        .limit(1);

      if (!assigneeMembership) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Assignee is not in this care hub' });
      }

      await ctx.db
        .insert(taskAssignments)
        .values({ taskId: input.taskId, caregiverId: input.caregiverId, createdAt: now })
        .onConflictDoUpdate({
          target: [taskAssignments.taskId],
          set: { caregiverId: input.caregiverId },
        });

      if (fromAssigneeId !== input.caregiverId) {
        await recordTaskEvent({
          db: ctx.db,
          taskId: input.taskId,
          careRecipientId: membership.careRecipientId,
          actorCaregiverId: membership.caregiverId,
          type: 'assigned',
          payload: { fromAssigneeId, toAssigneeId: input.caregiverId },
        });

        await sendPushToCaregiver({
          db: ctx.db,
          caregiverId: input.caregiverId,
          title: 'Task assigned to you',
          body: task.title,
          data: { type: 'task_assigned', taskId: input.taskId },
          log: ctx.req?.log,
        });
      }

      return { taskId: input.taskId, assigneeId: input.caregiverId };
    }),

  snooze: authedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        days: z.number().int().min(1).max(30),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const membership = await requireOwnerRole(ctx);
      const until = new Date(Date.now() + input.days * 24 * 60 * 60 * 1000);

      const [before] = await ctx.db
        .select({ status: tasks.status, dueAt: tasks.dueAt })
        .from(tasks)
        .where(and(eq(tasks.id, input.id), eq(tasks.careRecipientId, membership.careRecipientId)))
        .limit(1);

      const [updated] = await ctx.db
        .update(tasks)
        .set({ status: 'snoozed', dueAt: until, updatedAt: new Date() })
        .where(and(eq(tasks.id, input.id), eq(tasks.careRecipientId, membership.careRecipientId)))
        .returning();

      if (!updated) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Task not found' });
      }

      await recordTaskEvent({
        db: ctx.db,
        taskId: updated.id,
        careRecipientId: membership.careRecipientId,
        actorCaregiverId: membership.caregiverId,
        type: 'snoozed',
        payload: {
          days: input.days,
          fromStatus: before?.status ?? null,
          toStatus: updated.status,
          fromDueAt: before?.dueAt ?? null,
          toDueAt: updated.dueAt,
        },
      });

      return updated;
    }),

  delete: authedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const membership = await requireOwnerRole(ctx);
      const caregiverId = membership.caregiverId;

      const [updated] = await ctx.db
        .update(tasks)
        .set({ reviewState: 'ignored', status: 'done', updatedAt: new Date() })
        .where(and(eq(tasks.id, input.id), eq(tasks.careRecipientId, membership.careRecipientId)))
        .returning({
          id: tasks.id,
          provider: tasks.provider,
          sender: tasks.sender,
          senderDomain: tasks.senderDomain,
        });

      if (!updated) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Task not found' });
      }

      await recordTaskEvent({
        db: ctx.db,
        taskId: updated.id,
        careRecipientId: membership.careRecipientId,
        actorCaregiverId: caregiverId,
        type: 'reviewed',
        payload: { action: 'ignored', via: 'delete' },
      });

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
      const membership = await requireOwnerRole(ctx);

      try {
        const [before] = await ctx.db
          .select({ status: tasks.status })
          .from(tasks)
          .where(and(eq(tasks.id, input.id), eq(tasks.careRecipientId, membership.careRecipientId)))
          .limit(1);

        const [updated] = await ctx.db
          .update(tasks)
          .set({
            status: sql`(CASE WHEN ${tasks.status} = 'done' THEN 'todo' ELSE 'done' END)::task_status`,
            updatedAt: new Date(),
          })
          .where(and(eq(tasks.id, input.id), eq(tasks.careRecipientId, membership.careRecipientId)))
          .returning();

        if (!updated) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Task not found' });
        }

        await recordTaskEvent({
          db: ctx.db,
          taskId: updated.id,
          careRecipientId: membership.careRecipientId,
          actorCaregiverId: membership.caregiverId,
          type: 'status_toggled',
          payload: { fromStatus: before?.status ?? null, toStatus: updated.status },
        });

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
      const membership = await requireOwnerRole(ctx);

      const [updated] = await ctx.db
        .update(tasks)
        .set({ title: input.title, updatedAt: new Date() })
        .where(and(eq(tasks.id, input.id), eq(tasks.careRecipientId, membership.careRecipientId)))
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
      const membership = await requireOwnerRole(ctx);

      if (!input.title && !input.description && !input.type) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Nothing to update' });
      }

      const [before] = await ctx.db
        .select({ title: tasks.title, description: tasks.description, type: tasks.type })
        .from(tasks)
        .where(and(eq(tasks.id, input.id), eq(tasks.careRecipientId, membership.careRecipientId)))
        .limit(1);

      const payload: Partial<typeof tasks.$inferInsert> = {
        updatedAt: new Date(),
      };

      if (input.title !== undefined) payload.title = input.title.trim();
      if (input.description !== undefined) payload.description = input.description.trim();
      if (input.type !== undefined) payload.type = input.type;

      const [updated] = await ctx.db
        .update(tasks)
        .set(payload)
        .where(and(eq(tasks.id, input.id), eq(tasks.careRecipientId, membership.careRecipientId)))
        .returning();

      if (!updated) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Task not found' });
      }

      await recordTaskEvent({
        db: ctx.db,
        taskId: updated.id,
        careRecipientId: membership.careRecipientId,
        actorCaregiverId: membership.caregiverId,
        type: 'updated_details',
        payload: {
          from: before ?? null,
          to: { title: updated.title, description: updated.description, type: updated.type },
        },
      });

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
      const membership = await requireOwnerRole(ctx);
      const caregiverId = membership.caregiverId;

      if (input.action === 'ignore') {
        const [before] = await ctx.db
          .select({ reviewState: tasks.reviewState, status: tasks.status })
          .from(tasks)
          .where(and(eq(tasks.id, input.id), eq(tasks.careRecipientId, membership.careRecipientId)))
          .limit(1);

        const [ignored] = await ctx.db
          .update(tasks)
          .set({ reviewState: 'ignored', status: 'done', updatedAt: new Date() })
          .where(and(eq(tasks.id, input.id), eq(tasks.careRecipientId, membership.careRecipientId)))
          .returning({
            id: tasks.id,
            provider: tasks.provider,
            sender: tasks.sender,
            senderDomain: tasks.senderDomain,
          });

        if (!ignored) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Task not found' });
        }

        await recordTaskEvent({
          db: ctx.db,
          taskId: ignored.id,
          careRecipientId: membership.careRecipientId,
          actorCaregiverId: caregiverId,
          type: 'reviewed',
          payload: {
            action: 'ignored',
            from: before ?? null,
            to: { reviewState: 'ignored', status: 'done' },
          },
        });

        await recordSenderSuppression({
          ctx,
          caregiverId,
          provider: ignored.provider ?? null,
          sender: ignored.sender ?? null,
          senderDomain: ignored.senderDomain ?? null,
        });

        return { id: ignored.id, action: 'ignored' as const };
      }

      const [before] = await ctx.db
        .select({ reviewState: tasks.reviewState })
        .from(tasks)
        .where(and(eq(tasks.id, input.id), eq(tasks.careRecipientId, membership.careRecipientId)))
        .limit(1);

      const [updated] = await ctx.db
        .update(tasks)
        .set({ reviewState: 'approved', updatedAt: new Date() })
        .where(and(eq(tasks.id, input.id), eq(tasks.careRecipientId, membership.careRecipientId)))
        .returning();

      if (!updated) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Task not found' });
      }

      await recordTaskEvent({
        db: ctx.db,
        taskId: updated.id,
        careRecipientId: membership.careRecipientId,
        actorCaregiverId: caregiverId,
        type: 'reviewed',
        payload: {
          action: 'approved',
          from: before ?? null,
          to: { reviewState: 'approved' },
        },
      });

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
