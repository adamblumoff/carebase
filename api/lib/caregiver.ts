import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import { v5 as uuidv5 } from 'uuid';

import { caregivers } from '../db/schema';
import { Context } from '../trpc/context';

const USER_NAMESPACE = '6ba7b810-9dad-11d1-80b4-00c04fd430c8'; // DNS namespace; stable for deriving UUIDs

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
