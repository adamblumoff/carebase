export const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

export class Ticker {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly intervalMs: number,
    private readonly fn: () => Promise<void>
  ) {}

  start(runImmediately = false) {
    if (this.timer) return;
    const tick = async () => {
      try {
        await this.fn();
      } catch (err) {
        // Prevent unhandled rejections from crashing the process (Node 15+ default).
        console.error('Ticker task failed', err);
      } finally {
        this.timer = setTimeout(tick, this.intervalMs);
      }
    };

    if (runImmediately) {
      void tick();
    } else {
      this.timer = setTimeout(tick, this.intervalMs);
    }
  }

  stop() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
