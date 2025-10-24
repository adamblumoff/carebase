import type { PlanItemDelta } from '@carebase/shared';

export interface RealtimeEmitter {
  emitPlanItemDelta(userId: number, delta: PlanItemDelta): void;
}

let currentEmitter: RealtimeEmitter | null = null;

export function setRealtimeEmitter(emitter: RealtimeEmitter | null): void {
  currentEmitter = emitter;
}

export function getRealtimeEmitter(): RealtimeEmitter | null {
  return currentEmitter;
}

export function __setRealtimeEmitterForTests(emitter: RealtimeEmitter | null): void {
  setRealtimeEmitter(emitter);
}
