// ============================================================================
// TimescaleDB APM queries (spec 6.4, plan S10 to S12)
// ============================================================================
// Span and trace filters and sort orders, plus (TS-9) the entry-span
// queries behind operation stats and the latency histogram. Values are
// always bound parameters; the only interpolated pieces are the schema and
// column names from fixed allowlists.

import type { NativeQuery } from '../../core/query-translator.js';
import { DEFAULT_OPERATION_KINDS, LATENCY_HISTOGRAM_BOUNDS_MS } from '../../core/constants.js';
import type { MetadataFilter, OperationStat, SpanKind, SpanQueryParams, TraceQueryParams } from '../../core/types.js';
import { compileJsonFilters } from './json-path.js';

export interface SqlConditions {
  conditions: string[];
  values: unknown[];
  nextIdx: number;
}

const RESOURCE_PREFIX = 'resource.';

const asList = <T>(value: T | T[]): T[] => (Array.isArray(value) ? value : [value]);

/**
 * Splits span attribute filters by column (S4): a key starting with
 * `resource.` addresses `resource_attributes` with the rest of the key,
 * any other key addresses `attributes`.
 */
export function routeAttributeFilters(filters: MetadataFilter[]): { attributes: MetadataFilter[]; resource: MetadataFilter[] } {
  const attributes: MetadataFilter[] = [];
  const resource: MetadataFilter[] = [];
  for (const filter of filters) {
    if (filter.key.startsWith(RESOURCE_PREFIX) && filter.key.length > RESOURCE_PREFIX.length) {
      resource.push({ ...filter, key: filter.key.slice(RESOURCE_PREFIX.length) });
    } else {
      attributes.push(filter);
    }
  }
  return { attributes, resource };
}

/** Attribute filters on `attributes`/`resource_attributes` (or the `s.` aliased columns). */
function pushAttributeFilters(out: SqlConditions, filters: MetadataFilter[] | undefined, alias: '' | 's.'): void {
  if (!filters || filters.length === 0) return;
  const { attributes, resource } = routeAttributeFilters(filters);
  for (const [list, column] of [
    [attributes, alias === 's.' ? 's.attributes' : 'attributes'],
    [resource, alias === 's.' ? 's.resource_attributes' : 'resource_attributes'],
  ] as const) {
    if (list.length === 0) continue;
    const compiled = compileJsonFilters(list, column, out.nextIdx);
    out.conditions.push(...compiled.conditions);
    out.values.push(...compiled.values);
    out.nextIdx = compiled.nextIdx;
  }
}

/**
 * WHERE conditions of querySpans (count and page share them): time range,
 * project, trace, service, operation (`operationName` list and the
 * `operation` alias, AND when both are set), kind, status and attribute
 * filters (S12).
 */
export function buildSpanConditions(params: SpanQueryParams, startIdx: number): SqlConditions {
  const out: SqlConditions = { conditions: [], values: [], nextIdx: startIdx };
  const bind = (value: unknown): string => {
    out.values.push(value);
    return `$${out.nextIdx++}`;
  };

  out.conditions.push(`time ${params.fromExclusive ? '>' : '>='} ${bind(params.from)}`);
  out.conditions.push(`time ${params.toExclusive ? '<' : '<='} ${bind(params.to)}`);
  if (params.projectId) out.conditions.push(`project_id = ANY(${bind(asList(params.projectId))})`);
  if (params.traceId) out.conditions.push(`trace_id = ANY(${bind(asList(params.traceId))})`);
  if (params.serviceName) out.conditions.push(`service_name = ANY(${bind(asList(params.serviceName))})`);
  if (params.operationName) out.conditions.push(`operation_name = ANY(${bind(asList(params.operationName))})`);
  if (params.operation !== undefined) out.conditions.push(`operation_name = ${bind(params.operation)}`);
  if (params.kind) out.conditions.push(`kind = ANY(${bind(asList(params.kind))})`);
  if (params.statusCode) out.conditions.push(`status_code = ANY(${bind(asList(params.statusCode))})`);
  pushAttributeFilters(out, params.attributeFilters, '');
  return out;
}

/** Span sort keys to SQL; text columns sort in byte order (S6). */
const SPAN_SORT_SQL: Record<string, string> = {
  start_time: 'start_time',
  end_time: 'end_time',
  duration: 'duration_ms',
  duration_ms: 'duration_ms',
  service_name: 'service_name COLLATE "C"',
  operation_name: 'operation_name COLLATE "C"',
};

