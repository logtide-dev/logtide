// ============================================================================
// ClickHouse APM queries: span and trace filters and sorting (plan S12)
// ============================================================================
// Span and trace WHERE builders shared by the page and count queries, so both
// always apply the same filter. Every value is a query parameter; sort columns
// come from allowlists.

import type { MetadataFilter, SpanQueryParams, TraceQueryParams } from '../../core/types.js';
import { compileJsonFilters } from './json-path.js';
import { toDateTime64 } from './query-translator.js';

const RESOURCE_PREFIX = 'resource.';

const asList = <T>(value: T | T[]): T[] => (Array.isArray(value) ? [...value] : [value]);

/**
 * Splits span attribute filters by the JSON column they read: a key starting
 * with `resource.` addresses `resource_attributes` with the rest of the key,
 * any other key addresses `attributes`.
 */
export function routeAttributeFilters(filters: MetadataFilter[]): { attributes: MetadataFilter[]; resource: MetadataFilter[] } {
  const attributes: MetadataFilter[] = [];
  const resource: MetadataFilter[] = [];
  for (const f of filters) {
    if (f.key.startsWith(RESOURCE_PREFIX) && f.key.length > RESOURCE_PREFIX.length) {
      resource.push({ ...f, key: f.key.slice(RESOURCE_PREFIX.length) });
    } else {
      attributes.push(f);
    }
  }
  return { attributes, resource };
}

/** Attribute filter predicates over one span row; parameter prefixes keep span and trace names apart. */
function attributePredicates(
  filters: MetadataFilter[] | undefined,
  queryParams: Record<string, unknown>,
  prefixes: { attributes: string; resource: string },
): string[] {
  if (!filters || filters.length === 0) return [];
  const routed = routeAttributeFilters(filters);
  return [
    ...compileJsonFilters(routed.attributes, 'attributes', queryParams, prefixes.attributes),
    ...compileJsonFilters(routed.resource, 'resource_attributes', queryParams, prefixes.resource),
  ];
}

/**
 * WHERE predicates of querySpans (ANDed): time range, project, trace,
 * service, kind and status as before, plus `operationName` (one or a list),
 * the `operation` alias (ANDed when both are set) and attribute filters.
 */
export function buildSpanConditions(params: SpanQueryParams, queryParams: Record<string, unknown>): string[] {
  const conditions: string[] = [];
  conditions.push(`time ${params.fromExclusive ? '>' : '>='} {p_from:DateTime64(3)}`);
  queryParams.p_from = toDateTime64(params.from);
  conditions.push(`time ${params.toExclusive ? '<' : '<='} {p_to:DateTime64(3)}`);
  queryParams.p_to = toDateTime64(params.to);

  if (params.projectId) {
    conditions.push('project_id IN {p_pids:Array(String)}');
    queryParams.p_pids = asList(params.projectId);
  }
  if (params.traceId) {
    conditions.push('trace_id IN {p_tids:Array(String)}');
    queryParams.p_tids = asList(params.traceId);
  }
  if (params.serviceName) {
    conditions.push('service_name IN {p_svc:Array(String)}');
    queryParams.p_svc = asList(params.serviceName);
  }
  if (params.operationName !== undefined) {
    conditions.push('operation_name IN {p_ops:Array(String)}');
    queryParams.p_ops = asList(params.operationName);
  }
  if (params.operation !== undefined) {
    conditions.push('operation_name = {p_op:String}');
    queryParams.p_op = params.operation;
  }
  if (params.kind) {
    conditions.push('kind IN {p_kind:Array(String)}');
    queryParams.p_kind = asList(params.kind);
  }
  if (params.statusCode) {
    conditions.push('status_code IN {p_sc:Array(String)}');
    queryParams.p_sc = asList(params.statusCode);
  }
  conditions.push(...attributePredicates(params.attributeFilters, queryParams, { attributes: 'p_af', resource: 'p_rf' }));
  return conditions;
}

const SPAN_SORT_COLUMNS: ReadonlyMap<string, string> = new Map([
  ['start_time', 'start_time'],
  ['duration', 'duration_ms'],
  ['duration_ms', 'duration_ms'],
  ['end_time', 'end_time'],
  ['service_name', 'service_name'],
  ['operation_name', 'operation_name'],
]);

