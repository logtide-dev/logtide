// ============================================================================
// MongoDB log analytics pipelines (histogram; plan S7)
// ============================================================================
// Pipelines start with the shared log filter as their `$match`, so the
// project/time predicate keeps them on the time-series bucket index; result
// assembly (zero filling, ordering) is the engine-independent helper code.

import type { Document } from 'mongodb';
import { zeroFillHistogram } from '../../core/aggregation-helpers.js';
import type { LogHistogramParams, LogHistogramResult, LogLevel } from '../../core/types.js';

/** BSON numbers may arrive as `Long` (promoteLongs off, or values above 2^53). */
function toNumber(value: unknown): number {
  if (typeof value === 'object' && value !== null && 'toNumber' in value && typeof value.toNumber === 'function') {
    return Number(value.toNumber());
  }
  return Number(value);
}

/**
 * `(bucket start ms, level) -> count` over the filtered logs. Buckets are
 * epoch aligned with integer arithmetic on the millisecond timestamp (never
 * `$dateTrunc`, whose bins align to 2000-01-01).
 */
export function histogramPipeline(filter: Document, bucketMs: number): Document[] {
  const ms = { $toLong: '$time' };
  return [
    { $match: filter },
    { $group: { _id: { b: { $subtract: [ms, { $mod: [ms, bucketMs] }] }, level: '$level' }, n: { $sum: 1 } } },
  ];
}

export interface HistogramRow {
  _id: { b: unknown; level: unknown };
  n: unknown;
}

/** Zero-filled histogram from the grouped rows of histogramPipeline. */
export function assembleHistogram(
  params: Pick<LogHistogramParams, 'from' | 'to' | 'toExclusive' | 'bucketSeconds'>,
  rows: HistogramRow[],
): LogHistogramResult {
  return zeroFillHistogram(
    params,
    rows.map((r) => ({ time: new Date(toNumber(r._id.b)), level: String(r._id.level) as LogLevel, count: toNumber(r.n) })),
  );
}
