import { createClient, type ClickHouseClient, type DataFormat, type InsertParams } from '@clickhouse/client';
import { randomUUID } from 'crypto';
import { currentOrNull } from '@logtide/shared/context';
import { StorageEngine } from '../../core/storage-engine.js';

const CH_SAFE_RE = /[^a-zA-Z0-9_:-]/g;
function chSafe(v: string | null | undefined): string {
  if (!v) return '-';
  const c = v.replace(CH_SAFE_RE, '');
  return c.length > 0 ? c : '-';
}
function chCtxComment(): string {
  if (process.env.LOGTIDE_CONTEXT_SQL_COMMENT === 'false') return '';
  const ctx = currentOrNull();
  if (!ctx) return '';
  return `/* req=${chSafe(ctx.requestId)} origin=${chSafe(ctx.origin)} org=${chSafe(
    ctx.organizationId
  )} actor=${chSafe(ctx.actor.type)}:${chSafe(ctx.actor.id)} */ `;
}
function chQueryId(operation: string): string | undefined {
  const ctx = currentOrNull();
  if (!ctx) return undefined;
  // ClickHouse rejects a query whose query_id matches one already running, so the
  // id MUST be unique per call: two concurrent same-operation queries in one
  // request would otherwise collide ("Query with id = ... is already running").
  // Keep request id + operation as a readable, greppable prefix (the request id is
  // also mirrored in the SQL log_comment for correlation) and append a random
  // suffix for uniqueness. Cap the prefix so the suffix is never truncated away
  // (ClickHouse query_id has a 100-char limit).
  const prefix = `${chSafe(ctx.requestId)}-${chSafe(operation)}`.slice(0, 90);
  return `${prefix}-${randomUUID().slice(0, 8)}`;
}
import type {
  LogRecord,
  LogLevel,
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
  TimeBucket,
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
  ServiceDependencyResult,
  ServiceHealthStat,
  SpanTimeseriesParams,
  SpanTimeseriesBucket,
  ServiceDependency,
  DeleteSpansByTimeRangeParams,
  SpanKind,
  SpanStatusCode,
  AggregationInterval,
  MetricRecord,
  StoredMetricRecord,
  MetricType,
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
  MetricExemplar,
  MetricOverviewItem,
  MetricsOverviewParams,
  MetricsOverviewResult,
} from '../../core/types.js';
import { ClickHouseQueryTranslator, toDateTime64 } from './query-translator.js';

export interface ClickHouseEngineOptions {
  /** Use an existing ClickHouse client instead of creating a new one */
  client?: ClickHouseClient;
  /** Table name to use (default: 'logs') */
  tableName?: string;
  /** Skip schema initialization (use when connecting to existing DB) */
  skipInitialize?: boolean;
}

export class ClickHouseEngine extends StorageEngine {
  private client: ClickHouseClient | null = null;
  private ownsClient: boolean;
  private translator: ClickHouseQueryTranslator;
  private options: ClickHouseEngineOptions;

  private get tableName(): string {
    return this.options.tableName ?? 'logs';
  }

  constructor(config: StorageConfig, options: ClickHouseEngineOptions = {}) {
    super(config);
    this.options = options;
    this.ownsClient = !options.client;
    if (options.client) {
      this.client = options.client;
    }
    this.translator = new ClickHouseQueryTranslator(this.tableName);
  }

  async connect(): Promise<void> {
    if (this.client) return;
    this.client = createClient({
      url: `http://${this.config.host}:${this.config.port}`,
      username: this.config.username,
      password: this.config.password,
      database: this.config.database,
      max_open_connections: this.config.poolSize ?? 50,
      request_timeout: this.config.connectionTimeoutMs ?? 30_000,
      compression: { request: true, response: true },
      keep_alive: { enabled: true },
      clickhouse_settings: {
        async_insert: 1,
        wait_for_async_insert: 1,
        async_insert_busy_timeout_ms: 200,
        max_threads: 2,
      },
    });
  }

  async disconnect(): Promise<void> {
    if (this.client && this.ownsClient) {
      await this.client.close();
      this.client = null;
    }
  }

