import { getClient } from '../../db/client.js';
import { listGoogleConnectedUserIds } from '../../db/queries.js';
import { logError, logInfo, logWarn } from './logger.js';
import {
  refreshExpiringGoogleWatches,
  setWatchScheduleCallback,
  setWatchTestSchedulerOverride,
  resetWatchStateForTests
} from './watchers.js';
import type { GoogleSyncSummary, RetryState, SyncRunner } from './types.js';

interface RuntimeConfig {
  debounceMs: number;
  retryBaseMs: number;
  retryMaxMs: number;
  pollIntervalMs: number;
  enableSyncInTest: boolean;
  enablePollingFallback: boolean;
  isTestEnv: boolean;
}

let config: RuntimeConfig | null = null;

const debounceTimers = new Map<number, NodeJS.Timeout>();
const retryTimers = new Map<number, RetryState>();
const runningSyncs = new Set<number>();
const followUpRequested = new Set<number>();
let pollingTimer: NodeJS.Timeout | null = null;
let advisoryLocksSupported = true;
let locksDisabledForTests = false;
let lockHookForTests: ((userId: number) => boolean | Promise<boolean>) | null = null;
let syncRunner: SyncRunner | null = null;
let defaultSyncRunner: SyncRunner | null = null;
let testSchedulerOverride: ((userId: number, debounceMs: number) => void) | null = null;

export function initializeGoogleSyncRuntime(runtimeConfig: RuntimeConfig): void {
  config = runtimeConfig;
  setWatchScheduleCallback(scheduleGoogleSyncForUser);
}

export function setSyncRunner(runner: SyncRunner): void {
  syncRunner = runner;
  if (!defaultSyncRunner) {
    defaultSyncRunner = runner;
  }
}

function ensureConfig(): RuntimeConfig {
  if (!config) {
    throw new Error('Google sync runtime not initialized');
  }
  return config;
}

function ensureRunner(): SyncRunner {
  if (!syncRunner) {
    throw new Error('Google sync runner not configured');
  }
  return syncRunner;
}

function computeRetryDelay(userId: number): number {
  const { retryBaseMs, retryMaxMs } = ensureConfig();
  const current = retryTimers.get(userId);
  const attempt = (current?.attempt ?? 0) + 1;
  const delay = Math.min(retryBaseMs * 2 ** (attempt - 1), retryMaxMs);
  return delay;
}

export async function withSyncLock<T>(
  userId: number,
  action: () => Promise<T>
): Promise<{ acquired: boolean; value?: T }> {
  if (locksDisabledForTests) {
    const value = await action();
    return { acquired: true, value };
  }

  if (lockHookForTests) {
    const decision = await lockHookForTests(userId);
    if (!decision) {
      return { acquired: false };
    }
    const value = await action();
    return { acquired: true, value };
  }

  if (!advisoryLocksSupported) {
    const value = await action();
    return { acquired: true, value };
  }

  const client = await getClient();
  let acquired = false;
  let lockAttempted = false;
  try {
    try {
      const result = await client.query<{ acquired: boolean }>(
        'SELECT pg_try_advisory_lock($1::int, $2::int) AS acquired',
        [0x4753, userId]
      );
      lockAttempted = true;
      acquired = Boolean(result.rows[0]?.acquired);
    } catch (error) {
      if (
        error instanceof Error &&
        /pg_try_advisory_lock/.test(error.message ?? '')
      ) {
        advisoryLocksSupported = false;
        logWarn(
          'Postgres advisory locks unavailable; falling back to process-local sync coordination',
          error instanceof Error ? error.message : String(error)
        );
      } else {
        throw error;
      }
    }

    if (!lockAttempted || !advisoryLocksSupported) {
      const value = await action();
      return { acquired: true, value };
    }

    if (!acquired) {
      return { acquired: false };
    }

    const value = await action();
    return { acquired: true, value };
  } finally {
    if (acquired) {
      try {
        await client.query('SELECT pg_advisory_unlock($1::int, $2::int)', [0x4753, userId]);
      } catch (error) {
        logWarn(
          'Failed to release Google sync advisory lock',
          error instanceof Error ? error.message : String(error)
        );
      }
    }
    client.release();
  }
}

