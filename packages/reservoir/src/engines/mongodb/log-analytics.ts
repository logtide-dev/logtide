// ============================================================================
// MongoDB log analytics pipelines (histogram, facets, key discovery,
// sessions; plan S7 to S9, S14)
// ============================================================================
// Pipelines start with a `$match` on project and time (the shared log filter
// where one applies), so they stay on the time-series bucket index; result
// assembly (zero filling, ordering, cursors) is the engine-independent helper
// code.

import type { Document } from 'mongodb';
import { buildFacet, compareByteOrder, encodeSessionCursor, zeroFillHistogram } from '../../core/aggregation-helpers.js';
import type {
  DiscoverMetadataKeysParams,
  ListSessionsResult,
  LogFacetField,
  LogFacetsResult,
  LogHistogramParams,
  LogHistogramResult,
  LogLevel,
  MetadataKeyOccurrence,
  SessionSummary,
} from '../../core/types.js';
import { resolvedValueExpr, scalarTextExpr } from './json-path.js';
import { toNumber } from './bson-number.js';

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

// ----------------------------------------------------------------------------
// Facets
// ----------------------------------------------------------------------------

/** The hostname facet counts string hostnames from metadata, where ingestion stores them and the filter reads them. */
const HOSTNAME_TEXT: Document = {
  $cond: [{ $eq: [{ $type: '$metadata.hostname' }, 'string'] }, '$metadata.hostname', null],
};

/** Text form one facet field takes for a log; null when the log has none. */
function facetValueExpr(field: LogFacetField): unknown {
  if ('builtin' in field) {
    if (field.builtin === 'level') return '$level';
    if (field.builtin === 'service') return '$service';
    return HOSTNAME_TEXT;
  }
  return scalarTextExpr(resolvedValueExpr('metadata', field.metadata));
}

/**
 * Top `limit` values per field in one pass over the filtered logs: every log
 * yields one `(field index, text)` pair per field, empty and missing texts
 * are dropped, pairs are counted, and each field keeps its `limit` best
 * values (count desc, then value in byte order) plus the total of present
 * values. `$topN` holds only `limit` entries per field, so a high-cardinality
 * key never builds one oversized document. The field index is the literal
 * position in `fields`, never a user string.
 */
export function facetsPipeline(filter: Document, fields: LogFacetField[], limit: number): Document[] {
  return [
    { $match: filter },
    { $project: { _id: 0, kv: fields.map((field, f) => ({ f: { $literal: f }, v: facetValueExpr(field) })) } },
    { $unwind: '$kv' },
    { $match: { 'kv.v': { $nin: [null, ''] } } },
    { $group: { _id: { f: '$kv.f', v: '$kv.v' }, count: { $sum: 1 } } },
    {
      $group: {
        _id: '$_id.f',
        total: { $sum: '$count' },
        values: { $topN: { n: limit, sortBy: { count: -1, '_id.v': 1 }, output: { v: '$_id.v', c: '$count' } } },
      },
    },
  ];
}

export interface FacetRow {
  _id: unknown;
  total: unknown;
  values: { v: unknown; c: unknown }[];
}

/** Facets in request order from the rows of facetsPipeline; a field without a row has no values. */
export function assembleFacets(fields: LogFacetField[], rows: FacetRow[], limit: number): LogFacetsResult {
  const byField = new Map<number, FacetRow>();
  for (const row of rows) byField.set(toNumber(row._id), row);
  return {
    facets: fields.map((field, f) => {
      const row = byField.get(f);
      if (!row) return buildFacet(field, [], 0, limit);
      const top = row.values.map((x) => ({ value: String(x.v), count: toNumber(x.c) }));
      return buildFacet(field, top, toNumber(row.total), limit);
    }),
  };
}

// ----------------------------------------------------------------------------
// Metadata key discovery
// ----------------------------------------------------------------------------

/** Most keys one discovery call returns. */
export const DISCOVER_MAX_KEYS = 500;

/**
 * Keys of one log's metadata, as the shared `countMetadataKeys` counts them:
 * a top-level key whose value is an object contributes `parent.child` per
 * child (one level), any other top-level key contributes itself; each key
 * once per log. Non-object metadata contributes nothing.
 */
