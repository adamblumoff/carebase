type BackgroundTask = {
  label: string;
  run: () => Promise<void>;
};

const queue: BackgroundTask[] = [];
let running = false;

const runNext = () => {
  if (running) return;
  const next = queue.shift();
  if (!next) return;
  running = true;
  setImmediate(async () => {
    try {
      await next.run();
    } catch (error) {
      console.error(`Background task failed (${next.label})`, error);
    } finally {
      running = false;
      runNext();
    }
  });
};

export const enqueueBackgroundTask = (task: BackgroundTask) => {
  queue.push(task);
  runNext();
};
