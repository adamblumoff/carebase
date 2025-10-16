import type { Request } from 'express';
import { z, type ZodTypeAny } from 'zod';
import { ValidationError } from './errors.js';

function parseWithSchema<T extends ZodTypeAny>(value: unknown, schema: T): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new ValidationError(result.error.format());
  }
  return result.data;
}

export function validateQuery<T extends ZodTypeAny>(req: Request, schema: T): z.infer<T> {
  return parseWithSchema(req.query, schema);
}

export function validateParams<T extends ZodTypeAny>(req: Request, schema: T): z.infer<T> {
  return parseWithSchema(req.params, schema);
}

export function validateBody<T extends ZodTypeAny>(req: Request, schema: T): z.infer<T> {
  return parseWithSchema(req.body, schema);
}
