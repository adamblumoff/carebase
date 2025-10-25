import { describe, it } from 'vitest';
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
  __setRealtimeEmitterForTests: (emitter: { emitPlanItemDelta(userId: number, delta: unknown): void } | null) => void;
};

function createSummary(): GoogleSyncSummary {
  return { pushed: 0, pulled: 0, deleted: 0, errors: [], calendarId: 'primary' };
}

describe('google sync scheduler coordination', () => {
  it('triggers once per enqueue', async () => {
    __resetGoogleSyncStateForTests();
    __setGoogleSyncLockBehaviorForTests({ disableLocks: true });
    let called = 0;
    __setGoogleSyncRunnerForTests(async (userId) => {
      called += 1;
      assert.equal(userId, 77);
      return createSummary();
    });

    try {
      scheduleGoogleSyncForUser(77, 0);
      await new Promise((resolve) => setTimeout(resolve, 0));
      assert.equal(called, 1);
    } finally {
      __setGoogleSyncRunnerForTests();
      __resetGoogleSyncStateForTests();
      __setGoogleSyncLockBehaviorForTests({});
    }
  });

  it('retries when advisory lock is busy', async () => {
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

    try {
      scheduleGoogleSyncForUser(555, 0);
      await new Promise((resolve) => setTimeout(resolve, 50));
      assert.ok(runnerCalls >= 1);
    } finally {
      __setGoogleSyncRunnerForTests();
      __resetGoogleSyncStateForTests();
      __setGoogleSyncLockBehaviorForTests({});
    }
  });

  it('skips advisory lock when disabled', async () => {
    __resetGoogleSyncStateForTests();
    __setGoogleSyncLockBehaviorForTests({ disableLocks: true });
    let called = 0;
    __setGoogleSyncRunnerForTests(async (userId) => {
      called += 1;
      assert.equal(userId, 88);
      return createSummary();
    });

    try {
      scheduleGoogleSyncForUser(88, 0);
      await new Promise((resolve) => setTimeout(resolve, 0));
      assert.equal(called, 1);
    } finally {
      __setGoogleSyncRunnerForTests();
      __resetGoogleSyncStateForTests();
      __setGoogleSyncLockBehaviorForTests({});
    }
  });
});

describe('touchPlanForUser', () => {
  it('schedules a Google sync job', async () => {
    const originalQuery = dbAny.query;
    dbAny.query = async () => ({ rows: [], rowCount: 1, command: 'UPDATE', fields: [], oid: 0 });

    try {
      let scheduledUser: number | null = null;
      __setGoogleSyncSchedulerForTests((userId) => {
        scheduledUser = userId;
      });

      await touchPlanForUser(123);

      assert.equal(scheduledUser, 123);
    } finally {
      __setGoogleSyncSchedulerForTests(null);
      dbAny.query = originalQuery;
      __resetGoogleSyncStateForTests();
    }
  });

  it('skips realtime and scheduler when no rows updated', async () => {
    const originalQuery = dbAny.query;
    dbAny.query = async () => ({ rows: [], rowCount: 0, command: 'UPDATE', fields: [], oid: 0 });

    try {
      let scheduledUser: number | null = null;
      __setGoogleSyncSchedulerForTests((userId) => {
        scheduledUser = userId;
      });

      let deltaPayload: any = null;
      __setRealtimeEmitterForTests({
        emitPlanItemDelta(_userId: number, delta: unknown) {
          deltaPayload = delta;
        }
      });

      await touchPlanForUser(321);

      assert.equal(scheduledUser, null);
      assert.equal(deltaPayload, null);
    } finally {
      __setGoogleSyncSchedulerForTests(null);
      __setRealtimeEmitterForTests(null);
      dbAny.query = originalQuery;
      __resetGoogleSyncStateForTests();
    }
  });

  it('schedules a Google sync job when update returns owner', async () => {
    const originalQuery = dbAny.query;
    dbAny.query = async () => ({ rows: [{ id: 456 }], rowCount: 1, command: 'UPDATE', fields: [], oid: 0 });

    try {
      let scheduledUser: number | null = null;
      __setGoogleSyncSchedulerForTests((userId) => {
        scheduledUser = userId;
      });

      await __testTouchPlanForItem(789);

      assert.equal(scheduledUser, 456);
    } finally {
      __setGoogleSyncSchedulerForTests(null);
      dbAny.query = originalQuery;
      __resetGoogleSyncStateForTests();
    }
  });
});
