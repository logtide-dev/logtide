import type {
  EngineType,
  StorageConfig,
  LogRecord,
  StoredLogRecord,
  QueryParams,
  QueryResult,
  AggregateParams,
  AggregateResult,
  IngestResult,
  IngestReturningResult,
  HealthStatus,
  EngineCapabilities,
  GetByIdParams,
  GetByIdsParams,
  CountParams,
  CountResult,
  DistinctParams,
  DistinctResult,
  TopValuesParams,
  TopValuesResult,
  DeleteByTimeRangeParams,
  DeleteResult,
  SpanRecord,
  TraceRecord,
  SpanQueryParams,
  SpanQueryResult,
  TraceQueryParams,
  TraceQueryResult,
  IngestSpansResult,
  ServiceDependencyResult,
  ServiceHealthStat,
  SpanTimeseriesParams,
  SpanTimeseriesBucket,
  DeleteSpansByTimeRangeParams,
  MetricRecord,
  MetricQueryParams,
  MetricQueryResult,
  MetricAggregateParams,
  MetricAggregateResult,
  MetricNamesParams,
  MetricNamesResult,
  MetricLabelParams,
  MetricLabelResult,
  IngestMetricsResult,
  DeleteMetricsByTimeRangeParams,
  MetricsOverviewParams,
  MetricsOverviewResult,
  LogHistogramParams,
  LogHistogramResult,
  LogFacetsParams,
  LogFacetsResult,
  DiscoverMetadataKeysParams,
  MetadataKeyOccurrence,
  OperationStatsParams,
  OperationStat,
  LatencyHistogramParams,
  LatencyHistogramResult,
  ListSessionsParams,
  ListSessionsResult,
  HasSessionsParams,
} from './core/types.js';
import type { StorageEngine } from './core/storage-engine.js';
import type { IReservoir } from './core/reservoir-interface.js';
import { StorageEngineFactory } from './factory.js';
import type { EngineOptions } from './factory.js';
import {
  assertTimeRange,
  normalizeLogFilter,
  normalizeHistogramParams,
  normalizeFacetsParams,
  normalizeDiscoverParams,
  normalizeOperationStatsParams,
  normalizeSpanQueryParams,
  normalizeTraceQueryParams,
  normalizeListSessionsParams,
} from './core/normalize.js';
import { facetFieldName, zeroFillHistogram } from './core/aggregation-helpers.js';

/** Removes the client-only `matchNothing` flag before params reach an engine. */
function forEngine<T extends { matchNothing?: boolean }>(params: T): T {
  if (!('matchNothing' in params)) return params;
  const out = { ...params };
  delete out.matchNothing;
  return out;
}

/**
 * Reservoir - unified storage client for log management.
 *
 * @example
 * ```typescript
 * // Standalone mode (creates its own pool)
 * const reservoir = new Reservoir('timescale', {
 *   host: 'localhost',
 *   port: 5432,
 *   database: 'logtide',
 *   username: 'logtide',
 *   password: 'secret',
 * });
 * await reservoir.initialize();
 *
 * // Shared pool mode (reuse existing pg.Pool)
 * const reservoir = new Reservoir('timescale', config, {
 *   pool: existingPool,
 *   skipInitialize: true,
 *   tableName: 'logs',
 * });
 * await reservoir.initialize(); // no-op when skipInitialize is true
 *
 * // Wrap an engine built elsewhere (no factory validation)
 * const reservoir = Reservoir.fromEngine(new ClickHouseEngine(config));
 * await reservoir.initialize(); // connects and initializes the engine
 * ```
 *
 * Log, span, trace and session calls are normalized here once (spec 6.4):
 * legacy `search`/`searchMode` gain a `textQuery`, defaults and limits are
 * applied, invalid params reject with RangeError before any engine call, and
 * filters marked `matchNothing` are answered without the engine. Caller
 * params are never mutated.
 */
export class Reservoir implements IReservoir {
  private engine: StorageEngine;
  private initialized = false;
  private initPromise?: Promise<void>;

  constructor(engine: StorageEngine);
  constructor(type: EngineType, config: StorageConfig, options?: EngineOptions);
  constructor(typeOrEngine: EngineType | StorageEngine, config?: StorageConfig, options?: EngineOptions) {
    if (typeof typeOrEngine === 'string') {
      if (!config) throw new TypeError(`Reservoir needs a storage config for engine type ${typeOrEngine}`);
      this.engine = StorageEngineFactory.create(typeOrEngine, config, options);
    } else {
      this.engine = typeOrEngine;
    }
  }