/** Span ORDER BY: allowlisted column (default start_time), default ascending, span_id tie-break. */
export function spanOrderSql(params: Pick<SpanQueryParams, 'sortBy' | 'sortOrder'>): string {
  const column = SPAN_SORT_COLUMNS.get(params.sortBy ?? '') ?? 'start_time';
  const direction = String(params.sortOrder ?? '').toLowerCase() === 'desc' ? 'DESC' : 'ASC';
  return `ORDER BY ${column} ${direction}, span_id ASC`;
}

function hasSpanMatch(params: TraceQueryParams): boolean {
  return params.operation !== undefined || (params.attributeFilters?.length ?? 0) > 0;
}

/**
 * The span-match block of queryTraces, or null when neither `operation` nor
 * attribute filters are set: the trace must have one span, in the same
 * project and inside `[from, to]`, that matches the operation, every
 * attribute filter and, when given, `serviceName`, all together. Reuses the
 * outer `p_pids`, `p_from` and `p_to` parameters.
 */
export function traceSpanMatchSql(params: TraceQueryParams, queryParams: Record<string, unknown>): string | null {
  if (!hasSpanMatch(params)) return null;
  const conditions: string[] = [];
  if (params.projectId) {
    conditions.push('project_id IN {p_pids:Array(String)}');
    queryParams.p_pids = asList(params.projectId);
  }
  conditions.push('time >= {p_from:DateTime64(3)}', 'time <= {p_to:DateTime64(3)}');
  queryParams.p_from = toDateTime64(params.from);
  queryParams.p_to = toDateTime64(params.to);
  if (params.operation !== undefined) {
    conditions.push('operation_name = {p_op:String}');
    queryParams.p_op = params.operation;
  }
  if (params.serviceName) {
    conditions.push('service_name IN {p_ssvc:Array(String)}');
    queryParams.p_ssvc = asList(params.serviceName);
  }
  conditions.push(...attributePredicates(params.attributeFilters, queryParams, { attributes: 'p_taf', resource: 'p_trf' }));
  return `(project_id, trace_id) IN (SELECT project_id, trace_id FROM spans WHERE ${conditions.join(' AND ')})`;
}

/**
 * WHERE predicates of queryTraces (ANDed). While the span-match block is
 * active, `serviceName` applies to the matching span, not to the trace's
 * own `service_name` (only the first span seen at ingest).
 */
export function buildTraceConditions(params: TraceQueryParams, queryParams: Record<string, unknown>): string[] {
  const conditions: string[] = ['start_time >= {p_from:DateTime64(3)}', 'start_time <= {p_to:DateTime64(3)}'];
  queryParams.p_from = toDateTime64(params.from);
  queryParams.p_to = toDateTime64(params.to);

  if (params.projectId) {
    conditions.push('project_id IN {p_pids:Array(String)}');
    queryParams.p_pids = asList(params.projectId);
  }
  const spanMatch = traceSpanMatchSql(params, queryParams);
  if (params.serviceName && !spanMatch) {
    conditions.push('service_name IN {p_svc:Array(String)}');
    queryParams.p_svc = asList(params.serviceName);
  }
  if (params.error !== undefined) {
    conditions.push('error = {p_error:UInt8}');
    queryParams.p_error = params.error ? 1 : 0;
  }
  if (params.minDurationMs !== undefined) {
    conditions.push('duration_ms >= {p_minDur:UInt32}');
    queryParams.p_minDur = params.minDurationMs;
  }
  if (params.maxDurationMs !== undefined) {
    conditions.push('duration_ms <= {p_maxDur:UInt32}');
    queryParams.p_maxDur = params.maxDurationMs;
  }
  if (spanMatch) conditions.push(spanMatch);
  return conditions;
}

/** Trace ORDER BY: start_time (default) or duration, default descending, trace_id tie-break. */
export function traceOrderSql(params: Pick<TraceQueryParams, 'sortBy' | 'sortOrder'>): string {
  const column = params.sortBy === 'duration' ? 'duration_ms' : 'start_time';
  const direction = String(params.sortOrder ?? '').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  return `ORDER BY ${column} ${direction}, trace_id ASC`;
}
