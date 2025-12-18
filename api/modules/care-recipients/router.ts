import { TRPCError } from '@trpc/server';
import { and, eq, isNull } from 'drizzle-orm';
import { randomBytes } from 'crypto';
import { z } from 'zod';

import {
  careInvitations,
  careRecipientMemberships,
  careRecipients,
  caregivers,
  tasks,
} from '../../db/schema';
import { ensureCaregiver } from '../../lib/caregiver';
import { isValidIanaTimeZone } from '../../lib/timezone';
import {
  INVITE_TOKEN_BYTES,
  listCareTeam,
  requireCareRecipientMembership,
  requireOwnerRole,
  validateInvitationStillUsable,
} from '../../lib/careRecipient';
import { authedProcedure, router } from '../../trpc/trpc';

const createInput = z.object({
  name: z.string().min(1).max(120),
  caregiverName: z.string().min(1).max(80).optional(),
  timezone: z.string().min(1).max(64).optional(),
});

const inviteInput = z.object({
  email: z.string().email().optional(),
});

const acceptInviteInput = z.object({
  token: z.string().min(8).max(64),
  caregiverName: z.string().min(1).max(80).optional(),
  timezone: z.string().min(1).max(64).optional(),
});

export const careRecipientsRouter = router({
  my: authedProcedure.query(async ({ ctx }) => {
    const membership = await requireCareRecipientMembership(ctx);
    const [recipient] = await ctx.db
      .select({
        id: careRecipients.id,
        name: careRecipients.name,
        timezone: careRecipients.timezone,
      })
      .from(careRecipients)
      .where(eq(careRecipients.id, membership.careRecipientId))
      .limit(1);

    if (!recipient) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Care recipient not found' });
    }

    return {
      careRecipient: recipient,
      membership,
    };
  }),

  create: authedProcedure.input(createInput).mutation(async ({ ctx, input }) => {
    const caregiverId = await ensureCaregiver(ctx);

    const [existing] = await ctx.db
      .select({ id: careRecipientMemberships.id })
      .from(careRecipientMemberships)
      .where(eq(careRecipientMemberships.caregiverId, caregiverId))
      .limit(1);

    if (existing) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: 'Care recipient already set',
      });
    }

    const now = new Date();
    if (input.caregiverName) {
      await ctx.db
        .update(caregivers)
        .set({ name: input.caregiverName.trim() })
        .where(eq(caregivers.id, caregiverId));
    }

    if (input.timezone) {
      if (!isValidIanaTimeZone(input.timezone)) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid timezone' });
      }
      await ctx.db
        .update(caregivers)
        .set({ timezone: input.timezone })
        .where(eq(caregivers.id, caregiverId));
    }

    const timezone =
      input.timezone ??
      (
        await ctx.db
          .select({ timezone: caregivers.timezone })
          .from(caregivers)
          .where(eq(caregivers.id, caregiverId))
          .limit(1)
      )[0]?.timezone ??
      'UTC';

    const [recipient] = await ctx.db
      .insert(careRecipients)
      .values({ name: input.name.trim(), timezone, createdAt: now })
      .returning({
        id: careRecipients.id,
        name: careRecipients.name,
        timezone: careRecipients.timezone,
      });

    await ctx.db.insert(careRecipientMemberships).values({
      careRecipientId: recipient.id,
      caregiverId,
      role: 'owner',
      createdAt: now,
    });

    // Backfill existing tasks created by this caregiver so their list doesn't go empty after scoping.
    await ctx.db
      .update(tasks)
      .set({ careRecipientId: recipient.id, updatedAt: now })
      .where(and(eq(tasks.createdById, caregiverId), isNull(tasks.careRecipientId)));

    return {
      careRecipient: recipient,
      membership: { caregiverId, careRecipientId: recipient.id, role: 'owner' as const },
    };
  }),

  team: authedProcedure.query(async ({ ctx }) => {
    const membership = await requireCareRecipientMembership(ctx);
    return listCareTeam(ctx, membership.careRecipientId);
  }),

  invite: authedProcedure.input(inviteInput).mutation(async ({ ctx, input }) => {
    const membership = await requireOwnerRole(ctx);
    const caregiverId = membership.caregiverId;

    const token = randomBytes(INVITE_TOKEN_BYTES).toString('base64url');
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);

    const [invite] = await ctx.db
      .insert(careInvitations)
      .values({
        token,
        careRecipientId: membership.careRecipientId,
        invitedByCaregiverId: caregiverId,
        invitedEmail: input.email?.toLowerCase() ?? null,
        role: 'viewer',
        createdAt: now,
        expiresAt,
      })
      .returning({
        token: careInvitations.token,
        expiresAt: careInvitations.expiresAt,
      });

    return invite;
  }),

  acceptInvite: authedProcedure.input(acceptInviteInput).mutation(async ({ ctx, input }) => {
    const caregiverId = await ensureCaregiver(ctx);

    const [existing] = await ctx.db
      .select({ id: careRecipientMemberships.id })
      .from(careRecipientMemberships)
      .where(eq(careRecipientMemberships.caregiverId, caregiverId))
      .limit(1);

    if (existing) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: 'Care recipient already set',
      });
    }

    const [invite] = await ctx.db
      .select()
      .from(careInvitations)
      .where(eq(careInvitations.token, input.token))
      .limit(1);

    if (!invite) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Invite not found' });
    }

    await validateInvitationStillUsable({
      usedAt: invite.usedAt ?? null,
      expiresAt: invite.expiresAt ?? null,
    });

    const now = new Date();
    if (input.caregiverName) {
      await ctx.db
        .update(caregivers)
        .set({ name: input.caregiverName.trim() })
        .where(eq(caregivers.id, caregiverId));
    }

    if (input.timezone) {
      if (!isValidIanaTimeZone(input.timezone)) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid timezone' });
      }
      await ctx.db
        .update(caregivers)
        .set({ timezone: input.timezone })
        .where(eq(caregivers.id, caregiverId));
    }

    await ctx.db.insert(careRecipientMemberships).values({
      careRecipientId: invite.careRecipientId,
      caregiverId,
      role: invite.role,
      createdAt: now,
    });

    // Backfill any existing tasks created by this caregiver into the joined hub.
    await ctx.db
      .update(tasks)
      .set({ careRecipientId: invite.careRecipientId, updatedAt: now })
      .where(and(eq(tasks.createdById, caregiverId), isNull(tasks.careRecipientId)));

    await ctx.db
      .update(careInvitations)
      .set({ usedAt: now, usedByCaregiverId: caregiverId })
      .where(and(eq(careInvitations.id, invite.id), isNull(careInvitations.usedAt)));

    const [recipient] = await ctx.db
      .select({
        id: careRecipients.id,
        name: careRecipients.name,
        timezone: careRecipients.timezone,
      })
      .from(careRecipients)
      .where(eq(careRecipients.id, invite.careRecipientId))
      .limit(1);

    if (!recipient) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Care recipient not found' });
    }

    return {
      careRecipient: recipient,
      membership: { caregiverId, careRecipientId: recipient.id, role: invite.role },
    };
  }),
});
