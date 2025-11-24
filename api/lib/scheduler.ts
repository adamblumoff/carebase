export const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

export class Ticker {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly intervalMs: number,
    private readonly fn: () => Promise<void>
  ) {}

  start() {
    if (this.timer) return;
    const tick = async () => {
      try {
        await this.fn();
      } finally {
        this.timer = setTimeout(tick, this.intervalMs);
      }
    };
    this.timer = setTimeout(tick, this.intervalMs);
  }

  stop() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
