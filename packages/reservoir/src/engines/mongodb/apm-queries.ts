// ============================================================================
// MongoDB span and trace query builders (plan S12)
// ============================================================================
// Span filters gain `operationName` (the client maps the 1.6 `operation`
// alias onto it), `attributeFilters` with the metadata rules of logs and a
// deterministic sort. A trace matches `operation` / `attributeFilters` when
// ONE of its spans in the window matches all of them together; the pipeline
// starts on `spans` (project/time or operation index), groups by trace and
// joins `traces` through `idx_trace_key`.

import type { Document } from 'mongodb';
import { DEFAULT_OPERATION_KINDS, LATENCY_HISTOGRAM_BOUNDS_MS } from '../../core/constants.js';
import { compareByteOrder } from '../../core/aggregation-helpers.js';
import type {
  LatencyHistogramParams,
  LatencyHistogramResult,
  MetadataFilter,
  OperationStat,
  OperationStatsParams,
  SpanKind,
  SpanQueryParams,
  TraceQueryParams,
} from '../../core/types.js';
import { compileJsonFilters } from './json-path.js';
import { toNumber } from './bson-number.js';

const RESOURCE_PREFIX = 'resource.';

const list = <T>(value: T | T[]): T[] => (Array.isArray(value) ? value : [value]);
const eqOrIn = (values: unknown[]): unknown => (values.length === 1 ? values[0] : { $in: values });

/**
 * Span attribute filters split by target: a key starting with `resource.`
 * addresses `resource_attributes` with the rest of the key, any other key
 * addresses `attributes`.
 */
export function routeAttributeFilters(filters: MetadataFilter[] | undefined): {
  attributes: MetadataFilter[];
  resource: MetadataFilter[];
} {
  const attributes: MetadataFilter[] = [];
  const resource: MetadataFilter[] = [];
  for (const f of filters ?? []) {
    if (f.key.startsWith(RESOURCE_PREFIX) && f.key.length > RESOURCE_PREFIX.length) {
      resource.push({ ...f, key: f.key.slice(RESOURCE_PREFIX.length) });
    } else {
      attributes.push(f);
    }
  }
  return { attributes, resource };
}

/** One clause per attribute filter, for an `$and` list. */
function attributeClauses(filters: MetadataFilter[] | undefined): Document[] {
  const { attributes, resource } = routeAttributeFilters(filters);
  return [...compileJsonFilters(attributes, 'attributes'), ...compileJsonFilters(resource, 'resource_attributes')];
}

/** Span filter: project, window, typed filters, operation and attribute filters (every clause ANDs). */
export function buildSpanFilter(params: SpanQueryParams): Document {
  const filter: Document = {};
  const and: Document[] = [];

  if (params.projectId) filter.project_id = eqOrIn(list(params.projectId));

  const time: Document = {};
  time[params.fromExclusive ? '$gt' : '$gte'] = params.from;
  time[params.toExclusive ? '$lt' : '$lte'] = params.to;
  filter.time = time;

  if (params.traceId) filter.trace_id = eqOrIn(list(params.traceId));
  if (params.serviceName) filter.service_name = eqOrIn(list(params.serviceName));
  if (params.operationName !== undefined) filter.operation_name = eqOrIn(list(params.operationName));
  // Direct engine callers may still pass the alias; it ANDs with operationName.
  if (params.operation !== undefined) {
    if (filter.operation_name === undefined) filter.operation_name = params.operation;
    else and.push({ operation_name: params.operation });
  }
  if (params.kind) filter.kind = eqOrIn(list(params.kind));
  if (params.statusCode) filter.status_code = eqOrIn(list(params.statusCode));

  and.push(...attributeClauses(params.attributeFilters));
  if (and.length > 0) filter.$and = and;
  return filter;
}

/** Sort columns accepted for spans; anything else sorts by start_time (same allowlist as the SQL engines). */
const SPAN_SORT_COLUMNS = new Map<string, string>([
  ['start_time', 'start_time'],
  ['end_time', 'end_time'],
  ['duration_ms', 'duration_ms'],
  ['duration', 'duration_ms'],
  ['service_name', 'service_name'],
  ['operation_name', 'operation_name'],
]);

