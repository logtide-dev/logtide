/**
 * Ingestion clock skew detection (#279).
 *
 * A log whose client-supplied `time` sits far from the server clock is stored
 * and is visible in the UI, but threshold alert rules count logs in
 * [now - time_window, now] and so can never see it. The largest configurable
 * window is 24h (alerts/routes.ts), which is where the past default comes from:
 * past that point, no threshold rule in the product can match the log.
 *
 * Observation only. Skewed records are written unchanged.
 */
import { config } from '../../config/index.js';

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
  const pastMs = config.INGESTION_SKEW_PAST_MS;
  const futureMs = config.INGESTION_SKEW_FUTURE_MS;

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

      if (pastMs > 0 && delta > pastMs) {
        count++;
        if (delta > maxPastMs) maxPastMs = delta;
        return;
      }

      if (futureMs > 0 && delta < -futureMs) {
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
