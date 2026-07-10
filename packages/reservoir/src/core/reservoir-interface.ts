import type {
  EngineType,
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
} from './types.js';

/**
 * Shared public surface for Reservoir and ReservoirBuffered.
 *
 * Both the core client and the async buffer decorator implement this interface
 * so downstream code can depend on the shared contract without widening to a
 * union type. Buffer-specific methods (start/stop/metrics) are intentionally
 * not part of this interface.
 */
export interface IReservoir {
  initialize(): Promise<void>;

  ingest(logs: LogRecord[]): Promise<IngestResult>;
  ingestReturning(logs: LogRecord[]): Promise<IngestReturningResult>;
  query(params: QueryParams): Promise<QueryResult<StoredLogRecord>>;
  aggregate(params: AggregateParams): Promise<AggregateResult>;

  healthCheck(): Promise<HealthStatus>;
  getCapabilities(): EngineCapabilities;

  getById(params: GetByIdParams): Promise<StoredLogRecord | null>;
  getByIds(params: GetByIdsParams): Promise<StoredLogRecord[]>;
  count(params: CountParams): Promise<CountResult>;
  countEstimate(params: CountParams): Promise<CountResult>;
  distinct(params: DistinctParams): Promise<DistinctResult>;
  topValues(params: TopValuesParams): Promise<TopValuesResult>;
  deleteByTimeRange(params: DeleteByTimeRangeParams): Promise<DeleteResult>;

  // Spans & traces
  ingestSpans(spans: SpanRecord[]): Promise<IngestSpansResult>;
  upsertTrace(trace: TraceRecord): Promise<void>;
  querySpans(params: SpanQueryParams): Promise<SpanQueryResult>;
  getSpansByTraceId(traceId: string, projectId: string): Promise<SpanRecord[]>;
  queryTraces(params: TraceQueryParams): Promise<TraceQueryResult>;
  getTraceById(traceId: string, projectId: string): Promise<TraceRecord | null>;
  getServiceDependencies(
    projectId: string,
    from?: Date,
    to?: Date,
  ): Promise<ServiceDependencyResult>;
  /** Distinct service names that appear in traces within the time range. */
  getTraceServices(projectId: string, from?: Date, to?: Date): Promise<string[]>;
  /** Per-service health stats (calls, errors, avg + true window p95) from raw spans. */
  getServiceHealthStats(projectId: string, from?: Date, to?: Date): Promise<ServiceHealthStat[]>;
  /** Time-bucketed span volume + latency percentiles from raw spans (all engines). */
  getSpanTimeseries(params: SpanTimeseriesParams): Promise<SpanTimeseriesBucket[]>;
  deleteSpansByTimeRange(params: DeleteSpansByTimeRangeParams): Promise<DeleteResult>;

  // Metrics
  ingestMetrics(metrics: MetricRecord[]): Promise<IngestMetricsResult>;
  queryMetrics(params: MetricQueryParams): Promise<MetricQueryResult>;
  aggregateMetrics(params: MetricAggregateParams): Promise<MetricAggregateResult>;
  getMetricNames(params: MetricNamesParams): Promise<MetricNamesResult>;
  getMetricLabelKeys(params: MetricLabelParams): Promise<MetricLabelResult>;
  getMetricLabelValues(params: MetricLabelParams, labelKey: string): Promise<MetricLabelResult>;
  deleteMetricsByTimeRange(params: DeleteMetricsByTimeRangeParams): Promise<DeleteResult>;
  getMetricsOverview(params: MetricsOverviewParams): Promise<MetricsOverviewResult>;

  /**
   * Hard-purge all logs, spans, and metrics for a project across every
   * storage engine. Called by the background hard-delete worker after the
   * soft-delete grace window expires, before the projects row is removed from
   * Postgres.
   */
  purgeProject(projectId: string): Promise<DeleteResult>;

  // Lifecycle & introspection
  getEngineType(): EngineType;
  close(): Promise<void>;
}
