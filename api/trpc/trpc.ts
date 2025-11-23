import { TRPCError, initTRPC } from '@trpc/server';
import { Context } from './context';

const t = initTRPC.context<Context>().create();

export const router = t.router;
export const procedure = t.procedure;
export const authedProcedure = t.procedure.use(
  t.middleware(({ ctx, next }) => {
    if (!ctx.auth?.userId) {
      throw new TRPCError({ code: 'UNAUTHORIZED' });
    }
    return next({ ctx: { ...ctx, auth: ctx.auth } });
  })
);