/** `ORDER BY` of querySpans: default `start_time ASC`, unknown keys fall back to it, tie-break `span_id ASC`. */
export function spanOrderSql(params: Pick<SpanQueryParams, 'sortBy' | 'sortOrder'>): string {
  const key = params.sortBy !== undefined && Object.hasOwn(SPAN_SORT_SQL, params.sortBy) ? SPAN_SORT_SQL[params.sortBy] : 'start_time';
  const order = String(params.sortOrder ?? '').toLowerCase() === 'desc' ? 'DESC' : 'ASC';
  return `ORDER BY ${key} ${order}, span_id ASC`;
}

/**
 * The span-match block of queryTraces (S12, F3 contract, Wave D ruling C3):
 * active when `operation` or `attributeFilters` is set, it keeps traces
 * with one span starting inside [from, to] that matches the operation and
 * every attribute filter together (conformance TQ12, TQ13). `serviceName`
 * stays a trace-level filter (conformance TQ08, TQ10, TQ11). Inactive
 * block: `condition` is null.
 */
export function traceSpanMatchSql(
  params: Pick<TraceQueryParams, 'from' | 'to' | 'operation' | 'attributeFilters'>,
  startIdx: number,
  schema: string,
): { condition: string | null; values: unknown[]; nextIdx: number } {
  const hasFilters = (params.attributeFilters?.length ?? 0) > 0;
  if (params.operation === undefined && !hasFilters) return { condition: null, values: [], nextIdx: startIdx };

  const out: SqlConditions = { conditions: [], values: [], nextIdx: startIdx };
  out.conditions.push('s.project_id = traces.project_id', 's.trace_id = traces.trace_id');
  out.values.push(params.from);
  out.conditions.push(`s.time >= $${out.nextIdx++}`);
  out.values.push(params.to);
  out.conditions.push(`s.time <= $${out.nextIdx++}`);
  if (params.operation !== undefined) {
    out.values.push(params.operation);
    out.conditions.push(`s.operation_name = $${out.nextIdx++}`);
  }
  pushAttributeFilters(out, params.attributeFilters, 's.');
  return {
    condition: `EXISTS (SELECT 1 FROM ${schema}.spans s WHERE ${out.conditions.join(' AND ')})`,
    values: out.values,
    nextIdx: out.nextIdx,
  };
}

/** `ORDER BY` of queryTraces: `start_time` (default) or `duration`, default `DESC`, tie-break `trace_id ASC`. */
export function traceOrderSql(params: Pick<TraceQueryParams, 'sortBy' | 'sortOrder'>): string {
  const key = params.sortBy === 'duration' ? 'duration_ms' : 'start_time';
  const order = String(params.sortOrder ?? '').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  return `ORDER BY ${key} ${order}, trace_id ASC`;
}

// ----------------------------------------------------------------------------
// Entry spans: operation stats and latency histogram (S10, S11, F3 contract)
// ----------------------------------------------------------------------------
// Entry spans are the spans of the project (and service) in the window whose
// kind is in `kinds` (default SERVER and CONSUMER). With `kinds` omitted and
// no such span in that scope, the root spans of the same scope are used
// instead; explicit kinds never fall back. The latency histogram decides the
// population on the project and service scope first and only then filters
// by operation.

/** `kinds` mode selects entry kinds, `root` mode selects root spans. */
export type EntryMode = 'kinds' | 'root';

interface EntryScope {
  projectId: string;
  service?: string;
  from: Date;
  to: Date;
  kinds?: SpanKind[];
}

const ROOT_SPAN_SQL = "(parent_span_id IS NULL OR parent_span_id = '')";

/** Latency thresholds for the upper-inclusive buckets, see latencyHistogramSql. */
const NEGATED_LATENCY_BOUNDS: readonly number[] = Object.freeze([...LATENCY_HISTOGRAM_BOUNDS_MS].reverse().map((b) => -b));

/** The entry kinds of a call: `kinds` when given, else DEFAULT_OPERATION_KINDS. */
export function entryKinds(kinds: SpanKind[] | undefined): SpanKind[] {
  return kinds !== undefined ? [...kinds] : [...DEFAULT_OPERATION_KINDS];
}

