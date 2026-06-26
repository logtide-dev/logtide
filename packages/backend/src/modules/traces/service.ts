import { db } from '../../database/index.js';
import { pool } from '../../database/connection.js';
import { reservoir } from '../../database/reservoir.js';
import { projectsService } from '../projects/service.js';
import { recordSpanIngestion } from '../metering/index.js';
import { piiMaskingService } from '../pii-masking/service.js';
import type { TransformedSpan, AggregatedTrace } from '../otlp/trace-transformer.js';
import type {
  SpanRecord as ReservoirSpanRecord,
  TraceRecord as ReservoirTraceRecord,
} from '@logtide/reservoir';

export interface TraceListQuery {
  projectId: string | string[];
  service?: string | string[];
  error?: boolean;
  from?: Date;
  to?: Date;
  minDurationMs?: number;
  maxDurationMs?: number;
  limit?: number;
  offset?: number;
}

export interface TraceListResult {
  traces: TraceRecord[];
  total: number;
}

export interface TraceRecord {
  trace_id: string;
  service_name: string;
  root_service_name: string | null;
  root_operation_name: string | null;
  start_time: Date;
  end_time: Date;
  duration_ms: number;
  span_count: number;
  error: boolean;
}

export interface SpanRecord {
  span_id: string;
  trace_id: string;
  parent_span_id: string | null;
  service_name: string;
  operation_name: string;
  start_time: Date;
  end_time: Date;
  duration_ms: number;
  kind: string | null;
  status_code: string | null;
  status_message: string | null;
  attributes: Record<string, unknown> | null;
  events: Array<Record<string, unknown>> | null;
  links: Array<Record<string, unknown>> | null;
  resource_attributes: Record<string, unknown> | null;
}

// Service map enriched types
export interface ServiceHealthStats {
  service_name: string;
  total_calls: number;
  total_errors: number;
  error_rate: number;
  avg_latency_ms: number;
  p95_latency_ms: number | null;
}

export interface EnrichedServiceDependencyNode {
  id: string;
  name: string;
  callCount: number;
  errorRate: number;
  avgLatencyMs: number;
  p95LatencyMs: number | null;
  totalCalls: number;
}

export interface EnrichedServiceDependencyEdge {
  source: string;
  target: string;
  callCount: number;
  type: 'span' | 'log_correlation';
}

export interface EnrichedServiceDependencies {
  nodes: EnrichedServiceDependencyNode[];
  edges: EnrichedServiceDependencyEdge[];
}

interface LogCoOccurrenceRow {
  source_service: string;
  target_service: string;
  co_occurrence_count: number;
}

export class TracesService {
  async ingestSpans(
    spans: TransformedSpan[],
    traces: Map<string, AggregatedTrace>,
    projectId: string,
    organizationId: string
  ): Promise<number> {
    if (spans.length === 0) return 0;

    const reservoirSpans: ReservoirSpanRecord[] = spans.map((span) => ({
      time: new Date(span.start_time),
      spanId: span.span_id,
      traceId: span.trace_id,
      parentSpanId: span.parent_span_id || undefined,
      organizationId,
      projectId,
      serviceName: span.service_name,
      operationName: span.operation_name,
      startTime: new Date(span.start_time),
      endTime: new Date(span.end_time),
      durationMs: span.duration_ms,
      kind: span.kind || undefined,
      statusCode: span.status_code || undefined,
      statusMessage: span.status_message || undefined,
      attributes: span.attributes || undefined,
      events: span.events as Array<Record<string, unknown>> | undefined,
      links: span.links as Array<Record<string, unknown>> | undefined,
      resourceAttributes: span.resource_attributes || undefined,
    }));

    // PII masking (fail-closed): mask span attributes in place and drop any
    // span whose masking fails, so unmasked attributes (request/response bodies,
    // tokens, IPs) never reach storage. Mirrors the log ingestion path.
    const failedIdx = await piiMaskingService.maskSpanBatch(
      reservoirSpans,
      organizationId,
      projectId
    );
    let spansToStore = reservoirSpans;
    if (failedIdx.length > 0) {
      const failedSet = new Set(failedIdx);
      spansToStore = reservoirSpans.filter((_, i) => !failedSet.has(i));
      console.warn(
        `[Traces] PII masking failed for ${failedIdx.length} span(s); dropped pre-storage`
      );
    }

    const result = await reservoir.ingestSpans(spansToStore);

    // Metering: record ingested span count (fire-and-forget; activates
    // the tracing.max_spans_monthly quota in the capability system).
    if (organizationId) {
      recordSpanIngestion({ spanCount: result.ingested, organizationId, projectId });
    }

    for (const [, trace] of traces) {
      await reservoir.upsertTrace({
        traceId: trace.trace_id,
        organizationId,
        projectId,
        serviceName: trace.service_name,
        rootServiceName: trace.root_service_name || undefined,
        rootOperationName: trace.root_operation_name || undefined,
        startTime: new Date(trace.start_time),
        endTime: new Date(trace.end_time),
        durationMs: trace.duration_ms,
        spanCount: trace.span_count,
        error: trace.error,
      });
    }

    // Mark the project as having traces (debounced, fire-and-forget)
    projectsService.markHasData(projectId, 'traces').catch(() => {});

    return result.ingested;
  }

