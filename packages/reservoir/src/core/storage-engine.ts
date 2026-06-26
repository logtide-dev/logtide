import type {
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
  StorageSegment,
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
 * Abstract base class for storage engines.
 *
 * All storage engine implementations (TimescaleDB, ClickHouse, etc.)
 * must extend this class and implement all abstract methods.
 */
export abstract class StorageEngine {
  protected config: StorageConfig;

  constructor(config: StorageConfig) {
    this.config = config;
  }

  /** Connect to the storage backend */
  abstract connect(): Promise<void>;

  /** Disconnect and clean up resources */
  abstract disconnect(): Promise<void>;

  /** Check storage health and connectivity */
  abstract healthCheck(): Promise<HealthStatus>;

  /** Initialize schema (idempotent - safe to call multiple times) */
  abstract initialize(): Promise<void>;

  /** Migrate schema to a target version */
  abstract migrate(version: string): Promise<void>;

  /** Ingest a batch of log records */
  abstract ingest(logs: LogRecord[]): Promise<IngestResult>;

  /** Ingest a batch and return inserted records with IDs */
  abstract ingestReturning(logs: LogRecord[]): Promise<IngestReturningResult>;

  /** Query logs with filters and pagination */
  abstract query(params: QueryParams): Promise<QueryResult<StoredLogRecord>>;

  /** Time-series aggregation */
  abstract aggregate(params: AggregateParams): Promise<AggregateResult>;

  /** Get engine capabilities */
  abstract getCapabilities(): EngineCapabilities;

  /** Get storage segments in a time range (for tiering) */
  abstract getSegments(startTime: Date, endTime: Date): Promise<StorageSegment[]>;

  /** Get a single log by ID */
  abstract getById(params: GetByIdParams): Promise<StoredLogRecord | null>;

  /** Get multiple logs by IDs */
  abstract getByIds(params: GetByIdsParams): Promise<StoredLogRecord[]>;

  /** Count logs matching filters */
  abstract count(params: CountParams): Promise<CountResult>;

  /** Estimate count using query planner (fast, approximate) */
  abstract countEstimate(params: CountParams): Promise<CountResult>;

  /** Get distinct values for a field */
  abstract distinct(params: DistinctParams): Promise<DistinctResult>;

  /** Get top values for a field (GROUP BY + COUNT) */
  abstract topValues(params: TopValuesParams): Promise<TopValuesResult>;

  /** Delete logs by time range */
  abstract deleteByTimeRange(params: DeleteByTimeRangeParams): Promise<DeleteResult>;

  // =========================================================================
  // Span & Trace Operations
  // =========================================================================

  /** Ingest a batch of span records */
  abstract ingestSpans(spans: SpanRecord[]): Promise<IngestSpansResult>;

  /** Upsert a trace record (merge start/end times, sum span counts) */
  abstract upsertTrace(trace: TraceRecord): Promise<void>;

  /** Query spans with filters and pagination */
  abstract querySpans(params: SpanQueryParams): Promise<SpanQueryResult>;

  /** Get a single span by ID */
  abstract getSpansByTraceId(traceId: string, projectId: string): Promise<SpanRecord[]>;

  /** Query traces with filters and pagination */
  abstract queryTraces(params: TraceQueryParams): Promise<TraceQueryResult>;

  /** Get a single trace by ID */
  abstract getTraceById(traceId: string, projectId: string): Promise<TraceRecord | null>;

  /** Get service dependency graph from span parent-child relationships */
  abstract getServiceDependencies(
    projectId: string,
    from?: Date,
    to?: Date,
  ): Promise<ServiceDependencyResult>;

  /** Distinct service names appearing in traces within the time range */
  abstract getTraceServices(projectId: string, from?: Date, to?: Date): Promise<string[]>;

  /** Per-service health stats (calls, errors, avg + true window p95) from raw spans */
  abstract getServiceHealthStats(
    projectId: string,
    from?: Date,
    to?: Date,
  ): Promise<ServiceHealthStat[]>;

  /** Time-bucketed span volume + latency percentiles from raw spans (all engines) */
  abstract getSpanTimeseries(
    params: SpanTimeseriesParams,
  ): Promise<SpanTimeseriesBucket[]>;

  /** Delete spans by time range */
  abstract deleteSpansByTimeRange(params: DeleteSpansByTimeRangeParams): Promise<DeleteResult>;

  // =========================================================================
  // Metric Operations
  // =========================================================================

  /** Ingest a batch of metric data points */
  abstract ingestMetrics(metrics: MetricRecord[]): Promise<IngestMetricsResult>;

  /** Query raw metric data points */
  abstract queryMetrics(params: MetricQueryParams): Promise<MetricQueryResult>;

  /** Aggregate metrics into time buckets */
  abstract aggregateMetrics(params: MetricAggregateParams): Promise<MetricAggregateResult>;

  /** List distinct metric names for a project */
  abstract getMetricNames(params: MetricNamesParams): Promise<MetricNamesResult>;

  /** Get distinct label keys for a specific metric */
  abstract getMetricLabelKeys(params: MetricLabelParams): Promise<MetricLabelResult>;

  /** Get distinct label values for a specific metric + label key */
  abstract getMetricLabelValues(params: MetricLabelParams, labelKey: string): Promise<MetricLabelResult>;

  /** Delete metrics by time range */
  abstract deleteMetricsByTimeRange(params: DeleteMetricsByTimeRangeParams): Promise<DeleteResult>;

  /** Get overview of all metrics grouped by service */
  abstract getMetricsOverview(params: MetricsOverviewParams): Promise<MetricsOverviewResult>;
}
