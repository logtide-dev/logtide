// ============================================================================
// In-memory reference engine for the conformance suite
// ============================================================================
// Implements the 1.6 semantics (plan D3, D6) directly over arrays so the whole
// suite runs in CI without databases. Log text and metadata matching reuse
// `matchesLogSearch`, the same oracle live tail uses. It is wrapped by the
// normalizing `Reservoir` client exactly like a real engine, and it asserts
// the client contract: `matchNothing` and the span `operation` alias never
// reach an engine.

import { matchesLogSearch, metadataValueText, resolveMetadataPath } from '@logtide/shared';
import type { FieldClause, LogSearchQuery } from '@logtide/shared';
import { Reservoir } from '../client.js';
import { NotImplementedError } from '../core/errors.js';
import { FACETS_DEFAULT_LIMIT, DISCOVER_DEFAULT_SAMPLE_SIZE } from '../core/constants.js';
import { buildFacet, compareByteOrder, countMetadataKeys, zeroFillHistogram } from '../core/aggregation-helpers.js';
import type { StorageEngine } from '../core/storage-engine.js';
import {
  GLOBAL_SCOPE,
  type CountParams,
  type CountResult,
  type DiscoverMetadataKeysParams,
  type EngineCapabilities,
  type EngineType,
  type HasSessionsParams,
  type HealthStatus,
  type IngestResult,
  type IngestSpansResult,
  type LatencyHistogramParams,
  type LatencyHistogramResult,
  type ListSessionsParams,
  type ListSessionsResult,
  type LogFacetField,
  type LogFacetsParams,
  type LogFacetsResult,
  type LogFilterParams,
  type LogHistogramParams,
  type LogHistogramResult,
  type LogLevel,
  type LogRecord,
  type MetadataFilter,
  type MetadataKeyOccurrence,
  type OperationStat,
  type OperationStatsParams,
  type QueryParams,
  type QueryResult,
  type SpanQueryParams,
  type SpanQueryResult,
  type SpanRecord,
  type StoredLogRecord,
  type TextQuery,
  type TraceQueryParams,
  type TraceQueryResult,
  type TraceRecord,
} from '../core/types.js';

const NAME = 'ReferenceEngine';
const EMPTY_TEXT: TextQuery = { all: [], anyOf: [], none: [] };

const asList = <T>(v: T | T[] | undefined): T[] | undefined => (v === undefined ? undefined : Array.isArray(v) ? v : [v]);

function inRange(t: number, p: { from: Date; to: Date; fromExclusive?: boolean; toExclusive?: boolean }): boolean {
  const from = p.from.getTime();
  const to = p.to.getTime();
  return (p.fromExclusive ? t > from : t >= from) && (p.toExclusive ? t < to : t <= to);
}

function toClause(f: MetadataFilter): FieldClause {
  const field = { metadata: f.key };
  switch (f.op) {
    case 'in':
    case 'not_in':
      return { field, op: f.op, values: f.values ?? [] };
    case 'exists':
    case 'not_exists':
      return { field, op: f.op };
    default:
      return { field, op: f.op, value: f.value ?? '' };
  }
}

/** D3 metadata semantics over `metadata` (logs) or `attributes` (spans). */
function filtersMatch(
  values: Record<string, unknown> | undefined,
  filters: MetadataFilter[] | undefined,
  text: TextQuery = EMPTY_TEXT,
  message = '',
): boolean {
  const query: LogSearchQuery = { text, fields: (filters ?? []).map(toClause) };
  if (!matchesLogSearch({ message, level: '', service: '', metadata: values ?? null }, query)) return false;
  for (const f of filters ?? []) {
    // include_missing: false on a value exclusion also requires the key to resolve.
    if ((f.op === 'not_equals' || f.op === 'not_in') && f.include_missing === false) {
      if (resolveMetadataPath(values, f.key) === undefined) return false;
    }
  }
  return true;
}

