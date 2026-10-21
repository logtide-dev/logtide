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
import type { MetadataFilter, SpanQueryParams, TraceQueryParams } from '../../core/types.js';
import { compileJsonFilters } from './json-path.js';

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
