/**
 * Core type definitions for @logtide/reservoir
 *
 * These types define the storage abstraction layer for log management.
 * They align with @logtide/shared types but are designed to be storage-agnostic.
 */

import type { LogLevel, SpanKind, SpanStatusCode } from '@logtide/shared';
export type { LogLevel, SpanKind, SpanStatusCode };

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

/** Parameters for querying logs */
export interface QueryParams {
  organizationId?: string | string[];
  projectId?: string | string[];
  service?: string | string[];
  level?: LogLevel | LogLevel[];
  hostname?: string | string[];
  traceId?: string;
  sessionId?: string;
  from: Date;
  to: Date;
  fromExclusive?: boolean; // time > from (instead of >=)
  toExclusive?: boolean;   // time < to (instead of <=)
  search?: string;
  searchMode?: SearchMode;
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
  organizationId?: string | string[];
  projectId?: string | string[];
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
export interface CountParams {
  organizationId?: string | string[];
  projectId?: string | string[];
  service?: string | string[];
  level?: LogLevel | LogLevel[];
  hostname?: string | string[];
  traceId?: string;
  sessionId?: string;
  from: Date;
  to: Date;
  fromExclusive?: boolean;
  toExclusive?: boolean;
  search?: string;
  searchMode?: SearchMode;
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
  organizationId?: string | string[];
  projectId?: string | string[];
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
  organizationId?: string | string[];
  projectId?: string | string[];
  service?: string | string[];
  level?: LogLevel | LogLevel[];
  hostname?: string | string[];
  from: Date;
  to: Date;
  fromExclusive?: boolean;
  toExclusive?: boolean;
  limit?: number;
}

/** Result of a top values query */
export interface TopValuesResult {
  values: Array<{ value: string; count: number }>;
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

/** Parameters for querying spans */
export interface SpanQueryParams {
  organizationId?: string | string[];
  projectId?: string | string[];
  traceId?: string | string[];
  serviceName?: string | string[];
  operationName?: string | string[];
  kind?: SpanKind | SpanKind[];
  statusCode?: SpanStatusCode | SpanStatusCode[];
  from: Date;
  to: Date;
  fromExclusive?: boolean;
  toExclusive?: boolean;
  limit?: number;
  offset?: number;
  sortBy?: string;
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

/** Parameters for querying traces */
export interface TraceQueryParams {
  organizationId?: string | string[];
  projectId?: string | string[];
  serviceName?: string | string[];
  error?: boolean;
  from: Date;
  to: Date;
  minDurationMs?: number;
  maxDurationMs?: number;
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
export type MetricAggregationFn = 'avg' | 'sum' | 'min' | 'max' | 'count' | 'last' | 'p50' | 'p95' | 'p99';

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
}

/** A single time bucket in a metric aggregation result */
export interface MetricTimeBucket {
  bucket: Date;
  value: number;
  labels?: Record<string, string>;
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
  metricName: string;
  from?: Date;
  to?: Date;
  limit?: number;
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