  async listTraces(query: TraceListQuery): Promise<TraceListResult> {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const result = await reservoir.queryTraces({
      projectId: query.projectId,
      serviceName: query.service || undefined,
      error: query.error,
      from: query.from || thirtyDaysAgo,
      to: query.to || now,
      minDurationMs: query.minDurationMs,
      maxDurationMs: query.maxDurationMs,
      limit: query.limit || 50,
      offset: query.offset || 0,
    });

    return {
      traces: result.traces.map(toTraceRecord),
      total: result.total,
    };
  }

  async getTrace(traceId: string, projectId: string): Promise<TraceRecord | null> {
    const trace = await reservoir.getTraceById(traceId, projectId);
    return trace ? toTraceRecord(trace) : null;
  }

  async getTraceSpans(traceId: string, projectId: string): Promise<SpanRecord[]> {
    const spans = await reservoir.getSpansByTraceId(traceId, projectId);
    return spans.map(toSpanRecord);
  }

  async getServices(projectId: string, from?: Date): Promise<string[]> {
    const effectiveFrom = from || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    // Distinct service names straight from the storage engine (SELECT DISTINCT /
    // collection.distinct), so no result cap can drop services - works on all engines.
    const services = await reservoir.getTraceServices(projectId, effectiveFrom, new Date());
    return [...services].sort();
  }

  async getServiceDependencies(projectId: string, from?: Date, to?: Date) {
    return reservoir.getServiceDependencies(projectId, from, to);
  }

