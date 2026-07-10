import type { Reservoir } from '../client.js';
import type { StorageEngine } from '../core/storage-engine.js';
import type { IReservoir } from '../core/reservoir-interface.js';
import type {
  LogRecord,
  SpanRecord,
  MetricRecord,
  IngestResult,
  IngestReturningResult,
  IngestSpansResult,
  IngestMetricsResult,
} from '../core/types.js';
import type { BufferedConfig, BufferRecord, BufferRecordKind } from './types.js';
import { CircuitBreaker } from './circuit-breaker.js';
import { BufferMetrics } from './metrics.js';
import { FlushConsumerPool } from './flush-consumer-pool.js';
import { shardOf } from './sharding.js';

export class ReservoirBuffered implements IReservoir {
  readonly metrics = new BufferMetrics();
  private readonly breaker: CircuitBreaker;
  private readonly pool: FlushConsumerPool;
  private started = false;

  constructor(
    private readonly inner: Reservoir,
    private readonly config: BufferedConfig,
  ) {
    this.breaker = new CircuitBreaker(config.circuitBreaker, config.transport);
    this.pool = new FlushConsumerPool(
      config.transport,
      this.inner.getEngine(),
      config.flush,
      config.retry,
      this.metrics,
      this.breaker,
    );
  }

  async start(): Promise<void> {
    if (this.started) return;
    await this.config.transport.start();
    await this.pool.start();
    this.started = true;
  }

  async stop(): Promise<void> {
    if (!this.started) return;
    await this.pool.stop();
    await this.config.transport.stop();
    this.started = false;
  }

  async ingest(logs: LogRecord[]): Promise<IngestResult> {
    if (logs.length === 0) return { ingested: 0, failed: 0, durationMs: 0 };
    if (await this.breaker.shouldBypass()) {
      this.metrics.recordBypass('log', 'breaker_open', logs.length);
      return this.inner.ingest(logs);
    }
    const records: BufferRecord[] = logs.map((payload) =>
      this.toBufferRecord('log', payload as unknown as { projectId: string }, payload),
    );
    const start = Date.now();
    await this.config.transport.enqueueMany(records);
    const durationMs = Date.now() - start;
    this.countEnqueued('log', records);
    return { ingested: logs.length, failed: 0, durationMs };
  }

  async ingestSpans(spans: SpanRecord[]): Promise<IngestSpansResult> {
    if (spans.length === 0) return { ingested: 0, failed: 0, durationMs: 0 };
    if (await this.breaker.shouldBypass()) {
      this.metrics.recordBypass('span', 'breaker_open', spans.length);
      return this.inner.ingestSpans(spans);
    }
    const records: BufferRecord[] = spans.map((payload) =>
      this.toBufferRecord('span', payload as unknown as { projectId: string }, payload),
    );
    const start = Date.now();
    await this.config.transport.enqueueMany(records);
    const durationMs = Date.now() - start;
    this.countEnqueued('span', records);
    return { ingested: spans.length, failed: 0, durationMs };
  }

  async ingestMetrics(metrics: MetricRecord[]): Promise<IngestMetricsResult> {
    if (metrics.length === 0) return { ingested: 0, failed: 0, durationMs: 0 };
    if (await this.breaker.shouldBypass()) {
      this.metrics.recordBypass('metric', 'breaker_open', metrics.length);
      return this.inner.ingestMetrics(metrics);
    }
    const records: BufferRecord[] = metrics.map((payload) =>
      this.toBufferRecord('metric', payload as unknown as { projectId: string }, payload),
    );
    const start = Date.now();
    await this.config.transport.enqueueMany(records);
    const durationMs = Date.now() - start;
    this.countEnqueued('metric', records);
    return { ingested: metrics.length, failed: 0, durationMs };
  }

  async ingestReturning(logs: LogRecord[]): Promise<IngestReturningResult> {
    return this.inner.ingestReturning(logs);
  }

