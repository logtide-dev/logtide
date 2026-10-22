// Pure parameter helpers for the logs explorer endpoints (no I/O).

import type { LogLevel } from '@logtide/shared';

export const HISTOGRAM_TARGET_BUCKETS = 60;

export interface LogHistogramResponse {
  buckets: { time: Date; total: number; byLevel: Partial<Record<LogLevel, number>> }[];
  /** The bucket size used (requested or picked automatically). */
  bucketSeconds: number;
  total: number;
  from: Date;
  to: Date;
}

export const HISTOGRAM_BUCKET_LADDER_SECONDS = [
  1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 10800, 21600, 43200, 86400, 172800, 604800,
] as const;

/** Largest bucket the histogram endpoint accepts or picks (one week). */
export const HISTOGRAM_MAX_BUCKET_SECONDS = 604800;

const TIE_EPSILON = 1e-12;

/** A 400 for explorer params that are well-formed but unusable (empty range, too many buckets). */
export class ExplorerParamError extends Error {
  readonly statusCode = 400;

  constructor(message: string) {
    super(message);
    this.name = 'ExplorerParamError';
  }
}

/**
 * Bucket size for about HISTOGRAM_TARGET_BUCKETS buckets over the range: the
 * ladder value nearest on a log scale (ties go to the larger step), 1 below
 * the ladder and 604800 above it. Throws RangeError when `to <= from`.
 */
export function pickBucketSeconds(from: Date, to: Date): number {
  const rangeMs = to.getTime() - from.getTime();
  if (!(rangeMs > 0)) throw new RangeError('"to" must be after "from"');
  const raw = rangeMs / 1000 / HISTOGRAM_TARGET_BUCKETS;
  const ladder = HISTOGRAM_BUCKET_LADDER_SECONDS;
  if (raw <= ladder[0]) return ladder[0];
  if (raw >= ladder[ladder.length - 1]) return ladder[ladder.length - 1];

  let best: number = ladder[0];
  let bestDistance = Infinity;
  for (const step of ladder) {
    const distance = Math.abs(Math.log(step / raw));
    if (distance < bestDistance - TIE_EPSILON || (Math.abs(distance - bestDistance) <= TIE_EPSILON && step > best)) {
      best = step;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * Number of buckets the reservoir builds for the range: buckets are aligned
 * to multiples of `bucketSeconds` since the epoch and the one holding `to` is
 * included (same rule as the reservoir's MAX_HISTOGRAM_BUCKETS check).
 */
export function histogramBucketCount(from: Date, to: Date, bucketSeconds: number): number {
  const ms = bucketSeconds * 1000;
  return Math.floor(to.getTime() / ms) - Math.floor(from.getTime() / ms) + 1;
}
