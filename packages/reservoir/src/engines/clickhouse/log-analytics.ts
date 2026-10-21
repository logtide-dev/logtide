// ============================================================================
// ClickHouse log analytics: result assembly (plan S7, S8)
// ============================================================================
// The SQL lives in ClickHouseQueryTranslator; these pure functions turn the
// grouped rows into the contract shapes through the shared helpers, so zero
// filling and ordering match every other engine. 64-bit integers arrive as
// strings in JSONEachRow, hence `Number()`.

import { buildFacet, zeroFillHistogram } from '../../core/aggregation-helpers.js';
import { DISCOVER_DEFAULT_SAMPLE_SIZE } from '../../core/constants.js';
import type { NativeQuery } from '../../core/query-translator.js';
import type {
  DiscoverMetadataKeysParams,
  LogFacetField,
  LogFacetsResult,
  LogHistogramParams,
  LogHistogramResult,
  LogLevel,
  MetadataKeyOccurrence,
} from '../../core/types.js';
import { toDateTime64 } from './query-translator.js';

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

/** Most keys one discovery call returns. */
export const DISCOVER_MAX_KEYS = 500;

/**
 * Metadata keys of the newest `sampleSize` logs of the projects in range
 * (plan S9): a top-level key whose value is an object counts as
 * `parent.child` for each child (children whose own name has a dot are not
 * addressable and are skipped), any other top-level key counts as itself.
 * One occurrence per log and key; occurrences desc, then key in byte order.
 */
export function translateDiscoverKeys(params: DiscoverMetadataKeysParams, tableName = 'logs'): NativeQuery {
  const queryParams: Record<string, unknown> = {
    p_pids: Array.isArray(params.projectId) ? [...params.projectId] : [params.projectId],
    p_from: toDateTime64(params.from),
    p_to: toDateTime64(params.to),
    p_n: params.sampleSize ?? DISCOVER_DEFAULT_SAMPLE_SIZE,
  };
  const keysOfLog =
    `arrayDistinct(arrayFlatten(arrayMap(kv -> if(JSONType(kv.2) = 'Object', ` +
    `arrayMap(c -> concat(kv.1, '.', c), arrayFilter(c -> position(c, '.') = 0, JSONExtractKeys(kv.2))), ` +
    `[kv.1]), JSONExtractKeysAndValuesRaw(metadata))))`;
  const sample =
    `SELECT metadata FROM ${tableName} PREWHERE project_id IN {p_pids:Array(String)}` +
    ` AND time >= {p_from:DateTime64(3)} AND time <= {p_to:DateTime64(3)} ORDER BY time DESC LIMIT {p_n:UInt32}`;
  const query =
    `SELECT key, count() AS occurrences FROM (SELECT ${keysOfLog} AS keys FROM (${sample}))` +
    ` ARRAY JOIN keys AS key GROUP BY key ORDER BY occurrences DESC, key ASC LIMIT ${DISCOVER_MAX_KEYS}`;
  return { query, parameters: [queryParams] };
}

/** `translateDiscoverKeys` rows to the contract shape. */
export function assembleMetadataKeys(rows: Record<string, unknown>[]): MetadataKeyOccurrence[] {
  return rows.map((row) => ({ key: String(row.key), occurrences: Number(row.occurrences) }));
}
