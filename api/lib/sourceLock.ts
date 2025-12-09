const locks = new Map<string, Promise<void>>();

/**
 * Run a task sequentially per source id to avoid overlapping syncs that can race
 * on historyId/calendarSyncToken updates.
 */
export async function withSourceLock<T>(sourceId: string, fn: () => Promise<T>): Promise<T> {
  const previous = locks.get(sourceId)?.catch(() => undefined) ?? Promise.resolve();

  const current = (async () => {
    await previous;
    return await fn();
  })();

  const currentSettled = current.then(
    () => undefined,
    () => undefined
  );
  locks.set(sourceId, currentSettled);

  try {
    return await current;
  } finally {
    if (locks.get(sourceId) === currentSettled) {
      locks.delete(sourceId);
    }
  }
}
