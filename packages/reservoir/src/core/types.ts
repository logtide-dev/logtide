/**
 * Core type definitions for @logtide/reservoir
 *
 * These types define the storage abstraction layer for log management.
 * They align with @logtide/shared types but are designed to be storage-agnostic.
 */

import type { LogLevel, SpanKind, SpanStatusCode, MetadataFilter, LogSearchQuery } from '@logtide/shared';
export type { LogLevel, SpanKind, SpanStatusCode, MetadataFilter };

/** Sentinel for log queries that intentionally span all projects (admin / platform). */
export const GLOBAL_SCOPE = '__ALL_PROJECTS__' as const;
export type GlobalScope = typeof GLOBAL_SCOPE;

export type EngineType = 'timescale' | 'clickhouse' | 'mongodb';

export type StorageTier = 'hot' | 'warm' | 'cold' | 'archive';

export type SearchMode = 'fulltext' | 'substring';

export type FilterOperator =
  | '='
  | '!='
  | '>'
  | '>='
  | '<'
  | '<='
  | 'in'
  | 'not in'
  | 'like'
  | 'not like';

export type AggregationInterval = '1m' | '5m' | '15m' | '1h' | '6h' | '1d' | '1w';

/** A log record for storage */
export interface LogRecord {
  id?: string;
  time: Date;
  organizationId?: string;
  projectId: string;
  service: string;
  level: LogLevel;
  message: string;
  metadata?: Record<string, unknown>;
  traceId?: string;
  spanId?: string;
  sessionId?: string;
  hostname?: string;
}

/** A log record returned from the database (includes id) */
export interface StoredLogRecord extends LogRecord {
  id: string;
}

/** A filter condition for querying logs */
export interface Filter {
  field: string;
  operator: FilterOperator;
  value: string | number | boolean | Date | (string | number | boolean)[];
}

/**
 * Free-text part of a parsed log query (spec 6.4). Words match whole tokens
 * of `message` case-insensitively, phrases are case-insensitive substrings:
 * every term of `all`, at least one term of each `anyOf` group, no term of
 * `none`.
 */
export type TextQuery = LogSearchQuery['text'];

/**
 * Exclusions on typed fields. A log is dropped when its value is in the list;
 * `hostname` exclusions keep logs that have no hostname.
 */
export interface LogExclude {
  service?: string[];
  level?: LogLevel[];
  hostname?: string[];
}

/**
 * The filter part shared by `query`, `count`, `countEstimate`, `histogram`
 * and `facets`. Every filter ANDs with the others.
 */
export interface LogFilterParams {
  projectId: string | string[] | GlobalScope;
  service?: string | string[];
  level?: LogLevel | LogLevel[];
  hostname?: string | string[];
  traceId?: string;
  sessionId?: string;
  spanId?: string;
  from: Date;
  to: Date;
  fromExclusive?: boolean; // time > from (instead of >=)
  toExclusive?: boolean;   // time < to (instead of <=)
  /** @deprecated converted to `textQuery` by the client; engines read `textQuery` */
  search?: string;
  /** @deprecated converted to `textQuery` by the client */
  searchMode?: SearchMode;
  textQuery?: TextQuery;
  exclude?: LogExclude;
  metadataFilters?: MetadataFilter[];
  /**
   * Set by `mergeCompiledSearch` when the filters cannot match any log (empty
   * intersection). Answered by the client, never sent to engines.
   */
  matchNothing?: boolean;
}

