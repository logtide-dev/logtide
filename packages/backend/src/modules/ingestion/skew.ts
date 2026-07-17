/**
 * Ingestion clock skew detection (#279).
 *
 * A log whose client-supplied `time` sits far from the server clock is stored
 * and is visible in the UI, but threshold alert rules count logs in
 * [now - time_window, now] and so can never see it. The largest configurable
 * window is 24h (alerts/routes.ts), which is where the past threshold comes
 * from: past that point, no threshold rule in the product can match the log.
 *
 * Observation only. Skewed records are written unchanged.
 *
 * Always on: these thresholds are load-bearing product invariants, not
 * tunable knobs, so they are hardcoded rather than read from config. There is
 * no "disable" state.
 */

/** 24h: the largest alert `time_window` (alerts/routes.ts). Past this point,
 * no threshold rule in the product can ever count the log. Derived, not guessed. */
const PAST_THRESHOLD_MS = 86400000;

/** 5m: room for NTP jitter. */
const FUTURE_THRESHOLD_MS = 300000;

export interface SkewSummary {
  /** Number of skewed records in the batch. */
  count: number;
  /** Worst past delta seen, in ms. 0 when nothing was skewed into the past. */
  maxPastMs: number;
  /** Worst future delta seen, in ms. 0 when nothing was skewed into the future. */
  maxFutureMs: number;
}

export interface SkewTracker {
  observe(time: Date | undefined): void;
  summary(): SkewSummary | null;
}

/**
 * Single-pass tracker. `now` is read once per batch by the caller so that a
 * large batch is measured against one instant, not a drifting one.
 */
export function createSkewTracker(now: number): SkewTracker {
  let count = 0;
  let maxPastMs = 0;
  let maxFutureMs = 0;

  return {
    observe(time: Date | undefined): void {
      if (!time) return;

      // NaN for an Invalid Date. Both comparisons below are false for NaN, so a
      // malformed timestamp is never miscounted as skew: that is a separate
      // problem and counting it here would make this signal dishonest.
      const delta = now - time.getTime();

      if (delta > PAST_THRESHOLD_MS) {
        count++;
        if (delta > maxPastMs) maxPastMs = delta;
        return;
      }

      if (delta < -FUTURE_THRESHOLD_MS) {
        count++;
        const ahead = -delta;
        if (ahead > maxFutureMs) maxFutureMs = ahead;
      }
    },

    summary(): SkewSummary | null {
      return count > 0 ? { count, maxPastMs, maxFutureMs } : null;
    },
  };
}
