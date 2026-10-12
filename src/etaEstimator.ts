/** Samples kept for the running median. Small enough to track a changing pace. */
const WINDOW = 5;

/** Below this many samples the estimate is a guess and is labelled as one. */
const ROUGH_SAMPLES = 3;

/** Spread (range / median) above this means the pace is too erratic to trust. */
const NOISY_SPREAD = 1.5;

/** Running this many times longer than expected means the estimate has broken down. */
const OVERRUN_FACTOR = 1.5;

export type Confidence = "none" | "rough" | "fair" | "good";

export interface Estimate {
  ms: number;
  confidence: Confidence;
  /** Completed-task durations backing it. Shown in the tooltip. */
  samples: number;
  /** The current task has already outrun its expected duration. */
  overdue: boolean;
}

/**
 * Estimates time remaining from how long completed tasks actually took.
 *
 * Uses a median of the last few durations rather than a mean/EMA: one stalled
 * task would drag a mean for a long time, and in a Claude Code session stalls
 * are common (a long tool call, a big file read, waiting on a build).
 *
 * The interval before the FIRST completion is discarded. It covers startup,
 * thinking and tool calls that happened before any task finished, so counting
 * it as "one task's duration" inflated the first ETA several-fold — and with an
 * EMA that first bad sample then polluted every later estimate.
 *
 * Accuracy improves as a session runs: 1 sample is reported as `rough`, and
 * confidence rises as samples accumulate and their spread narrows.
 */
export class EtaEstimator {
  private readonly durations: number[] = [];
  private lastCompleted = 0;
  private lastStamp: number | undefined;
  private sawFirstCompletion = false;

  constructor(private readonly now: () => number = Date.now) {}

  update(completed: number, total: number): void {
    if (total <= 0 || completed < 0) return;
    const t = this.now();

    // List shrank — new session or a reset. Rebaseline instead of sampling.
    if (completed < this.lastCompleted) {
      this.reset();
      this.lastCompleted = completed;
      this.lastStamp = t;
      return;
    }

    const advanced = completed - this.lastCompleted;
    if (advanced === 0) {
      // statusLine re-fires constantly; only establish a clock origin.
      this.lastStamp ??= t;
      return;
    }

    if (this.lastStamp !== undefined) {
      if (!this.sawFirstCompletion) {
        // Startup interval, not task work. Discard it and start the clock here.
        this.sawFirstCompletion = true;
      } else {
        const perTask = (t - this.lastStamp) / advanced;
        if (perTask > 0) {
          // A burst of N completions in one push gives N copies of the same
          // average, which would wrongly dominate the window. Record one.
          this.durations.push(perTask);
          if (this.durations.length > WINDOW) this.durations.shift();
        }
      }
    }

    this.lastCompleted = completed;
    this.lastStamp = t;
  }

  /** Remaining time with a confidence grade, or undefined when not estimable. */
  estimate(completed: number, total: number): Estimate | undefined {
    if (total <= 0) return undefined;
    const left = Math.max(0, total - completed);
    if (left === 0) {
      return { ms: 0, confidence: "good", samples: this.durations.length, overdue: false };
    }
    if (this.durations.length === 0) return undefined;

    const per = median(this.durations);

    // Time already spent on the task in flight. Without this the estimate is a
    // snapshot from the last completion: it would still promise "~35s left"
    // after the current task had already run for eight minutes.
    const elapsed = this.lastStamp === undefined ? 0 : Math.max(0, this.now() - this.lastStamp);
    const overdue = elapsed > per * OVERRUN_FACTOR;

    // An overrunning task is evidence against the measured pace, not just a
    // slow instance of it: a 5s average with 8 minutes elapsed means the pace
    // no longer describes this session. Treat the time already spent as the
    // best available floor for what work now costs, so the estimate widens
    // instead of insisting on a number the session has already disproved.
    const effectivePer = overdue ? Math.max(per, elapsed) : per;
    const remainingOnCurrent = Math.max(0, effectivePer - elapsed);
    const ms = remainingOnCurrent + (left - 1) * effectivePer;

    return {
      ms,
      confidence: overdue ? "rough" : this.confidence(per),
      samples: this.durations.length,
      overdue,
    };
  }

  /** How long the in-flight task has run beyond its expected duration, in ms. */
  overrunMs(): number {
    if (this.durations.length === 0 || this.lastStamp === undefined) return 0;
    return Math.max(0, this.now() - this.lastStamp - median(this.durations));
  }

  private confidence(per: number): Confidence {
    const n = this.durations.length;
    if (n < ROUGH_SAMPLES) return "rough";

    // Range relative to the median: how consistent the pace has been.
    const sorted = [...this.durations].sort((a, b) => a - b);
    const spread = per > 0 ? (sorted[sorted.length - 1] - sorted[0]) / per : 0;
    if (spread > NOISY_SPREAD) return "rough";
    return n >= WINDOW && spread < NOISY_SPREAD / 2 ? "good" : "fair";
  }

  reset(): void {
    this.durations.length = 0;
    this.lastCompleted = 0;
    this.lastStamp = undefined;
    this.sawFirstCompletion = false;
  }
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Rounds to a precision the estimate actually supports — "~2m" rather than
 * "1m 53s", which would imply accuracy that isn't there.
 */
export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 10) return "<10s";
  if (s < 60) return `${Math.round(s / 5) * 5}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem ? `${h}h ${rem}m` : `${h}h`;
}
