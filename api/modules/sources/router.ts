import { TRPCError } from '@trpc/server';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import {
  createOAuthClient,
  googleScope,
  hasGoogleConfig,
  signState,
  verifyState,
  setOAuthRedirectUri,
} from '../../lib/google';
import { ensureCaregiver } from '../../lib/caregiver';
import { careRecipientMemberships, caregivers, sources } from '../../db/schema';
import { requireCareRecipientMembership, requireOwnerRole } from '../../lib/careRecipient';
import { authedProcedure, router } from '../../trpc/trpc';

export const sourcesRouter = router({
  list: authedProcedure.query(async ({ ctx }) => {
    const membership = await requireCareRecipientMembership(ctx);

    const memberRows = await ctx.db
      .select({ caregiverId: careRecipientMemberships.caregiverId })
      .from(careRecipientMemberships)
      .where(eq(careRecipientMemberships.careRecipientId, membership.careRecipientId));

    const caregiverIds = memberRows.map((m) => m.caregiverId);
    if (caregiverIds.length === 0) return [];

    return ctx.db
      .select({
        id: sources.id,
        caregiverId: sources.caregiverId,
        caregiverName: caregivers.name,
        provider: sources.provider,
        accountEmail: sources.accountEmail,
        status: sources.status,
        isPrimary: sources.isPrimary,
        lastSyncAt: sources.lastSyncAt,
        errorMessage: sources.errorMessage,
        watchExpiration: sources.watchExpiration,
        lastPushAt: sources.lastPushAt,
      })
      .from(sources)
      .innerJoin(caregivers, eq(caregivers.id, sources.caregiverId))
      .where(inArray(sources.caregiverId, caregiverIds));
  }),

  authorizeUrl: authedProcedure
    .input(z.object({ redirectUri: z.string().url().optional() }).optional())
    .query(async ({ ctx, input }) => {
      if (!hasGoogleConfig()) {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Google config missing' });
      }

      const caregiverId = await ensureCaregiver(ctx);

      // carry caregiver in state to allow backend-only exchange if app can't capture code
      const state = signState({ caregiverId });

      const client = createOAuthClient();
      if (input?.redirectUri) {
        client.redirectUri = input.redirectUri;
      }

      const url = client.generateAuthUrl({
        scope: googleScope,
        access_type: 'offline',
        prompt: 'consent',
        include_granted_scopes: true,
        state,
      });

      return { url };
    }),

  connectGoogle: authedProcedure
    .input(
      z.object({
        code: z.string().min(1),
        redirectUri: z.string().url(),
        state: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (!hasGoogleConfig()) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'Google OAuth env vars are missing',
        });
      }

      const caregiverId = await ensureCaregiver(ctx);
      const membership = await requireCareRecipientMembership(ctx);
      const parsedState = verifyState(input.state);
      if (parsedState.caregiverId !== caregiverId) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'State does not match caregiver' });
      }

      const client = createOAuthClient();
      setOAuthRedirectUri(client, input.redirectUri);

      const { tokens } = await client.getToken({ code: input.code, scope: googleScope });

      if (!tokens.refresh_token) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'No refresh token returned; ensure prompt=consent access_type=offline',
        });
      }

      const tokenInfo = await client.getTokenInfo(tokens.access_token ?? '');
      if (!tokenInfo.email) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to retrieve account email from Google token',
        });
      }
      const accountEmail = tokenInfo.email;

      const memberRows = await ctx.db
        .select({ caregiverId: careRecipientMemberships.caregiverId })
        .from(careRecipientMemberships)
        .where(eq(careRecipientMemberships.careRecipientId, membership.careRecipientId));
      const caregiverIds = memberRows.map((m) => m.caregiverId);

      const [primary] = caregiverIds.length
        ? await ctx.db
            .select({ id: sources.id })
            .from(sources)
            .where(
              and(
                inArray(sources.caregiverId, caregiverIds),
                eq(sources.provider, 'gmail'),
                eq(sources.isPrimary, true)
              )
            )
            .limit(1)
        : [];

      const shouldBecomePrimary = membership.role === 'owner' && !primary;

      const [row] = await ctx.db
        .insert(sources)
        .values({
          caregiverId,
          provider: 'gmail',
          accountEmail,
          refreshToken: tokens.refresh_token,
          scopes: googleScope,
          status: 'active',
          isPrimary: shouldBecomePrimary,
        })
        .onConflictDoUpdate({
          target: [sources.caregiverId, sources.provider, sources.accountEmail],
          set: {
            refreshToken: tokens.refresh_token,
            scopes: googleScope,
            status: 'active',
            isPrimary: shouldBecomePrimary ? true : sources.isPrimary,
            updatedAt: new Date(),
          },
        })
        .returning();

      return row;
    }),

  setPrimary: authedProcedure
    .input(z.object({ sourceId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const membership = await requireOwnerRole(ctx);

      const memberRows = await ctx.db
        .select({ caregiverId: careRecipientMemberships.caregiverId })
        .from(careRecipientMemberships)
        .where(eq(careRecipientMemberships.careRecipientId, membership.careRecipientId));
      const caregiverIds = memberRows.map((m) => m.caregiverId);
      if (caregiverIds.length === 0) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'No care team members found',
        });
      }

      const [source] = await ctx.db
        .select()
        .from(sources)
        .where(and(eq(sources.id, input.sourceId), inArray(sources.caregiverId, caregiverIds)))
        .limit(1);

      if (!source) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Source not found' });
      }

      const now = new Date();

      await ctx.db
        .update(sources)
        .set({ isPrimary: false, updatedAt: now })
        .where(
          and(eq(sources.provider, source.provider), inArray(sources.caregiverId, caregiverIds))
        );

      const [updated] = await ctx.db
        .update(sources)
        .set({ isPrimary: true, updatedAt: now })
        .where(eq(sources.id, source.id))
        .returning();

      return updated;
    }),

  disconnect: authedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const caregiverId = await ensureCaregiver(ctx);
      const membership = await requireCareRecipientMembership(ctx);

      const memberRows = await ctx.db
        .select({ caregiverId: careRecipientMemberships.caregiverId })
        .from(careRecipientMemberships)
        .where(eq(careRecipientMemberships.careRecipientId, membership.careRecipientId));
      const caregiverIds = memberRows.map((m) => m.caregiverId);

      const [source] = await ctx.db
        .select()
        .from(sources)
        .where(and(eq(sources.id, input.id), inArray(sources.caregiverId, caregiverIds)))
        .limit(1);

      if (!source) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Source not found' });
      }

      const canDisconnect = membership.role === 'owner' || source.caregiverId === caregiverId;
      if (!canDisconnect) {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }

      const [updated] = await ctx.db
        .update(sources)
        .set({ status: 'disconnected', isPrimary: false, updatedAt: new Date() })
        .where(eq(sources.id, input.id))
        .returning();

      return updated;
    }),
});
