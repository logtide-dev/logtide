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
import {
  DEFAULT_OPERATION_KINDS,
  DISCOVER_DEFAULT_SAMPLE_SIZE,
  FACETS_DEFAULT_LIMIT,
  LATENCY_HISTOGRAM_BOUNDS_MS,
  OPERATION_STATS_DEFAULT_LIMIT,
} from '../core/constants.js';
import {
  buildFacet,
  compareByteOrder,
  countMetadataKeys,
  decodeSessionCursor,
  encodeSessionCursor,
  latencyBucketIndex,
  zeroFillHistogram,
} from '../core/aggregation-helpers.js';
import type { StorageEngine } from '../core/storage-engine.js';
import {
  GLOBAL_SCOPE,
  type CountParams,
  type CountResult,
  type DiscoverMetadataKeysParams,
  type AggregationInterval,
  type DistinctParams,
  type DistinctResult,
  type IngestMetricsResult,
  type MetricAggregateParams,
  type MetricAggregateResult,
  type MetricAggregationFn,
  type MetricLabelParams,
  type MetricLabelResult,
  type MetricQueryParams,
  type MetricQueryResult,
  type MetricRecord,
  type StoredMetricRecord,
  type TopValuesParams,
  type TopValuesResult,
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
  type SessionSummary,
  type SpanKind,
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

/** D3 metadata semantics over `metadata` (logs) or one span attribute map. */
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

const RESOURCE_PREFIX = 'resource.';

/**
 * Span attribute filters (Wave D ruling C2): a key starting with `resource.`
 * reads `resourceAttributes` with the rest of the key, any other key reads
 * `attributes`; every filter must hold.
 */
function spanFiltersMatch(span: SpanRecord, filters: MetadataFilter[] | undefined): boolean {
  const attributes: MetadataFilter[] = [];
  const resource: MetadataFilter[] = [];
  for (const f of filters ?? []) {
    if (f.key.startsWith(RESOURCE_PREFIX) && f.key.length > RESOURCE_PREFIX.length) {
      resource.push({ ...f, key: f.key.slice(RESOURCE_PREFIX.length) });
    } else {
      attributes.push(f);
    }
  }
  return filtersMatch(span.attributes, attributes) && filtersMatch(span.resourceAttributes, resource);
}

function hostnameOf(log: LogRecord): string | undefined {
  const fromMetadata = log.metadata?.hostname;
  return typeof fromMetadata === 'string' ? fromMetadata : log.hostname;
}

/** A metric label: the literal attribute key (dots included), string values only. */
function metricLabel(metric: MetricRecord, key: string): string | undefined {
  const attributes = metric.attributes;
  if (!attributes || !Object.prototype.hasOwnProperty.call(attributes, key)) return undefined;
  const value = attributes[key];
  return typeof value === 'string' ? value : undefined;
}

const METRIC_INTERVAL_MS: Record<AggregationInterval, number> = {
  '1m': 60_000,
  '5m': 300_000,
  '15m': 900_000,
  '1h': 3_600_000,
  '6h': 21_600_000,
  '1d': 86_400_000,
  '1w': 604_800_000,
};

function aggregatePoints(points: StoredMetricRecord[], aggregation: MetricAggregationFn): number {
  const values = points.map((p) => p.value);
  switch (aggregation) {
    case 'sum':
      return values.reduce((a, b) => a + b, 0);
    case 'count':
      return values.length;
    case 'avg':
      return values.reduce((a, b) => a + b, 0) / values.length;
    case 'min':
      return Math.min(...values);
    case 'max':
      return Math.max(...values);
    default:
      throw new Error(`${NAME}: unsupported metric aggregation ${aggregation}`);
  }
}

/** Built-in columns topValues and distinct accept (the translators' ALLOWED_COLUMNS). */
const BUILTIN_FIELD_READERS: Record<string, (log: StoredLogRecord) => string | undefined> = {
  service: (log) => log.service,
  level: (log) => log.level,
  message: (log) => log.message,
  trace_id: (log) => log.traceId,
  span_id: (log) => log.spanId,
  project_id: (log) => log.projectId,
};

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

/** PostgreSQL `percentile_cont`: linear interpolation over the sorted values. */
function percentileCont(sorted: number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  const position = fraction * (sorted.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
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
  private metrics: StoredMetricRecord[] = [];
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

  /** Text values of `field` over the logs of the top values / distinct scope (S5 text, empty skipped). */
  private fieldValues(params: TopValuesParams | DistinctParams): { value: string; time: Date }[] {
    const field = params.field;
    const read = BUILTIN_FIELD_READERS[field];
    if (!read && !(field.startsWith('metadata.') && field.length > 'metadata.'.length)) {
      throw new Error(`${NAME}: unsupported field ${field}`);
    }
    const key = field.slice('metadata.'.length);
    const out: { value: string; time: Date }[] = [];
    for (const log of this.logs) {
      if (!logMatches(log, params)) continue;
      const value = read ? read(log) : metadataValueText(resolveMetadataPath(log.metadata, key));
      if (value === undefined || value === '') continue;
      out.push({ value, time: log.time });
    }
    return out;
  }

  async topValues(params: TopValuesParams): Promise<TopValuesResult> {
    const groups = new Map<string, { count: number; lastSeen: number }>();
    for (const { value, time } of this.fieldValues(params)) {
      const group = groups.get(value);
      if (group) {
        group.count++;
        group.lastSeen = Math.max(group.lastSeen, time.getTime());
      } else {
        groups.set(value, { count: 1, lastSeen: time.getTime() });
      }
    }
    const rows = [...groups]
      .map(([value, g]) => ({
        value,
        count: g.count,
        ...(params.includeLastSeen ? { lastSeen: new Date(g.lastSeen).toISOString() } : {}),
      }))
      .sort((a, b) => b.count - a.count || compareByteOrder(a.value, b.value));
    return { values: params.limit ? rows.slice(0, params.limit) : rows };
  }

  async distinct(params: DistinctParams): Promise<DistinctResult> {
    const values = [...new Set(this.fieldValues(params).map((v) => v.value))].sort(compareByteOrder);
    return { values: params.limit ? values.slice(0, params.limit) : values };
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

  /** Logs of the project in range with a non-empty session id (plan D6). */
  private sessionLogs(params: { projectId: string; from: Date; to: Date; service?: string }): StoredLogRecord[] {
    return this.logs.filter((log) =>
      log.projectId === params.projectId
      && inRange(log.time.getTime(), params)
      && typeof log.sessionId === 'string'
      && log.sessionId !== ''
      && (params.service === undefined || log.service === params.service));
  }

  async listSessions(params: ListSessionsParams): Promise<ListSessionsResult> {
    const groups = new Map<string, SessionSummary>();
    for (const log of this.sessionLogs(params)) {
      const id = log.sessionId!;
      const time = log.time.getTime();
      const isError = log.level === 'error' || log.level === 'critical' ? 1 : 0;
      const group = groups.get(id);
      if (!group) {
        groups.set(id, {
          sessionId: id, service: log.service, firstEvent: new Date(time), lastEvent: new Date(time), eventCount: 1, errorCount: isError,
        });
        continue;
      }
      if (compareByteOrder(log.service, group.service) < 0) group.service = log.service;
      if (time < group.firstEvent.getTime()) group.firstEvent = new Date(time);
      if (time > group.lastEvent.getTime()) group.lastEvent = new Date(time);
      group.eventCount++;
      group.errorCount += isError;
    }
    let rows = [...groups.values()].sort((a, b) =>
      b.lastEvent.getTime() - a.lastEvent.getTime() || compareByteOrder(a.sessionId, b.sessionId));
    if (params.cursor !== undefined) {
      const after = decodeSessionCursor(params.cursor);
      const at = after.lastEvent.getTime();
      rows = rows.filter((r) => {
        const last = r.lastEvent.getTime();
        return last < at || (last === at && compareByteOrder(r.sessionId, after.sessionId) > 0);
      });
    }
    const fetched = rows.slice(0, params.limit + 1);
    const sessions = fetched.slice(0, params.limit);
    const tail = sessions[sessions.length - 1];
    return fetched.length > params.limit
      ? { sessions, nextCursor: encodeSessionCursor(tail.lastEvent, tail.sessionId) }
      : { sessions };
  }

  async hasSessions(params: HasSessionsParams): Promise<boolean> {
    return this.sessionLogs(params).length > 0;
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
      && spanFiltersMatch(s, params.attributeFilters));
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
      // One span of the trace, starting inside [from, to], must match the
      // operation and every attribute filter together (Wave D ruling C3).
      return this.spans.some((s) =>
        s.projectId === t.projectId
        && s.traceId === t.traceId
        && inRange(s.time.getTime(), params)
        && (params.operation === undefined || s.operationName === params.operation)
        && spanFiltersMatch(s, params.attributeFilters));
    });
    const key = params.sortBy === 'duration' ? (t: TraceRecord) => t.durationMs : (t: TraceRecord) => t.startTime.getTime();
    const dir = params.sortOrder === 'asc' ? 1 : -1;
    rows.sort((a, b) => dir * (key(a) - key(b)) || compareByteOrder(a.traceId, b.traceId));
    const { rows: traces, ...rest } = page(rows, params.limit, params.offset);
    return { traces: structuredClone(traces), ...rest };
  }

  /**
   * Entry spans of the project (and service) in range: kinds in `kinds`
   * (default DEFAULT_OPERATION_KINDS); with `kinds` omitted and no such span
   * in that scope, the root spans of the same scope (plan D6).
   */
  private entrySpans(params: { projectId: string; service?: string; from: Date; to: Date; kinds?: SpanKind[] }): SpanRecord[] {
    const scope = this.spans.filter((s) =>
      s.projectId === params.projectId
      && (params.service === undefined || s.serviceName === params.service)
      && inRange(s.time.getTime(), params));
    const kinds: readonly SpanKind[] = params.kinds ?? DEFAULT_OPERATION_KINDS;
    const entries = scope.filter((s) => s.kind !== undefined && kinds.includes(s.kind));
    if (entries.length > 0 || params.kinds !== undefined) return entries;
    return scope.filter((s) => !s.parentSpanId);
  }

  async getOperationStats(params: OperationStatsParams): Promise<OperationStat[]> {
    const groups = new Map<string, { service: string; operation: string; durations: number[]; errorCount: number }>();
    for (const span of this.entrySpans(params)) {
      const key = JSON.stringify([span.serviceName, span.operationName]);
      let group = groups.get(key);
      if (!group) {
        group = { service: span.serviceName, operation: span.operationName, durations: [], errorCount: 0 };
        groups.set(key, group);
      }
      group.durations.push(span.durationMs);
      if (span.statusCode === 'ERROR') group.errorCount++;
    }
    const rows: OperationStat[] = [...groups.values()].map((g) => {
      const sorted = [...g.durations].sort((a, b) => a - b);
      return {
        service: g.service,
        operation: g.operation,
        count: sorted.length,
        errorCount: g.errorCount,
        avgMs: sorted.reduce((sum, d) => sum + d, 0) / sorted.length,
        p50Ms: percentileCont(sorted, 0.5),
        p95Ms: percentileCont(sorted, 0.95),
        p99Ms: percentileCont(sorted, 0.99),
      };
    });
    rows.sort((a, b) => b.count - a.count || compareByteOrder(a.service, b.service) || compareByteOrder(a.operation, b.operation));
    return rows.slice(0, params.limit ?? OPERATION_STATS_DEFAULT_LIMIT);
  }

  // --------------------------------------------------------------------------
  // Metrics (the subset the metric label cases use)
  // --------------------------------------------------------------------------

  async ingestMetrics(metrics: MetricRecord[]): Promise<IngestMetricsResult> {
    for (const metric of metrics) {
      this.metrics.push({ ...structuredClone(metric), id: `metric-${this.nextId++}`, hasExemplars: false });
    }
    return { ingested: metrics.length, failed: 0, durationMs: 0 };
  }

  private matchMetrics(params: {
    projectId: string | string[];
    organizationId?: string | string[];
    metricName?: string | string[];
    metricType?: string | string[];
    serviceName?: string | string[];
    from?: Date;
    to?: Date;
    fromExclusive?: boolean;
    toExclusive?: boolean;
    attributes?: Record<string, string>;
  }): StoredMetricRecord[] {
    const projects = asList(params.projectId)!;
    const orgs = asList(params.organizationId);
    const names = asList(params.metricName);
    const types = asList(params.metricType);
    const services = asList(params.serviceName);
    return this.metrics.filter((m) =>
      projects.includes(m.projectId)
      && (!orgs || orgs.includes(m.organizationId))
      && (!names || names.includes(m.metricName))
      && (!types || types.includes(m.metricType))
      && (!services || services.includes(m.serviceName))
      && (params.from === undefined || (params.fromExclusive ? m.time > params.from : m.time >= params.from))
      && (params.to === undefined || (params.toExclusive ? m.time < params.to : m.time <= params.to))
      // A label filter compares the literal attribute key with a string value.
      && Object.entries(params.attributes ?? {}).every(([key, value]) => metricLabel(m, key) === value));
  }

  async queryMetrics(params: MetricQueryParams): Promise<MetricQueryResult> {
    const rows = this.matchMetrics(params).sort((a, b) => a.time.getTime() - b.time.getTime());
    if (params.sortOrder !== 'asc') rows.reverse();
    const { rows: metrics, ...rest } = page(rows, params.limit, params.offset);
    return { metrics: structuredClone(metrics), ...rest };
  }

  async aggregateMetrics(params: MetricAggregateParams): Promise<MetricAggregateResult> {
    const bucketMs = METRIC_INTERVAL_MS[params.interval];
    const groupBy = params.groupBy ?? [];
    const groups = new Map<string, { bucket: number; labels: Record<string, string>; points: StoredMetricRecord[] }>();
    for (const m of this.matchMetrics(params)) {
      const bucket = Math.floor(m.time.getTime() / bucketMs) * bucketMs;
      const labels = Object.fromEntries(groupBy.map((key) => [key, metricLabel(m, key) ?? '']));
      const groupKey = JSON.stringify([bucket, groupBy.map((key) => labels[key])]);
      const group = groups.get(groupKey) ?? { bucket, labels, points: [] };
      group.points.push(m);
      groups.set(groupKey, group);
    }
    const timeseries = [...groups.values()]
      .sort((a, b) => a.bucket - b.bucket)
      .map((g) => ({
        bucket: new Date(g.bucket),
        value: aggregatePoints(g.points, params.aggregation),
        ...(groupBy.length > 0 ? { labels: g.labels } : {}),
      }));
    return { metricName: params.metricName, metricType: params.metricType ?? 'gauge', timeseries };
  }

  async getMetricLabelValues(params: MetricLabelParams, labelKey: string): Promise<MetricLabelResult> {
    const values = new Set<string>();
    for (const m of this.matchMetrics(params)) {
      const value = metricLabel(m, labelKey);
      if (value !== undefined && value !== '') values.add(value);
    }
    const sorted = [...values].sort(compareByteOrder);
    return { values: params.limit ? sorted.slice(0, params.limit) : sorted };
  }

  async getLatencyHistogram(params: LatencyHistogramParams): Promise<LatencyHistogramResult> {
    const counts = Array.from({ length: LATENCY_HISTOGRAM_BOUNDS_MS.length + 1 }, () => 0);
    for (const span of this.entrySpans(params)) {
      if (params.operation !== undefined && span.operationName !== params.operation) continue;
      counts[latencyBucketIndex(span.durationMs)]++;
    }
    return { bounds: [...LATENCY_HISTOGRAM_BOUNDS_MS], counts };
  }
}

/** A Reservoir over a fresh, empty reference engine, initialized. */
export async function createReferenceReservoir(): Promise<Reservoir> {
  const reservoir = Reservoir.fromEngine(new ReferenceEngine() as unknown as StorageEngine);
  await reservoir.initialize();
  return reservoir;
}
