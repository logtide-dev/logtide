// ============================================================================
// ClickHouse log analytics: result assembly (plan S7)
// ============================================================================
// The SQL lives in ClickHouseQueryTranslator; these pure functions turn the
// grouped rows into the contract shapes through the shared helpers, so zero
// filling and ordering match every other engine.

import { zeroFillHistogram } from '../../core/aggregation-helpers.js';
import type { LogHistogramParams, LogHistogramResult, LogLevel } from '../../core/types.js';

/**
 * Builds the zero-filled histogram from `translateHistogram` rows
 * (`bucket_ms`, `level`, `n`; 64-bit integers arrive as strings in
 * JSONEachRow, hence `Number()`).
 */
export function assembleHistogram(
  params: Pick<LogHistogramParams, 'from' | 'to' | 'toExclusive' | 'bucketSeconds'>,
  rows: Record<string, unknown>[],
): LogHistogramResult {
  return zeroFillHistogram(
    params,
    rows.map((row) => ({
      time: new Date(Number(row.bucket_ms)),
      level: String(row.level) as LogLevel,
      count: Number(row.n),
    })),
  );
}
