import { PLAN_ITEM_DELTA_EVENT, type PlanItemDelta } from '@carebase/shared';
import type { Server as SocketIOServer } from 'socket.io';

const PLAN_UPDATE_EVENT = 'plan:update';

type PendingEntry = {
  timer: NodeJS.Immediate | null;
  deltas: Map<string, PlanItemDelta>;
};

const userRoom = (userId: number) => `user:${userId}`;

export class PlanRealtimePublisher {
  private readonly pending = new Map<number, PendingEntry>();

  constructor(private readonly io: SocketIOServer) {}

  emitPlanUpdate(userId: number): void {
    this.io.to(userRoom(userId)).emit(PLAN_UPDATE_EVENT);
  }

  emitPlanItemDelta(userId: number, delta: PlanItemDelta): void {
    const identifier = delta.planItemId ?? delta.entityId;
    const key = `${delta.itemType}:${identifier}`;
    let entry = this.pending.get(userId);
    if (!entry) {
      entry = { timer: null, deltas: new Map() };
      this.pending.set(userId, entry);
    }

    entry.deltas.set(key, { ...delta });
    if (!entry.timer) {
      entry.timer = setImmediate(() => {
        this.flushUser(userId);
      });
    }
  }

  clear(): void {
    for (const entry of this.pending.values()) {
      if (entry.timer) {
        clearImmediate(entry.timer);
      }
    }
    this.pending.clear();
  }

  private flushUser(userId: number): void {
    const entry = this.pending.get(userId);
    if (!entry) {
      return;
    }

    if (entry.timer) {
      clearImmediate(entry.timer);
      entry.timer = null;
    }

    if (entry.deltas.size === 0) {
      this.pending.delete(userId);
      return;
    }

    const deltas = Array.from(entry.deltas.values());
    entry.deltas.clear();
    this.pending.delete(userId);

    this.io.to(userRoom(userId)).emit(PLAN_ITEM_DELTA_EVENT, { deltas });
  }
}
