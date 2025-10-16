import type { User } from '@carebase/shared';
import { db, getRealtimeEmitter } from './shared.js';

let planVersionColumnsEnsured = false;
let planVersionEnsurePromise: Promise<void> | null = null;

let scheduleGoogleSyncForUserFn: ((userId: number, debounceMs?: number) => void) | null = null;

async function scheduleGoogleSync(userId: number): Promise<void> {
  try {
    if (!scheduleGoogleSyncForUserFn) {
      const mod = await import('../../services/googleSync.js');
      scheduleGoogleSyncForUserFn = mod.scheduleGoogleSyncForUser;
    }
    scheduleGoogleSyncForUserFn?.(userId);
  } catch (error) {
    console.error('Failed to schedule Google sync for user', userId, error);
  }
}

export function __setGoogleSyncSchedulerForTests(scheduler: ((userId: number) => void) | null): void {
  scheduleGoogleSyncForUserFn = scheduler;
}

async function ensurePlanVersionColumns(): Promise<void> {
  if (planVersionColumnsEnsured) {
    return;
  }

  if (!planVersionEnsurePromise) {
    planVersionEnsurePromise = (async () => {
      try {
        await db.query(
          'ALTER TABLE users ADD COLUMN IF NOT EXISTS plan_version INTEGER NOT NULL DEFAULT 0'
        );
        await db.query(
          'ALTER TABLE users ADD COLUMN IF NOT EXISTS plan_updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP'
        );
      } catch (error) {
        console.error('Failed to ensure plan version columns:', error);
      } finally {
        planVersionColumnsEnsured = true;
      }
    })();
  }

  await planVersionEnsurePromise;
}

async function touchPlanForItem(itemId: number): Promise<void> {
  await ensurePlanVersionColumns();
  const result = await db.query(
    `UPDATE users u
     SET plan_version = COALESCE(u.plan_version, 0) + 1,
         plan_updated_at = NOW()
    FROM recipients r
    JOIN items i ON i.recipient_id = r.id
     WHERE i.id = $1
       AND r.user_id = u.id
     RETURNING u.id`,
    [itemId]
  );
  const userRow = result.rows[0];
  if (userRow?.id) {
    const realtime = getRealtimeEmitter();
    realtime?.emitPlanUpdate(userRow.id as number);
    await scheduleGoogleSync(userRow.id as number);
  }
}

export const __testTouchPlanForItem = touchPlanForItem;
export { touchPlanForItem };

export async function touchPlanForUser(userId: number): Promise<void> {
  await ensurePlanVersionColumns();
  const result = await db.query(
    `UPDATE users
     SET plan_version = COALESCE(plan_version, 0) + 1,
         plan_updated_at = NOW()
     WHERE id = $1`,
    [userId]
  );
  if (result.rowCount === 0) {
    return;
  }
  const realtime = getRealtimeEmitter();
  realtime?.emitPlanUpdate(userId);
  await scheduleGoogleSync(userId);
}

export async function getPlanVersion(userId: number): Promise<{ planVersion: number; planUpdatedAt: Date | null }> {
  await ensurePlanVersionColumns();
  const result = await db.query(
    `SELECT plan_version, plan_updated_at
     FROM users
     WHERE id = $1`,
    [userId]
  );

  if (result.rows.length === 0) {
    return { planVersion: 0, planUpdatedAt: null };
  }

  const row = result.rows[0] as { plan_version: number | null; plan_updated_at: Date | null };
  return {
    planVersion: row.plan_version ?? 0,
    planUpdatedAt: row.plan_updated_at ?? null
  };
}