  async getEnrichedServiceDependencies(
    projectId: string,
    from?: Date,
    to?: Date,
  ): Promise<EnrichedServiceDependencies> {
    const effectiveFrom = from || new Date(Date.now() - 24 * 60 * 60 * 1000);
    const effectiveTo = to || new Date();
    const rangeHours = (effectiveTo.getTime() - effectiveFrom.getTime()) / (1000 * 60 * 60);

    // Only include log co-occurrence for ranges <= 7 days (performance guard)
    const includeLogCorrelation = rangeHours <= 168;

    const results = await Promise.allSettled([
      reservoir.getServiceDependencies(projectId, effectiveFrom, effectiveTo),
      this.getServiceHealthStats(projectId, effectiveFrom, effectiveTo),
      includeLogCorrelation
        ? this.getLogCoOccurrenceEdges(projectId, effectiveFrom, effectiveTo)
        : Promise.resolve([]),
    ]);

    const spanDeps = results[0].status === 'fulfilled' ? results[0].value : { nodes: [], edges: [] };
    const healthStats = results[1].status === 'fulfilled' ? results[1].value : [];
    const logCoOccurrence = results[2].status === 'fulfilled' ? results[2].value : [];

    // Build health map for quick lookup
    const healthMap = new Map<string, ServiceHealthStats>(
      healthStats.map((s) => [s.service_name, s]),
    );

    // Merge nodes: start from span-based, add log-only services
    const nodeMap = new Map<string, EnrichedServiceDependencyNode>();

    for (const node of spanDeps.nodes) {
      const health = healthMap.get(node.name);
      nodeMap.set(node.name, {
        id: node.name,
        name: node.name,
        callCount: node.callCount,
        errorRate: health?.error_rate ?? 0,
        avgLatencyMs: health?.avg_latency_ms ?? 0,
        p95LatencyMs: health?.p95_latency_ms ?? null,
        totalCalls: health?.total_calls ?? node.callCount,
      });
    }

    // Add services that appear only in log co-occurrence (no spans)
    for (const edge of logCoOccurrence) {
      for (const svcName of [edge.source_service, edge.target_service]) {
        if (!nodeMap.has(svcName)) {
          const health = healthMap.get(svcName);
          nodeMap.set(svcName, {
            id: svcName,
            name: svcName,
            callCount: 0,
            errorRate: health?.error_rate ?? 0,
            avgLatencyMs: health?.avg_latency_ms ?? 0,
            p95LatencyMs: health?.p95_latency_ms ?? null,
            totalCalls: health?.total_calls ?? 0,
          });
        }
      }
    }

    // Merge edges: span edges take priority, log edges fill gaps
    const edgeKey = (s: string, t: string) => `${s}-->${t}`;
    const edgeMap = new Map<string, EnrichedServiceDependencyEdge>();

    for (const edge of spanDeps.edges) {
      edgeMap.set(edgeKey(edge.source, edge.target), {
        source: edge.source,
        target: edge.target,
        callCount: edge.callCount,
        type: 'span',
      });
    }

    for (const edge of logCoOccurrence) {
      const fwdKey = edgeKey(edge.source_service, edge.target_service);
      const revKey = edgeKey(edge.target_service, edge.source_service);
      if (!edgeMap.has(fwdKey) && !edgeMap.has(revKey)) {
        edgeMap.set(fwdKey, {
          source: edge.source_service,
          target: edge.target_service,
          callCount: edge.co_occurrence_count,
          type: 'log_correlation',
        });
      }
    }

    return {
      nodes: Array.from(nodeMap.values()),
      edges: Array.from(edgeMap.values()),
    };
  }

  private async getServiceHealthStats(
    projectId: string,
    from: Date,
    to: Date,
  ): Promise<ServiceHealthStats[]> {
    // True window p95 computed directly from raw spans by the storage engine
    // (percentile_cont / quantile / $percentile), not a max of per-bucket p95s
    // from a continuous aggregate. Works across every reservoir engine.
    const stats = await reservoir.getServiceHealthStats(projectId, from, to);

    return stats.map((s) => ({
      service_name: s.serviceName,
      total_calls: s.totalCalls,
      total_errors: s.totalErrors,
      error_rate: s.totalCalls > 0 ? s.totalErrors / s.totalCalls : 0,
      avg_latency_ms: s.avgLatencyMs,
      p95_latency_ms: s.p95LatencyMs,
    }));
  }

  private async getLogCoOccurrenceEdges(
    projectId: string,
    from: Date,
    to: Date,
  ): Promise<LogCoOccurrenceRow[]> {
    if (reservoir.getEngineType() !== 'timescale') {
      return [];
    }

    const result = await pool.query<{
      source_service: string;
      target_service: string;
      co_occurrence_count: string;
    }>(
      `SELECT
         a.service  AS source_service,
         b.service  AS target_service,
         COUNT(*)::int AS co_occurrence_count
       FROM logs a
       JOIN logs b
         ON  a.trace_id   = b.trace_id
         AND a.project_id = b.project_id
         AND a.service    < b.service
       WHERE a.project_id = $1
         AND a.trace_id   IS NOT NULL
         AND a.time >= $2
         AND a.time <= $3
         AND b.time >= $2
         AND b.time <= $3
       GROUP BY a.service, b.service
       HAVING COUNT(*) >= 2
       ORDER BY co_occurrence_count DESC
       LIMIT 500`,
      [projectId, from, to],
    );

    return result.rows.map((r) => ({
      source_service: r.source_service,
      target_service: r.target_service,
      co_occurrence_count: Number(r.co_occurrence_count),
    }));
  }

