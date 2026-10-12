const ALPHA = 0.3;

/**
 * EMA of wall-clock duration per completed task.
 *
 * Only advances on a rising `completed` count: statusLine re-fires on every
 * session event, so sampling every push would flood the average with ~0ms
 * intervals and drive the ETA to zero.
 */
export class EtaEstimator {
  private ema: number | undefined;
  private lastCompleted = 0;
  private lastStamp: number | undefined;

  constructor(private readonly now: () => number = Date.now) {}

  update(completed: number, total: number): void {
    if (total <= 0 || completed < 0) {
      return;
    }
    const t = this.now();

    // Restart (new session, or list shrank/reset) — rebaseline, don't sample.
    if (completed < this.lastCompleted) {
      this.reset();
      this.lastCompleted = completed;
      this.lastStamp = t;
      return;
    }

    const advanced = completed - this.lastCompleted;
    if (advanced === 0) {
      // First sighting still needs a clock origin to measure the next step from.
      this.lastStamp ??= t;
      return;
    }

    if (this.lastStamp !== undefined) {
      const perTask = (t - this.lastStamp) / advanced;
      if (perTask > 0) {
        this.ema = this.ema === undefined ? perTask : ALPHA * perTask + (1 - ALPHA) * this.ema;
      }
    }
    this.lastCompleted = completed;
    this.lastStamp = t;
  }

  /** Milliseconds remaining, or undefined when not yet estimable. */
  remainingMs(completed: number, total: number): number | undefined {
    if (total <= 0) return undefined;
    const left = Math.max(0, total - completed);
    if (left === 0) return 0;
    if (this.ema === undefined) return undefined;
    return left * this.ema;
  }

  reset(): void {
    this.ema = undefined;
    this.lastCompleted = 0;
    this.lastStamp = undefined;
  }
}

/** "3m", "1h 5m", "12s" — compact enough for a status bar. */
export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem ? `${h}h ${rem}m` : `${h}h`;
}