/** Default start_time ascending; span_id breaks ties so pages are stable. */
export function spanSort(params: Pick<SpanQueryParams, 'sortBy' | 'sortOrder'>): Document {
  const column = SPAN_SORT_COLUMNS.get(params.sortBy ?? '') ?? 'start_time';
  return { [column]: params.sortOrder === 'desc' ? -1 : 1, span_id: 1 };
}

/** Default start_time descending; trace_id breaks ties so pages are stable. */
export function traceSort(params: Pick<TraceQueryParams, 'sortBy' | 'sortOrder'>): Document {
  const column = params.sortBy === 'duration' ? 'duration_ms' : 'start_time';
  return { [column]: params.sortOrder === 'asc' ? 1 : -1, trace_id: 1 };
}

/** Trace-level filter on `traces`; `serviceName` is the trace's own service. */
export function buildTraceFilter(params: TraceQueryParams): Document {
  const filter: Document = {};
  if (params.projectId) filter.project_id = eqOrIn(list(params.projectId));
  filter.start_time = { $gte: params.from, $lte: params.to };
  if (params.organizationId) filter.organization_id = eqOrIn(list(params.organizationId));
  if (params.serviceName) filter.service_name = eqOrIn(list(params.serviceName));
  if (params.error !== undefined) filter.error = params.error;
  if (params.minDurationMs !== undefined) filter.duration_ms = { ...filter.duration_ms, $gte: params.minDurationMs };
  if (params.maxDurationMs !== undefined) filter.duration_ms = { ...filter.duration_ms, $lte: params.maxDurationMs };
  return filter;
}

/** The span-match block applies when an operation or at least one attribute filter is set. */
export function isTraceSpanMatchActive(params: TraceQueryParams): boolean {
  return params.operation !== undefined || (params.attributeFilters?.length ?? 0) > 0;
}

/** Spans of the window that match the operation and every attribute filter together. */
function traceSpanMatch(params: TraceQueryParams): Document {
  const match: Document = {};
  if (params.projectId) match.project_id = eqOrIn(list(params.projectId));
  match.time = { $gte: params.from, $lte: params.to };
  if (params.operation !== undefined) match.operation_name = params.operation;
  const clauses = attributeClauses(params.attributeFilters);
  if (clauses.length > 0) match.$and = clauses;
  return match;
}

/**
 * Traces with at least one matching span (block active): matching spans,
 * grouped by (project, trace), joined to their trace document, filtered by
 * the trace-level filters, then counted and paged in one `$facet`.
 */
export function traceMatchPipeline(params: TraceQueryParams, sort: Document, offset: number, limit: number): Document[] {
  return [
    { $match: traceSpanMatch(params) },
    { $group: { _id: { p: '$project_id', t: '$trace_id' } } },
    {
      $lookup: {
        from: 'traces',
        localField: '_id.t',
        foreignField: 'trace_id',
        let: { p: '$_id.p' },
        pipeline: [{ $match: { $expr: { $eq: ['$project_id', '$$p'] } } }],
        as: 'trace',
      },
    },
    { $unwind: '$trace' },
    { $replaceRoot: { newRoot: '$trace' } },
    { $match: buildTraceFilter(params) },
    {
      $facet: {
        total: [{ $count: 'n' }],
        page: [{ $sort: sort }, { $skip: offset }, { $limit: Math.max(1, limit) }, { $project: { _id: 0 } }],
      },
    },
  ];
}

// ============================================================================
// Operation stats and latency histogram (plan S10, S11; F3 contract)
// ============================================================================
// Entry spans: kinds in `kinds` (default SERVER and CONSUMER) within the
// project, service and window; when `kinds` was omitted and that selection is
// empty, the root spans of the same scope. The latency histogram decides the
// mode on the project and service scope, then filters by operation.

/** `'kinds'` selects entry spans by kind, `'root'` the root spans (the fallback). */
export type EntryMode = 'kinds' | 'root';

