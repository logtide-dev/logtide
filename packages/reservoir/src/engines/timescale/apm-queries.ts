// ============================================================================
// TimescaleDB APM queries (spec 6.4, plan S10 to S12)
// ============================================================================
// Span and trace filters and sort orders, plus (TS-9) the entry-span
// queries behind operation stats and the latency histogram. Values are
// always bound parameters; the only interpolated pieces are the schema and
// column names from fixed allowlists.

import type { MetadataFilter, SpanQueryParams, TraceQueryParams } from '../../core/types.js';
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
 * The span-match block of queryTraces (S12, F3 contract): active when
 * `operation` or `attributeFilters` is set, it keeps traces with one span
 * matching the operation and every attribute filter together. Only a lower
 * time bound is applied to that span, for chunk exclusion: a trace starts
 * at its first span (upsertTrace keeps the LEAST start), so every span of
 * a trace in the window starts at or after `from`. `serviceName` stays a
 * trace-level filter (F3, conformance TQ08). Inactive block: `condition`
 * is null.
 */
export function traceSpanMatchSql(
  params: Pick<TraceQueryParams, 'from' | 'operation' | 'attributeFilters'>,
  startIdx: number,
  schema: string,
): { condition: string | null; values: unknown[]; nextIdx: number } {
  const hasFilters = (params.attributeFilters?.length ?? 0) > 0;
  if (params.operation === undefined && !hasFilters) return { condition: null, values: [], nextIdx: startIdx };

  const out: SqlConditions = { conditions: [], values: [], nextIdx: startIdx };
  out.conditions.push('s.project_id = traces.project_id', 's.trace_id = traces.trace_id');
  out.values.push(params.from);
  out.conditions.push(`s.time >= $${out.nextIdx++}`);
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