  async getStats(projectId: string, from?: Date, to?: Date) {
    // Stats require aggregation (count, sum, avg, max) - use Kysely for timescale
    if (reservoir.getEngineType() === 'timescale') {
      let query = db
        .selectFrom('traces')
        .where('project_id', '=', projectId);

      if (from) query = query.where('start_time', '>=', from);
      if (to) query = query.where('start_time', '<=', to);

      const stats = await query
        .select([
          db.fn.count<number>('trace_id').as('total_traces'),
          db.fn.sum<number>('span_count').as('total_spans'),
          db.fn.avg<number>('duration_ms').as('avg_duration'),
          db.fn.max<number>('duration_ms').as('max_duration'),
        ])
        .executeTakeFirst();

      const errorCount = await query
        .select(db.fn.count<number>('trace_id').as('count'))
        .where('error', '=', true)
        .executeTakeFirst();

      return {
        total_traces: Number(stats?.total_traces || 0),
        total_spans: Number(stats?.total_spans || 0),
        avg_duration_ms: Math.round(Number(stats?.avg_duration || 0)),
        max_duration_ms: Number(stats?.max_duration || 0),
        error_count: Number(errorCount?.count || 0),
        error_rate: stats?.total_traces
          ? Number(errorCount?.count || 0) / Number(stats.total_traces)
          : 0,
      };
    }

    // ClickHouse: query all traces and compute stats in app layer
    const result = await reservoir.queryTraces({
      projectId,
      from: from || new Date(0),
      to: to || new Date(),
      limit: 100000,
    });

    const traces = result.traces;
    const totalTraces = result.total;
    const totalSpans = traces.reduce((sum: number, t: { spanCount: number }) => sum + t.spanCount, 0);
    const avgDuration = traces.length > 0
      ? traces.reduce((sum: number, t: { durationMs: number }) => sum + t.durationMs, 0) / traces.length
      : 0;
    const maxDuration = traces.length > 0
      ? Math.max(...traces.map((t: { durationMs: number }) => t.durationMs))
      : 0;
    const errorCount = traces.filter((t: { error: boolean }) => t.error).length;

    return {
      total_traces: totalTraces,
      total_spans: totalSpans,
      avg_duration_ms: Math.round(avgDuration),
      max_duration_ms: maxDuration,
      error_count: errorCount,
      // errorCount/avg/spans are computed over the analyzed page, so the rate must
      // use the same denominator (traces.length), not the full total_traces, which
      // would deflate the rate whenever the result set exceeds the query cap.
      error_rate: traces.length > 0 ? errorCount / traces.length : 0,
    };
  }
}

function toTraceRecord(t: ReservoirTraceRecord): TraceRecord {
  return {
    trace_id: t.traceId,
    service_name: t.serviceName,
    root_service_name: t.rootServiceName ?? null,
    root_operation_name: t.rootOperationName ?? null,
    start_time: t.startTime,
    end_time: t.endTime,
    duration_ms: t.durationMs,
    span_count: t.spanCount,
    error: t.error,
  };
}

function toSpanRecord(s: ReservoirSpanRecord): SpanRecord {
  return {
    span_id: s.spanId,
    trace_id: s.traceId,
    parent_span_id: s.parentSpanId ?? null,
    service_name: s.serviceName,
    operation_name: s.operationName,
    start_time: s.startTime,
    end_time: s.endTime,
    duration_ms: s.durationMs,
    kind: s.kind ?? null,
    status_code: s.statusCode ?? null,
    status_message: s.statusMessage ?? null,
    attributes: s.attributes ?? null,
    events: s.events ?? null,
    links: s.links ?? null,
    resource_attributes: s.resourceAttributes ?? null,
  };
}

export const tracesService = new TracesService();