/** `'native'` uses `$percentile` (MongoDB 7.0+); `'buckets'` derives percentiles from latency buckets. */
export type PercentileStrategy = 'native' | 'buckets';

interface EntryScope {
  projectId: string;
  service?: string;
  from: Date;
  to: Date;
}

const PERCENTILES = [0.5, 0.95, 0.99];

/** `$match` of the entry spans in scope for one mode. */
export function entrySpanMatch(scope: EntryScope, mode: EntryMode, kinds: readonly SpanKind[]): Document {
  const match: Document = { project_id: scope.projectId, time: { $gte: scope.from, $lte: scope.to } };
  if (scope.service !== undefined) match.service_name = scope.service;
  if (mode === 'kinds') match.kind = { $in: [...kinds] };
  else match.parent_span_id = { $in: [null, ''] };
  return match;
}

/**
 * Index into `LatencyHistogramResult.counts`: the number of bounds below the
 * duration, so buckets are upper-inclusive (`bounds[i - 1] < d <= bounds[i]`)
 * and durations above the last bound land in the overflow bucket.
 */
export function bucketIndexExpr(bounds: readonly number[] = LATENCY_HISTOGRAM_BOUNDS_MS): Document {
  return { $size: { $filter: { input: [...bounds], cond: { $lt: ['$$this', '$duration_ms'] } } } };
}

const ERROR_COUNT: Document = { $sum: { $cond: [{ $eq: ['$status_code', 'ERROR'] }, 1, 0] } };

/**
 * Per (service, operation) stats of the entry spans. Native: count, errors,
 * average and approximate `$percentile`, ordered by count desc, then service
 * and operation, limited on the server. Buckets: one row per (service,
 * operation, latency bucket) with min and max, assembled in TypeScript.
 */
export function operationStatsPipeline(
  params: OperationStatsParams & { limit: number },
  mode: EntryMode,
  strategy: PercentileStrategy,
): Document[] {
  const match = entrySpanMatch(params, mode, params.kinds ?? DEFAULT_OPERATION_KINDS);
  if (strategy === 'native') {
    return [
      { $match: match },
      {
        $group: {
          _id: { s: '$service_name', o: '$operation_name' },
          count: { $sum: 1 },
          errors: ERROR_COUNT,
          avg: { $avg: '$duration_ms' },
          p: { $percentile: { input: '$duration_ms', p: PERCENTILES, method: 'approximate' } },
        },
      },
      { $sort: { count: -1, '_id.s': 1, '_id.o': 1 } },
      { $limit: params.limit },
    ];
  }
  return [
    { $match: match },
    {
      $group: {
        _id: { s: '$service_name', o: '$operation_name', b: bucketIndexExpr() },
        n: { $sum: 1 },
        errors: ERROR_COUNT,
        sum: { $sum: '$duration_ms' },
        min: { $min: '$duration_ms' },
        max: { $max: '$duration_ms' },
      },
    },
  ];
}

/**
 * Percentiles from latency bucket counts (`counts.length === bounds.length + 1`,
 * upper-inclusive, overflow last). The values of a bucket are taken as evenly
 * spread between its edges, clamped to the observed `[min, max]`; a
 * percentile interpolates between the two neighbouring ranks
 * (`p * (n - 1)`, like `percentile_cont`). The error is bounded by one
 * bucket width.
 */
export function percentilesFromBuckets(bounds: readonly number[], counts: number[], ps: number[], min: number, max: number): number[] {
  const n = counts.reduce((sum, c) => sum + c, 0);
  if (n === 0) return ps.map(() => 0);
  const starts: number[] = [];
  let acc = 0;
  for (const c of counts) {
    starts.push(acc);
    acc += c;
  }
  const valueAt = (rank: number): number => {
    let i = 0;
    while (i < counts.length - 1 && rank >= starts[i] + counts[i]) i++;
    const lo = Math.max(i === 0 ? min : bounds[i - 1], min);
    const hi = Math.min(i < bounds.length ? bounds[i] : max, max);
    const m = counts[i];
    return m > 1 ? lo + ((hi - lo) * (rank - starts[i])) / (m - 1) : (lo + hi) / 2;
  };
  return ps.map((p) => {
    const r = p * (n - 1);
    const below = Math.floor(r);
    const above = Math.ceil(r);
    const v = valueAt(below) + (valueAt(above) - valueAt(below)) * (r - below);
    return Math.min(max, Math.max(min, v));
  });
}

