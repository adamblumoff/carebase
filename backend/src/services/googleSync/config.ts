const IS_TEST_ENV = process.env.NODE_ENV === 'test';

function parseDuration(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export interface GoogleSyncConfig {
  lookbackDays: number;
  debounceMs: number;
  retryBaseMs: number;
  retryMaxMs: number;
  pollIntervalMs: number;
  enableInTest: boolean;
  enablePollingFallback: boolean;
}

export function getGoogleSyncConfig(): GoogleSyncConfig {
  const enableInTest = process.env.GOOGLE_SYNC_ENABLE_TEST === 'true';
  const lookbackDays = parseDuration(process.env.GOOGLE_SYNC_LOOKBACK_DAYS, 30);
  const defaultDebounce = parseDuration(process.env.GOOGLE_SYNC_DEBOUNCE_MS, 15_000);
  const defaultRetryBase = parseDuration(process.env.GOOGLE_SYNC_RETRY_BASE_MS, 60_000);
  const defaultRetryMax = parseDuration(process.env.GOOGLE_SYNC_RETRY_MAX_MS, 300_000);
  const pollIntervalMs = parseDuration(process.env.GOOGLE_SYNC_POLL_INTERVAL_MS, 30 * 60 * 1000);
  const enablePollingFallback = process.env.GOOGLE_SYNC_ENABLE_POLLING_FALLBACK === 'true';

  const testAdjustments = IS_TEST_ENV && !enableInTest
    ? {
        debounceMs: 0,
        retryBaseMs: 1_000,
        retryMaxMs: 5_000
      }
    : null;

  return {
    lookbackDays,
    debounceMs: testAdjustments?.debounceMs ?? defaultDebounce,
    retryBaseMs: testAdjustments?.retryBaseMs ?? defaultRetryBase,
    retryMaxMs: testAdjustments?.retryMaxMs ?? defaultRetryMax,
    pollIntervalMs,
    enableInTest,
    enablePollingFallback
  };
}

export function isTestEnv(): boolean {
  return IS_TEST_ENV;
}