  query(...args: Parameters<Reservoir['query']>): ReturnType<Reservoir['query']> { return this.inner.query(...args); }
  aggregate(...args: Parameters<Reservoir['aggregate']>): ReturnType<Reservoir['aggregate']> { return this.inner.aggregate(...args); }
  healthCheck(): ReturnType<Reservoir['healthCheck']> { return this.inner.healthCheck(); }
  getCapabilities(): ReturnType<Reservoir['getCapabilities']> { return this.inner.getCapabilities(); }
  getById(...args: Parameters<Reservoir['getById']>): ReturnType<Reservoir['getById']> { return this.inner.getById(...args); }
  getByIds(...args: Parameters<Reservoir['getByIds']>): ReturnType<Reservoir['getByIds']> { return this.inner.getByIds(...args); }
  count(...args: Parameters<Reservoir['count']>): ReturnType<Reservoir['count']> { return this.inner.count(...args); }
  countEstimate(...args: Parameters<Reservoir['countEstimate']>): ReturnType<Reservoir['countEstimate']> { return this.inner.countEstimate(...args); }
  distinct(...args: Parameters<Reservoir['distinct']>): ReturnType<Reservoir['distinct']> { return this.inner.distinct(...args); }
  topValues(...args: Parameters<Reservoir['topValues']>): ReturnType<Reservoir['topValues']> { return this.inner.topValues(...args); }
  deleteByTimeRange(...args: Parameters<Reservoir['deleteByTimeRange']>): ReturnType<Reservoir['deleteByTimeRange']> { return this.inner.deleteByTimeRange(...args); }
  upsertTrace(...args: Parameters<Reservoir['upsertTrace']>): ReturnType<Reservoir['upsertTrace']> { return this.inner.upsertTrace(...args); }
  querySpans(...args: Parameters<Reservoir['querySpans']>): ReturnType<Reservoir['querySpans']> { return this.inner.querySpans(...args); }
  getSpansByTraceId(...args: Parameters<Reservoir['getSpansByTraceId']>): ReturnType<Reservoir['getSpansByTraceId']> { return this.inner.getSpansByTraceId(...args); }
  queryTraces(...args: Parameters<Reservoir['queryTraces']>): ReturnType<Reservoir['queryTraces']> { return this.inner.queryTraces(...args); }
  getTraceById(...args: Parameters<Reservoir['getTraceById']>): ReturnType<Reservoir['getTraceById']> { return this.inner.getTraceById(...args); }
  getServiceDependencies(...args: Parameters<Reservoir['getServiceDependencies']>): ReturnType<Reservoir['getServiceDependencies']> { return this.inner.getServiceDependencies(...args); }
  getTraceServices(...args: Parameters<Reservoir['getTraceServices']>): ReturnType<Reservoir['getTraceServices']> { return this.inner.getTraceServices(...args); }
  getServiceHealthStats(...args: Parameters<Reservoir['getServiceHealthStats']>): ReturnType<Reservoir['getServiceHealthStats']> { return this.inner.getServiceHealthStats(...args); }
  getSpanTimeseries(...args: Parameters<Reservoir['getSpanTimeseries']>): ReturnType<Reservoir['getSpanTimeseries']> { return this.inner.getSpanTimeseries(...args); }
  deleteSpansByTimeRange(...args: Parameters<Reservoir['deleteSpansByTimeRange']>): ReturnType<Reservoir['deleteSpansByTimeRange']> { return this.inner.deleteSpansByTimeRange(...args); }
  queryMetrics(...args: Parameters<Reservoir['queryMetrics']>): ReturnType<Reservoir['queryMetrics']> { return this.inner.queryMetrics(...args); }
  aggregateMetrics(...args: Parameters<Reservoir['aggregateMetrics']>): ReturnType<Reservoir['aggregateMetrics']> { return this.inner.aggregateMetrics(...args); }
  getMetricNames(...args: Parameters<Reservoir['getMetricNames']>): ReturnType<Reservoir['getMetricNames']> { return this.inner.getMetricNames(...args); }
  getMetricLabelKeys(...args: Parameters<Reservoir['getMetricLabelKeys']>): ReturnType<Reservoir['getMetricLabelKeys']> { return this.inner.getMetricLabelKeys(...args); }
  getMetricLabelValues(...args: Parameters<Reservoir['getMetricLabelValues']>): ReturnType<Reservoir['getMetricLabelValues']> { return this.inner.getMetricLabelValues(...args); }
  deleteMetricsByTimeRange(...args: Parameters<Reservoir['deleteMetricsByTimeRange']>): ReturnType<Reservoir['deleteMetricsByTimeRange']> { return this.inner.deleteMetricsByTimeRange(...args); }
  getMetricsOverview(...args: Parameters<Reservoir['getMetricsOverview']>): ReturnType<Reservoir['getMetricsOverview']> { return this.inner.getMetricsOverview(...args); }
  purgeProject(...args: Parameters<Reservoir['purgeProject']>): ReturnType<Reservoir['purgeProject']> { return this.inner.purgeProject(...args); }
  getEngineType(): ReturnType<Reservoir['getEngineType']> { return this.inner.getEngineType(); }
  getEngine(): StorageEngine { return this.inner.getEngine(); }
  async close(): Promise<void> { await this.stop(); await this.inner.close(); }
  async initialize(): Promise<void> { await this.inner.initialize(); }

  private toBufferRecord(
    kind: BufferRecordKind,
    projectIdSource: { projectId: string },
    payload: unknown,
  ): BufferRecord {
    return {
      kind,
      projectId: projectIdSource.projectId,
      payload: payload as BufferRecord['payload'],
      enqueuedAt: Date.now(),
    };
  }

  private countEnqueued(kind: BufferRecordKind, records: BufferRecord[]): void {
    const byShard = new Map<number, number>();
    for (const r of records) {
      const s = this.config.transport.shardCount === 1
        ? 0
        : shardOf(r.projectId, this.config.transport.shardCount);
      byShard.set(s, (byShard.get(s) ?? 0) + 1);
    }
    for (const [shard, n] of byShard) this.metrics.recordEnqueued(kind, shard, n);
  }
}