interface NativeStatRow {
  _id: { s: unknown; o: unknown };
  count: unknown;
  errors: unknown;
  avg: unknown;
  p: unknown;
}

interface BucketStatRow {
  _id: { s: unknown; o: unknown; b: unknown };
  n: unknown;
  errors: unknown;
  sum: unknown;
  min: unknown;
  max: unknown;
}

interface BucketGroup {
  service: string;
  operation: string;
  counts: number[];
  errors: number;
  sum: number;
  min: number;
  max: number;
}

function orderStats(stats: OperationStat[], limit: number): OperationStat[] {
  return stats
    .sort((a, b) => b.count - a.count || compareByteOrder(a.service, b.service) || compareByteOrder(a.operation, b.operation))
    .slice(0, limit);
}

/** OperationStat rows from operationStatsPipeline, in contract order, at most `limit`. */
export function assembleOperationStats(rows: Document[], strategy: PercentileStrategy, limit: number): OperationStat[] {
  if (strategy === 'native') {
    const stats = (rows as NativeStatRow[]).map((r) => {
      const p: unknown[] = Array.isArray(r.p) ? r.p : [];
      return {
        service: String(r._id.s),
        operation: String(r._id.o),
        count: toNumber(r.count),
        errorCount: toNumber(r.errors),
        avgMs: toNumber(r.avg),
        p50Ms: toNumber(p[0]),
        p95Ms: toNumber(p[1]),
        p99Ms: toNumber(p[2]),
      };
    });
    return orderStats(stats, limit);
  }

  const groups = new Map<string, BucketGroup>();
  for (const r of rows as BucketStatRow[]) {
    const service = String(r._id.s);
    const operation = String(r._id.o);
    const key = JSON.stringify([service, operation]);
    let g = groups.get(key);
    if (!g) {
      const counts = new Array<number>(LATENCY_HISTOGRAM_BOUNDS_MS.length + 1).fill(0);
      g = { service, operation, counts, errors: 0, sum: 0, min: Infinity, max: -Infinity };
      groups.set(key, g);
    }
    g.counts[toNumber(r._id.b)] += toNumber(r.n);
    g.errors += toNumber(r.errors);
    g.sum += toNumber(r.sum);
    g.min = Math.min(g.min, toNumber(r.min));
    g.max = Math.max(g.max, toNumber(r.max));
  }
  const stats = [...groups.values()].map((g) => {
    const count = g.counts.reduce((sum, c) => sum + c, 0);
    const [p50Ms, p95Ms, p99Ms] = percentilesFromBuckets(LATENCY_HISTOGRAM_BOUNDS_MS, g.counts, PERCENTILES, g.min, g.max);
    return { service: g.service, operation: g.operation, count, errorCount: g.errors, avgMs: g.sum / count, p50Ms, p95Ms, p99Ms };
  });
  return orderStats(stats, limit);
}

/** Latency bucket counts of the entry spans (mode decided by the caller), filtered by operation. */
export function latencyHistogramPipeline(params: LatencyHistogramParams, mode: EntryMode): Document[] {
  const match = entrySpanMatch(params, mode, DEFAULT_OPERATION_KINDS);
  if (params.operation !== undefined) match.operation_name = params.operation;
  return [{ $match: match }, { $group: { _id: bucketIndexExpr(), n: { $sum: 1 } } }];
}

/** The fixed bounds and one count per bucket (zero-filled) from latencyHistogramPipeline rows. */
export function assembleLatencyHistogram(rows: Document[]): LatencyHistogramResult {
  const counts = new Array<number>(LATENCY_HISTOGRAM_BOUNDS_MS.length + 1).fill(0);
  for (const r of rows) counts[toNumber(r._id)] += toNumber(r.n);
  return { bounds: [...LATENCY_HISTOGRAM_BOUNDS_MS], counts };
}
