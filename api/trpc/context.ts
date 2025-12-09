import { inferAsyncReturnType } from '@trpc/server';
import { verifyToken } from '@clerk/backend';
import { db } from '../db/client';

type AuthContext = {
  userId: string;
  sessionId: string | null;
  claims: Record<string, any>;
  token: string;
};

type MaybeFastifyReq = {
  headers: Record<string, string | string[] | undefined>;
  log?: any;
};

export const createContext = async ({
  req,
  info,
}: {
  req: MaybeFastifyReq;
  info?: { connectionParams?: Record<string, any> };
}) => {
  const paramAuth =
    info?.connectionParams?.Authorization ||
    info?.connectionParams?.authorization ||
    info?.connectionParams?.authToken;

  const headerAuth = req.headers.authorization || (req.headers.Authorization as string | undefined);

  const authHeader = headerAuth || (typeof paramAuth === 'string' ? paramAuth : undefined);
  const bearer = authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : undefined;

  let auth: AuthContext | null = null;

  if (bearer && process.env.CLERK_SECRET_KEY) {
    try {
      const verified = await verifyToken(bearer, {
        secretKey: process.env.CLERK_SECRET_KEY,
        template: 'trpc',
      });
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