/** Parameters for querying logs */
export interface QueryParams extends LogFilterParams {
  filters?: Filter[];
  limit?: number;
  offset?: number;
  cursor?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

/** Result of a log query */
export interface QueryResult<T = LogRecord> {
  logs: T[];
  total: number;
  hasMore: boolean;
  limit: number;
  offset: number;
  nextCursor?: string;
  executionTimeMs?: number;
  tiers?: StorageTier[];
}

/** Parameters for aggregation queries */
export interface AggregateParams {
  projectId: string | string[] | GlobalScope;
  service?: string | string[];
  from: Date;
  to: Date;
  interval: AggregationInterval;
  groupBy?: string[];
  filters?: Filter[];
}

/** Time bucket in an aggregation result */
export interface TimeBucket {
  bucket: Date;
  total: number;
  byLevel?: Record<LogLevel, number>;
  byField?: Record<string, number>;
}

/** Result of an aggregation query */
export interface AggregateResult {
  timeseries: TimeBucket[];
  total: number;
  executionTimeMs?: number;
}

/** Result of a batch ingestion */
export interface IngestResult {
  ingested: number;
  failed: number;
  durationMs: number;
  errors?: Array<{
    index: number;
    error: string;
  }>;
}

/** Result of a batch ingestion with returned records */
export interface IngestReturningResult extends IngestResult {
  rows: StoredLogRecord[];
}

/** Health check status */
export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  engine: EngineType;
  connected: boolean;
  responseTimeMs: number;
  details?: Record<string, unknown>;
  error?: string;
}

/** Capabilities of a storage engine */
export interface EngineCapabilities {
  engine: EngineType;
  supportsFullTextSearch: boolean;
  supportsAggregations: boolean;
  supportsStreaming: boolean;
  supportsTransactions: boolean;
  maxBatchSize: number;
  nativeCompression: boolean;
  nativeTiering: boolean;
  supportedOperators: FilterOperator[];
  supportedIntervals: AggregationInterval[];
}

/** Metadata about a storage segment (for tiering) */
export interface StorageSegment {
  id: string;
  organizationId: string;
  startTime: Date;
  endTime: Date;
  tier: StorageTier;
  engine: EngineType;
  recordCount: number;
  compressedSizeBytes: number;
  uncompressedSizeBytes: number;
  s3Path?: string;
  createdAt: Date;
  lastAccessedAt?: Date;
  metadata?: Record<string, unknown>;
}

/** Parameters for single log lookup by ID */
export interface GetByIdParams {
  id: string;
  projectId: string;
}

/** Parameters for batch log lookup by IDs */
export interface GetByIdsParams {
  ids: string[];
  projectId: string;
}

/** Parameters for counting logs */
export interface CountParams extends LogFilterParams {
  filters?: Filter[];
}

/** Result of a count query */
export interface CountResult {
  count: number;
  executionTimeMs?: number;
}

/** Parameters for distinct value queries */
export interface DistinctParams {
  field: string;
  projectId: string | string[] | GlobalScope;
  service?: string | string[];
  level?: LogLevel | LogLevel[];
  hostname?: string | string[];
  from: Date;
  to: Date;
  fromExclusive?: boolean;
  toExclusive?: boolean;
  filters?: Filter[];
  limit?: number;
}

/** Result of a distinct query */
export interface DistinctResult {
  values: string[];
  executionTimeMs?: number;
}

/** Parameters for top values (GROUP BY field + COUNT) */
export interface TopValuesParams {
  field: string;
  projectId: string | string[] | GlobalScope;
  service?: string | string[];
  level?: LogLevel | LogLevel[];
  hostname?: string | string[];
  from: Date;
  to: Date;
  fromExclusive?: boolean;
  toExclusive?: boolean;
  limit?: number;
  /** When true, each value carries the max event time seen in the window */
  includeLastSeen?: boolean;
}

/** Result of a top values query */
export interface TopValuesResult {
  /** lastSeen is an ISO 8601 UTC string, present only when includeLastSeen was requested */
  values: Array<{ value: string; count: number; lastSeen?: string }>;
  executionTimeMs?: number;
}

/** Parameters for deleting logs by time range */
export interface DeleteByTimeRangeParams {
  projectId: string | string[];
  from: Date;
  to: Date;
  service?: string | string[];
  level?: LogLevel | LogLevel[];
}

