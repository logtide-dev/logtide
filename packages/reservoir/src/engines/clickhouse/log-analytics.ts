// ============================================================================
// ClickHouse log analytics (plan S7, S8, S9, S14)
// ============================================================================
// Histogram and facet SQL lives in ClickHouseQueryTranslator (it reuses the
// log filter); key discovery and session SQL lives here. The pure functions
// turn grouped rows into the contract shapes through the shared helpers, so
// zero filling, ordering and cursors match every other engine. 64-bit
// integers arrive as strings in JSONEachRow, hence `Number()`.

import { buildFacet, encodeSessionCursor, zeroFillHistogram } from '../../core/aggregation-helpers.js';
import { DISCOVER_DEFAULT_SAMPLE_SIZE } from '../../core/constants.js';
import type { NativeQuery } from '../../core/query-translator.js';
import type {
  DiscoverMetadataKeysParams,
  HasSessionsParams,
  ListSessionsParams,
  ListSessionsResult,
  LogFacetField,
  LogFacetsResult,
  LogHistogramParams,
  LogHistogramResult,
  LogLevel,
  MetadataKeyOccurrence,
  SessionSummary,
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

// ----------------------------------------------------------------------------
// Sessions (plan S14)
// ----------------------------------------------------------------------------

/** Project and window (primary key) in PREWHERE; a non-empty session id in WHERE. */
function sessionScope(
  params: Pick<ListSessionsParams, 'projectId' | 'from' | 'to'>,
  queryParams: Record<string, unknown>,
  tableName: string,
): string {
  queryParams.p_pid = params.projectId;
  queryParams.p_from = toDateTime64(params.from);
  queryParams.p_to = toDateTime64(params.to);
  return (
    `FROM ${tableName} PREWHERE project_id = {p_pid:String} AND time >= {p_from:DateTime64(3)} AND time <= {p_to:DateTime64(3)}` +
    ` WHERE session_id IS NOT NULL AND session_id != ''`
  );
}

/**
 * One row per session over the filtered events (the service filter applies
 * before grouping), most recent last event first, session id byte order on
 * ties; `limit` rows plus one to detect a next page. Times come back as epoch
 * milliseconds, so the cursor compares at millisecond precision. The service
 * alias is `min_service`: an alias named `service` would shadow the column
 * in WHERE.
 */
export function translateListSessions(
  params: Pick<ListSessionsParams, 'projectId' | 'from' | 'to' | 'service'>,
  limit: number,
  cursor: { lastEvent: Date; sessionId: string } | null,
  tableName = 'logs',
): NativeQuery {
  const queryParams: Record<string, unknown> = {};
  let scope = sessionScope(params, queryParams, tableName);
  if (params.service !== undefined) {
    scope += ' AND service = {p_service:String}';
    queryParams.p_service = params.service;
  }
  let having = '';
  if (cursor) {
    having = ' HAVING last_ms < {p_cms:Int64} OR (last_ms = {p_cms:Int64} AND session_id > {p_csid:String})';
    queryParams.p_cms = cursor.lastEvent.getTime();
    queryParams.p_csid = cursor.sessionId;
  }
  queryParams.p_limit = limit + 1;
  const query =
    `SELECT session_id, min(toString(service)) AS min_service,` +
    ` toUnixTimestamp64Milli(min(time)) AS first_ms, toUnixTimestamp64Milli(max(time)) AS last_ms,` +
    ` count() AS event_count, countIf(level IN ('error', 'critical')) AS error_count` +
    ` ${scope} GROUP BY session_id${having} ORDER BY last_ms DESC, session_id ASC LIMIT {p_limit:UInt32}`;
  return { query, parameters: [queryParams] };
}

/** Whether the project has an event with a non-empty session id in the window. */
export function translateHasSessions(params: HasSessionsParams, tableName = 'logs'): NativeQuery {
  const queryParams: Record<string, unknown> = {};
  return { query: `SELECT 1 ${sessionScope(params, queryParams, tableName)} LIMIT 1`, parameters: [queryParams] };
}

/** `translateListSessions` rows (at most `limit + 1`) to one page with its next cursor. */
export function assembleSessions(rows: Record<string, unknown>[], limit: number): ListSessionsResult {
  const sessions: SessionSummary[] = rows.slice(0, limit).map((row) => ({
    sessionId: String(row.session_id),
    service: String(row.min_service),
    firstEvent: new Date(Number(row.first_ms)),
    lastEvent: new Date(Number(row.last_ms)),
    eventCount: Number(row.event_count),
    errorCount: Number(row.error_count),
  }));
  if (rows.length <= limit || sessions.length === 0) return { sessions };
  const tail = sessions[sessions.length - 1];
  return { sessions, nextCursor: encodeSessionCursor(tail.lastEvent, tail.sessionId) };
}