/** Scope plus selection conditions shared by the entry span queries, bound from $1. */
function entryConditions(p: EntryScope, mode: EntryMode, operation?: string): SqlConditions {
  const out: SqlConditions = { conditions: [], values: [], nextIdx: 1 };
  const bind = (value: unknown): string => {
    out.values.push(value);
    return `$${out.nextIdx++}`;
  };
  out.conditions.push(`project_id = ${bind(p.projectId)}`, `time >= ${bind(p.from)}`, `time <= ${bind(p.to)}`);
  if (p.service !== undefined) out.conditions.push(`service_name = ${bind(p.service)}`);
  out.conditions.push(mode === 'kinds' ? `kind = ANY(${bind(entryKinds(p.kinds))})` : ROOT_SPAN_SQL);
  if (operation !== undefined) out.conditions.push(`operation_name = ${bind(operation)}`);
  return out;
}

/** Whether the scope has one span of the entry kinds (`LIMIT 1` probe). */
export function entryProbeSql(schema: string, p: EntryScope): NativeQuery {
  const { conditions, values } = entryConditions(p, 'kinds');
  return { query: `SELECT 1 FROM ${schema}.spans WHERE ${conditions.join(' AND ')} LIMIT 1`, parameters: values };
}

/**
 * Per (service, operation) stats of the selected spans: exact
 * `percentile_cont` percentiles, ordered by count desc, then service and
 * operation in byte order (S6), cut to `limit`.
 */
export function operationStatsSql(schema: string, p: EntryScope & { limit: number }, mode: EntryMode): NativeQuery {
  const { conditions, values, nextIdx } = entryConditions(p, mode);
  values.push(p.limit);
  const query =
    `SELECT service_name, operation_name, COUNT(*)::bigint AS cnt, ` +
    `(COUNT(*) FILTER (WHERE status_code = 'ERROR'))::bigint AS error_count, ` +
    `AVG(duration_ms)::float8 AS avg_ms, ` +
    `percentile_cont(ARRAY[0.5, 0.95, 0.99]) WITHIN GROUP (ORDER BY duration_ms) AS p ` +
    `FROM ${schema}.spans WHERE ${conditions.join(' AND ')} ` +
    `GROUP BY service_name, operation_name ` +
    `ORDER BY cnt DESC, service_name COLLATE "C" ASC, operation_name COLLATE "C" ASC LIMIT $${nextIdx}`;
  return { query, parameters: values };
}

/**
 * Span counts per latency bucket index of the selected spans (and
 * operation). Buckets are upper-inclusive (`bounds[i-1] < d <= bounds[i]`),
 * so the index is the number of bounds below the duration. `width_bucket`
 * counts thresholds at or below its operand, hence the negation: the
 * number of bounds `>= d` is `width_bucket(-d, negated bounds ascending)`,
 * and the index is the bound count minus that.
 */
export function latencyHistogramSql(schema: string, p: EntryScope & { operation?: string }, mode: EntryMode): NativeQuery {
  const { conditions, values, nextIdx } = entryConditions(p, mode, p.operation);
  values.push([...NEGATED_LATENCY_BOUNDS]);
  const query =
    `SELECT ${LATENCY_HISTOGRAM_BOUNDS_MS.length} - width_bucket((-duration_ms)::float8, $${nextIdx}::float8[]) AS idx, ` +
    `COUNT(*)::bigint AS n FROM ${schema}.spans WHERE ${conditions.join(' AND ')} GROUP BY 1`;
  return { query, parameters: values };
}

export interface OperationStatRow {
  service_name: string;
  operation_name: string;
  /** pg returns bigint as a string. */
  cnt: number | string;
  error_count: number | string;
  avg_ms: number | string;
  /** float8[] of p50, p95, p99. */
  p: (number | string)[];
}

export function operationStatRows(rows: OperationStatRow[]): OperationStat[] {
  return rows.map((row) => ({
    service: row.service_name,
    operation: row.operation_name,
    count: Number(row.cnt),
    errorCount: Number(row.error_count),
    avgMs: Number(row.avg_ms),
    p50Ms: Number(row.p[0]),
    p95Ms: Number(row.p[1]),
    p99Ms: Number(row.p[2]),
  }));
}

/** `bounds.length + 1` counts from `(idx, n)` rows. */
export function latencyCounts(rows: { idx: number | string; n: number | string }[]): number[] {
  const counts = Array.from({ length: LATENCY_HISTOGRAM_BOUNDS_MS.length + 1 }, () => 0);
  for (const row of rows) counts[Number(row.idx)] += Number(row.n);
  return counts;
}