/** Result of a delete operation */
export interface DeleteResult {
  deleted: number;
  executionTimeMs?: number;
}

/** Configuration for a storage engine */
export interface StorageConfig {
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  schema?: string;
  poolSize?: number;
  connectionTimeoutMs?: number;
  ssl?: boolean;
  options?: Record<string, unknown>;
}

// ============================================================================
// Span & Trace Types
// ============================================================================

/** A span record for storage */
export interface SpanRecord {
  time: Date;
  spanId: string;
  traceId: string;
  parentSpanId?: string;
  organizationId?: string;
  projectId: string;
  serviceName: string;
  operationName: string;
  startTime: Date;
  endTime: Date;
  durationMs: number;
  kind?: SpanKind;
  statusCode?: SpanStatusCode;
  statusMessage?: string;
  attributes?: Record<string, unknown>;
  events?: Array<Record<string, unknown>>;
  links?: Array<Record<string, unknown>>;
  resourceAttributes?: Record<string, unknown>;
}

/** A trace record (aggregated from spans) */
export interface TraceRecord {
  traceId: string;
  organizationId?: string;
  projectId: string;
  serviceName: string;
  rootServiceName?: string;
  rootOperationName?: string;
  startTime: Date;
  endTime: Date;
  durationMs: number;
  spanCount: number;
  error: boolean;
}

/**
 * Span sort keys. `'duration'` is the 1.6 alias the client maps to
 * `'duration_ms'`; engines receive the column names.
 */
export type SpanSortBy = 'start_time' | 'duration' | 'end_time' | 'duration_ms' | 'service_name' | 'operation_name';

/** Parameters for querying spans */
export interface SpanQueryParams {
  organizationId?: string | string[];
  projectId?: string | string[];
  traceId?: string | string[];
  serviceName?: string | string[];
  operationName?: string | string[];
  /** Single-value alias of `operationName`; the client maps it (both set and different is an error). */
  operation?: string;
  kind?: SpanKind | SpanKind[];
  statusCode?: SpanStatusCode | SpanStatusCode[];
  /**
   * Filters over span `attributes`, with the metadata filter semantics of
   * logs; a key starting with `resource.` reads `resourceAttributes` with the
   * rest of the key instead.
   */
  attributeFilters?: MetadataFilter[];
  from: Date;
  to: Date;
  fromExclusive?: boolean;
  toExclusive?: boolean;
  limit?: number;
  offset?: number;
  /** Default `start_time` ascending. */
  sortBy?: SpanSortBy;
  sortOrder?: 'asc' | 'desc';
}

/** Result of a span query */
export interface SpanQueryResult {
  spans: SpanRecord[];
  total: number;
  hasMore: boolean;
  limit: number;
  offset: number;
  executionTimeMs?: number;
}

export type TraceSortBy = 'start_time' | 'duration';

