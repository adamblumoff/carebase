import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { GoogleSyncSummary } from '../services/googleSync.js';

process.env.GOOGLE_SYNC_ENABLE_TEST = 'true';
process.env.GOOGLE_SYNC_DEBOUNCE_MS = '0';
process.env.GOOGLE_SYNC_RETRY_BASE_MS = '10';
process.env.GOOGLE_SYNC_RETRY_MAX_MS = '50';

const googleSync = await import('../services/googleSync.js');
const {
  scheduleGoogleSyncForUser,
  __setGoogleSyncRunnerForTests,
  __resetGoogleSyncStateForTests,
  __setGoogleSyncLockBehaviorForTests
} = googleSync;

const queries = await import('../db/queries.js');
const {
  touchPlanForUser,
  __testTouchPlanForItem,
  __setGoogleSyncSchedulerForTests
} = queries as unknown as {
  touchPlanForUser: (userId: number) => Promise<void>;
  __testTouchPlanForItem: (itemId: number) => Promise<void>;
  __setGoogleSyncSchedulerForTests: (scheduler: ((userId: number) => void) | null) => void;
};

const dbClientModule = await import('../db/client.js');
const dbAny = dbClientModule.default as unknown as {
  query: (text: string, params?: any[]) => Promise<any>;
};

const realtimeModule = await import('../services/realtime.js');
const { __setRealtimeEmitterForTests } = realtimeModule as unknown as {
  __setRealtimeEmitterForTests: (emitter: { emitPlanUpdate(userId: number): void } | null) => void;
};

function createSummary(): GoogleSyncSummary {
  return { pushed: 0, pulled: 0, deleted: 0, errors: [], calendarId: 'primary' };
}

await test('google sync scheduler coordination', async (t) => {
  await t.test('triggers once per enqueue', async () => {
    __resetGoogleSyncStateForTests();
    __setGoogleSyncLockBehaviorForTests({ disableLocks: true });
    let called = 0;
    __setGoogleSyncRunnerForTests(async (userId) => {
      called += 1;
      assert.equal(userId, 77);
      return createSummary();
    });

    scheduleGoogleSyncForUser(77, 0);
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(called, 1);
    __setGoogleSyncRunnerForTests();
    __resetGoogleSyncStateForTests();
  });

  await t.test('retries when advisory lock is busy', async () => {
    __resetGoogleSyncStateForTests();
    let runnerCalls = 0;
    let attempt = 0;

    __setGoogleSyncLockBehaviorForTests({
      acquireHook: async () => {
        attempt += 1;
        if (attempt === 1) {
          setTimeout(() => scheduleGoogleSyncForUser(555, 0), 0);
          return false;
        }
        return true;
      }
    });

    __setGoogleSyncRunnerForTests(async (userId) => {
      runnerCalls += 1;
      assert.equal(userId, 555);
      return createSummary();
    });

    scheduleGoogleSyncForUser(555, 0);

    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.ok(runnerCalls >= 1);

    __setGoogleSyncRunnerForTests();
    __resetGoogleSyncStateForTests();
  });

  await t.test('skips advisory lock when disabled', async () => {
    __resetGoogleSyncStateForTests();
    __setGoogleSyncLockBehaviorForTests({ disableLocks: true });
    let called = 0;
    __setGoogleSyncRunnerForTests(async (userId) => {
      called += 1;
      assert.equal(userId, 88);
      return createSummary();
    });

    scheduleGoogleSyncForUser(88, 0);
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(called, 1);

    __setGoogleSyncRunnerForTests();
    __resetGoogleSyncStateForTests();
  });
});

test('touchPlanForUser schedules a Google sync job', async () => {
  const originalQuery = dbAny.query;
  dbAny.query = async () => ({ rows: [], rowCount: 1, command: 'UPDATE', fields: [], oid: 0 });

  let scheduledUser: number | null = null;
  __setGoogleSyncSchedulerForTests((userId) => {
    scheduledUser = userId;
  });

  await touchPlanForUser(123);

  assert.equal(scheduledUser, 123);

  __setGoogleSyncSchedulerForTests(null);
  dbAny.query = originalQuery;
  __resetGoogleSyncStateForTests();
});

test('touchPlanForUser skips realtime and scheduler when no rows updated', async () => {
  const originalQuery = dbAny.query;
  dbAny.query = async () => ({ rows: [], rowCount: 0, command: 'UPDATE', fields: [], oid: 0 });

  let scheduledUser: number | null = null;
  __setGoogleSyncSchedulerForTests((userId) => {
    scheduledUser = userId;
  });

  let emitted = false;
  __setRealtimeEmitterForTests({
    emitPlanUpdate() {
      emitted = true;
    }
  });

  await touchPlanForUser(321);

  assert.equal(scheduledUser, null);
  assert.equal(emitted, false);

  __setGoogleSyncSchedulerForTests(null);
  __setRealtimeEmitterForTests(null);
  dbAny.query = originalQuery;
  __resetGoogleSyncStateForTests();
});

test('touchPlanForItem schedules a Google sync job when update returns owner', async () => {
  const originalQuery = dbAny.query;
  dbAny.query = async () => ({ rows: [{ id: 456 }], rowCount: 1, command: 'UPDATE', fields: [], oid: 0 });

  let scheduledUser: number | null = null;
  __setGoogleSyncSchedulerForTests((userId) => {
    scheduledUser = userId;
  });

  await __testTouchPlanForItem(999);

  assert.equal(scheduledUser, 456);

  __setGoogleSyncSchedulerForTests(null);
  dbAny.query = originalQuery;
  __resetGoogleSyncStateForTests();
});