function hostnameOf(log: LogRecord): string | undefined {
  const fromMetadata = log.metadata?.hostname;
  return typeof fromMetadata === 'string' ? fromMetadata : log.hostname;
}

function assertNoClientOnlyParams(params: object, method: string): void {
  if ('matchNothing' in params) throw new Error(`${method}: matchNothing must be answered by the client, never sent to an engine`);
}

function logMatches(log: StoredLogRecord, p: LogFilterParams): boolean {
  if (p.projectId !== GLOBAL_SCOPE && !asList(p.projectId)!.includes(log.projectId)) return false;
  if (!inRange(log.time.getTime(), p)) return false;
  const services = asList(p.service);
  if (services && !services.includes(log.service)) return false;
  const levels = asList(p.level);
  if (levels && !levels.includes(log.level)) return false;
  const host = hostnameOf(log);
  const hosts = asList(p.hostname);
  if (hosts && (host === undefined || !hosts.includes(host))) return false;
  if (p.traceId !== undefined && log.traceId !== p.traceId) return false;
  if (p.sessionId !== undefined && log.sessionId !== p.sessionId) return false;
  if (p.spanId !== undefined && log.spanId !== p.spanId) return false;
  const ex = p.exclude;
  if (ex?.service && ex.service.includes(log.service)) return false;
  if (ex?.level && ex.level.includes(log.level)) return false;
  // A hostname exclusion keeps logs without a hostname.
  if (ex?.hostname && host !== undefined && ex.hostname.includes(host)) return false;
  return filtersMatch(log.metadata, p.metadataFilters, p.textQuery ?? EMPTY_TEXT, log.message);
}

/** The text form a facet counts for one log; undefined when the log has none. */
function facetValue(log: StoredLogRecord, field: LogFacetField): string | undefined {
  if ('builtin' in field) {
    if (field.builtin === 'hostname') return hostnameOf(log);
    return field.builtin === 'level' ? log.level : log.service;
  }
  return metadataValueText(resolveMetadataPath(log.metadata, field.metadata));
}

function compareLogs(a: StoredLogRecord, b: StoredLogRecord): number {
  return a.time.getTime() - b.time.getTime() || compareByteOrder(a.id, b.id);
}

const SPAN_SORT_KEYS: Record<string, (s: SpanRecord) => number | string> = {
  start_time: (s) => s.startTime.getTime(),
  end_time: (s) => s.endTime.getTime(),
  duration_ms: (s) => s.durationMs,
  service_name: (s) => s.serviceName,
  operation_name: (s) => s.operationName,
};

function compareValues(a: number | string, b: number | string): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return compareByteOrder(String(a), String(b));
}

function page<T>(rows: T[], limit: number | undefined, offset: number | undefined) {
  const l = limit ?? 50;
  const o = offset ?? 0;
  const slice = rows.slice(o, o + l);
  return { rows: slice, total: rows.length, hasMore: o + slice.length < rows.length, limit: l, offset: o };
}

export class ReferenceEngine {
  private logs: StoredLogRecord[] = [];
  private spans: SpanRecord[] = [];
  private traces = new Map<string, TraceRecord>();
  private nextId = 1;

  async connect(): Promise<void> {}

  async disconnect(): Promise<void> {}

  async initialize(): Promise<void> {}

  getCapabilities(): EngineCapabilities {
    return {
      engine: 'reference' as unknown as EngineType,
      supportsFullTextSearch: true,
      supportsAggregations: true,
      supportsStreaming: false,
      supportsTransactions: false,
      maxBatchSize: 100_000,
      nativeCompression: false,
      nativeTiering: false,
      supportedOperators: [],
      supportedIntervals: [],
    };
  }

  async healthCheck(): Promise<HealthStatus> {
    return { status: 'healthy', engine: 'reference' as unknown as EngineType, connected: true, responseTimeMs: 0 };
  }

  // --------------------------------------------------------------------------
  // Logs
  // --------------------------------------------------------------------------

