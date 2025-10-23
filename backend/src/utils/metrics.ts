const counters = new Map<string, number>();

const INTERVAL_MS = Number.parseInt(process.env.METRICS_FLUSH_INTERVAL_MS ?? '60000', 10);
let timer: NodeJS.Timeout | null = null;

function formatKey(name: string, tags?: Record<string, string | number | boolean>): string {
  if (!tags || Object.keys(tags).length === 0) {
    return name;
  }
  const serialized = Object.entries(tags)
    .map(([key, value]) => `${key}=${String(value)}`)
    .sort()
    .join(',');
  return `${name}|${serialized}`;
}

function ensureTimer(): void {
  if (timer || INTERVAL_MS <= 0) {
    return;
  }

  timer = setInterval(() => {
    if (counters.size === 0) {
      return;
    }

    const payload = Array.from(counters.entries()).map(([key, value]) => ({ key, value }));
    console.log('[Metrics] Flush counters', payload);
    counters.clear();
  }, INTERVAL_MS);

  if (timer.unref) {
    timer.unref();
  }
}

export function incrementMetric(
  name: string,
  value = 1,
  tags?: Record<string, string | number | boolean>
): void {
  const key = formatKey(name, tags);
  counters.set(key, (counters.get(key) ?? 0) + value);
  ensureTimer();
}

export function gaugeMetric(
  name: string,
  value: number,
  tags?: Record<string, string | number | boolean>
): void {
  const key = formatKey(name, tags);
  counters.set(key, value);
  ensureTimer();
}

export function flushMetrics(): void {
  if (counters.size === 0) {
    return;
  }
  const payload = Array.from(counters.entries()).map(([key, value]) => ({ key, value }));
  console.log('[Metrics] Manual flush', payload);
  counters.clear();
}

export function __resetMetricsForTests(): void {
  counters.clear();
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