async function performSync(userId: number): Promise<void> {
  const cfg = ensureConfig();
  const runner = ensureRunner();

  if (runningSyncs.has(userId)) {
    followUpRequested.add(userId);
    return;
  }

  runningSyncs.add(userId);
  let lockAcquired = false;
  let summary: GoogleSyncSummary | null = null;
  try {
    const result = await withSyncLock(userId, async () => {
      lockAcquired = true;
      const syncSummary = await runner(userId, { pullRemote: true });
      retryTimers.delete(userId);
      return syncSummary;
    });

    if (!lockAcquired || !result.acquired) {
      logInfo('Skipped Google sync because advisory lock is held elsewhere', { userId });
      scheduleGoogleSyncForUser(userId, cfg.debounceMs);
      return;
    }

    summary = result.value ?? null;
    if (!summary) {
      return;
    }

    logInfo(
      `user=${userId} pushed=${summary.pushed} pulled=${summary.pulled} deleted=${summary.deleted} errors=${summary.errors.length}`
    );
  } catch (error) {
    if (!lockAcquired) {
      logWarn(
        `Google sync lock contention resulted in error`,
        error instanceof Error ? error.message : String(error)
      );
      scheduleGoogleSyncForUser(userId, cfg.debounceMs);
      return;
    }
    const delay = computeRetryDelay(userId);
    const message = error instanceof Error ? error.message : String(error);
    logError(`user=${userId} sync failed (${message}). Retrying in ${delay}ms`);
    const existing = retryTimers.get(userId);
    if (existing?.timer) {
      clearTimeout(existing.timer);
    }
    const timer = setTimeout(() => {
      retryTimers.delete(userId);
      void performSync(userId);
    }, delay);
    retryTimers.set(userId, { attempt: (existing?.attempt ?? 0) + 1, timer });
    return;
  } finally {
    runningSyncs.delete(userId);
  }

  if (followUpRequested.has(userId)) {
    followUpRequested.delete(userId);
    scheduleGoogleSyncForUser(userId);
  }
}

export function scheduleGoogleSyncForUser(userId: number, debounceMs?: number): void {
  const cfg = ensureConfig();
  const effectiveDebounce = debounceMs ?? cfg.debounceMs;

  logInfo('Scheduling Google sync', { userId, debounceMs: effectiveDebounce });

  if (testSchedulerOverride) {
    testSchedulerOverride(userId, effectiveDebounce);
    return;
  }
  if (cfg.isTestEnv && !cfg.enableSyncInTest) {
    return;
  }
  if (runningSyncs.has(userId)) {
    followUpRequested.add(userId);
    return;
  }

  const existing = debounceTimers.get(userId);
  if (existing) {
    clearTimeout(existing);
  }

  const retry = retryTimers.get(userId);
  if (retry?.timer) {
    clearTimeout(retry.timer);
  }
  retryTimers.delete(userId);

  if (effectiveDebounce <= 0) {
    debounceTimers.delete(userId);
    void performSync(userId);
    return;
  }

  const timer = setTimeout(() => {
    debounceTimers.delete(userId);
    void performSync(userId);
  }, effectiveDebounce);
  debounceTimers.set(userId, timer);
}

async function runGoogleSyncPolling(): Promise<void> {
  const cfg = ensureConfig();
  try {
    await refreshExpiringGoogleWatches();
    if (!cfg.enablePollingFallback) {
      return;
    }
    const userIds = await listGoogleConnectedUserIds();
    for (const userId of userIds) {
      scheduleGoogleSyncForUser(userId);
    }
  } catch (error) {
    logError('polling error', error instanceof Error ? error.message : error);
  }
}

export function startGoogleSyncPolling(): void {
  const cfg = ensureConfig();
  if (cfg.isTestEnv && !cfg.enableSyncInTest) {
    return;
  }
  if (pollingTimer) {
    return;
  }

  void runGoogleSyncPolling();

  pollingTimer = setInterval(() => {
    void runGoogleSyncPolling();
  }, cfg.pollIntervalMs);
}

export function stopGoogleSyncPolling(): void {
  if (pollingTimer) {
    clearInterval(pollingTimer);
    pollingTimer = null;
  }
}

export function __setGoogleSyncRunnerForTests(runner?: SyncRunner): void {
  if (runner) {
    setSyncRunner(runner);
  } else if (defaultSyncRunner) {
    syncRunner = defaultSyncRunner;
  }
}

export function __resetGoogleSyncStateForTests(): void {
  testSchedulerOverride = null;
  resetWatchStateForTests();
  debounceTimers.forEach((timer) => clearTimeout(timer));
  debounceTimers.clear();
  retryTimers.forEach(({ timer }) => timer && clearTimeout(timer));
  retryTimers.clear();
  runningSyncs.clear();
  followUpRequested.clear();
  advisoryLocksSupported = true;
  locksDisabledForTests = false;
  lockHookForTests = null;
  if (defaultSyncRunner) {
    syncRunner = defaultSyncRunner;
  }
}

export function __setGoogleSyncSchedulerForTests(
  scheduler: ((userId: number, debounceMs: number) => void) | null
): void {
  testSchedulerOverride = scheduler;
  setWatchTestSchedulerOverride(scheduler);
}

export function __setGoogleSyncLockBehaviorForTests(options?: {
  disableLocks?: boolean;
  acquireHook?: (userId: number) => boolean | Promise<boolean>;
}): void {
  locksDisabledForTests = options?.disableLocks ?? false;
  lockHookForTests = options?.acquireHook ?? null;
}
