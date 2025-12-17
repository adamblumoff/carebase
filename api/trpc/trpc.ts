import { TRPCError, initTRPC } from '@trpc/server';
import { Context } from './context';

const t = initTRPC.context<Context>().create();

export const router = t.router;

const logErrorsMiddleware = t.middleware(async ({ ctx, path, type, rawInput, next }) => {
  const result = await next();
  if (!result.ok) {
    ctx.req?.log?.error?.(
      { err: result.error, path, type, input: rawInput },
      'trpc request failed'
    );
  }
  return result;
});

export const procedure = t.procedure.use(logErrorsMiddleware);
export const authedProcedure = procedure.use(
  t.middleware(({ ctx, next }) => {
    if (!ctx.auth?.userId) {
      throw new TRPCError({ code: 'UNAUTHORIZED' });
    }
    return next({ ctx: { ...ctx, auth: ctx.auth } });
  })
);
