// Bucket interval and time grid of a metrics query.

import type { MetricQueryInterval } from '@logtide/shared';

export type QueryInterval = Exclude<MetricQueryInterval, 'auto'>;

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export const QUERY_INTERVALS: readonly QueryInterval[] = ['1m', '5m', '15m', '1h', '6h', '1d'];

export const QUERY_INTERVAL_MS: Record<QueryInterval, number> = {
  '1m': MINUTE_MS,
  '5m': 5 * MINUTE_MS,
  '15m': 15 * MINUTE_MS,
  '1h': HOUR_MS,
  '6h': 6 * HOUR_MS,
  '1d': DAY_MS,
};

/** Target bucket count for `auto`. */
export const AUTO_MIN_BUCKETS = 60;
export const AUTO_MAX_BUCKETS = 120;

/** An explicit interval that would give more buckets than this falls back to auto. */
export const MAX_BUCKETS = 1500;

/**
 * Pick the interval whose bucket count over the window is closest to the
 * 60-120 range (distance measured as a ratio, so 168 buckets beats 28).
 */
export function pickAutoInterval(fromMs: number, toMs: number): QueryInterval {
  const range = Math.max(0, toMs - fromMs);
  let best: QueryInterval = QUERY_INTERVALS[0];
  let bestDistance = Infinity;
  for (const interval of QUERY_INTERVALS) {
    const buckets = range / QUERY_INTERVAL_MS[interval];
    let distance = 0;
    if (buckets > AUTO_MAX_BUCKETS) distance = Math.log(buckets / AUTO_MAX_BUCKETS);
    else if (buckets < AUTO_MIN_BUCKETS) distance = Math.log(AUTO_MIN_BUCKETS / Math.max(buckets, 1e-9));
    if (distance < bestDistance) {
      best = interval;
      bestDistance = distance;
    }
  }
  return best;
}

export function resolveInterval(
  requested: MetricQueryInterval,
  fromMs: number,
  toMs: number,
): { interval: QueryInterval; warning?: string } {
  if (requested === 'auto') return { interval: pickAutoInterval(fromMs, toMs) };
  const buckets = (toMs - fromMs) / QUERY_INTERVAL_MS[requested];
  if (buckets > MAX_BUCKETS) {
    const interval = pickAutoInterval(fromMs, toMs);
    return {
      interval,
      warning: `Interval ${requested} gives too many points for this time range, using ${interval} instead`,
    };
  }
  return { interval: requested };
}

/** Start of the bucket holding `ms` (buckets are aligned to the Unix epoch, like the engines). */
export function bucketStart(ms: number, stepMs: number): number {
  return Math.floor(ms / stepMs) * stepMs;
}

/** Bucket starts covering [from, to). */
export function buildGrid(fromMs: number, toMs: number, stepMs: number): number[] {
  const grid: number[] = [];
  for (let t = bucketStart(fromMs, stepMs); t < toMs; t += stepMs) grid.push(t);
  return grid;
}
