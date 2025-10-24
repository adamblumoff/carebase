import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLAN_ITEM_DELTA_EVENT, type PlanItemDelta } from '@carebase/shared';
import { PlanRealtimePublisher } from './planRealtimePublisher.js';

class FakeIO {
  public events: Array<{ room: string; event: string; args: unknown[] }> = [];

  to(room: string) {
    return {
      emit: (event: string, ...args: unknown[]) => {
        this.events.push({ room, event, args });
      }
    };
  }
}

function nextTick(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(() => resolve());
  });
}

test('PlanRealtimePublisher batches item deltas per user', async () => {
  const io = new FakeIO();
  const publisher = new PlanRealtimePublisher(io as any);

  const deltaA: PlanItemDelta = {
    action: 'created',
    entityId: 10,
    itemType: 'appointment',
    version: 5,
    source: 'rest'
  };

  const deltaB: PlanItemDelta = {
    action: 'updated',
    entityId: 11,
    itemType: 'bill',
    version: 6,
    source: 'rest'
  };

  publisher.emitPlanItemDelta(7, deltaA);
  publisher.emitPlanItemDelta(7, deltaB);

  await nextTick();

  const deltaEvent = io.events.find((entry) => entry.event === PLAN_ITEM_DELTA_EVENT);
  assert.ok(deltaEvent, 'Expected plan:item-delta event to be emitted');
  assert.equal(deltaEvent?.room, 'user:7');
  assert.equal(Array.isArray(deltaEvent?.args[0]?.deltas), true);
  const payload = deltaEvent?.args[0] as { deltas: PlanItemDelta[] };
  assert.equal(payload.deltas.length, 2);
});

test('PlanRealtimePublisher deduplicates deltas for the same item within a tick', async () => {
  const io = new FakeIO();
  const publisher = new PlanRealtimePublisher(io as any);

  const first: PlanItemDelta = {
    action: 'created',
    entityId: 12,
    itemType: 'appointment',
    version: 7,
    source: 'rest'
  };
  const second: PlanItemDelta = {
    action: 'updated',
    entityId: 12,
    itemType: 'appointment',
    version: 8,
    source: 'rest',
    data: { summary: 'Updated summary' }
  };

  publisher.emitPlanItemDelta(3, first);
  publisher.emitPlanItemDelta(3, second);

  await nextTick();

  const deltaEvent = io.events.find((entry) => entry.event === PLAN_ITEM_DELTA_EVENT);
  assert.ok(deltaEvent);
  const payload = deltaEvent?.args[0] as { deltas: PlanItemDelta[] };
  assert.equal(payload.deltas.length, 1);
  assert.equal(payload.deltas[0]?.action, 'updated');
  assert.equal(payload.deltas[0]?.version, 8);
  assert.deepEqual(payload.deltas[0]?.data, { summary: 'Updated summary' });
});
