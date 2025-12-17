import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';

import { careRecipientMemberships, caregivers } from '../db/schema';
import { Context } from '../trpc/context';
import { ensureCaregiver } from './caregiver';

export type CareRecipientRole = 'owner' | 'viewer';

export type CareRecipientMembership = {
  caregiverId: string;
  careRecipientId: string;
  role: CareRecipientRole;
};

export async function getCareRecipientMembership(ctx: Context) {
  const caregiverId = await ensureCaregiver(ctx);

  const [membership] = await ctx.db
    .select({
      caregiverId: careRecipientMemberships.caregiverId,
      careRecipientId: careRecipientMemberships.careRecipientId,
      role: careRecipientMemberships.role,
    })
    .from(careRecipientMemberships)
    .where(eq(careRecipientMemberships.caregiverId, caregiverId))
    .limit(1);

  return { caregiverId, membership: membership ?? null };
}

export async function requireCareRecipientMembership(
  ctx: Context
): Promise<CareRecipientMembership> {
  const { caregiverId, membership } = await getCareRecipientMembership(ctx);
  if (!membership) {
    throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Care recipient not set up' });
  }
  if (membership.caregiverId !== caregiverId) {
    throw new TRPCError({ code: 'FORBIDDEN' });
  }
  return membership as CareRecipientMembership;
}

export async function requireOwnerRole(ctx: Context): Promise<CareRecipientMembership> {
  const membership = await requireCareRecipientMembership(ctx);
  if (membership.role !== 'owner') {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Owner access required' });
  }
  return membership;
}

export async function ensureNoMembership(ctx: Context) {
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

  return caregiverId;
}

export async function listCareTeam(ctx: Context, careRecipientId: string) {
  return ctx.db
    .select({
      caregiverId: caregivers.id,
      name: caregivers.name,
      email: caregivers.email,
      role: careRecipientMemberships.role,
    })
    .from(careRecipientMemberships)
    .innerJoin(caregivers, eq(caregivers.id, careRecipientMemberships.caregiverId))
    .where(eq(careRecipientMemberships.careRecipientId, careRecipientId));
}

export async function validateInvitationStillUsable({
  usedAt,
  expiresAt,
}: {
  usedAt: Date | null;
  expiresAt: Date | null;
}) {
  if (usedAt) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invite already used' });
  }
  if (expiresAt && expiresAt.getTime() <= Date.now()) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invite expired' });
  }
}

export const INVITE_TOKEN_BYTES = 16;

export const isInviteToken = (token: string) => token.length >= 12 && token.length <= 64;
