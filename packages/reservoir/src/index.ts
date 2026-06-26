// Core types
export { GLOBAL_SCOPE } from './core/types.js';
export type { GlobalScope } from './core/types.js';
export type {
  LogLevel,
  SpanKind,
  SpanStatusCode,
  EngineType,
  StorageTier,
  SearchMode,
  FilterOperator,
  AggregationInterval,
  LogRecord,
  StoredLogRecord,
  Filter,
  QueryParams,
  QueryResult,
  AggregateParams,
  AggregateResult,
  TimeBucket,
  IngestResult,
  IngestReturningResult,
  HealthStatus,
  EngineCapabilities,
  StorageSegment,
  StorageConfig,
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
  ServiceDependency,
  ServiceDependencyResult,
  ServiceHealthStat,
  SpanTimeseriesParams,
  SpanTimeseriesBucket,
  DeleteSpansByTimeRangeParams,
  MetricType,
  HistogramData,
  MetricExemplar,
  MetricRecord,
  StoredMetricRecord,
  MetricQueryParams,
  MetricQueryResult,
  MetricAggregationFn,
  MetricAggregateParams,
  MetricTimeBucket,
  MetricAggregateResult,
  MetricNamesParams,
  MetricNamesResult,
  MetricLabelParams,
  MetricLabelResult,
  IngestMetricsResult,
  DeleteMetricsByTimeRangeParams,
  MetricOverviewItem,
  MetricsOverviewParams,
  MetricsOverviewResult,
} from './core/types.js';

// Core abstractions
export { StorageEngine } from './core/storage-engine.js';
export { QueryTranslator } from './core/query-translator.js';
export type { NativeQuery } from './core/query-translator.js';

// Factory and client
export { StorageEngineFactory } from './factory.js';
export type { EngineOptions } from './factory.js';
export { Reservoir } from './client.js';
export type { IReservoir } from './core/reservoir-interface.js';

// Engines - TimescaleDB
export { TimescaleEngine, TimescaleQueryTranslator } from './engines/timescale/index.js';
export type { TimescaleEngineOptions } from './engines/timescale/index.js';

// Engines - ClickHouse
export { ClickHouseEngine, ClickHouseQueryTranslator } from './engines/clickhouse/index.js';
export type { ClickHouseEngineOptions } from './engines/clickhouse/index.js';

// Engines - MongoDB
export { MongoDBEngine, MongoDBQueryTranslator } from './engines/mongodb/index.js';
export type { MongoDBEngineOptions } from './engines/mongodb/index.js';

// Buffered (async buffer layer)
export * from './buffered/index.js';

