import { inferAsyncReturnType } from '@trpc/server';
import { createClerkClient } from '@clerk/backend';
import type { CreateFastifyContextOptions } from '@trpc/server/adapters/fastify';
import { db } from '../db/client';

const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY ?? '' });

type AuthContext = {
  userId: string;
  sessionId: string | null;
  claims: Record<string, any>;
  token: string;
};

export const createContext = async ({ req }: CreateFastifyContextOptions) => {
  const authHeader = req.headers.authorization;
  const bearer = authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : undefined;

  let auth: AuthContext | null = null;

  if (bearer && process.env.CLERK_SECRET_KEY) {
    try {
      const verified = await clerk.verifyToken(bearer, { template: 'trpc' });
      auth = {
        userId: verified.sub,
        sessionId: (verified as any).sid ?? null,
        claims: verified as Record<string, any>,
        token: bearer,
      };
    } catch (error) {
      req.log?.warn({ err: error }, 'Failed to verify Clerk token');
    }
  }

  return {
    db,
    auth,
    req,
  };
};

export type Context = inferAsyncReturnType<typeof createContext>;
