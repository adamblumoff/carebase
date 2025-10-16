import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { HttpError } from './errors.js';

export function route(handler: (req: Request, res: Response) => Promise<void>): RequestHandler {
  return async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    try {
      await handler(req, res);
    } catch (error) {
      handleError(error, res);
    }
  };
}

function handleError(error: unknown, res: Response): void {
  if (error instanceof HttpError) {
    if (error.status >= 500) {
      console.error(error);
    }
    res.status(error.status).json({ error: error.message, details: error.details });
    return;
  }

  console.error('Unhandled error in route handler:', error);
  res.status(500).json({ error: 'Internal server error' });
}
