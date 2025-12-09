import { EventEmitter } from 'events';

export type IngestionPushEvent = {
  caregiverId: string;
  sourceId: string;
  startedAt?: Date;
  finishedAt?: Date;
};

class IngestionEventBus extends EventEmitter {}

export const ingestionEventBus = new IngestionEventBus();

// Allow unbounded listeners (one per connected client).
ingestionEventBus.setMaxListeners(0);
