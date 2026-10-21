// ============================================================================
// TimescaleDB log analytics: result assembly (spec 6.4, plan S7)
// ============================================================================
// The SQL lives in TimescaleQueryTranslator next to the shared log filter;
// this module turns grouped rows into contract results with the helpers
// every engine shares, so zero filling and ordering cannot drift.

import { buildFacet, zeroFillHistogram } from '../../core/aggregation-helpers.js';
import type {
  LogFacetField,
  LogFacetsResult,
  LogHistogramParams,
  LogHistogramResult,
  LogLevel,
} from '../../core/types.js';

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

/** One `(field index, value, count, present total)` row of translateFacets. */
export interface FacetRow {
  /** Position of the field in the request, never a user string. */
  f: number | string;
  v: string;
  /** pg returns bigint as a string. */
  cnt: number | string;
  /** Matching logs with a present value for the field. */
  total: number | string;
}

/**
 * Facets in request order (S8) from translateFacets rows: count desc, then
 * byte order, `otherCount` = present total minus the returned counts. A
 * field without rows has no present value: `values: []`, `otherCount: 0`.
 */
export function assembleFacets(fields: LogFacetField[], rows: FacetRow[], limit: number): LogFacetsResult {
  const perField = new Map<number, { top: { value: string; count: number }[]; total: number }>();
  for (const row of rows) {
    const f = Number(row.f);
    let entry = perField.get(f);
    if (!entry) {
      entry = { top: [], total: Number(row.total) };
      perField.set(f, entry);
    }
    entry.top.push({ value: row.v, count: Number(row.cnt) });
  }
  return {
    facets: fields.map((field, f) => {
      const entry = perField.get(f);
      return buildFacet(field, entry?.top ?? [], entry?.total ?? 0, limit);
    }),
  };
}