/** Parameters for querying traces */
export interface TraceQueryParams {
  organizationId?: string | string[];
  projectId?: string | string[];
  /** Trace-level service (the trace's `serviceName`), also when `operation` or `attributeFilters` is set. */
  serviceName?: string | string[];
  error?: boolean;
  from: Date;
  to: Date;
  minDurationMs?: number;
  maxDurationMs?: number;
  /**
   * `operation` and `attributeFilters` keep traces with at least one span,
   * starting inside [from, to], matching the operation and all attribute
   * filters together. A `resource.` key prefix reads `resourceAttributes`.
   */
  operation?: string;
  attributeFilters?: MetadataFilter[];
  /** Default `start_time` descending. */
  sortBy?: TraceSortBy;
  sortOrder?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

/** Result of a trace query */
export interface TraceQueryResult {
  traces: TraceRecord[];
  total: number;
  hasMore: boolean;
  limit: number;
  offset: number;
  executionTimeMs?: number;
}

/** Result of a batch span ingestion */
export interface IngestSpansResult {
  ingested: number;
  failed: number;
  durationMs: number;
  errors?: Array<{ index: number; error: string }>;
}

/** A service dependency edge */
export interface ServiceDependency {
  source: string;
  target: string;
  callCount: number;
}

/** Result of a service dependency query */
export interface ServiceDependencyResult {
  nodes: Array<{ id: string; name: string; callCount: number }>;
  edges: ServiceDependency[];
}

/**
 * Per-service health stats computed over a time window directly from raw spans.
 * p95LatencyMs is a true window percentile (approximate on engines whose native
 * quantile is approximate, e.g. MongoDB/ClickHouse t-digest), not a max of
 * per-bucket percentiles.
 */
export interface ServiceHealthStat {
  serviceName: string;
  totalCalls: number;
  totalErrors: number;
  avgLatencyMs: number;
  p95LatencyMs: number | null;
}

/**
 * Parameters for a time-bucketed span aggregation (volume + latency). Spans
 * are selected on their start time inside `[from, to]`; only non-empty
 * buckets are returned, ascending.
 */
export interface SpanTimeseriesParams {
  projectIds: string[];
  from: Date;
  to: Date;
  /** Calendar bucket (start of hour or day). Required unless `bucketSeconds` is set. */
  bucket?: 'hour' | 'day';
  /**
   * Fixed bucket width in seconds, an integer from 60 to 86,400. Buckets start
   * at multiples of it since the Unix epoch. Overrides `bucket` when set.
   */
  bucketSeconds?: number;
  /** One service or a list (any of them). An empty string means no filter. */
  serviceName?: string | string[];
  /** Keep only spans of these kinds (non-empty), e.g. `['SERVER', 'CONSUMER']` for entry spans. */
  kinds?: SpanKind[];
  /**
   * Filters with the semantics of `SpanQueryParams.attributeFilters`: a key
   * starting with `resource.` reads `resourceAttributes` with the rest of the
   * key, any other key reads `attributes`; every filter must hold.
   */
  attributeFilters?: MetadataFilter[];
  /**
   * One row per (bucket, service) instead of per bucket, each carrying its
   * `serviceName`; counts and percentiles are per service. Rows are ordered
   * by bucket time, then service name (byte order), both ascending.
   */
  groupByService?: boolean;
}

/** One time bucket of span volume + latency percentiles. */
export interface SpanTimeseriesBucket {
  time: Date;
  /** The service of the row; set only when `groupByService` is true. */
  serviceName?: string;
  spanCount: number;
  errorCount: number;
  p50: number | null;
  p95: number | null;
  p99: number | null;
}

/** Parameters for deleting spans by time range */
export interface DeleteSpansByTimeRangeParams {
  projectId: string | string[];
  from: Date;
  to: Date;
  serviceName?: string | string[];
}

// ============================================================================
// Metric Types
// ============================================================================

/** OTLP metric types */
export type MetricType = 'gauge' | 'sum' | 'histogram' | 'exp_histogram' | 'summary';

/** Histogram/summary bucket data stored in JSONB */
export interface HistogramData {
  sum?: number;
  count?: number;
  min?: number;
  max?: number;
  /** Histogram: bucket counts per explicit bound */
  bucket_counts?: number[];
  explicit_bounds?: number[];
  /**
   * 1.8: id of a canonical bucket grid (e.g. "exp2-s2-v1", exponential
   * histograms re-bucketed at ingest). When set, bucket_counts are the counts
   * on that grid and explicit_bounds is omitted: the engines treat the id as
   * opaque (merge class key, returned as MetricHistogramValue.grid) and the
   * backend expands it to explicit bounds. Takes precedence over
   * explicit_bounds when both are present.
   */
  grid?: string;
  /** ExponentialHistogram fields */
  scale?: number;
  zero_count?: number;
  positive?: { offset: number; bucket_counts: number[] };
  negative?: { offset: number; bucket_counts: number[] };
  /** Summary: quantile values */
  quantile_values?: Array<{ quantile: number; value: number }>;
}

/** A single metric exemplar with trace correlation */
export interface MetricExemplar {
  exemplarValue: number;
  exemplarTime?: Date;
  traceId?: string;
  spanId?: string;
  attributes?: Record<string, unknown>;
}

/** A metric data point record for ingestion */
export interface MetricRecord {
  time: Date;
  organizationId: string;
  projectId: string;
  metricName: string;
  metricType: MetricType;
  value: number;
  isMonotonic?: boolean;
  serviceName: string;
  attributes?: Record<string, unknown>;
  resourceAttributes?: Record<string, unknown>;
  /** 1.8: OTLP unit (e.g. "By", "%", "s"). Engines do not store it; the backend metric catalog does. */
  unit?: string;
  /** 1.8: OTLP description. Engines do not store it; the backend metric catalog does. */
  description?: string;
  /** 1.8: OTLP aggregation temporality of sums and histograms. Engines do not store it; the catalog does. */
  temporality?: 'cumulative' | 'delta';
  histogramData?: HistogramData;
  exemplars?: MetricExemplar[];
}

/** A stored metric record (includes DB-generated id) */
export interface StoredMetricRecord extends MetricRecord {
  id: string;
  hasExemplars: boolean;
}

/** Parameters for querying raw metric data points */
export interface MetricQueryParams {
  organizationId?: string | string[];
  projectId: string | string[];
  metricName?: string | string[];
  metricType?: MetricType | MetricType[];
  serviceName?: string | string[];
  from: Date;
  to: Date;
  fromExclusive?: boolean;
  toExclusive?: boolean;
  /** Filter by label key-value pairs */
  attributes?: Record<string, string>;
  limit?: number;
  offset?: number;
  sortOrder?: 'asc' | 'desc';
  includeExemplars?: boolean;
}

/** Result of a raw metric query */
export interface MetricQueryResult {
  metrics: StoredMetricRecord[];
  total: number;
  hasMore: boolean;
  limit: number;
  offset: number;
  executionTimeMs?: number;
}

/** Aggregation function for metric time-series */
/**
 * hist_last / hist_sum (1.8) work on histogram_data with explicit buckets
 * (explicit_bounds + bucket_counts; exponential histograms are converted to
 * explicit buckets at ingest) and fill MetricTimeBucket.histogram:
 * - hist_last: the histogram of the latest point in the bucket (per group).
 *   For cumulative temporality, where each point is a running total.
 * - hist_sum: element-wise sum of bucket_counts, sum of sum and count, over
 *   every point in the bucket (per group). For delta temporality.
 * Merge classes: only points with IDENTICAL explicit_bounds (same length and
 * same values in order) are added together. A point with a `grid` id
 * (HistogramData.grid) is valid when bucket_counts is a non-empty array; its
 * merge class key is the grid id plus the bucket_counts length (never its
 * bounds), so grid points and explicit-bounds points are separate classes.
 * The pick is the class of the latest point of the bucket (per group); its
 * bounds (or grid id, with bounds []) are returned and points of other classes
 * are skipped (ties on time: engine-defined). Points without histogram_data or
 * buckets are ignored. MetricTimeBucket.value = count.
 */
export type MetricAggregationFn =
  | 'avg'
  | 'sum'
  | 'min'
  | 'max'
  | 'count'
  | 'last'
  | 'p50'
  | 'p95'
  | 'p99'
  | 'hist_last'
  | 'hist_sum';

/** 1.8: a histogram value returned by hist_last / hist_sum. */
export interface MetricHistogramValue {
  /**
   * Explicit upper bounds (length n); counts has n + 1 entries (last is +Inf).
   * Empty when `grid` is set.
   */
  bounds: number[];
  /**
   * 1.8: the canonical grid id of the merge class (HistogramData.grid), set
   * for points stored with a grid instead of explicit bounds. The engines do
   * not know the grid's bounds: `bounds` is then [] and the caller expands
   * the id (counts are the counts on that grid).
   */
  grid?: string;
  counts: number[];
  sum: number;
  count: number;
}

/** Parameters for time-series aggregation of metrics */
export interface MetricAggregateParams {
  organizationId?: string | string[];
  projectId: string | string[];
  metricName: string;
  metricType?: MetricType;
  serviceName?: string | string[];
  from: Date;
  to: Date;
  interval: AggregationInterval;
  aggregation: MetricAggregationFn;
  /** Group results by these label keys */
  groupBy?: string[];
  attributes?: Record<string, string>;
  /**
   * 1.8: group by metric or resource attributes, after groupBy. Each ref adds
   * a label keyed by metricAttrLabel(ref) ("resource." prefix for resource keys).
   */
  groupByAttrs?: MetricAttrRef[];
  /** 1.8: filters on metric or resource attributes, all ANDed. */
  filters?: MetricAttrFilter[];
}

/** Which attribute map a key lives in: data point attributes or resource attributes. */
export type MetricAttrScope = 'metric' | 'resource';

/** A reference to one attribute of a metric data point or of its resource. */
export interface MetricAttrRef {
  scope: MetricAttrScope;
  /** Literal key, dots included ("host.name" is one key, never a path). */
  key: string;
}

/**
 * Attribute filter (1.8). Values compare as text, except gte/lt which compare
 * numerically (a missing or non-numeric value never matches). exists and
 * notExists ignore values. eq/neq take exactly one value, in/nin one or more.
 * neq/nin match data points that lack the key.
 */
export type MetricAttrFilterOp = 'eq' | 'neq' | 'in' | 'nin' | 'exists' | 'notExists' | 'gte' | 'lt';

export interface MetricAttrFilter extends MetricAttrRef {
  op: MetricAttrFilterOp;
  values?: string[];
}

/** Label key of a grouped attribute in MetricTimeBucket.labels. */
export function metricAttrLabel(ref: MetricAttrRef): string {
  return ref.scope === 'resource' ? `resource.${ref.key}` : ref.key;
}

/** A single time bucket in a metric aggregation result */
export interface MetricTimeBucket {
  bucket: Date;
  value: number;
  labels?: Record<string, string>;
  /** 1.8: set for hist_last / hist_sum. */
  histogram?: MetricHistogramValue;
}

/** Result of a metric aggregation query */
export interface MetricAggregateResult {
  metricName: string;
  metricType: MetricType;
  timeseries: MetricTimeBucket[];
  executionTimeMs?: number;
}

/** Parameters for listing distinct metric names */
export interface MetricNamesParams {
  organizationId?: string | string[];
  projectId: string | string[];
  metricType?: MetricType | MetricType[];
  from?: Date;
  to?: Date;
  limit?: number;
  /** 1.8: only names with at least one data point matching every filter (e.g. resource host.name = X). */
  filters?: MetricAttrFilter[];
}

/** Result of metric name listing */
export interface MetricNamesResult {
  names: Array<{ name: string; type: MetricType }>;
  executionTimeMs?: number;
}

/** Parameters for label key/value discovery */
export interface MetricLabelParams {
  organizationId?: string | string[];
  projectId: string | string[];
  /** Required for metric scope. With resource scope, an empty string means every metric. */
  metricName: string;
  from?: Date;
  to?: Date;
  limit?: number;
  /** 1.8: which attribute map keys/values come from. Default 'metric'. */
  scope?: MetricAttrScope;
}

/**
 * 1.8: who sends metrics. One row per distinct value of a resource attribute
 * (for example host.name or service.name) across the projects and window.
 */
export interface MetricSourcesParams {
  organizationId?: string | string[];
  projectId: string | string[];
  from: Date;
  to: Date;
  /** Resource attribute that identifies a source, e.g. "host.name". */
  key: string;
  /** Only count data points whose metric name starts with one of these prefixes. */
  includeMetricPrefixes?: string[];
  /** Ignore data points whose metric name starts with one of these prefixes. */
  excludeMetricPrefixes?: string[];
  /** Other resource attributes collected per source (distinct values, at most 20 each, sorted). */
  coKeys?: string[];
  /** Max sources, ordered by value ascending. Default 500. */
  limit?: number;
}

export interface MetricSource {
  /** Value of the identifying resource attribute (non-empty). */
  value: string;
  /** Projects where the source was seen, sorted. */
  projectIds: string[];
  lastSeen: Date;
  /** Distinct metric names sent by the source in the window. */
  metricCount: number;
  /** Data points in the window. */
  pointCount: number;
  /** Distinct non-empty values per requested co-key, at most 20 (which 20 is engine-defined when there are more), sorted; every requested key present, possibly empty. */
  co: Record<string, string[]>;
}

export interface MetricSourcesResult {
  sources: MetricSource[];
  executionTimeMs?: number;
}

/** Result of metric label query */
export interface MetricLabelResult {
  keys?: string[];
  values?: string[];
  executionTimeMs?: number;
}

/** Result of batch metric ingestion */
export interface IngestMetricsResult {
  ingested: number;
  failed: number;
  durationMs: number;
  errors?: Array<{ index: number; error: string }>;
}

/** Parameters for deleting metrics by time range */
export interface DeleteMetricsByTimeRangeParams {
  projectId: string | string[];
  from: Date;
  to: Date;
  metricName?: string | string[];
  serviceName?: string | string[];
}

/** A metric summary for dashboard overview */
export interface MetricOverviewItem {
  metricName: string;
  metricType: MetricType;
  serviceName: string;
  latestValue: number;
  avgValue: number;
  minValue: number;
  maxValue: number;
  pointCount: number;
}

/** Parameters for metrics overview */
export interface MetricsOverviewParams {
  projectId: string | string[];
  from: Date;
  to: Date;
  serviceName?: string;
}

/** Result of metrics overview query */
export interface MetricsOverviewResult {
  services: Array<{
    serviceName: string;
    metrics: MetricOverviewItem[];
  }>;
  executionTimeMs?: number;
}

// ============================================================================
// 1.6 contract: log histogram, facets, metadata keys (spec 6.4)
// ============================================================================

/**
 * Log volume over time. Buckets are aligned to multiples of `bucketSeconds`
 * since the Unix epoch (UTC) and zero-filled across the filter's range.
 */
export interface LogHistogramParams extends LogFilterParams {
  /** Positive integer; at most MAX_HISTOGRAM_BUCKETS buckets in the range. */
  bucketSeconds: number;
}

export interface LogHistogramBucket {
  /** Bucket start. */
  time: Date;
  total: number;
  /** Levels with a zero count are omitted. */
  byLevel: Partial<Record<LogLevel, number>>;
}

export interface LogHistogramResult {
  buckets: LogHistogramBucket[];
  bucketSeconds: number;
}

export type LogFacetField = { builtin: 'level' | 'service' | 'hostname' } | { metadata: string };

/** Top values per field over the logs matching every filter (including one on the faceted field). */
export interface LogFacetsParams extends LogFilterParams {
  /** 1 to FACETS_MAX_FIELDS fields, no duplicates. */
  fields: LogFacetField[];
  /** Values per field, default FACETS_DEFAULT_LIMIT, clamped to 1..FACETS_MAX_LIMIT. */
  limit?: number;
  /**
   * Most matching logs counted, the newest first (time, then id, descending);
   * default and maximum FACETS_SAMPLE_SIZE.
   */
  sampleSize?: number;
  /**
   * Only the newest `scanLimit` logs of each project in the window (before
   * the filters) are considered; default and maximum FACETS_SCAN_LIMIT.
   */
  scanLimit?: number;
}

export interface LogFacet {
  /** `'level' | 'service' | 'hostname'` or `'metadata.<key>'`. */
  field: string;
  /** Count desc, then value byte order; values are text forms, empty strings skipped. */
  values: { value: string; count: number }[];
  /** Matching logs with a present value that is not in `values`. */
  otherCount: number;
}

export interface LogFacetsResult {
  /** One entry per requested field, in request order. */
  facets: LogFacet[];
  /**
   * Logs the facets were counted over: the newest matching logs among the
   * newest `scanLimit` logs of each project, at most `sampleSize`. Every
   * matching log of the window when it has fewer logs than both limits.
   */
  sampleSize: number;
}

/** Metadata keys seen in the most recent `sampleSize` logs of the range (at most DISCOVER_MAX_KEYS keys). */
export interface DiscoverMetadataKeysParams {
  projectId: string | string[];
  from: Date;
  to: Date;
  /** Default DISCOVER_DEFAULT_SAMPLE_SIZE, clamped to 1..DISCOVER_MAX_SAMPLE_SIZE. */
  sampleSize?: number;
}

export interface MetadataKeyOccurrence {
  /** Top-level key, or `parent.child` for one nested level (the child name may contain dots). */
  key: string;
  /** Number of sampled logs that have the key. */
  occurrences: number;
}

// ============================================================================
// 1.6 contract: operation stats and latency histogram (spec 6.4)
// ============================================================================

/**
 * Per-operation stats over entry spans: spans whose kind is in `kinds`
 * (default DEFAULT_OPERATION_KINDS). With `kinds` omitted and no such span in
 * scope, the root spans of the same scope are used instead.
 */
export interface OperationStatsParams {
  projectId: string;
  service?: string;
  from: Date;
  to: Date;
  kinds?: SpanKind[];
  /** Default OPERATION_STATS_DEFAULT_LIMIT, clamped to 1..OPERATION_STATS_MAX_LIMIT. */
  limit?: number;
}

export interface OperationStat {
  service: string;
  operation: string;
  count: number;
  /** Spans with status code ERROR. */
  errorCount: number;
  avgMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
}

/** Latency distribution of the same entry spans as getOperationStats. */
export interface LatencyHistogramParams {
  projectId: string;
  service?: string;
  operation?: string;
  from: Date;
  to: Date;
}

export interface LatencyHistogramResult {
  /** LATENCY_HISTOGRAM_BOUNDS_MS. */
  bounds: number[];
  /**
   * `bounds.length + 1` counts, upper-inclusive: `counts[i]` holds spans with
   * `bounds[i - 1] < duration <= bounds[i]`, the last one `> 60000` ms.
   */
  counts: number[];
}

// ============================================================================
// 1.6 contract: sessions (orchestrator addition)
// ============================================================================

/**
 * Sessions of a project: logs in range with a non-empty session id, grouped
 * by session id, ordered by last event desc then session id byte order.
 */
export interface ListSessionsParams {
  projectId: string;
  from: Date;
  to: Date;
  /** Positive integer, clamped to SESSIONS_MAX_LIMIT. */
  limit: number;
  /** `nextCursor` of the previous page. */
  cursor?: string;
  /** Applied to events before grouping. */
  service?: string;
}

export interface SessionSummary {
  sessionId: string;
  /** Byte-order smallest service among the grouped events. */
  service: string;
  firstEvent: Date;
  lastEvent: Date;
  eventCount: number;
  /** Events with level error or critical. */
  errorCount: number;
}

export interface ListSessionsResult {
  sessions: SessionSummary[];
  /** Present only when more rows exist. */
  nextCursor?: string;
}

export interface HasSessionsParams {
  projectId: string;
  from: Date;
  to: Date;
}
