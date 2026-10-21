// ============================================================================
// ClickHouse log analytics: result assembly (plan S7, S8)
// ============================================================================
// The SQL lives in ClickHouseQueryTranslator; these pure functions turn the
// grouped rows into the contract shapes through the shared helpers, so zero
// filling and ordering match every other engine. 64-bit integers arrive as
// strings in JSONEachRow, hence `Number()`.

import { buildFacet, zeroFillHistogram } from '../../core/aggregation-helpers.js';
import type {
  LogFacetField,
  LogFacetsResult,
  LogHistogramParams,
  LogHistogramResult,
  LogLevel,
} from '../../core/types.js';

/** Builds the zero-filled histogram from `translateHistogram` rows (`bucket_ms`, `level`, `n`). */
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

/**
 * Builds one facet per requested field, in request order, from
 * `translateFacets` rows (`f` field index, `v` value, `cnt` count, `total`
 * present values of the field). A field without rows has no values.
 */
export function assembleFacets(
  fields: LogFacetField[],
  rows: Record<string, unknown>[],
  limit: number,
): LogFacetsResult {
  const top = fields.map(() => [] as { value: string; count: number }[]);
  const totals = fields.map(() => 0);
  for (const row of rows) {
    const index = Number(row.f);
    if (!Number.isInteger(index) || index < 0 || index >= fields.length) continue;
    top[index].push({ value: String(row.v), count: Number(row.cnt) });
    totals[index] = Number(row.total);
  }
  return { facets: fields.map((field, i) => buildFacet(field, top[i], totals[i], limit)) };
}