const METADATA_KEYS: Document = {
  $setUnion: [
    {
      $reduce: {
        input: { $cond: [{ $eq: [{ $type: '$metadata' }, 'object'] }, { $objectToArray: '$metadata' }, []] },
        initialValue: [],
        in: {
          $let: {
            vars: { e: '$$this' },
            in: {
              $concatArrays: [
                '$$value',
                {
                  $cond: [
                    { $eq: [{ $type: '$$e.v' }, 'object'] },
                    { $map: { input: { $objectToArray: '$$e.v' }, as: 'c', in: { $concat: ['$$e.k', '.', '$$c.k'] } } },
                    ['$$e.k'],
                  ],
                },
              ],
            },
          },
        },
      },
    },
  ],
};

/**
 * Key occurrences over the most recent `sampleSize` logs of the projects in
 * range (newest first, id as the tie-break like the other engines), busiest
 * key first, then key byte order, at most DISCOVER_MAX_KEYS keys.
 */
export function discoverKeysPipeline(params: DiscoverMetadataKeysParams & { sampleSize: number }): Document[] {
  const projects = Array.isArray(params.projectId) ? params.projectId : [params.projectId];
  return [
    { $match: { project_id: projects.length === 1 ? projects[0] : { $in: projects }, time: { $gte: params.from, $lte: params.to } } },
    { $sort: { time: -1, id: -1 } },
    { $limit: params.sampleSize },
    { $project: { _id: 0, keys: METADATA_KEYS } },
    { $unwind: '$keys' },
    { $group: { _id: '$keys', occurrences: { $sum: 1 } } },
    { $sort: { occurrences: -1, _id: 1 } },
    { $limit: DISCOVER_MAX_KEYS },
  ];
}

/** Rows of discoverKeysPipeline as key occurrences, in contract order. */
export function assembleMetadataKeys(rows: { _id: unknown; occurrences: unknown }[]): MetadataKeyOccurrence[] {
  return rows
    .map((r) => ({ key: String(r._id), occurrences: toNumber(r.occurrences) }))
    .sort((a, b) => b.occurrences - a.occurrences || compareByteOrder(a.key, b.key));
}

// ----------------------------------------------------------------------------
// Sessions
// ----------------------------------------------------------------------------

interface SessionScope {
  projectId: string;
  from: Date;
  to: Date;
  service?: string;
}

/**
 * Logs of the project in range with a non-empty session id (and the service
 * when given, applied before grouping). Bounded by the project/time bucket
 * index of the time-series collection; no new index on `logs`.
 */
export function sessionMatch(scope: SessionScope): Document {
  const match: Document = {
    project_id: scope.projectId,
    time: { $gte: scope.from, $lte: scope.to },
    session_id: { $nin: [null, ''] },
  };
  if (scope.service !== undefined) match.service = scope.service;
  return match;
}

/**
 * Sessions grouped by id (byte-order smallest service, first and last event,
 * events, errors = error + critical), strictly after the cursor row, ordered
 * by last event desc then session id, `limit + 1` groups so the caller knows
 * whether another page exists. Dates compare at millisecond precision.
 */
export function listSessionsPipeline(
  scope: SessionScope,
  limit: number,
  cursor: { lastEvent: Date; sessionId: string } | null,
): Document[] {
  const pipeline: Document[] = [
    { $match: sessionMatch(scope) },
    {
      $group: {
        _id: '$session_id',
        service: { $min: '$service' },
        first: { $min: '$time' },
        last: { $max: '$time' },
        eventCount: { $sum: 1 },
        errorCount: { $sum: { $cond: [{ $in: ['$level', ['error', 'critical']] }, 1, 0] } },
      },
    },
  ];
  if (cursor) {
    pipeline.push({
      $match: { $or: [{ last: { $lt: cursor.lastEvent } }, { last: cursor.lastEvent, _id: { $gt: cursor.sessionId } }] },
    });
  }
  pipeline.push({ $sort: { last: -1, _id: 1 } }, { $limit: limit + 1 });
  return pipeline;
}

const asDate = (value: unknown): Date => (value instanceof Date ? value : new Date(value as string));

/** One page of sessions from listSessionsPipeline rows; `nextCursor` only when more rows exist. */
export function assembleSessions(rows: Document[], limit: number): ListSessionsResult {
  const sessions: SessionSummary[] = rows.slice(0, limit).map((r) => ({
    sessionId: String(r._id),
    service: String(r.service),
    firstEvent: asDate(r.first),
    lastEvent: asDate(r.last),
    eventCount: toNumber(r.eventCount),
    errorCount: toNumber(r.errorCount),
  }));
  if (rows.length <= limit || sessions.length === 0) return { sessions };
  const tail = sessions[sessions.length - 1];
  return { sessions, nextCursor: encodeSessionCursor(tail.lastEvent, tail.sessionId) };
}