  async ingest(logs: LogRecord[]): Promise<IngestResult> {
    for (const log of logs) {
      const id = log.id ?? `00000000-0000-4000-8000-${(this.nextId++).toString(16).padStart(12, '0')}`;
      this.logs.push({ ...structuredClone(log), id });
    }
    return { ingested: logs.length, failed: 0, durationMs: 0 };
  }

  private matchLogs(params: LogFilterParams & { filters?: unknown[]; cursor?: string }, method: string): StoredLogRecord[] {
    assertNoClientOnlyParams(params, method);
    if (params.filters && params.filters.length > 0) throw new Error(`${NAME} does not support legacy filters`);
    if (params.cursor !== undefined) throw new Error(`${NAME} does not support cursors`);
    return this.logs.filter((log) => logMatches(log, params));
  }

  async query(params: QueryParams): Promise<QueryResult<StoredLogRecord>> {
    const rows = this.matchLogs(params, 'query').sort(compareLogs);
    if (params.sortOrder !== 'asc') rows.reverse();
    const { rows: logs, ...rest } = page(rows, params.limit, params.offset);
    return { logs: structuredClone(logs), ...rest };
  }

  async count(params: CountParams): Promise<CountResult> {
    return { count: this.matchLogs(params, 'count').length };
  }

  async countEstimate(params: CountParams): Promise<CountResult> {
    return { count: this.matchLogs(params, 'countEstimate').length };
  }

  async histogram(params: LogHistogramParams): Promise<LogHistogramResult> {
    const b = params.bucketSeconds * 1000;
    const groups = new Map<string, { time: Date; level: LogLevel; count: number }>();
    for (const log of this.matchLogs(params, 'histogram')) {
      const start = Math.floor(log.time.getTime() / b) * b;
      const key = `${start}|${log.level}`;
      const group = groups.get(key);
      if (group) group.count++;
      else groups.set(key, { time: new Date(start), level: log.level, count: 1 });
    }
    return zeroFillHistogram(params, [...groups.values()]);
  }

  async facets(params: LogFacetsParams): Promise<LogFacetsResult> {
    const rows = this.matchLogs(params, 'facets');
    const limit = params.limit ?? FACETS_DEFAULT_LIMIT;
    const facets = params.fields.map((field) => {
      const counts = new Map<string, number>();
      let present = 0;
      for (const log of rows) {
        const value = facetValue(log, field);
        if (value === undefined || value === '') continue;
        present++;
        counts.set(value, (counts.get(value) ?? 0) + 1);
      }
      return buildFacet(field, [...counts].map(([value, count]) => ({ value, count })), present, limit);
    });
    return { facets };
  }

  async discoverMetadataKeys(params: DiscoverMetadataKeysParams): Promise<MetadataKeyOccurrence[]> {
    assertNoClientOnlyParams(params, 'discoverMetadataKeys');
    const projects = asList(params.projectId)!;
    const sample = this.logs
      .filter((log) => projects.includes(log.projectId) && inRange(log.time.getTime(), params))
      .sort((a, b) => compareLogs(b, a))
      .slice(0, params.sampleSize ?? DISCOVER_DEFAULT_SAMPLE_SIZE);
    return countMetadataKeys(sample.map((log) => log.metadata));
  }

  async listSessions(_params: ListSessionsParams): Promise<ListSessionsResult> {
    throw new NotImplementedError('listSessions', NAME);
  }

  async hasSessions(_params: HasSessionsParams): Promise<boolean> {
    throw new NotImplementedError('hasSessions', NAME);
  }

  // --------------------------------------------------------------------------
  // Spans and traces
  // --------------------------------------------------------------------------

  async ingestSpans(spans: SpanRecord[]): Promise<IngestSpansResult> {
    for (const span of spans) this.spans.push(structuredClone(span));
    return { ingested: spans.length, failed: 0, durationMs: 0 };
  }

  async upsertTrace(trace: TraceRecord): Promise<void> {
    this.traces.set(`${trace.projectId}|${trace.traceId}`, structuredClone(trace));
  }

