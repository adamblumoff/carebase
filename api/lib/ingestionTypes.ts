import type { FastifyRequest } from 'fastify';
import type { DbClient } from '../db/client';

export type IngestionCtx = {
  db: DbClient;
  req?: FastifyRequest;
};
