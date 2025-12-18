import { and, desc, eq, gte, lt, or, sql } from 'drizzle-orm';
import { z } from 'zod';

import { caregivers, careRecipients, handoffNotes, taskAssignments, tasks } from '../../db/schema';
import { requireCareRecipientMembership } from '../../lib/careRecipient';
import { dayBoundsUtc, localDateString } from '../../lib/timezone';
import { authedProcedure, router } from '../../trpc/trpc';

const selectTask = {
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

const listLimitInput = z
  .object({
    limit: z.number().int().min(1).max(50).default(12),
  })
  .optional();

export const todayRouter = router({
  feed: authedProcedure.input(listLimitInput).query(async ({ ctx, input }) => {
    const membership = await requireCareRecipientMembership(ctx);
    const now = new Date();
    const limit = input?.limit ?? 12;

    const [profile] = await ctx.db
      .select({
        caregiverTimezone: caregivers.timezone,
        hubTimezone: careRecipients.timezone,
      })
      .from(caregivers)
      .innerJoin(careRecipients, eq(careRecipients.id, membership.careRecipientId))
      .where(eq(caregivers.id, membership.caregiverId))
      .limit(1);

    const caregiverTimezone = profile?.caregiverTimezone ?? 'UTC';
    const hubTimezone = profile?.hubTimezone ?? 'UTC';

    const { startUtc: startOfTodayUtc, endUtc: startOfTomorrowUtc } = dayBoundsUtc({
      timeZone: caregiverTimezone,
      now,
    });
    const upcomingEndUtc = new Date(startOfTodayUtc.getTime() + 7 * 24 * 60 * 60 * 1000);
    const recentCompletedStartUtc = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const baseVisiblePredicate = and(
      eq(tasks.careRecipientId, membership.careRecipientId),
      sql`${tasks.reviewState} != 'ignored'`
    );

    const [needsReview, dueToday, upcoming, assignedToMe, recentlyCompleted] = await Promise.all([
      ctx.db
        .select(selectTask)
        .from(tasks)
        .leftJoin(taskAssignments, eq(taskAssignments.taskId, tasks.id))
        .where(and(baseVisiblePredicate, eq(tasks.reviewState, 'pending')))
        .orderBy(desc(tasks.createdAt))
        .limit(limit),

      ctx.db
        .select(selectTask)
        .from(tasks)
        .leftJoin(taskAssignments, eq(taskAssignments.taskId, tasks.id))
        .where(
          and(
            baseVisiblePredicate,
            sql`${tasks.status} != 'done'`,
            or(
              and(
                eq(tasks.type, 'appointment'),
                gte(tasks.startAt, startOfTodayUtc),
                lt(tasks.startAt, startOfTomorrowUtc)
              ),
              and(gte(tasks.dueAt, startOfTodayUtc), lt(tasks.dueAt, startOfTomorrowUtc))
            )
          )
        )
        .orderBy(sql`COALESCE(${tasks.startAt}, ${tasks.dueAt}) ASC NULLS LAST`)
        .limit(limit),

      ctx.db
        .select(selectTask)
        .from(tasks)
        .leftJoin(taskAssignments, eq(taskAssignments.taskId, tasks.id))
        .where(
          and(
            baseVisiblePredicate,
            sql`${tasks.status} != 'done'`,
            or(
              and(
                eq(tasks.type, 'appointment'),
                gte(tasks.startAt, now),
                lt(tasks.startAt, upcomingEndUtc)
              ),
              and(gte(tasks.dueAt, now), lt(tasks.dueAt, upcomingEndUtc))
            )
          )
        )
        .orderBy(sql`COALESCE(${tasks.startAt}, ${tasks.dueAt}) ASC NULLS LAST`)
        .limit(limit),

      ctx.db
        .select(selectTask)
        .from(tasks)
        .innerJoin(taskAssignments, eq(taskAssignments.taskId, tasks.id))
        .where(
          and(
            baseVisiblePredicate,
            sql`${tasks.status} != 'done'`,
            eq(taskAssignments.caregiverId, membership.caregiverId)
          )
        )
        .orderBy(desc(tasks.updatedAt))
        .limit(limit),

      ctx.db
        .select(selectTask)
        .from(tasks)
        .leftJoin(taskAssignments, eq(taskAssignments.taskId, tasks.id))
        .where(
          and(
            baseVisiblePredicate,
            eq(tasks.status, 'done'),
            gte(tasks.updatedAt, recentCompletedStartUtc)
          )
        )
        .orderBy(desc(tasks.updatedAt))
        .limit(limit),
    ]);

    const hubLocalDate = localDateString({ timeZone: hubTimezone, now });
    const [handoff] = await ctx.db
      .select({
        id: handoffNotes.id,
        body: handoffNotes.body,
        localDate: handoffNotes.localDate,
        updatedAt: handoffNotes.updatedAt,
        updatedByCaregiverId: handoffNotes.updatedByCaregiverId,
      })
      .from(handoffNotes)
      .where(
        and(
          eq(handoffNotes.careRecipientId, membership.careRecipientId),
          eq(handoffNotes.localDate, hubLocalDate)
        )
      )
      .limit(1);

    return {
      caregiverTimezone,
      hubTimezone,
      hubLocalDate,
      handoff: handoff ?? null,
      needsReview,
      dueToday,
      upcoming,
      assignedToMe,
      recentlyCompleted,
    };
  }),
});
