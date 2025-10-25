import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalEnv = { ...process.env };

async function loadMetricsModule() {
  return await vi.importActual<typeof import('../metrics.js')>('../metrics.js');
}

beforeEach(() => {
  vi.restoreAllMocks();
  Object.assign(process.env, originalEnv);
});

afterEach(() => {
  Object.assign(process.env, originalEnv);
});

describe('metrics utilities', () => {
  it('increments and gauges values with formatted tags', async () => {
    vi.resetModules();
    delete process.env.METRICS_FLUSH_INTERVAL_MS;
    const metrics = await loadMetricsModule();
    metrics.__resetMetricsForTests();
    const increment = metrics.incrementMetric;
    const gauge = metrics.gaugeMetric;
    const flush = metrics.flushMetrics;
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    increment('requests_total', 1, { route: '/api', success: true });
    gauge('queue_depth', 5);
    flush();

    expect(consoleSpy).toHaveBeenCalledWith('[Metrics] Manual flush', expect.arrayContaining([
      { key: 'queue_depth', value: 5 },
      { key: 'requests_total|route=/api,success=true', value: 1 }
    ]));
  });

  it('starts interval flush when METRICS_FLUSH_INTERVAL_MS is positive', async () => {
    vi.resetModules();
    process.env.METRICS_FLUSH_INTERVAL_MS = '5';
    const metrics = await loadMetricsModule();
    metrics.__resetMetricsForTests();
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    vi.useFakeTimers();
    metrics.incrementMetric('background_job');
    await vi.advanceTimersByTimeAsync(5);
    vi.useRealTimers();

    expect(consoleSpy).toHaveBeenCalledWith('[Metrics] Flush counters', expect.arrayContaining([
      expect.objectContaining({ key: 'background_job', value: 1 })
    ]));
  });
});
