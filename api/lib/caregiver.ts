import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import { v5 as uuidv5 } from 'uuid';

import { caregivers } from '../db/schema';
import { Context } from '../trpc/context';

const USER_NAMESPACE = '6ba7b810-9dad-11d1-80b4-00c04fd430c8'; // DNS namespace; stable for deriving UUIDs

const claimString = (value: unknown) => (typeof value === 'string' && value.trim() ? value : null);

const inferEmailFromClaims = (claims: Record<string, any>) => {
  const direct =
    claimString(claims.email) ??
    claimString(claims.email_address) ??
    claimString(claims.primary_email) ??
    claimString(claims.primary_email_address);
  if (direct) return direct.toLowerCase();

  const arr = Array.isArray(claims.email_addresses) ? claims.email_addresses : null;
  const first =
    arr?.find((v: any) => claimString(v?.email_address))?.email_address ??
    arr?.find((v: any) => claimString(v)) ??
    null;
  return claimString(first)?.toLowerCase() ?? null;
};

const inferNameFromClaims = (claims: Record<string, any>, fallback: string) => {
  const full =
    claimString(claims.name) ??
    claimString(claims.full_name) ??
    claimString(claims.username) ??
    null;
  if (full) return full;

  const first = claimString(claims.given_name) ?? claimString(claims.first_name) ?? null;
  const last = claimString(claims.family_name) ?? claimString(claims.last_name) ?? null;
  const combined = `${first ?? ''} ${last ?? ''}`.trim();
  if (combined) return combined;

  return fallback;
};

// Ensure there is a caregiver row for the authenticated Clerk user and return its id.
export async function ensureCaregiver(ctx: Context) {
  const userId = ctx.auth?.userId;
  if (!userId) {
    throw new TRPCError({ code: 'UNAUTHORIZED' });
  }

  const caregiverId = uuidv5(userId, USER_NAMESPACE);

  const [existing] = await ctx.db
    .select({ id: caregivers.id })
    .from(caregivers)
    .where(eq(caregivers.id, caregiverId));

  if (existing) return caregiverId;

  const claims = ctx.auth?.claims ?? {};
  const email = inferEmailFromClaims(claims) ?? `${userId}@local`;
  const name = inferNameFromClaims(claims, userId);

  await ctx.db
    .insert(caregivers)
    .values({
      id: caregiverId,
      name,
      email,
    })
    .onConflictDoNothing();

  return caregiverId;
}
