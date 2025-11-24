import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { createOAuthClient, googleScope, hasGoogleConfig, signState } from '../../lib/google';
import { ensureCaregiver } from '../../lib/caregiver';
import { sources } from '../../db/schema';
import { authedProcedure, router } from '../../trpc/trpc';

export const sourcesRouter = router({
  list: authedProcedure.query(async ({ ctx }) => {
    const caregiverId = await ensureCaregiver(ctx);
    return ctx.db.select().from(sources).where(eq(sources.caregiverId, caregiverId));
  }),

  authorizeUrl: authedProcedure
    .input(z.object({ redirectUri: z.string().url().optional() }).optional())
    .query(async ({ ctx, input }) => {
      if (!hasGoogleConfig()) {
        throw new TRPCError({ code: 'FAILED_PRECONDITION', message: 'Google config missing' });
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
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (!hasGoogleConfig()) {
        throw new TRPCError({
          code: 'FAILED_PRECONDITION',
          message: 'Google OAuth env vars are missing',
        });
      }

      const caregiverId = await ensureCaregiver(ctx);

      const client = createOAuthClient();
      client.redirectUri = input.redirectUri;

      const { tokens } = await client.getToken({ code: input.code, scope: googleScope });

      if (!tokens.refresh_token) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'No refresh token returned; ensure prompt=consent access_type=offline',
        });
      }

      const tokenInfo = await client.getTokenInfo(tokens.access_token ?? '');
      const accountEmail = tokenInfo.email ?? 'unknown';

      const [row] = await ctx.db
        .insert(sources)
        .values({
          caregiverId,
          provider: 'gmail',
          accountEmail,
          refreshToken: tokens.refresh_token,
          scopes: googleScope,
          status: 'active',
        })
        .onConflictDoUpdate({
          target: [sources.caregiverId, sources.provider, sources.accountEmail],
          set: {
            refreshToken: tokens.refresh_token,
            scopes: googleScope,
            status: 'active',
            updatedAt: new Date(),
          },
        })
        .returning();

      return row;
    }),

  disconnect: authedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const caregiverId = await ensureCaregiver(ctx);
      const [updated] = await ctx.db
        .update(sources)
        .set({ status: 'disconnected', updatedAt: new Date() })
        .where(eq(sources.id, input.id))
        .returning();

      if (!updated || updated.caregiverId !== caregiverId) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Source not found' });
      }

      return { id: updated.id, status: updated.status };
    }),
});