  async querySpans(params: SpanQueryParams): Promise<SpanQueryResult> {
    if ('operation' in params) throw new Error('querySpans: the client maps operation to operationName before the engine');
    const projects = asList(params.projectId);
    const orgs = asList(params.organizationId);
    const traces = asList(params.traceId);
    const services = asList(params.serviceName);
    const operations = asList(params.operationName);
    const kinds = asList(params.kind);
    const statuses = asList(params.statusCode);
    const rows = this.spans.filter((s) =>
      (!projects || projects.includes(s.projectId))
      && (!orgs || (s.organizationId !== undefined && orgs.includes(s.organizationId)))
      && inRange(s.time.getTime(), params)
      && (!traces || traces.includes(s.traceId))
      && (!services || services.includes(s.serviceName))
      && (!operations || operations.includes(s.operationName))
      && (!kinds || (s.kind !== undefined && kinds.includes(s.kind)))
      && (!statuses || (s.statusCode !== undefined && statuses.includes(s.statusCode)))
      && filtersMatch(s.attributes, params.attributeFilters));
    const key = SPAN_SORT_KEYS[params.sortBy ?? 'start_time'] ?? SPAN_SORT_KEYS.start_time;
    const dir = params.sortOrder === 'desc' ? -1 : 1;
    rows.sort((a, b) => dir * compareValues(key(a), key(b)) || compareByteOrder(a.spanId, b.spanId));
    const { rows: spans, ...rest } = page(rows, params.limit, params.offset);
    return { spans: structuredClone(spans), ...rest };
  }

  async queryTraces(params: TraceQueryParams): Promise<TraceQueryResult> {
    const projects = asList(params.projectId);
    const orgs = asList(params.organizationId);
    const services = asList(params.serviceName);
    const from = params.from.getTime();
    const to = params.to.getTime();
    const needsSpan = params.operation !== undefined || (params.attributeFilters?.length ?? 0) > 0;
    const rows = [...this.traces.values()].filter((t) => {
      const start = t.startTime.getTime();
      if (projects && !projects.includes(t.projectId)) return false;
      if (orgs && (t.organizationId === undefined || !orgs.includes(t.organizationId))) return false;
      if (start < from || start > to) return false;
      if (services && !services.includes(t.serviceName)) return false;
      if (params.error !== undefined && t.error !== params.error) return false;
      if (params.minDurationMs !== undefined && t.durationMs < params.minDurationMs) return false;
      if (params.maxDurationMs !== undefined && t.durationMs > params.maxDurationMs) return false;
      if (!needsSpan) return true;
      // One span of the trace must match the operation and every attribute filter together.
      return this.spans.some((s) =>
        s.projectId === t.projectId
        && s.traceId === t.traceId
        && (params.operation === undefined || s.operationName === params.operation)
        && filtersMatch(s.attributes, params.attributeFilters));
    });
    const key = params.sortBy === 'duration' ? (t: TraceRecord) => t.durationMs : (t: TraceRecord) => t.startTime.getTime();
    const dir = params.sortOrder === 'asc' ? 1 : -1;
    rows.sort((a, b) => dir * (key(a) - key(b)) || compareByteOrder(a.traceId, b.traceId));
    const { rows: traces, ...rest } = page(rows, params.limit, params.offset);
    return { traces: structuredClone(traces), ...rest };
  }

  async getOperationStats(_params: OperationStatsParams): Promise<OperationStat[]> {
    throw new NotImplementedError('getOperationStats', NAME);
  }

  async getLatencyHistogram(_params: LatencyHistogramParams): Promise<LatencyHistogramResult> {
    throw new NotImplementedError('getLatencyHistogram', NAME);
  }
}

/** A Reservoir over a fresh, empty reference engine, initialized. */
export async function createReferenceReservoir(): Promise<Reservoir> {
  const reservoir = Reservoir.fromEngine(new ReferenceEngine() as unknown as StorageEngine);
  await reservoir.initialize();
  return reservoir;
}