  async healthCheck(): Promise<HealthStatus> {
    const start = Date.now();
    try {
      await this.runQuery({ query: 'SELECT 1', format: 'JSONEachRow' }, 'health-check');
      const responseTimeMs = Date.now() - start;
      let status: HealthStatus['status'] = 'healthy';
      if (responseTimeMs >= 200) status = 'unhealthy';
      else if (responseTimeMs >= 50) status = 'degraded';
      return { status, engine: 'clickhouse', connected: true, responseTimeMs };
    } catch (err) {
      return {
        status: 'unhealthy',
        engine: 'clickhouse',
        connected: false,
        responseTimeMs: Date.now() - start,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async initialize(): Promise<void> {
    if (this.options.skipInitialize) return;

    // Create database if it doesn't exist (connect without specifying database)
    const bootstrapClient = createClient({
      url: `http://${this.config.host}:${this.config.port}`,
      username: this.config.username,
      password: this.config.password,
    });
    try {
      await bootstrapClient.command({
        query: `CREATE DATABASE IF NOT EXISTS ${this.config.database}`,
      });
    } finally {
      await bootstrapClient.close();
    }

    const t = this.tableName;

    await this.runCommand({
      query: `
        CREATE TABLE IF NOT EXISTS ${t} (
          id UUID DEFAULT generateUUIDv4(),
          time DateTime64(3) NOT NULL,
          project_id String NOT NULL,
          service LowCardinality(String) NOT NULL,
          level LowCardinality(String) NOT NULL,
          message String NOT NULL,
          metadata String DEFAULT '{}',
          trace_id Nullable(String) DEFAULT NULL,
          span_id Nullable(String) DEFAULT NULL,
          session_id Nullable(String) DEFAULT NULL,
          created_at DateTime DEFAULT now()
        )
        ENGINE = MergeTree()
        PARTITION BY toYYYYMM(time)
        ORDER BY (project_id, time)
        SETTINGS index_granularity = 8192
      `,
    });

    try {
      await this.runCommand({
        query: `ALTER TABLE ${t} ADD INDEX IF NOT EXISTS idx_message_fulltext message TYPE ngrambf_v1(3, 32768, 3, 0) GRANULARITY 1`,
      });
    } catch {
      // index may already exist
    }

    try {
      await this.runCommand({
        query: `ALTER TABLE ${t} ADD INDEX IF NOT EXISTS idx_trace_id trace_id TYPE bloom_filter(0.01) GRANULARITY 1`,
      });
    } catch {
      // index may already exist
    }

    // Bloom filter on id - lets getByIds skip data granules that don't contain
    // any of the requested UUIDs without a full project scan.
    // MATERIALIZE rewrites every existing part, so only run it the first time the
    // index is created. Re-running it on each boot queues a full-table mutation
    // that can pin ClickHouse at 100% CPU on large tables.
    try {
      if (!(await this.chObjectExists('index', t, 'idx_id'))) {
        await this.runCommand({
          query: `ALTER TABLE ${t} ADD INDEX IF NOT EXISTS idx_id id TYPE bloom_filter(0.01) GRANULARITY 1`,
        });
        await this.runCommand({
          query: `ALTER TABLE ${t} MATERIALIZE INDEX idx_id`,
        });
      }
    } catch {
      // index may already exist
    }

    try {
      await this.runCommand({
        query: `ALTER TABLE ${t} ADD INDEX IF NOT EXISTS idx_span_id span_id TYPE bloom_filter(0.01) GRANULARITY 1`,
      });
    } catch {
      // index may already exist
    }

    // session_id: the engine writes and filters on it, so existing installs that
    // predate this column need it added. New tables already have it from CREATE.
    try {
      await this.runCommand({
        query: `ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS session_id Nullable(String) DEFAULT NULL`,
      });
      await this.runCommand({
        query: `ALTER TABLE ${t} ADD INDEX IF NOT EXISTS idx_session_id session_id TYPE bloom_filter(0.01) GRANULARITY 1`,
      });
    } catch {
      // column/index may already exist
    }

    // Projection for fast service+level filtered queries.
    // Gate the MATERIALIZE so the one-time backfill of existing parts runs only at
    // creation, not on every boot (see idx_id note above).
    try {
      if (!(await this.chObjectExists('projection', t, 'proj_service_time'))) {
        await this.runCommand({
          query: `ALTER TABLE ${t} ADD PROJECTION IF NOT EXISTS proj_service_time (SELECT * ORDER BY project_id, service, level, time)`,
        });
        await this.runCommand({
          query: `ALTER TABLE ${t} MATERIALIZE PROJECTION proj_service_time`,
        });
      }
    } catch {
      // projection may already exist
    }

    // Materialized column for hostname - extracted from metadata JSON once at ingest time.
    // Eliminates JSONExtractString() calls on every DISTINCT/filter query row.
    // Gate the explicit MATERIALIZE so the one-time backfill of existing parts runs
    // only at creation; re-issuing it every boot queues a full-table rewrite mutation.
    // New parts get the column at ingest regardless.
    try {
      if (!(await this.chObjectExists('column', t, 'hostname'))) {
        await this.runCommand({
          query: `ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS hostname String MATERIALIZED JSONExtractString(metadata, 'hostname')`,
        });
        await this.runCommand({
          query: `ALTER TABLE ${t} MATERIALIZE COLUMN hostname`,
        });
      }
    } catch {
      // column may already exist
    }

    // Spans table
    await this.runCommand({
      query: `
        CREATE TABLE IF NOT EXISTS spans (
          time DateTime64(3) NOT NULL,
          span_id String NOT NULL,
          trace_id String NOT NULL,
          parent_span_id Nullable(String) DEFAULT NULL,
          organization_id Nullable(String) DEFAULT NULL,
          project_id String NOT NULL,
          service_name LowCardinality(String) NOT NULL,
          operation_name String NOT NULL,
          start_time DateTime64(3) NOT NULL,
          end_time DateTime64(3) NOT NULL,
          duration_ms UInt32 NOT NULL,
          kind LowCardinality(Nullable(String)) DEFAULT NULL,
          status_code LowCardinality(Nullable(String)) DEFAULT NULL,
          status_message Nullable(String) DEFAULT NULL,
          attributes String DEFAULT '{}',
          events String DEFAULT '[]',
          links String DEFAULT '[]',
          resource_attributes String DEFAULT '{}'
        )
        ENGINE = MergeTree()
        PARTITION BY toYYYYMM(time)
        ORDER BY (project_id, trace_id, time)
        SETTINGS index_granularity = 8192
      `,
    });

    try {
      await this.runCommand({
        query: `ALTER TABLE spans ADD INDEX IF NOT EXISTS idx_spans_trace_id trace_id TYPE bloom_filter(0.01) GRANULARITY 1`,
      });
    } catch { /* index may already exist */ }

    try {
      await this.runCommand({
        query: `ALTER TABLE spans ADD INDEX IF NOT EXISTS idx_spans_parent parent_span_id TYPE bloom_filter(0.01) GRANULARITY 1`,
      });
    } catch { /* index may already exist */ }

    // Projection for fast service_name filtered span queries.
    // One-time MATERIALIZE only (see idx_id note above).
    try {
      if (!(await this.chObjectExists('projection', 'spans', 'proj_service_time'))) {
        await this.runCommand({
          query: `ALTER TABLE spans ADD PROJECTION IF NOT EXISTS proj_service_time (SELECT * ORDER BY project_id, service_name, status_code, time)`,
        });
        await this.runCommand({
          query: `ALTER TABLE spans MATERIALIZE PROJECTION proj_service_time`,
        });
      }
    } catch { /* projection may already exist */ }

    // Traces table (ReplacingMergeTree for upsert semantics)
    await this.runCommand({
      query: `
        CREATE TABLE IF NOT EXISTS traces (
          trace_id String NOT NULL,
          organization_id Nullable(String) DEFAULT NULL,
          project_id String NOT NULL,
          service_name LowCardinality(String) NOT NULL,
          root_service_name Nullable(String) DEFAULT NULL,
          root_operation_name Nullable(String) DEFAULT NULL,
          start_time DateTime64(3) NOT NULL,
          end_time DateTime64(3) NOT NULL,
          duration_ms UInt32 NOT NULL,
          span_count UInt32 NOT NULL,
          error UInt8 DEFAULT 0,
          updated_at DateTime DEFAULT now()
        )
        ENGINE = ReplacingMergeTree(updated_at)
        ORDER BY (project_id, trace_id)
        SETTINGS index_granularity = 8192
      `,
    });

    // Metrics table
    await this.runCommand({
      query: `
        CREATE TABLE IF NOT EXISTS metrics (
          time            DateTime64(3) NOT NULL,
          id              UUID DEFAULT generateUUIDv4(),
          organization_id Nullable(String) DEFAULT NULL,
          project_id      String NOT NULL,
          metric_name     LowCardinality(String) NOT NULL,
          metric_type     LowCardinality(String) NOT NULL,
          value           Float64 NOT NULL DEFAULT 0,
          is_monotonic    Nullable(UInt8) DEFAULT NULL,
          service_name    LowCardinality(String) NOT NULL DEFAULT 'unknown',
          attributes      String DEFAULT '{}',
          resource_attributes String DEFAULT '{}',
          histogram_data  Nullable(String) DEFAULT NULL,
          has_exemplars   UInt8 NOT NULL DEFAULT 0
        )
        ENGINE = MergeTree()
        PARTITION BY toYYYYMM(time)
        ORDER BY (project_id, metric_name, time)
        SETTINGS index_granularity = 8192
      `,
    });

    // Metric exemplars table
    await this.runCommand({
      query: `
        CREATE TABLE IF NOT EXISTS metric_exemplars (
          time            DateTime64(3) NOT NULL,
          id              UUID DEFAULT generateUUIDv4(),
          metric_id       String NOT NULL,
          organization_id Nullable(String) DEFAULT NULL,
          project_id      String NOT NULL,
          exemplar_value  Float64 NOT NULL,
          exemplar_time   Nullable(DateTime64(3)) DEFAULT NULL,
          trace_id        Nullable(String) DEFAULT NULL,
          span_id         Nullable(String) DEFAULT NULL,
          attributes      String DEFAULT '{}'
        )
        ENGINE = MergeTree()
        PARTITION BY toYYYYMM(time)
        ORDER BY (project_id, metric_id, time)
        SETTINGS index_granularity = 8192
      `,
    });

    // Metrics hourly rollup (target table for materialized view)
    await this.runCommand({
      query: `
        CREATE TABLE IF NOT EXISTS metrics_hourly_rollup (
          bucket DateTime NOT NULL,
          project_id String NOT NULL,
          metric_name LowCardinality(String) NOT NULL,
          metric_type LowCardinality(String) NOT NULL,
          service_name LowCardinality(String) NOT NULL,
          point_count UInt64,
          value_sum Float64,
          min_value Float64,
          max_value Float64
        )
        ENGINE = MergeTree()
        PARTITION BY toYYYYMM(bucket)
        ORDER BY (project_id, metric_name, service_name, bucket)
      `,
    });

    // Materialized view: auto-populates hourly rollup on insert to metrics
    await this.runCommand({
      query: `
        CREATE MATERIALIZED VIEW IF NOT EXISTS metrics_hourly_rollup_mv
        TO metrics_hourly_rollup AS
        SELECT
          toStartOfHour(time) AS bucket,
          project_id,
          metric_name,
          metric_type,
          service_name,
          count() AS point_count,
          sum(value) AS value_sum,
          min(value) AS min_value,
          max(value) AS max_value
        FROM metrics
        GROUP BY bucket, project_id, metric_name, metric_type, service_name
      `,
    });

    // Metrics daily rollup
    await this.runCommand({
      query: `
        CREATE TABLE IF NOT EXISTS metrics_daily_rollup (
          bucket DateTime NOT NULL,
          project_id String NOT NULL,
          metric_name LowCardinality(String) NOT NULL,
          metric_type LowCardinality(String) NOT NULL,
          service_name LowCardinality(String) NOT NULL,
          point_count UInt64,
          value_sum Float64,
          min_value Float64,
          max_value Float64
        )
        ENGINE = MergeTree()
        PARTITION BY toYYYYMM(bucket)
        ORDER BY (project_id, metric_name, service_name, bucket)
      `,
    });

    // Materialized view: auto-populates daily rollup on insert to metrics
    await this.runCommand({
      query: `
        CREATE MATERIALIZED VIEW IF NOT EXISTS metrics_daily_rollup_mv
        TO metrics_daily_rollup AS
        SELECT
          toStartOfDay(time) AS bucket,
          project_id,
          metric_name,
          metric_type,
          service_name,
          count() AS point_count,
          sum(value) AS value_sum,
          min(value) AS min_value,
          max(value) AS max_value
        FROM metrics
        GROUP BY bucket, project_id, metric_name, metric_type, service_name
      `,
    });
  }

  async migrate(_version: string): Promise<void> {
    // placeholder
  }

  async ingest(logs: LogRecord[]): Promise<IngestResult> {
    if (logs.length === 0) {
      return { ingested: 0, failed: 0, durationMs: 0 };
    }

    const start = Date.now();

    try {
      const values = logs.map((log) => this.toClickHouseRow(log));
      await this.runInsert({ table: this.tableName, values, format: 'JSONEachRow' }, 'ingest-logs');
      return { ingested: logs.length, failed: 0, durationMs: Date.now() - start };
    } catch (err) {
      return {
        ingested: 0,
        failed: logs.length,
        durationMs: Date.now() - start,
        errors: [{ index: 0, error: err instanceof Error ? err.message : String(err) }],
      };
    }
  }

  async ingestReturning(logs: LogRecord[]): Promise<IngestReturningResult> {
    if (logs.length === 0) {
      return { ingested: 0, failed: 0, durationMs: 0, rows: [] };
    }

    const start = Date.now();

    // Use provided IDs or generate client-side since ClickHouse has no RETURNING
    const logsWithIds = logs.map((log) => ({
      id: log.id ?? randomUUID(),
      ...this.toClickHouseRow(log),
    }));

    try {
      await this.runInsert({ table: this.tableName, values: logsWithIds, format: 'JSONEachRow' }, 'ingest-logs-returning');

      const rows: StoredLogRecord[] = logsWithIds.map((row, i) => ({
        id: row.id,
        time: logs[i].time,
        projectId: logs[i].projectId,
        service: logs[i].service,
        level: logs[i].level,
        message: logs[i].message,
        metadata: logs[i].metadata,
        traceId: logs[i].traceId,
        spanId: logs[i].spanId,
        hostname: logs[i].hostname,
      }));

      return { ingested: logs.length, failed: 0, durationMs: Date.now() - start, rows };
    } catch (err) {
      return {
        ingested: 0,
        failed: logs.length,
        durationMs: Date.now() - start,
        rows: [],
        errors: [{ index: 0, error: err instanceof Error ? err.message : String(err) }],
      };
    }
  }

  async query(params: QueryParams): Promise<QueryResult<StoredLogRecord>> {
    const start = Date.now();
    const native = this.translator.translateQuery(params);
    const limit = (native.metadata?.limit as number) ?? 50;
    const offset = params.offset ?? 0;

    const resultSet = await this.runQuery({
      query: native.query as string,
      query_params: (native.parameters as Record<string, unknown>[])[0],
      format: 'JSONEachRow',
    });
    const rows = await resultSet.json() as Record<string, unknown>[];
    const hasMore = rows.length > limit;
    const trimmedRows = hasMore ? rows.slice(0, limit) : rows;

    let nextCursor: string | undefined;
    if (hasMore) {
      const last = trimmedRows[trimmedRows.length - 1];
      const lastTime = parseClickHouseTime(last.time);
      const cursorStr = `${lastTime.toISOString()},${last.id}`;
      nextCursor = Buffer.from(cursorStr).toString('base64');
    }

    const logs = trimmedRows.map(mapClickHouseRowToStoredLogRecord);

    return {
      logs,
      total: trimmedRows.length,
      hasMore,
      limit,
      offset,
      nextCursor,
      executionTimeMs: Date.now() - start,
    };
  }

  async aggregate(params: AggregateParams): Promise<AggregateResult> {
    const start = Date.now();
    const native = this.translator.translateAggregate(params);

    const resultSet = await this.runQuery({
      query: native.query as string,
      query_params: (native.parameters as Record<string, unknown>[])[0],
      format: 'JSONEachRow',
    });
    const rows = await resultSet.json() as Record<string, unknown>[];

    const bucketMap = new Map<string, TimeBucket>();

    for (const row of rows) {
      const bucketTime = parseClickHouseTime(row.bucket);
      const key = bucketTime.toISOString();
      let bucket = bucketMap.get(key);
      if (!bucket) {
        bucket = { bucket: bucketTime, total: 0, byLevel: {} as Record<LogLevel, number> };
        bucketMap.set(key, bucket);
      }
      const count = Number(row.total);
      bucket.total += count;
      if (row.level && bucket.byLevel) {
        bucket.byLevel[row.level as LogLevel] = count;
      }
    }

    const timeseries = Array.from(bucketMap.values());
    const total = timeseries.reduce((sum, b) => sum + b.total, 0);

    return {
      timeseries,
      total,
      executionTimeMs: Date.now() - start,
    };
  }

  async getById(params: GetByIdParams): Promise<StoredLogRecord | null> {
    const resultSet = await this.runQuery({
      query: `SELECT * FROM ${this.tableName} WHERE id = {p_id:UUID} AND project_id = {p_project_id:String} LIMIT 1`,
      query_params: { p_id: params.id, p_project_id: params.projectId },
      format: 'JSONEachRow',
    });
    const rows = await resultSet.json() as Record<string, unknown>[];
    return rows.length > 0 ? mapClickHouseRowToStoredLogRecord(rows[0]) : null;
  }

  async getByIds(params: GetByIdsParams): Promise<StoredLogRecord[]> {
    if (params.ids.length === 0) return [];
    const resultSet = await this.runQuery({
      query: `SELECT * FROM ${this.tableName} WHERE id IN {p_ids:Array(UUID)} AND project_id = {p_project_id:String} ORDER BY time DESC`,
      query_params: { p_ids: params.ids, p_project_id: params.projectId },
      format: 'JSONEachRow',
    });
    const rows = await resultSet.json() as Record<string, unknown>[];
    return rows.map(mapClickHouseRowToStoredLogRecord);
  }

  async count(params: CountParams): Promise<CountResult> {
    const start = Date.now();
    const native = this.translator.translateCount(params);
    const resultSet = await this.runQuery({
      query: native.query as string,
      query_params: (native.parameters as Record<string, unknown>[])[0],
      format: 'JSONEachRow',
    });
    const rows = await resultSet.json() as Record<string, unknown>[];
    return {
      count: Number(rows[0]?.count ?? 0),
      executionTimeMs: Date.now() - start,
    };
  }

  async countEstimate(params: CountParams): Promise<CountResult> {
    // ClickHouse COUNT is already fast, but for massive datasets (>100M rows)
    // using a SAMPLE clause provides instant statistical estimates.
    // NOTE: SAMPLE requires the table to be created with SAMPLE BY.
    // Since we didn't define SAMPLE BY in the schema, we'll rely on 
    // ClickHouse's native speed, but we can avoid final deduplication
    // or complex filtering if possible.
    // For now, exact count is fast enough for ClickHouse on index keys.
    return this.count(params);
  }

  async distinct(params: DistinctParams): Promise<DistinctResult> {
    const start = Date.now();
    const native = this.translator.translateDistinct(params);
    const resultSet = await this.runQuery({
      query: native.query as string,
      query_params: (native.parameters as Record<string, unknown>[])[0],
      format: 'JSONEachRow',
    });
    const rows = await resultSet.json() as Record<string, unknown>[];
    return {
      values: rows.map((row) => row.value as string).filter((v) => v != null && v !== ''),
      executionTimeMs: Date.now() - start,
    };
  }

  async topValues(params: TopValuesParams): Promise<TopValuesResult> {
    const start = Date.now();
    const native = this.translator.translateTopValues(params);
    const resultSet = await this.runQuery({
      query: native.query as string,
      query_params: (native.parameters as Record<string, unknown>[])[0],
      format: 'JSONEachRow',
    });
    const rows = await resultSet.json() as Record<string, unknown>[];
    return {
      values: rows.map((row) => ({
        value: String(row.value),
        count: Number(row.count),
      })),
      executionTimeMs: Date.now() - start,
    };
  }

  async deleteByTimeRange(params: DeleteByTimeRangeParams): Promise<DeleteResult> {
    const start = Date.now();
    const native = this.translator.translateDelete(params);
    // ClickHouse mutations are async - the command returns immediately
    await this.runCommand({
      query: native.query as string,
      query_params: (native.parameters as Record<string, unknown>[])[0],
    });
    return {
      // ClickHouse async mutations don't report row count immediately
      deleted: 0,
      executionTimeMs: Date.now() - start,
    };
  }

  getCapabilities(): EngineCapabilities {
    return {
      engine: 'clickhouse',
      supportsFullTextSearch: true,
      supportsAggregations: true,
      supportsStreaming: true,
      supportsTransactions: false,
      maxBatchSize: 100_000,
      nativeCompression: true,
      nativeTiering: false,
      supportedOperators: ['=', '!=', '>', '>=', '<', '<=', 'in', 'not in', 'like', 'not like'],
      supportedIntervals: ['1m', '5m', '15m', '1h', '6h', '1d', '1w'],
    };
  }

  async getSegments(_startTime: Date, _endTime: Date): Promise<StorageSegment[]> {
    return [];
  }

  private getClient(): ClickHouseClient {
    if (!this.client) {
      throw new Error('Not connected. Call connect() first.');
    }
    return this.client;
  }

  /**
   * Returns true when a data-skipping index, projection, or materialized column
   * already exists on the given table.
   *
   * Gates the one-time MATERIALIZE backfills in initialize(): MATERIALIZE is NOT
   * idempotent, so re-issuing it on every initialize() (which runs on each process
   * boot) queues a fresh full-table-rewrite mutation each time and can pin
   * ClickHouse at 100% CPU on large tables. We only want to MATERIALIZE the first
   * time an object is created.
   *
   * On any introspection error we return true (assume it exists) so we never
   * trigger a surprise full-table MATERIALIZE storm; worst case the optimization
   * is not backfilled on pre-existing parts.
   */
  private async chObjectExists(
    kind: 'index' | 'projection' | 'column',
    table: string,
    name: string,
  ): Promise<boolean> {
    const source =
      kind === 'index'
        ? 'system.data_skipping_indices'
        : kind === 'projection'
          ? 'system.projections'
          : 'system.columns';
    try {
      const resultSet = await this.runQuery(
        {
          query: `SELECT count() AS c FROM ${source} WHERE database = {db:String} AND table = {tbl:String} AND name = {name:String}`,
          query_params: { db: this.config.database, tbl: table, name },
          format: 'JSONEachRow',
        },
        'schema-introspect',
      );
      const rows = (await resultSet.json()) as { c: string | number }[];
      return rows.length > 0 && Number(rows[0].c) > 0;
    } catch {
      return true;
    }
  }

  private async runCommand(args: Parameters<ClickHouseClient['command']>[0], op = 'cmd') {
    const client = this.getClient();
    const final = { ...args, query: chCtxComment() + args.query, query_id: (args as any).query_id ?? chQueryId(op) };
    return client.command(final);
  }

  private async runQuery<Format extends DataFormat>(
    args: { query: string; format?: Format; [k: string]: unknown },
    op = 'query',
  ) {
    const client = this.getClient();
    const final = { ...args, query: chCtxComment() + args.query, query_id: (args as any).query_id ?? chQueryId(op) };
    // The spread loses the format literal; cast via `any` to preserve the Format generic
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return client.query<Format>(final as any);
  }

  private async runInsert(args: InsertParams<import('stream').Readable>, op = 'insert') {
    const client = this.getClient();
    const queryId = chQueryId(op);
    const final: typeof args = { ...args };
    if (queryId) {
      (final as any).query_id = queryId;
    }
    const comment = chCtxComment().trim();
    if (comment) {
      (final as any).clickhouse_settings = {
        ...((args as any).clickhouse_settings as object | undefined),
        log_comment: comment,
      };
    }
    return client.insert(final);
  }

  private toClickHouseRow(log: LogRecord): Record<string, unknown> {
    const row: Record<string, unknown> = {
      time: log.time.getTime(),
      project_id: log.projectId,
      service: log.service,
      level: log.level,
      message: log.message,
      metadata: log.metadata ? JSON.stringify(log.metadata) : '{}',
      trace_id: log.traceId ?? null,
      span_id: log.spanId ?? null,
      session_id: log.sessionId ?? null,
    };
    if (log.id) {
      row.id = log.id;
    }
    return row;
  }

  // =========================================================================
  // Span & Trace Operations
  // =========================================================================

  async ingestSpans(spans: SpanRecord[]): Promise<IngestSpansResult> {
    if (spans.length === 0) return { ingested: 0, failed: 0, durationMs: 0 };

    const start = Date.now();

    try {
      const values = spans.map((span) => ({
        time: span.time.getTime(),
        span_id: span.spanId,
        trace_id: span.traceId,
        parent_span_id: span.parentSpanId ?? null,
        organization_id: span.organizationId ?? null,
        project_id: span.projectId,
        service_name: span.serviceName,
        operation_name: span.operationName,
        start_time: span.startTime.getTime(),
        end_time: span.endTime.getTime(),
        duration_ms: span.durationMs,
        kind: span.kind ?? null,
        status_code: span.statusCode ?? null,
        status_message: span.statusMessage ?? null,
        attributes: span.attributes ? JSON.stringify(span.attributes) : '{}',
        events: span.events ? JSON.stringify(span.events) : '[]',
        links: span.links ? JSON.stringify(span.links) : '[]',
        resource_attributes: span.resourceAttributes ? JSON.stringify(span.resourceAttributes) : '{}',
      }));

      await this.runInsert({ table: 'spans', values, format: 'JSONEachRow' }, 'ingest-spans');
      return { ingested: spans.length, failed: 0, durationMs: Date.now() - start };
    } catch (err) {
      return {
        ingested: 0,
        failed: spans.length,
        durationMs: Date.now() - start,
        errors: [{ index: 0, error: err instanceof Error ? err.message : String(err) }],
      };
    }
  }

  async upsertTrace(trace: TraceRecord): Promise<void> {
    // Recompute the trace summary directly from the spans table (the source of
    // truth) instead of read-modify-writing the existing traces row. The old
    // approach (SELECT existing -> existing.span_count + delta -> INSERT) lost
    // concurrent increments under a race. Aggregating from spans is idempotent and
    // race-free: spans are always inserted before the upsert, so whichever upsert
    // runs last writes the correct totals. The ReplacingMergeTree then keeps that
    // latest (correct) row. Falls back to the payload when no spans are present.
    const resultSet = await this.runQuery({
      query: `SELECT count() AS span_count,
                     min(start_time) AS start_time,
                     max(end_time) AS end_time,
                     max(status_code = 'ERROR') AS error
              FROM spans
              WHERE trace_id = {traceId:String} AND project_id = {projectId:String}`,
      query_params: { traceId: trace.traceId, projectId: trace.projectId },
      format: 'JSONEachRow',
    });
    const agg = (await resultSet.json<{
      span_count: number;
      start_time: string;
      end_time: string;
      error: number;
    }>())[0];

    const haveSpans = agg && Number(agg.span_count) > 0;
    const startTime = haveSpans ? parseClickHouseTime(agg.start_time) : trace.startTime;
    const endTime = haveSpans ? parseClickHouseTime(agg.end_time) : trace.endTime;
    const spanCount = haveSpans ? Number(agg.span_count) : trace.spanCount;
    const error = haveSpans ? !!agg.error : trace.error;

    const durationMs = endTime.getTime() - startTime.getTime();

    await this.runInsert({
      table: 'traces',
      values: [{
        trace_id: trace.traceId,
        organization_id: trace.organizationId ?? null,
        project_id: trace.projectId,
        service_name: trace.serviceName,
        root_service_name: trace.rootServiceName ?? null,
        root_operation_name: trace.rootOperationName ?? null,
        start_time: startTime.getTime(),
        end_time: endTime.getTime(),
        duration_ms: durationMs,
        span_count: spanCount,
        error: error ? 1 : 0,
      }],
      format: 'JSONEachRow',
    }, 'upsert-trace');
  }

  async querySpans(params: SpanQueryParams): Promise<SpanQueryResult> {
    const start = Date.now();
    const limit = params.limit ?? 50;
    const offset = params.offset ?? 0;

    const conditions: string[] = [];
    const queryParams: Record<string, unknown> = {};

    // Time range
    conditions.push(`time ${params.fromExclusive ? '>' : '>='} {p_from:DateTime64(3)}`);
    queryParams.p_from = toDateTime64(params.from);
    conditions.push(`time ${params.toExclusive ? '<' : '<='} {p_to:DateTime64(3)}`);
    queryParams.p_to = toDateTime64(params.to);

    if (params.projectId) {
      const pids = Array.isArray(params.projectId) ? params.projectId : [params.projectId];
      conditions.push(`project_id IN {p_pids:Array(String)}`);
      queryParams.p_pids = pids;
    }
    if (params.traceId) {
      const tids = Array.isArray(params.traceId) ? params.traceId : [params.traceId];
      conditions.push(`trace_id IN {p_tids:Array(String)}`);
      queryParams.p_tids = tids;
    }
    if (params.serviceName) {
      const svc = Array.isArray(params.serviceName) ? params.serviceName : [params.serviceName];
      conditions.push(`service_name IN {p_svc:Array(String)}`);
      queryParams.p_svc = svc;
    }
    if (params.kind) {
      const k = Array.isArray(params.kind) ? params.kind : [params.kind];
      conditions.push(`kind IN {p_kind:Array(String)}`);
      queryParams.p_kind = k;
    }
    if (params.statusCode) {
      const sc = Array.isArray(params.statusCode) ? params.statusCode : [params.statusCode];
      conditions.push(`status_code IN {p_sc:Array(String)}`);
      queryParams.p_sc = sc;
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Allowlist to prevent SQL injection via user-controlled sort parameters
    const ALLOWED_SORT_COLUMNS = new Set(['start_time', 'end_time', 'duration_ms', 'service_name', 'operation_name']);
    const ALLOWED_SORT_ORDERS = new Set(['asc', 'desc']);
    const sortBy = ALLOWED_SORT_COLUMNS.has(params.sortBy ?? '') ? params.sortBy! : 'start_time';
    const sortOrder = ALLOWED_SORT_ORDERS.has((params.sortOrder ?? '').toLowerCase()) ? params.sortOrder!.toUpperCase() : 'ASC';

    const countResult = await this.runQuery({
      query: `SELECT count() AS count FROM spans ${where}`,
      query_params: queryParams,
      format: 'JSONEachRow',
    });
    const total = Number((await countResult.json<{ count: string }>())[0]?.count ?? 0);

    const resultSet = await this.runQuery({
      query: `SELECT * FROM spans ${where} ORDER BY ${sortBy} ${sortOrder} LIMIT ${limit} OFFSET ${offset}`,
      query_params: queryParams,
      format: 'JSONEachRow',
    });
    const rows = await resultSet.json<Record<string, unknown>>();

    return {
      spans: rows.map(mapClickHouseRowToSpanRecord),
      total,
      hasMore: offset + rows.length < total,
      limit,
      offset,
      executionTimeMs: Date.now() - start,
    };
  }

  async getSpansByTraceId(traceId: string, projectId: string): Promise<SpanRecord[]> {
    const resultSet = await this.runQuery({
      query: `SELECT * FROM spans WHERE trace_id = {traceId:String} AND project_id = {projectId:String} ORDER BY start_time ASC`,
      query_params: { traceId, projectId },
      format: 'JSONEachRow',
    });
    const rows = await resultSet.json<Record<string, unknown>>();
    return rows.map(mapClickHouseRowToSpanRecord);
  }

  async queryTraces(params: TraceQueryParams): Promise<TraceQueryResult> {
    const start = Date.now();
    const limit = params.limit ?? 50;
    const offset = params.offset ?? 0;

    const conditions: string[] = [];
    const queryParams: Record<string, unknown> = {};

    conditions.push(`start_time >= {p_from:DateTime64(3)}`);
    queryParams.p_from = toDateTime64(params.from);
    conditions.push(`start_time <= {p_to:DateTime64(3)}`);
    queryParams.p_to = toDateTime64(params.to);

    if (params.projectId) {
      const pids = Array.isArray(params.projectId) ? params.projectId : [params.projectId];
      conditions.push(`project_id IN {p_pids:Array(String)}`);
      queryParams.p_pids = pids;
    }
    if (params.serviceName) {
      const svc = Array.isArray(params.serviceName) ? params.serviceName : [params.serviceName];
      conditions.push(`service_name IN {p_svc:Array(String)}`);
      queryParams.p_svc = svc;
    }
    if (params.error !== undefined) {
      conditions.push(`error = {p_error:UInt8}`);
      queryParams.p_error = params.error ? 1 : 0;
    }
    if (params.minDurationMs !== undefined) {
      conditions.push(`duration_ms >= {p_minDur:UInt32}`);
      queryParams.p_minDur = params.minDurationMs;
    }
    if (params.maxDurationMs !== undefined) {
      conditions.push(`duration_ms <= {p_maxDur:UInt32}`);
      queryParams.p_maxDur = params.maxDurationMs;
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Use FINAL to get deduplicated rows from ReplacingMergeTree
    const countResult = await this.runQuery({
      query: `SELECT count() AS count FROM traces FINAL ${where}`,
      query_params: queryParams,
      format: 'JSONEachRow',
    });
    const total = Number((await countResult.json<{ count: string }>())[0]?.count ?? 0);

    const resultSet = await this.runQuery({
      query: `SELECT * FROM traces FINAL ${where} ORDER BY start_time DESC LIMIT ${limit} OFFSET ${offset}`,
      query_params: queryParams,
      format: 'JSONEachRow',
    });
    const rows = await resultSet.json<Record<string, unknown>>();

    return {
      traces: rows.map(mapClickHouseRowToTraceRecord),
      total,
      hasMore: offset + rows.length < total,
      limit,
      offset,
      executionTimeMs: Date.now() - start,
    };
  }

  async getTraceById(traceId: string, projectId: string): Promise<TraceRecord | null> {
    const resultSet = await this.runQuery({
      query: `SELECT * FROM traces FINAL WHERE trace_id = {traceId:String} AND project_id = {projectId:String}`,
      query_params: { traceId, projectId },
      format: 'JSONEachRow',
    });
    const rows = await resultSet.json<Record<string, unknown>>();
    return rows.length > 0 ? mapClickHouseRowToTraceRecord(rows[0]) : null;
  }

  async getTraceServices(projectId: string, from?: Date, to?: Date): Promise<string[]> {
    const conditions = ['project_id = {p_pid:String}'];
    const queryParams: Record<string, unknown> = { p_pid: projectId };
    if (from) { conditions.push('start_time >= {p_from:DateTime64(3)}'); queryParams.p_from = toDateTime64(from); }
    if (to) { conditions.push('start_time <= {p_to:DateTime64(3)}'); queryParams.p_to = toDateTime64(to); }

    const resultSet = await this.runQuery({
      query: `SELECT DISTINCT service_name FROM traces WHERE ${conditions.join(' AND ')} ORDER BY service_name`,
      query_params: queryParams,
      format: 'JSONEachRow',
    });
    const rows = await resultSet.json<{ service_name: string }>();
    return rows.map((r) => r.service_name).filter((s) => s != null && s !== '');
  }

  async getServiceDependencies(
    projectId: string,
    from?: Date,
    to?: Date,
  ): Promise<ServiceDependencyResult> {
    const queryParams: Record<string, unknown> = { projectId };
    let timeFilter = '';

    if (from) {
      timeFilter += ` AND child.start_time >= {p_from:DateTime64(3)}`;
      queryParams.p_from = toDateTime64(from);
    }
    if (to) {
      timeFilter += ` AND child.start_time <= {p_to:DateTime64(3)}`;
      queryParams.p_to = toDateTime64(to);
    }

    const resultSet = await this.runQuery({
      query: `
        SELECT
          parent.service_name AS source_service,
          child.service_name AS target_service,
          count() AS call_count
        FROM spans AS child
        INNER JOIN spans AS parent
          ON child.parent_span_id = parent.span_id
          AND child.trace_id = parent.trace_id
        WHERE child.project_id = {projectId:String}
          AND child.service_name != parent.service_name
          ${timeFilter}
        GROUP BY parent.service_name, child.service_name
      `,
      query_params: queryParams,
      format: 'JSONEachRow',
    });

    const rows = await resultSet.json<{ source_service: string; target_service: string; call_count: string }>();

    const serviceCallCounts = new Map<string, number>();
    const edges: ServiceDependency[] = [];

    for (const row of rows) {
      const source = row.source_service;
      const target = row.target_service;
      const count = Number(row.call_count);

      serviceCallCounts.set(source, (serviceCallCounts.get(source) || 0) + count);
      serviceCallCounts.set(target, (serviceCallCounts.get(target) || 0) + count);
      edges.push({ source, target, callCount: count });
    }

    const nodes = Array.from(serviceCallCounts.entries()).map(([name, callCount]) => ({
      id: name,
      name,
      callCount,
    }));

    return { nodes, edges };
  }

  async getServiceHealthStats(
    projectId: string,
    from?: Date,
    to?: Date,
  ): Promise<ServiceHealthStat[]> {
    const queryParams: Record<string, unknown> = { projectId };
    let timeFilter = '';

    if (from) {
      timeFilter += ` AND start_time >= {p_from:DateTime64(3)}`;
      queryParams.p_from = toDateTime64(from);
    }
    if (to) {
      timeFilter += ` AND start_time <= {p_to:DateTime64(3)}`;
      queryParams.p_to = toDateTime64(to);
    }

    // True window p95 from raw spans via quantile() (approximate t-digest, over
    // the whole window - not a max of per-bucket percentiles).
    const resultSet = await this.runQuery({
      query: `
        SELECT
          service_name,
          count() AS total_calls,
          countIf(status_code = 'ERROR') AS total_errors,
          avg(duration_ms) AS avg_latency_ms,
          quantile(0.95)(duration_ms) AS p95_latency_ms
        FROM spans
        WHERE project_id = {projectId:String}${timeFilter}
        GROUP BY service_name
      `,
      query_params: queryParams,
      format: 'JSONEachRow',
    });

    const rows = await resultSet.json<{
      service_name: string;
      total_calls: string;
      total_errors: string;
      avg_latency_ms: number;
      p95_latency_ms: number | null;
    }>();

    return rows.map((r) => ({
      serviceName: r.service_name,
      totalCalls: Number(r.total_calls),
      totalErrors: Number(r.total_errors),
      avgLatencyMs: Number(r.avg_latency_ms),
      p95LatencyMs: r.p95_latency_ms != null ? Number(r.p95_latency_ms) : null,
    }));
  }

  async getSpanTimeseries(params: SpanTimeseriesParams): Promise<SpanTimeseriesBucket[]> {
    const { projectIds, from, to, bucket, serviceName } = params;
    if (projectIds.length === 0) return [];

    const truncFn = bucket === 'day' ? 'toStartOfDay' : 'toStartOfHour';
    const queryParams: Record<string, unknown> = {
      p_pids: projectIds,
      p_from: toDateTime64(from),
      p_to: toDateTime64(to),
    };
    let svcFilter = '';
    if (serviceName) {
      svcFilter = ` AND service_name = {p_service:String}`;
      queryParams.p_service = serviceName;
    }

    const resultSet = await this.runQuery({
      query: `
        SELECT
          ${truncFn}(start_time) AS bucket,
          count() AS span_count,
          countIf(status_code = 'ERROR') AS error_count,
          quantile(0.5)(duration_ms) AS p50,
          quantile(0.95)(duration_ms) AS p95,
          quantile(0.99)(duration_ms) AS p99
        FROM spans
        WHERE project_id IN {p_pids:Array(String)}
          AND start_time >= {p_from:DateTime64(3)}
          AND start_time <= {p_to:DateTime64(3)}${svcFilter}
        GROUP BY bucket
        ORDER BY bucket ASC
      `,
      query_params: queryParams,
      format: 'JSONEachRow',
    });

    const rows = await resultSet.json<{
      bucket: string;
      span_count: string;
      error_count: string;
      p50: number | null;
      p95: number | null;
      p99: number | null;
    }>();

    return rows.map((r) => ({
      time: parseClickHouseTime(r.bucket),
      spanCount: Number(r.span_count ?? 0),
      errorCount: Number(r.error_count ?? 0),
      p50: r.p50 != null ? Number(r.p50) : null,
      p95: r.p95 != null ? Number(r.p95) : null,
      p99: r.p99 != null ? Number(r.p99) : null,
    }));
  }

  async deleteSpansByTimeRange(params: DeleteSpansByTimeRangeParams): Promise<DeleteResult> {
    const start = Date.now();
    const pids = Array.isArray(params.projectId) ? params.projectId : [params.projectId];

    const conditions = [
      `project_id IN {p_pids:Array(String)}`,
      `time >= {p_from:DateTime64(3)}`,
      `time <= {p_to:DateTime64(3)}`,
    ];
    const queryParams: Record<string, unknown> = {
      p_pids: pids,
      p_from: toDateTime64(params.from),
      p_to: toDateTime64(params.to),
    };

    if (params.serviceName) {
      const svc = Array.isArray(params.serviceName) ? params.serviceName : [params.serviceName];
      conditions.push(`service_name IN {p_svc:Array(String)}`);
      queryParams.p_svc = svc;
    }

    // ClickHouse mutations are async
    await this.runCommand({
      query: `ALTER TABLE spans DELETE WHERE ${conditions.join(' AND ')}`,
      query_params: queryParams,
    });

    return { deleted: 0, executionTimeMs: Date.now() - start };
  }

  // =========================================================================
  // Metric Operations
  // =========================================================================

  async ingestMetrics(metrics: MetricRecord[]): Promise<IngestMetricsResult> {
    if (metrics.length === 0) return { ingested: 0, failed: 0, durationMs: 0 };

    const start = Date.now();

    try {
      const metricRows: Record<string, unknown>[] = [];
      const exemplarRows: Record<string, unknown>[] = [];

      for (const metric of metrics) {
        const metricId = randomUUID();
        const hasExemplars = (metric.exemplars?.length ?? 0) > 0;

        metricRows.push({
          time: metric.time.getTime(),
          id: metricId,
          organization_id: metric.organizationId ?? null,
          project_id: metric.projectId,
          metric_name: metric.metricName,
          metric_type: metric.metricType,
          value: metric.value,
          is_monotonic: metric.isMonotonic != null ? (metric.isMonotonic ? 1 : 0) : null,
          service_name: metric.serviceName || 'unknown',
          attributes: metric.attributes ? JSON.stringify(metric.attributes) : '{}',
          resource_attributes: metric.resourceAttributes ? JSON.stringify(metric.resourceAttributes) : '{}',
          histogram_data: metric.histogramData ? JSON.stringify(metric.histogramData) : null,
          has_exemplars: hasExemplars ? 1 : 0,
        });

        if (hasExemplars && metric.exemplars) {
          for (const ex of metric.exemplars) {
            exemplarRows.push({
              time: metric.time.getTime(),
              metric_id: metricId,
              organization_id: metric.organizationId ?? null,
              project_id: metric.projectId,
              exemplar_value: ex.exemplarValue,
              exemplar_time: ex.exemplarTime ? ex.exemplarTime.getTime() : null,
              trace_id: ex.traceId ?? null,
              span_id: ex.spanId ?? null,
              attributes: ex.attributes ? JSON.stringify(ex.attributes) : '{}',
            });
          }
        }
      }

      await this.runInsert({ table: 'metrics', values: metricRows, format: 'JSONEachRow' }, 'ingest-metrics');

      if (exemplarRows.length > 0) {
        await this.runInsert({ table: 'metric_exemplars', values: exemplarRows, format: 'JSONEachRow' }, 'ingest-metric-exemplars');
      }

      return { ingested: metrics.length, failed: 0, durationMs: Date.now() - start };
    } catch (err) {
      return {
        ingested: 0,
        failed: metrics.length,
        durationMs: Date.now() - start,
        errors: [{ index: 0, error: err instanceof Error ? err.message : String(err) }],
      };
    }
  }

  async queryMetrics(params: MetricQueryParams): Promise<MetricQueryResult> {
    const start = Date.now();
    const limit = params.limit ?? 50;
    const offset = params.offset ?? 0;

    const conditions: string[] = [];
    const queryParams: Record<string, unknown> = {};

    // Project ID (required)
    const pids = Array.isArray(params.projectId) ? params.projectId : [params.projectId];
    conditions.push(`project_id IN {p_pids:Array(String)}`);
    queryParams.p_pids = pids;

    // Time range
    conditions.push(`time ${params.fromExclusive ? '>' : '>='} {p_from:DateTime64(3)}`);
    queryParams.p_from = toDateTime64(params.from);
    conditions.push(`time ${params.toExclusive ? '<' : '<='} {p_to:DateTime64(3)}`);
    queryParams.p_to = toDateTime64(params.to);

    if (params.organizationId) {
      const oids = Array.isArray(params.organizationId) ? params.organizationId : [params.organizationId];
      conditions.push(`organization_id IN {p_oids:Array(String)}`);
      queryParams.p_oids = oids;
    }
    if (params.metricName) {
      const names = Array.isArray(params.metricName) ? params.metricName : [params.metricName];
      conditions.push(`metric_name IN {p_names:Array(String)}`);
      queryParams.p_names = names;
    }
    if (params.metricType) {
      const types = Array.isArray(params.metricType) ? params.metricType : [params.metricType];
      conditions.push(`metric_type IN {p_types:Array(String)}`);
      queryParams.p_types = types;
    }
    if (params.serviceName) {
      const svc = Array.isArray(params.serviceName) ? params.serviceName : [params.serviceName];
      conditions.push(`service_name IN {p_svc:Array(String)}`);
      queryParams.p_svc = svc;
    }

    // Attribute label filtering
    if (params.attributes) {
      let attrIdx = 0;
      for (const [key, val] of Object.entries(params.attributes)) {
        const keyParam = `p_attr_key_${attrIdx}`;
        const valParam = `p_attr_val_${attrIdx}`;
        conditions.push(`JSONExtractString(attributes, {${keyParam}:String}) = {${valParam}:String}`);
        queryParams[keyParam] = key;
        queryParams[valParam] = val;
        attrIdx++;
      }
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const sortOrder = params.sortOrder ?? 'desc';

    // Count total
    const countResult = await this.runQuery({
      query: `SELECT count() AS count FROM metrics ${where}`,
      query_params: queryParams,
      format: 'JSONEachRow',
    });
    const total = Number((await countResult.json<{ count: string }>())[0]?.count ?? 0);

    // Fetch rows
    const resultSet = await this.runQuery({
      query: `SELECT * FROM metrics ${where} ORDER BY time ${sortOrder} LIMIT ${limit} OFFSET ${offset}`,
      query_params: queryParams,
      format: 'JSONEachRow',
    });
    const rows = await resultSet.json<Record<string, unknown>>();

    let metricsResult = rows.map(mapClickHouseRowToMetricRecord);

    // Fetch exemplars if requested
    if (params.includeExemplars) {
      const metricIds = metricsResult.filter(m => m.hasExemplars).map(m => m.id);
      if (metricIds.length > 0) {
        const exemplarResult = await this.runQuery({
          query: `SELECT * FROM metric_exemplars WHERE metric_id IN {p_mids:Array(String)} ORDER BY time ASC`,
          query_params: { p_mids: metricIds },
          format: 'JSONEachRow',
        });
        const exemplarRows = await exemplarResult.json<Record<string, unknown>>();

        const exemplarsByMetricId = new Map<string, MetricExemplar[]>();
        for (const row of exemplarRows) {
          const metricId = String(row.metric_id);
          if (!exemplarsByMetricId.has(metricId)) {
            exemplarsByMetricId.set(metricId, []);
          }
          exemplarsByMetricId.get(metricId)!.push({
            exemplarValue: Number(row.exemplar_value),
            exemplarTime: row.exemplar_time ? parseClickHouseTime(row.exemplar_time) : undefined,
            traceId: row.trace_id ? String(row.trace_id) : undefined,
            spanId: row.span_id ? String(row.span_id) : undefined,
            attributes: parseJsonField(row.attributes) as Record<string, unknown> | undefined,
          });
        }

        metricsResult = metricsResult.map(m => ({
          ...m,
          exemplars: exemplarsByMetricId.get(m.id) ?? m.exemplars,
        }));
      }
    }

    return {
      metrics: metricsResult,
      total,
      hasMore: offset + rows.length < total,
      limit,
      offset,
      executionTimeMs: Date.now() - start,
    };
  }

  async aggregateMetrics(params: MetricAggregateParams): Promise<MetricAggregateResult> {
    const start = Date.now();

    // Use pre-aggregated rollups when eligible
    if (this.canUseMetricRollup(params)) {
      return this.aggregateMetricsFromRollup(params, start);
    }

    const intervalMap: Record<AggregationInterval, string> = {
      '1m': '1 MINUTE',
      '5m': '5 MINUTE',
      '15m': '15 MINUTE',
      '1h': '1 HOUR',
      '6h': '6 HOUR',
      '1d': '1 DAY',
      '1w': '1 WEEK',
    };
    const interval = intervalMap[params.interval];

    const aggFnMap: Record<string, string> = {
      avg: 'avg(value)',
      sum: 'sum(value)',
      min: 'min(value)',
      max: 'max(value)',
      count: 'count()',
      last: 'argMax(value, time)',
      p50: 'quantile(0.5)(value)',
      p95: 'quantile(0.95)(value)',
      p99: 'quantile(0.99)(value)',
    };
    const aggExpr = aggFnMap[params.aggregation] ?? 'avg(value)';

    const conditions: string[] = [];
    const queryParams: Record<string, unknown> = {};

    const pids = Array.isArray(params.projectId) ? params.projectId : [params.projectId];
    conditions.push(`project_id IN {p_pids:Array(String)}`);
    queryParams.p_pids = pids;

    conditions.push(`time >= {p_from:DateTime64(3)}`);
    queryParams.p_from = toDateTime64(params.from);
    conditions.push(`time <= {p_to:DateTime64(3)}`);
    queryParams.p_to = toDateTime64(params.to);

    conditions.push(`metric_name = {p_name:String}`);
    queryParams.p_name = params.metricName;

    if (params.organizationId) {
      const oids = Array.isArray(params.organizationId) ? params.organizationId : [params.organizationId];
      conditions.push(`organization_id IN {p_oids:Array(String)}`);
      queryParams.p_oids = oids;
    }
    if (params.metricType) {
      conditions.push(`metric_type = {p_type:String}`);
      queryParams.p_type = params.metricType;
    }
    if (params.serviceName) {
      const svc = Array.isArray(params.serviceName) ? params.serviceName : [params.serviceName];
      conditions.push(`service_name IN {p_svc:Array(String)}`);
      queryParams.p_svc = svc;
    }

    // Attribute label filtering
    if (params.attributes) {
      let attrIdx = 0;
      for (const [key, val] of Object.entries(params.attributes)) {
        const keyParam = `p_attr_key_${attrIdx}`;
        const valParam = `p_attr_val_${attrIdx}`;
        conditions.push(`JSONExtractString(attributes, {${keyParam}:String}) = {${valParam}:String}`);
        queryParams[keyParam] = key;
        queryParams[valParam] = val;
        attrIdx++;
      }
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Build GROUP BY columns for groupBy label keys
    const groupByColumns = ['bucket'];
    const selectExtra: string[] = [];
    if (params.groupBy && params.groupBy.length > 0) {
      for (let i = 0; i < params.groupBy.length; i++) {
        const labelKey = params.groupBy[i];
        const alias = `label_${i}`;
        const keyParam = `p_gb_key_${i}`;
        selectExtra.push(`JSONExtractString(attributes, {${keyParam}:String}) AS ${alias}`);
        queryParams[keyParam] = labelKey;
        groupByColumns.push(alias);
      }
    }

    const selectCols = [
      `toStartOfInterval(time, INTERVAL ${interval}) AS bucket`,
      `${aggExpr} AS agg_value`,
      ...selectExtra,
    ].join(', ');

    const query = `SELECT ${selectCols} FROM metrics ${where} GROUP BY ${groupByColumns.join(', ')} ORDER BY bucket ASC`;

    const resultSet = await this.runQuery({
      query,
      query_params: queryParams,
      format: 'JSONEachRow',
    });
    const rows = await resultSet.json<Record<string, unknown>>();

    const timeseries = rows.map(row => {
      const bucket: { bucket: Date; value: number; labels?: Record<string, string> } = {
        bucket: parseClickHouseTime(row.bucket),
        value: Number(row.agg_value),
      };

      if (params.groupBy && params.groupBy.length > 0) {
        const labels: Record<string, string> = {};
        for (let i = 0; i < params.groupBy.length; i++) {
          labels[params.groupBy[i]] = String(row[`label_${i}`] ?? '');
        }
        bucket.labels = labels;
      }

      return bucket;
    });

    // Determine metricType: use param or query DB
    let metricType: MetricType = params.metricType ?? 'gauge';
    if (!params.metricType) {
      const typeResult = await this.runQuery({
        query: `SELECT metric_type FROM metrics WHERE metric_name = {p_name:String} AND project_id IN {p_pids:Array(String)} LIMIT 1`,
        query_params: { p_name: params.metricName, p_pids: pids },
        format: 'JSONEachRow',
      });
      const typeRows = await typeResult.json<{ metric_type: string }>();
      if (typeRows.length > 0) {
        metricType = typeRows[0].metric_type as MetricType;
      }
    }

    return {
      metricName: params.metricName,
      metricType,
      timeseries,
      executionTimeMs: Date.now() - start,
    };
  }

  private canUseMetricRollup(params: MetricAggregateParams): boolean {
    if (params.interval !== '1h' && params.interval !== '1d') return false;
    if (params.aggregation === 'last' || params.aggregation === 'p50' || params.aggregation === 'p95' || params.aggregation === 'p99') return false;
    if (params.groupBy && params.groupBy.length > 0) return false;
    if (params.attributes && Object.keys(params.attributes).length > 0) return false;
    return true;
  }

  private async aggregateMetricsFromRollup(
    params: MetricAggregateParams,
    start: number,
  ): Promise<MetricAggregateResult> {
    const rollupTable = params.interval === '1d'
      ? 'metrics_daily_rollup'
      : 'metrics_hourly_rollup';

    // Re-aggregate from rollup (handles partial rows)
    const aggExpr: Record<string, string> = {
      avg: 'sum(value_sum) / sum(point_count)',
      sum: 'sum(value_sum)',
      min: 'min(min_value)',
      max: 'max(max_value)',
      count: 'sum(point_count)',
    };
    const expr = aggExpr[params.aggregation] || aggExpr.avg;

    const projectIds = Array.isArray(params.projectId) ? params.projectId : [params.projectId];

    const queryParams: Record<string, unknown> = {
      p_pids: projectIds,
      p_from: toDateTime64(params.from),
      p_to: toDateTime64(params.to),
      p_name: params.metricName,
    };

    let serviceFilter = '';
    if (params.serviceName) {
      const services = Array.isArray(params.serviceName) ? params.serviceName : [params.serviceName];
      queryParams.p_services = services;
      serviceFilter = ' AND service_name IN {p_services:Array(String)}';
    }

    const sql = `
      SELECT
        bucket,
        ${expr} AS agg_value,
        any(metric_type) AS metric_type
      FROM ${rollupTable}
      WHERE project_id IN {p_pids:Array(String)}
        AND bucket >= {p_from:DateTime64(3)}
        AND bucket <= {p_to:DateTime64(3)}
        AND metric_name = {p_name:String}
        ${serviceFilter}
      GROUP BY bucket
      ORDER BY bucket ASC
    `;

    const result = await this.runQuery({
      query: sql,
      query_params: queryParams,
      format: 'JSONEachRow',
    });
    const rows = await result.json<{ bucket: string; agg_value: number; metric_type?: string }>();

    const metricType = params.metricType || rows[0]?.metric_type || 'gauge';

    return {
      metricName: params.metricName,
      metricType: metricType as MetricType,
      timeseries: rows.map(r => ({
        bucket: new Date(r.bucket),
        value: Number(r.agg_value) || 0,
      })),
      executionTimeMs: Date.now() - start,
    };
  }

  async getMetricNames(params: MetricNamesParams): Promise<MetricNamesResult> {
    const start = Date.now();
    const limit = params.limit ?? 1000;

    const conditions: string[] = [];
    const queryParams: Record<string, unknown> = {};

    const pids = Array.isArray(params.projectId) ? params.projectId : [params.projectId];
    conditions.push(`project_id IN {p_pids:Array(String)}`);
    queryParams.p_pids = pids;

    if (params.organizationId) {
      const oids = Array.isArray(params.organizationId) ? params.organizationId : [params.organizationId];
      conditions.push(`organization_id IN {p_oids:Array(String)}`);
      queryParams.p_oids = oids;
    }
    if (params.metricType) {
      const types = Array.isArray(params.metricType) ? params.metricType : [params.metricType];
      conditions.push(`metric_type IN {p_types:Array(String)}`);
      queryParams.p_types = types;
    }
    if (params.from) {
      conditions.push(`time >= {p_from:DateTime64(3)}`);
      queryParams.p_from = toDateTime64(params.from);
    }
    if (params.to) {
      conditions.push(`time <= {p_to:DateTime64(3)}`);
      queryParams.p_to = toDateTime64(params.to);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const resultSet = await this.runQuery({
      query: `SELECT metric_name, metric_type FROM metrics ${where} GROUP BY metric_name, metric_type ORDER BY metric_name ASC LIMIT ${limit}`,
      query_params: queryParams,
      format: 'JSONEachRow',
    });
    const rows = await resultSet.json<{ metric_name: string; metric_type: string }>();

    return {
      names: rows.map(row => ({
        name: row.metric_name,
        type: row.metric_type as MetricType,
      })),
      executionTimeMs: Date.now() - start,
    };
  }

  async getMetricLabelKeys(params: MetricLabelParams): Promise<MetricLabelResult> {
    const start = Date.now();
    const limit = params.limit ?? 100;

    const conditions: string[] = [];
    const queryParams: Record<string, unknown> = {};

    const pids = Array.isArray(params.projectId) ? params.projectId : [params.projectId];
    conditions.push(`project_id IN {p_pids:Array(String)}`);
    queryParams.p_pids = pids;

    conditions.push(`metric_name = {p_name:String}`);
    queryParams.p_name = params.metricName;

    if (params.organizationId) {
      const oids = Array.isArray(params.organizationId) ? params.organizationId : [params.organizationId];
      conditions.push(`organization_id IN {p_oids:Array(String)}`);
      queryParams.p_oids = oids;
    }
    if (params.from) {
      conditions.push(`time >= {p_from:DateTime64(3)}`);
      queryParams.p_from = toDateTime64(params.from);
    }
    if (params.to) {
      conditions.push(`time <= {p_to:DateTime64(3)}`);
      queryParams.p_to = toDateTime64(params.to);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // ClickHouse has no native JSONB keys function, so we sample rows
    // and extract keys client-side using JSONExtractKeys
    const resultSet = await this.runQuery({
      query: `SELECT DISTINCT arrayJoin(JSONExtractKeys(attributes)) AS key FROM metrics ${where} LIMIT ${limit}`,
      query_params: queryParams,
      format: 'JSONEachRow',
    });
    const rows = await resultSet.json<{ key: string }>();

    return {
      keys: rows.map(r => r.key),
      executionTimeMs: Date.now() - start,
    };
  }

  async getMetricLabelValues(params: MetricLabelParams, labelKey: string): Promise<MetricLabelResult> {
    const start = Date.now();
    const limit = params.limit ?? 100;

    const conditions: string[] = [];
    const queryParams: Record<string, unknown> = {};

    const pids = Array.isArray(params.projectId) ? params.projectId : [params.projectId];
    conditions.push(`project_id IN {p_pids:Array(String)}`);
    queryParams.p_pids = pids;

    conditions.push(`metric_name = {p_name:String}`);
    queryParams.p_name = params.metricName;

    if (params.organizationId) {
      const oids = Array.isArray(params.organizationId) ? params.organizationId : [params.organizationId];
      conditions.push(`organization_id IN {p_oids:Array(String)}`);
      queryParams.p_oids = oids;
    }
    if (params.from) {
      conditions.push(`time >= {p_from:DateTime64(3)}`);
      queryParams.p_from = toDateTime64(params.from);
    }
    if (params.to) {
      conditions.push(`time <= {p_to:DateTime64(3)}`);
      queryParams.p_to = toDateTime64(params.to);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const resultSet = await this.runQuery({
      query: `SELECT DISTINCT JSONExtractString(attributes, {p_label_key:String}) AS val FROM metrics ${where} HAVING val != '' LIMIT ${limit}`,
      query_params: { ...queryParams, p_label_key: labelKey },
      format: 'JSONEachRow',
    });
    const rows = await resultSet.json<{ val: string }>();

    return {
      values: rows.map(r => r.val),
      executionTimeMs: Date.now() - start,
    };
  }

  async deleteMetricsByTimeRange(params: DeleteMetricsByTimeRangeParams): Promise<DeleteResult> {
    const start = Date.now();
    const pids = Array.isArray(params.projectId) ? params.projectId : [params.projectId];

    const conditions = [
      `project_id IN {p_pids:Array(String)}`,
      `time >= {p_from:DateTime64(3)}`,
      `time <= {p_to:DateTime64(3)}`,
    ];
    const queryParams: Record<string, unknown> = {
      p_pids: pids,
      p_from: toDateTime64(params.from),
      p_to: toDateTime64(params.to),
    };

    if (params.metricName) {
      const names = Array.isArray(params.metricName) ? params.metricName : [params.metricName];
      conditions.push(`metric_name IN {p_names:Array(String)}`);
      queryParams.p_names = names;
    }
    if (params.serviceName) {
      const svc = Array.isArray(params.serviceName) ? params.serviceName : [params.serviceName];
      conditions.push(`service_name IN {p_svc:Array(String)}`);
      queryParams.p_svc = svc;
    }

    // Delete from metrics table (async mutation)
    await this.runCommand({
      query: `ALTER TABLE metrics DELETE WHERE ${conditions.join(' AND ')}`,
      query_params: queryParams,
    });

    // Also delete exemplars for the same time range / project
    const exemplarConditions = [
      `project_id IN {p_pids:Array(String)}`,
      `time >= {p_from:DateTime64(3)}`,
      `time <= {p_to:DateTime64(3)}`,
    ];
    await this.runCommand({
      query: `ALTER TABLE metric_exemplars DELETE WHERE ${exemplarConditions.join(' AND ')}`,
      query_params: {
        p_pids: pids,
        p_from: toDateTime64(params.from),
        p_to: toDateTime64(params.to),
      },
    });

    return { deleted: 0, executionTimeMs: Date.now() - start };
  }

  async getMetricsOverview(params: MetricsOverviewParams): Promise<MetricsOverviewResult> {
    const start = Date.now();
    const projectIds = Array.isArray(params.projectId) ? params.projectId : [params.projectId];
    const queryParams: Record<string, unknown> = {
      p_pids: projectIds,
      p_from: toDateTime64(params.from),
      p_to: toDateTime64(params.to),
    };

    let serviceFilter = '';
    if (params.serviceName) {
      queryParams.p_service = params.serviceName;
      serviceFilter = ' AND service_name = {p_service:String}';
    }

    // Aggregates come from the hourly rollup. The rollup has no last-value column,
    // so the true latest value is computed separately from the raw metrics table
    // via argMax(value, time) instead of mislabeling the average as the latest.
    // DateTime64(3) params match the fractional-second values from toDateTime64.
    const sql = `
      SELECT
        metric_name,
        any(metric_type) AS mt,
        service_name,
        sum(point_count) AS total_points,
        sum(value_sum) / sum(point_count) AS avg_val,
        min(min_value) AS mn,
        max(max_value) AS mx
      FROM metrics_hourly_rollup
      WHERE project_id IN {p_pids:Array(String)}
        AND bucket >= {p_from:DateTime64(3)}
        AND bucket <= {p_to:DateTime64(3)}
        ${serviceFilter}
      GROUP BY metric_name, service_name
      ORDER BY service_name, metric_name
    `;

    const latestSql = `
      SELECT metric_name, service_name, argMax(value, time) AS latest_val
      FROM metrics
      WHERE project_id IN {p_pids:Array(String)}
        AND time >= {p_from:DateTime64(3)}
        AND time <= {p_to:DateTime64(3)}
        ${serviceFilter}
      GROUP BY metric_name, service_name
    `;

    const [result, latestResult] = await Promise.all([
      this.runQuery({ query: sql, query_params: queryParams, format: 'JSONEachRow' }),
      this.runQuery({ query: latestSql, query_params: queryParams, format: 'JSONEachRow' }),
    ]);
    const rows = await result.json<Record<string, unknown>>();
    const latestRows = await latestResult.json<Record<string, unknown>>();

    const latestMap = new Map<string, number>();
    for (const lr of latestRows) {
      latestMap.set(`${lr.metric_name as string}|${lr.service_name as string}`, Number(lr.latest_val));
    }

    const serviceMap = new Map<string, MetricOverviewItem[]>();
    // `Number(x) ?? 0` does not catch NaN (Number() returns NaN, not nullish), so
    // coerce explicitly and fall back to 0 for non-finite values.
    const safeNum = (v: unknown): number => {
      const n = Number(v);
      return Number.isFinite(n) ? n : 0;
    };

    for (const row of rows) {
      const serviceName = row.service_name as string;
      const latestKey = `${row.metric_name as string}|${serviceName}`;
      const item: MetricOverviewItem = {
        metricName: row.metric_name as string,
        metricType: (row.mt as MetricType) || 'gauge',
        serviceName,
        latestValue: latestMap.has(latestKey) ? safeNum(latestMap.get(latestKey)) : safeNum(row.avg_val),
        avgValue: safeNum(row.avg_val),
        minValue: safeNum(row.mn),
        maxValue: safeNum(row.mx),
        pointCount: safeNum(row.total_points),
      };
      if (!serviceMap.has(serviceName)) serviceMap.set(serviceName, []);
      serviceMap.get(serviceName)!.push(item);
    }

    return {
      services: Array.from(serviceMap.entries()).map(([serviceName, metrics]) => ({
        serviceName,
        metrics,
      })),
      executionTimeMs: Date.now() - start,
    };
  }
}

function parseClickHouseTime(value: unknown): Date {
  if (value instanceof Date) return value;
  const str = String(value);
  // ClickHouse DateTime64(3) can return as epoch seconds (number) or ISO string
  const num = Number(str);
  if (!isNaN(num) && str.trim() !== '') {
    // If it looks like epoch seconds (< year 10000), convert
    return num < 1e12 ? new Date(num * 1000) : new Date(num);
  }
  // A space-separated ClickHouse datetime like "2025-01-15 12:00:00.000" carries
  // no timezone and would be parsed as LOCAL time by Date. Treat the zone-less
  // form as UTC by normalizing it to an ISO string with a 'Z' suffix.
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(str)) {
    return new Date(`${str.replace(' ', 'T')}Z`);
  }
  return new Date(str);
}

function mapClickHouseRowToStoredLogRecord(row: Record<string, unknown>): StoredLogRecord {
  let metadata: Record<string, unknown> | undefined;
  if (row.metadata && typeof row.metadata === 'string' && row.metadata !== '{}') {
    try {
      metadata = JSON.parse(row.metadata as string);
    } catch {
      metadata = undefined;
    }
  } else if (row.metadata && typeof row.metadata === 'object') {
    metadata = row.metadata as Record<string, unknown>;
  }

  return {
    id: String(row.id),
    time: parseClickHouseTime(row.time),
    projectId: String(row.project_id),
    service: String(row.service),
    level: String(row.level) as LogLevel,
    message: String(row.message),
    metadata,
    traceId: row.trace_id ? String(row.trace_id) : undefined,
    spanId: row.span_id ? String(row.span_id) : undefined,
    sessionId: row.session_id ? String(row.session_id) : undefined,
  };
}

function parseJsonField(value: unknown): Record<string, unknown> | undefined {
  if (!value) return undefined;
  if (typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === 'string') {
    if (value === '{}' || value === '[]' || value === '') return undefined;
    try { return JSON.parse(value); } catch { return undefined; }
  }
  return undefined;
}

function parseJsonArrayField(value: unknown): Array<Record<string, unknown>> | undefined {
  if (!value) return undefined;
  if (Array.isArray(value)) return value as Array<Record<string, unknown>>;
  if (typeof value === 'string') {
    if (value === '[]' || value === '') return undefined;
    try { return JSON.parse(value); } catch { return undefined; }
  }
  return undefined;
}

function mapClickHouseRowToSpanRecord(row: Record<string, unknown>): SpanRecord {
  return {
    time: parseClickHouseTime(row.time),
    spanId: String(row.span_id),
    traceId: String(row.trace_id),
    parentSpanId: row.parent_span_id ? String(row.parent_span_id) : undefined,
    organizationId: row.organization_id ? String(row.organization_id) : undefined,
    projectId: String(row.project_id),
    serviceName: String(row.service_name),
    operationName: String(row.operation_name),
    startTime: parseClickHouseTime(row.start_time),
    endTime: parseClickHouseTime(row.end_time),
    durationMs: Number(row.duration_ms),
    kind: row.kind ? String(row.kind) as SpanKind : undefined,
    statusCode: row.status_code ? String(row.status_code) as SpanStatusCode : undefined,
    statusMessage: row.status_message ? String(row.status_message) : undefined,
    attributes: parseJsonField(row.attributes),
    events: parseJsonArrayField(row.events),
    links: parseJsonArrayField(row.links),
    resourceAttributes: parseJsonField(row.resource_attributes),
  };
}

function mapClickHouseRowToTraceRecord(row: Record<string, unknown>): TraceRecord {
  return {
    traceId: String(row.trace_id),
    organizationId: row.organization_id ? String(row.organization_id) : undefined,
    projectId: String(row.project_id),
    serviceName: String(row.service_name),
    rootServiceName: row.root_service_name ? String(row.root_service_name) : undefined,
    rootOperationName: row.root_operation_name ? String(row.root_operation_name) : undefined,
    startTime: parseClickHouseTime(row.start_time),
    endTime: parseClickHouseTime(row.end_time),
    durationMs: Number(row.duration_ms),
    spanCount: Number(row.span_count),
    error: !!Number(row.error),
  };
}

function mapClickHouseRowToMetricRecord(row: Record<string, unknown>): StoredMetricRecord {
  let histogramData: MetricRecord['histogramData'];
  if (row.histogram_data && typeof row.histogram_data === 'string' && row.histogram_data !== 'null') {
    try {
      histogramData = JSON.parse(row.histogram_data as string);
    } catch {
      histogramData = undefined;
    }
  }

  return {
    id: String(row.id),
    time: parseClickHouseTime(row.time),
    organizationId: row.organization_id ? String(row.organization_id) : '',
    projectId: String(row.project_id),
    metricName: String(row.metric_name),
    metricType: String(row.metric_type) as MetricType,
    value: Number(row.value),
    isMonotonic: row.is_monotonic != null ? !!Number(row.is_monotonic) : undefined,
    serviceName: String(row.service_name),
    attributes: parseJsonField(row.attributes) as Record<string, unknown> | undefined,
    resourceAttributes: parseJsonField(row.resource_attributes) as Record<string, unknown> | undefined,
    histogramData,
    hasExemplars: !!Number(row.has_exemplars),
  };
}
