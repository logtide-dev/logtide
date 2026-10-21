// ============================================================================
// TimescaleDB log analytics: result assembly (spec 6.4, plan S7)
// ============================================================================
// The SQL lives in TimescaleQueryTranslator next to the shared log filter;
// this module turns grouped rows into contract results with the helpers
// every engine shares, so zero filling and ordering cannot drift.

import { zeroFillHistogram } from '../../core/aggregation-helpers.js';
import type { LogHistogramParams, LogHistogramResult, LogLevel } from '../../core/types.js';

/** One `(bucket start in epoch seconds, level, count)` row of translateHistogram. */
export interface HistogramRow {
  /** pg returns bigint as a string. */
  bucket_s: number | string;
  level: string;
  n: number | string;
}

/**
 * Zero-filled, epoch-aligned histogram (S7) from translateHistogram rows.
 * Throws RangeError for a bucket size that is not a positive integer.
 */
export function histogramRowsToResult(
  params: Pick<LogHistogramParams, 'from' | 'to' | 'toExclusive' | 'bucketSeconds'>,
  rows: HistogramRow[],
): LogHistogramResult {
  return zeroFillHistogram(
    params,
    rows.map((row) => ({
      time: new Date(Number(row.bucket_s) * 1000),
      level: row.level as LogLevel,
      count: Number(row.n),
    })),
  );
}