  /** Wraps an already constructed engine; the factory and its config validation are not used. */
  static fromEngine(engine: StorageEngine): Reservoir {
    return new Reservoir(engine);
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      await this.engine.connect();
      await this.engine.initialize();
      this.initialized = true;
    })();

    try {
      await this.initPromise;
    } catch (err) {
      this.initPromise = undefined;
      throw err;
    }
  }

  async ingest(logs: LogRecord[]): Promise<IngestResult> {
    this.ensureInitialized();
    return this.engine.ingest(logs);
  }

  async ingestReturning(logs: LogRecord[]): Promise<IngestReturningResult> {
    this.ensureInitialized();
    return this.engine.ingestReturning(logs);
  }

  async query(params: QueryParams): Promise<QueryResult<StoredLogRecord>> {
    this.ensureInitialized();
    const normalized = normalizeLogFilter(params);
    if (normalized.matchNothing) {
      return { logs: [], total: 0, hasMore: false, limit: params.limit ?? 50, offset: params.offset ?? 0 };
    }
    return this.engine.query(forEngine(normalized));
  }

  async aggregate(params: AggregateParams): Promise<AggregateResult> {
    this.ensureInitialized();
    return this.engine.aggregate(params);
  }

  async healthCheck(): Promise<HealthStatus> {
    return this.engine.healthCheck();
  }

  getCapabilities(): EngineCapabilities {
    return this.engine.getCapabilities();
  }

  async getById(params: GetByIdParams): Promise<StoredLogRecord | null> {
    this.ensureInitialized();
    return this.engine.getById(params);
  }

  async getByIds(params: GetByIdsParams): Promise<StoredLogRecord[]> {
    this.ensureInitialized();
    return this.engine.getByIds(params);
  }

  async count(params: CountParams): Promise<CountResult> {
    this.ensureInitialized();
    const normalized = normalizeLogFilter(params);
    if (normalized.matchNothing) return { count: 0 };
    return this.engine.count(forEngine(normalized));
  }

  async countEstimate(params: CountParams): Promise<CountResult> {
    this.ensureInitialized();
    const normalized = normalizeLogFilter(params);
    if (normalized.matchNothing) return { count: 0 };
    return this.engine.countEstimate(forEngine(normalized));
  }

  async distinct(params: DistinctParams): Promise<DistinctResult> {
    this.ensureInitialized();
    return this.engine.distinct(params);
  }

  async topValues(params: TopValuesParams): Promise<TopValuesResult> {
    this.ensureInitialized();
    return this.engine.topValues(params);
  }

  async deleteByTimeRange(params: DeleteByTimeRangeParams): Promise<DeleteResult> {
    this.ensureInitialized();
    return this.engine.deleteByTimeRange(params);
  }

  async histogram(params: LogHistogramParams): Promise<LogHistogramResult> {
    this.ensureInitialized();
    const normalized = normalizeHistogramParams(params);
    if (normalized.matchNothing) return zeroFillHistogram(normalized, []);
    return this.engine.histogram(forEngine(normalized));
  }

  async facets(params: LogFacetsParams): Promise<LogFacetsResult> {
    this.ensureInitialized();
    const normalized = normalizeFacetsParams(params);
    if (normalized.matchNothing) {
      return { facets: normalized.fields.map((field) => ({ field: facetFieldName(field), values: [], otherCount: 0 })) };
    }
    return this.engine.facets(forEngine(normalized));
  }

  async discoverMetadataKeys(params: DiscoverMetadataKeysParams): Promise<MetadataKeyOccurrence[]> {
    this.ensureInitialized();
    return this.engine.discoverMetadataKeys(normalizeDiscoverParams(params));
  }

  async listSessions(params: ListSessionsParams): Promise<ListSessionsResult> {
    this.ensureInitialized();
    return this.engine.listSessions(normalizeListSessionsParams(params));
  }

  async hasSessions(params: HasSessionsParams): Promise<boolean> {
    this.ensureInitialized();
    assertTimeRange(params.from, params.to);
    return this.engine.hasSessions(params);
  }

  // =========================================================================
  // Span & Trace Operations
  // =========================================================================

  async ingestSpans(spans: SpanRecord[]): Promise<IngestSpansResult> {
    this.ensureInitialized();
    return this.engine.ingestSpans(spans);
  }

  async upsertTrace(trace: TraceRecord): Promise<void> {
    this.ensureInitialized();
    return this.engine.upsertTrace(trace);
  }

  async querySpans(params: SpanQueryParams): Promise<SpanQueryResult> {
    this.ensureInitialized();
    return this.engine.querySpans(normalizeSpanQueryParams(params));
  }

  async getSpansByTraceId(traceId: string, projectId: string): Promise<SpanRecord[]> {
    this.ensureInitialized();
    return this.engine.getSpansByTraceId(traceId, projectId);
  }

  async queryTraces(params: TraceQueryParams): Promise<TraceQueryResult> {
    this.ensureInitialized();
    return this.engine.queryTraces(normalizeTraceQueryParams(params));
  }

  async getTraceById(traceId: string, projectId: string): Promise<TraceRecord | null> {
    this.ensureInitialized();
    return this.engine.getTraceById(traceId, projectId);
  }

  async getServiceDependencies(
    projectId: string,
    from?: Date,
    to?: Date,
  ): Promise<ServiceDependencyResult> {
    this.ensureInitialized();
    return this.engine.getServiceDependencies(projectId, from, to);
  }

  async getTraceServices(projectId: string, from?: Date, to?: Date): Promise<string[]> {
    this.ensureInitialized();
    return this.engine.getTraceServices(projectId, from, to);
  }

  async getServiceHealthStats(
    projectId: string,
    from?: Date,
    to?: Date,
  ): Promise<ServiceHealthStat[]> {
    this.ensureInitialized();
    return this.engine.getServiceHealthStats(projectId, from, to);
  }

  async getSpanTimeseries(params: SpanTimeseriesParams): Promise<SpanTimeseriesBucket[]> {
    this.ensureInitialized();
    return this.engine.getSpanTimeseries(params);
  }

  async deleteSpansByTimeRange(params: DeleteSpansByTimeRangeParams): Promise<DeleteResult> {
    this.ensureInitialized();
    return this.engine.deleteSpansByTimeRange(params);
  }

  async getOperationStats(params: OperationStatsParams): Promise<OperationStat[]> {
    this.ensureInitialized();
    return this.engine.getOperationStats(normalizeOperationStatsParams(params));
  }

  async getLatencyHistogram(params: LatencyHistogramParams): Promise<LatencyHistogramResult> {
    this.ensureInitialized();
    assertTimeRange(params.from, params.to);
    return this.engine.getLatencyHistogram(params);
  }

  // =========================================================================
  // Metric Operations
  // =========================================================================

  async ingestMetrics(metrics: MetricRecord[]): Promise<IngestMetricsResult> {
    this.ensureInitialized();
    return this.engine.ingestMetrics(metrics);
  }

  async queryMetrics(params: MetricQueryParams): Promise<MetricQueryResult> {
    this.ensureInitialized();
    return this.engine.queryMetrics(params);
  }

  async aggregateMetrics(params: MetricAggregateParams): Promise<MetricAggregateResult> {
    this.ensureInitialized();
    return this.engine.aggregateMetrics(params);
  }

  async getMetricNames(params: MetricNamesParams): Promise<MetricNamesResult> {
    this.ensureInitialized();
    return this.engine.getMetricNames(params);
  }

  async getMetricLabelKeys(params: MetricLabelParams): Promise<MetricLabelResult> {
    this.ensureInitialized();
    return this.engine.getMetricLabelKeys(params);
  }

  async getMetricLabelValues(params: MetricLabelParams, labelKey: string): Promise<MetricLabelResult> {
    this.ensureInitialized();
    return this.engine.getMetricLabelValues(params, labelKey);
  }

  async deleteMetricsByTimeRange(params: DeleteMetricsByTimeRangeParams): Promise<DeleteResult> {
    this.ensureInitialized();
    return this.engine.deleteMetricsByTimeRange(params);
  }

  async getMetricsOverview(params: MetricsOverviewParams): Promise<MetricsOverviewResult> {
    this.ensureInitialized();
    return this.engine.getMetricsOverview(params);
  }

  /**
   * Hard-purge all logs, spans, and metrics for a project.
   * Implements IReservoir.purgeProject by calling the three time-range delete
   * methods with the full time span so nothing is left behind.
   */
  async purgeProject(projectId: string): Promise<DeleteResult> {
    this.ensureInitialized();
    const from = new Date(0);
    const to = new Date('2100-01-01T00:00:00Z');
    const [logs, spans, metrics] = await Promise.all([
      this.engine.deleteByTimeRange({ projectId, from, to }),
      this.engine.deleteSpansByTimeRange({ projectId, from, to }),
      this.engine.deleteMetricsByTimeRange({ projectId, from, to }),
    ]);
    return { deleted: logs.deleted + spans.deleted + metrics.deleted };
  }

  getEngineType(): EngineType {
    return this.engine.getCapabilities().engine;
  }

  /**
   * Return the underlying storage engine.
   *
   * Exposed so decorators (e.g. the async buffer) can obtain a direct handle
   * to the engine and avoid recursing back through the public client surface.
   */
  getEngine(): StorageEngine {
    return this.engine;
  }

  async close(): Promise<void> {
    if (!this.initialized) return;
    try {
      await this.engine.disconnect();
    } finally {
      this.initialized = false;
      this.initPromise = undefined;
    }
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('Reservoir not initialized. Call initialize() first.');
    }
  }
}
