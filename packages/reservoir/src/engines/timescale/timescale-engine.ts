import pg from 'pg';
import { randomUUID } from 'crypto';
import { currentOrNull } from '@logtide/shared/context';
import { StorageEngine } from '../../core/storage-engine.js';
import type {
  LogRecord,
  LogLevel,
  StoredLogRecord,
  QueryParams,
  QueryResult,
  AggregateParams,
  AggregateResult,
  AggregationInterval,
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
  MetricRecord,
  StoredMetricRecord,
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
  MetricType,
  MetricTimeBucket,
  MetricExemplar,
  MetricOverviewItem,
  MetricsOverviewParams,
  MetricsOverviewResult,
} from '../../core/types.js';
import { TimescaleQueryTranslator } from './query-translator.js';

const { Pool } = pg;

function sanitizeNull(value: string): string {
  return value.includes('\0') ? value.replace(/\0/g, '') : value;
}

const METRIC_INTERVAL_MAP: Record<AggregationInterval, string> = {
  '1m': '1 minute',
  '5m': '5 minutes',
  '15m': '15 minutes',
  '1h': '1 hour',
  '6h': '6 hours',
  '1d': '1 day',
  '1w': '1 week',
};

const SAFE_RE = /[^a-zA-Z0-9_:-]/g;
function safe(v: string | null | undefined): string {
  if (!v) return '-';
  const c = v.replace(SAFE_RE, '');
  return c.length > 0 ? c : '-';
}
function ctxComment(): string {
  if (process.env.LOGTIDE_CONTEXT_SQL_COMMENT === 'false') return '';
  const ctx = currentOrNull();
  if (!ctx) return '';
  return `/* req=${safe(ctx.requestId)} origin=${safe(ctx.origin)} org=${safe(
    ctx.organizationId
  )} actor=${safe(ctx.actor.type)}:${safe(ctx.actor.id)} */ `;
}

export interface TimescaleEngineOptions {
  /** Use an existing pg.Pool instead of creating a new one */
  pool?: pg.Pool;
  /** Table name to use (default: 'logs') */
  tableName?: string;
  /** Skip schema initialization (use when connecting to existing DB) */
  skipInitialize?: boolean;
  /** Include organization_id column in INSERT/queries (default: false) */
  hasOrganizationId?: boolean;
  /** SQL type for the project_id column (default: 'text') */
  projectIdType?: 'text' | 'uuid';
}

export class TimescaleEngine extends StorageEngine {
  private pool: pg.Pool | null = null;
  private ownsPool: boolean;
  private translator: TimescaleQueryTranslator;
  private options: TimescaleEngineOptions;

  private get schema(): string {
    return this.config.schema ?? 'public';
  }

  private get tableName(): string {
    return this.options.tableName ?? 'logs';
  }

  constructor(config: StorageConfig, options: TimescaleEngineOptions = {}) {
    super(config);
    this.options = options;
    this.ownsPool = !options.pool;
    if (options.pool) {
      this.pool = options.pool;
    }
    this.translator = new TimescaleQueryTranslator(this.schema, this.tableName);
  }

  async connect(): Promise<void> {
    if (this.pool) return;
    this.pool = new Pool({
      host: this.config.host,
      port: this.config.port,
      database: this.config.database,
      user: this.config.username,
      password: this.config.password,
      max: this.config.poolSize ?? 10,
      connectionTimeoutMillis: this.config.connectionTimeoutMs ?? 5000,
      ssl: this.config.ssl ? { rejectUnauthorized: false } : undefined,
    });
    if (typeof this.pool.on === 'function') {
      this.pool.on('error', (err) => {
        console.error('[TimescaleEngine] Pool error:', err.message);
      });
    }
  }

  async disconnect(): Promise<void> {
    if (this.pool && this.ownsPool) {
      await this.pool.end();
      this.pool = null;
    }
  }

  async healthCheck(): Promise<HealthStatus> {
    const start = Date.now();
    try {
      await this.runQuery('SELECT 1');
      const responseTimeMs = Date.now() - start;
      let status: HealthStatus['status'] = 'healthy';
      if (responseTimeMs >= 200) status = 'unhealthy';
      else if (responseTimeMs >= 50) status = 'degraded';
      return { status, engine: 'timescale', connected: true, responseTimeMs };
    } catch (err) {
      return {
        status: 'unhealthy',
        engine: 'timescale',
        connected: false,
        responseTimeMs: Date.now() - start,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async initialize(): Promise<void> {
    if (this.options.skipInitialize) return;

    const pool = this.getPool();
    const s = this.schema;
    const t = this.tableName;

    await pool.query(`CREATE SCHEMA IF NOT EXISTS ${s}`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ${s}.${t} (
        time TIMESTAMPTZ NOT NULL,
        id UUID NOT NULL DEFAULT gen_random_uuid(),
        project_id TEXT NOT NULL,
        service TEXT NOT NULL,
        level TEXT NOT NULL,
        message TEXT NOT NULL,
        metadata JSONB DEFAULT '{}',
        trace_id TEXT,
        span_id TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // hypertable (ignore error if already exists)
    try {
      await pool.query(
        `SELECT create_hypertable('${s}.${t}', 'time', if_not_exists => TRUE)`,
      );
    } catch {
      // not a TimescaleDB instance or already a hypertable
    }

    await pool.query(`CREATE INDEX IF NOT EXISTS idx_${t}_service_time ON ${s}.${t} (service, time DESC)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_${t}_level_time ON ${s}.${t} (level, time DESC)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_${t}_trace_id ON ${s}.${t} (trace_id) WHERE trace_id IS NOT NULL`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_${t}_span_id ON ${s}.${t} (span_id) WHERE span_id IS NOT NULL`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_${t}_fulltext ON ${s}.${t} USING GIN (to_tsvector('english', message))`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_${t}_composite ON ${s}.${t} (project_id, time DESC, id DESC)`);

    try {
      await pool.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_${t}_message_trgm ON ${s}.${t} USING GIN (message gin_trgm_ops)`);
    } catch {
      // pg_trgm not available
    }

    // compression policy (ignore error if not supported)
    try {
      await pool.query(`ALTER TABLE ${s}.${t} SET (timescaledb.compress, timescaledb.compress_segmentby = 'project_id', timescaledb.compress_orderby = 'time DESC, id DESC')`);
      await pool.query(`SELECT add_compression_policy('${s}.${t}', INTERVAL '7 days', if_not_exists => TRUE)`);
    } catch {
      // compression not available
    }
  }

  async migrate(_version: string): Promise<void> {
    // placeholder for future migrations
  }

  async ingest(logs: LogRecord[]): Promise<IngestResult> {
    if (logs.length === 0) {
      return { ingested: 0, failed: 0, durationMs: 0 };
    }

    const start = Date.now();
    const { query, values } = this.buildInsertQuery(logs);

    try {
      await this.runQuery(query, values);
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
    const { query, values } = this.buildInsertQuery(logs, true);

    try {
      const result = await this.runQuery(query, values);
      const rows = result.rows.map(mapRowToStoredLogRecord);
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

    const result = await this.runQuery(native.query as string, native.parameters);
    const hasMore = result.rows.length > limit;
    const rows = hasMore ? result.rows.slice(0, limit) : result.rows;

    let nextCursor: string | undefined;
    if (hasMore) {
      const last = rows[rows.length - 1];
      const cursorStr = `${(last.time as Date).toISOString()},${last.id}`;
      nextCursor = Buffer.from(cursorStr).toString('base64');
    }

    const logs = rows.map(mapRowToStoredLogRecord);

    return {
      logs,
      total: rows.length,
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

    const result = await this.runQuery(native.query as string, native.parameters);

    const bucketMap = new Map<string, TimeBucket>();

    for (const row of result.rows) {
      const key = (row.bucket as Date).toISOString();
      let bucket = bucketMap.get(key);
      if (!bucket) {
        bucket = { bucket: row.bucket as Date, total: 0, byLevel: {} as Record<LogLevel, number> };
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
    const result = await this.runQuery(
      `SELECT * FROM ${this.schema}.${this.tableName} WHERE id = $1 AND project_id = $2 LIMIT 1`,
      [params.id, params.projectId],
    );
    return result.rows.length > 0 ? mapRowToStoredLogRecord(result.rows[0]) : null;
  }

  async getByIds(params: GetByIdsParams): Promise<StoredLogRecord[]> {
    if (params.ids.length === 0) return [];
    const result = await this.runQuery(
      `SELECT * FROM ${this.schema}.${this.tableName} WHERE id = ANY($1::uuid[]) AND project_id = $2 ORDER BY time DESC`,
      [params.ids, params.projectId],
    );
    return result.rows.map(mapRowToStoredLogRecord);
  }

  async count(params: CountParams): Promise<CountResult> {
    const start = Date.now();
    const native = this.translator.translateCount(params);
    const result = await this.runQuery(native.query as string, native.parameters);
    return {
      count: Number(result.rows[0]?.count ?? 0),
      executionTimeMs: Date.now() - start,
    };
  }

  async countEstimate(params: CountParams): Promise<CountResult> {
    const start = Date.now();
    const native = this.translator.translateCountEstimate(params);
    const result = await this.runQuery(
      `EXPLAIN (FORMAT JSON) ${native.query}`,
      native.parameters,
    );
    const plan = (result.rows[0] as Record<string, unknown>)['QUERY PLAN'] as Array<{ Plan: { 'Plan Rows': number } }>;
    const estimate = Math.round(plan[0]?.Plan?.['Plan Rows'] ?? 0);
    return {
      count: estimate,
      executionTimeMs: Date.now() - start,
    };
  }

  async distinct(params: DistinctParams): Promise<DistinctResult> {
    const start = Date.now();

    // Skip-Scan Optimization for indexed fields (service, level)
    // This provides massive performance gains (100x+) on large datasets by jumping
    // through the index instead of scanning all matching rows.
    // Skip-scan only when no extra filters are present (service/level/filters would require CTE changes)
    if (
      (params.field === 'service' || params.field === 'level') &&
      params.projectId &&
      params.from &&
      params.to &&
      !params.service &&
      !params.level &&
      !params.filters
    ) {
      try {
        const fieldName = params.field; // safe, validated above
        const projectIds = Array.isArray(params.projectId) ? params.projectId : [params.projectId];

        // Honor the exclusive-bound flags so this fast path matches the standard
        // distinct path (operators are not user input).
        const fromOp = params.fromExclusive ? '>' : '>=';
        const toOp = params.toExclusive ? '<' : '<=';

        // Use a recursive CTE to jump through the b-tree index
        // ORDER BY field only (not project_id) so we get the globally smallest value first
        const query = `
          WITH RECURSIVE t AS (
             (SELECT ${fieldName} AS value FROM ${this.schema}.${this.tableName}
              WHERE project_id = ANY($1) AND time ${fromOp} $2 AND time ${toOp} $3
              ORDER BY ${fieldName}, time DESC LIMIT 1)
             UNION ALL
             SELECT (SELECT ${fieldName} AS value FROM ${this.schema}.${this.tableName}
                     WHERE project_id = ANY($1) AND time ${fromOp} $2 AND time ${toOp} $3 AND ${fieldName} > t.value
                     ORDER BY ${fieldName}, time DESC LIMIT 1)
             FROM t
             WHERE t.value IS NOT NULL
          )
          SELECT value FROM t WHERE value IS NOT NULL LIMIT $4;
        `;

        const limit = params.limit ?? 1000;
        const result = await this.runQuery(query, [projectIds, params.from, params.to, limit]);

        return {
          values: result.rows.map((row) => row.value as string).filter((v) => v != null && v !== ''),
          executionTimeMs: Date.now() - start,
        };
      } catch (err) {
        console.warn('[Reservoir] Skip-Scan CTE failed, falling back to standard distinct:', err);
        // Fallback to standard distinct logic if CTE fails
      }
    }

    const native = this.translator.translateDistinct(params);
    const result = await this.runQuery(native.query as string, native.parameters);
    return {
      values: result.rows.map((row: Record<string, unknown>) => row.value as string).filter((v) => v != null && v !== ''),
      executionTimeMs: Date.now() - start,
    };
  }

  async topValues(params: TopValuesParams): Promise<TopValuesResult> {
    const start = Date.now();
    const native = this.translator.translateTopValues(params);
    const result = await this.runQuery(native.query as string, native.parameters);
    return {
      values: result.rows.map((row: Record<string, unknown>) => ({
        value: row.value as string,
        count: Number(row.count),
      })),
      executionTimeMs: Date.now() - start,
    };
  }

  async deleteByTimeRange(params: DeleteByTimeRangeParams): Promise<DeleteResult> {
    const start = Date.now();
    const native = this.translator.translateDelete(params);
    const result = await this.runQuery(native.query as string, native.parameters);
    return {
      deleted: Number(result.rowCount ?? 0),
      executionTimeMs: Date.now() - start,
    };
  }

  getCapabilities(): EngineCapabilities {
    return {
      engine: 'timescale',
      supportsFullTextSearch: true,
      supportsAggregations: true,
      supportsStreaming: true,
      supportsTransactions: true,
      maxBatchSize: 10000,
      nativeCompression: true,
      nativeTiering: false,
      supportedOperators: ['=', '!=', '>', '>=', '<', '<=', 'in', 'not in', 'like', 'not like'],
      supportedIntervals: ['1m', '5m', '15m', '1h', '6h', '1d', '1w'],
    };
  }

  async getSegments(_startTime: Date, _endTime: Date): Promise<StorageSegment[]> {
    return [];
  }

  private getPool(): pg.Pool {
    if (!this.pool) {
      throw new Error('Not connected. Call connect() first.');
    }
    return this.pool;
  }

  private async runQuery(sql: string, params?: unknown[]): Promise<pg.QueryResult> {
    const pool = this.getPool();
    const final = ctxComment() + sql;
    return params ? pool.query(final, params as any[]) : pool.query(final);
  }

  private buildInsertQuery(logs: LogRecord[], returning = false): { query: string; values: unknown[] } {
    const s = this.schema;
    const t = this.tableName;
    // Use the id-path if ANY log carries an id (not just the first): a mixed batch
    // must not push `undefined` into the id array. Missing ids are generated so the
    // UNNEST arrays stay aligned and provided ids are preserved.
    const hasIds = logs.length > 0 && logs.some((l) => l.id != null);

    const ids: string[] = [];
    const times: Date[] = [];
    const projectIds: string[] = [];
    const services: string[] = [];
    const levels: string[] = [];
    const messages: string[] = [];
    const metadatas: (string | null)[] = [];
    const traceIds: (string | null)[] = [];
    const spanIds: (string | null)[] = [];
    const sessionIds: (string | null)[] = [];

    for (const log of logs) {
      if (hasIds) ids.push(log.id ?? randomUUID());
      times.push(log.time);
      projectIds.push(sanitizeNull(log.projectId));
      services.push(sanitizeNull(log.service));
      levels.push(log.level);
      messages.push(sanitizeNull(log.message));
      metadatas.push(log.metadata ? JSON.stringify(log.metadata) : null);
      traceIds.push(log.traceId ?? null);
      spanIds.push(log.spanId ?? null);
      sessionIds.push(log.sessionId ?? null);
    }

    let query: string;
    let values: unknown[];
    const pidType = this.options.projectIdType === 'uuid' ? 'uuid' : 'text';

    if (hasIds) {
      query = `INSERT INTO ${s}.${t} (id, time, project_id, service, level, message, metadata, trace_id, span_id, session_id) SELECT * FROM UNNEST($1::uuid[], $2::timestamptz[], $3::${pidType}[], $4::text[], $5::text[], $6::text[], $7::jsonb[], $8::text[], $9::text[], $10::text[])`;
      values = [ids, times, projectIds, services, levels, messages, metadatas, traceIds, spanIds, sessionIds];
    } else {
      query = `INSERT INTO ${s}.${t} (time, project_id, service, level, message, metadata, trace_id, span_id, session_id) SELECT * FROM UNNEST($1::timestamptz[], $2::${pidType}[], $3::text[], $4::text[], $5::text[], $6::jsonb[], $7::text[], $8::text[], $9::text[])`;
      values = [times, projectIds, services, levels, messages, metadatas, traceIds, spanIds, sessionIds];
    }

    if (returning) {
      query += ' RETURNING *';
    }

    return { query, values };
  }

  // =========================================================================
  // Span & Trace Operations
  // =========================================================================

  async ingestSpans(spans: SpanRecord[]): Promise<IngestSpansResult> {
    if (spans.length === 0) return { ingested: 0, failed: 0, durationMs: 0 };

    const start = Date.now();
    const s = this.schema;

    const times: Date[] = [];
    const spanIds: string[] = [];
    const traceIds: string[] = [];
    const parentSpanIds: (string | null)[] = [];
    const orgIds: (string | null)[] = [];
    const projectIds: string[] = [];
    const serviceNames: string[] = [];
    const operationNames: string[] = [];
    const startTimes: Date[] = [];
    const endTimes: Date[] = [];
    const durations: number[] = [];
    const kinds: (string | null)[] = [];
    const statusCodes: (string | null)[] = [];
    const statusMessages: (string | null)[] = [];
    const attributesJsons: (string | null)[] = [];
    const eventsJsons: (string | null)[] = [];
    const linksJsons: (string | null)[] = [];
    const resourceAttrsJsons: (string | null)[] = [];

    for (const span of spans) {
      times.push(span.time);
      spanIds.push(span.spanId);
      traceIds.push(span.traceId);
      parentSpanIds.push(span.parentSpanId ?? null);
      orgIds.push(span.organizationId ?? null);
      projectIds.push(span.projectId);
      serviceNames.push(sanitizeNull(span.serviceName));
      operationNames.push(sanitizeNull(span.operationName));
      startTimes.push(span.startTime);
      endTimes.push(span.endTime);
      durations.push(span.durationMs);
      kinds.push(span.kind ?? null);
      statusCodes.push(span.statusCode ?? null);
      statusMessages.push(span.statusMessage ? sanitizeNull(span.statusMessage) : null);
      attributesJsons.push(span.attributes ? JSON.stringify(span.attributes) : null);
      eventsJsons.push(span.events ? JSON.stringify(span.events) : null);
      linksJsons.push(span.links ? JSON.stringify(span.links) : null);
      resourceAttrsJsons.push(span.resourceAttributes ? JSON.stringify(span.resourceAttributes) : null);
    }

    try {
      await this.runQuery(
        `INSERT INTO ${s}.spans (
          time, span_id, trace_id, parent_span_id, organization_id, project_id,
          service_name, operation_name, start_time, end_time, duration_ms,
          kind, status_code, status_message, attributes, events, links, resource_attributes
        )
        SELECT * FROM UNNEST(
          $1::timestamptz[], $2::text[], $3::text[], $4::text[], $5::uuid[], $6::${this.options.projectIdType === 'uuid' ? 'uuid' : 'text'}[],
          $7::text[], $8::text[], $9::timestamptz[], $10::timestamptz[], $11::integer[],
          $12::text[], $13::text[], $14::text[], $15::jsonb[], $16::jsonb[], $17::jsonb[], $18::jsonb[]
        )`,
        [times, spanIds, traceIds, parentSpanIds, orgIds, projectIds,
         serviceNames, operationNames, startTimes, endTimes, durations,
         kinds, statusCodes, statusMessages, attributesJsons, eventsJsons, linksJsons, resourceAttrsJsons],
      );
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
    const s = this.schema;

    // Single atomic upsert on the (trace_id, project_id) primary key. Spans for one
    // trace routinely arrive in concurrent ingest batches; a read-modify-write would
    // race and lose span counts or insert duplicates. ON CONFLICT lets Postgres
    // serialize the per-row merge, accumulating span_count and widening the time
    // window with LEAST/GREATEST.
    await this.runQuery(
      `INSERT INTO ${s}.traces (
        trace_id, organization_id, project_id, service_name, root_service_name, root_operation_name,
        start_time, end_time, duration_ms, span_count, error
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      ON CONFLICT (trace_id, project_id) DO UPDATE SET
        start_time = LEAST(${s}.traces.start_time, EXCLUDED.start_time),
        end_time = GREATEST(${s}.traces.end_time, EXCLUDED.end_time),
        duration_ms = (EXTRACT(EPOCH FROM (
          GREATEST(${s}.traces.end_time, EXCLUDED.end_time) - LEAST(${s}.traces.start_time, EXCLUDED.start_time)
        )) * 1000)::integer,
        span_count = ${s}.traces.span_count + EXCLUDED.span_count,
        error = ${s}.traces.error OR EXCLUDED.error,
        root_service_name = COALESCE(EXCLUDED.root_service_name, ${s}.traces.root_service_name),
        root_operation_name = COALESCE(EXCLUDED.root_operation_name, ${s}.traces.root_operation_name)`,
      [trace.traceId, trace.organizationId ?? null, trace.projectId, trace.serviceName,
       trace.rootServiceName ?? null, trace.rootOperationName ?? null,
       trace.startTime, trace.endTime, trace.durationMs, trace.spanCount, trace.error],
    );
  }

  async querySpans(params: SpanQueryParams): Promise<SpanQueryResult> {
    const start = Date.now();
    const s = this.schema;
    const limit = params.limit ?? 50;
    const offset = params.offset ?? 0;

    const conditions: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    // Time range
    conditions.push(`time ${params.fromExclusive ? '>' : '>='} $${idx++}`);
    values.push(params.from);
    conditions.push(`time ${params.toExclusive ? '<' : '<='} $${idx++}`);
    values.push(params.to);

    // Filters
    if (params.projectId) {
      const pids = Array.isArray(params.projectId) ? params.projectId : [params.projectId];
      conditions.push(`project_id = ANY($${idx++})`);
      values.push(pids);
    }
    if (params.traceId) {
      const tids = Array.isArray(params.traceId) ? params.traceId : [params.traceId];
      conditions.push(`trace_id = ANY($${idx++})`);
      values.push(tids);
    }
    if (params.serviceName) {
      const svc = Array.isArray(params.serviceName) ? params.serviceName : [params.serviceName];
      conditions.push(`service_name = ANY($${idx++})`);
      values.push(svc);
    }
    if (params.kind) {
      const k = Array.isArray(params.kind) ? params.kind : [params.kind];
      conditions.push(`kind = ANY($${idx++})`);
      values.push(k);
    }
    if (params.statusCode) {
      const sc = Array.isArray(params.statusCode) ? params.statusCode : [params.statusCode];
      conditions.push(`status_code = ANY($${idx++})`);
      values.push(sc);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Allowlist to prevent SQL injection via user-controlled sort parameters
    const ALLOWED_SORT_COLUMNS = new Set(['start_time', 'end_time', 'duration_ms', 'service_name', 'operation_name']);
    const ALLOWED_SORT_ORDERS = new Set(['asc', 'desc']);
    const sortBy = ALLOWED_SORT_COLUMNS.has(params.sortBy ?? '') ? params.sortBy! : 'start_time';
    const sortOrder = ALLOWED_SORT_ORDERS.has((params.sortOrder ?? '').toLowerCase()) ? params.sortOrder!.toUpperCase() : 'ASC';

    const countResult = await this.runQuery(
      `SELECT COUNT(*)::int AS count FROM ${s}.spans ${where}`,
      values,
    );
    const total = countResult.rows[0]?.count ?? 0;

    const result = await this.runQuery(
      `SELECT * FROM ${s}.spans ${where}
       ORDER BY ${sortBy} ${sortOrder}
       LIMIT $${idx++} OFFSET $${idx++}`,
      [...values, limit, offset],
    );

    return {
      spans: result.rows.map(mapRowToSpanRecord),
      total,
      hasMore: offset + result.rows.length < total,
      limit,
      offset,
      executionTimeMs: Date.now() - start,
    };
  }

  async getSpansByTraceId(traceId: string, projectId: string): Promise<SpanRecord[]> {
    const s = this.schema;
    const result = await this.runQuery(
      `SELECT * FROM ${s}.spans WHERE trace_id = $1 AND project_id = $2 ORDER BY start_time ASC`,
      [traceId, projectId],
    );
    return result.rows.map(mapRowToSpanRecord);
  }

  async queryTraces(params: TraceQueryParams): Promise<TraceQueryResult> {
    const start = Date.now();
    const s = this.schema;
    const limit = params.limit ?? 50;
    const offset = params.offset ?? 0;

    const conditions: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    conditions.push(`start_time >= $${idx++}`);
    values.push(params.from);
    conditions.push(`start_time <= $${idx++}`);
    values.push(params.to);

    if (params.projectId) {
      const pids = Array.isArray(params.projectId) ? params.projectId : [params.projectId];
      conditions.push(`project_id = ANY($${idx++})`);
      values.push(pids);
    }
    if (params.serviceName) {
      const svc = Array.isArray(params.serviceName) ? params.serviceName : [params.serviceName];
      conditions.push(`service_name = ANY($${idx++})`);
      values.push(svc);
    }
    if (params.error !== undefined) {
      conditions.push(`error = $${idx++}`);
      values.push(params.error);
    }
    if (params.minDurationMs !== undefined) {
      conditions.push(`duration_ms >= $${idx++}`);
      values.push(params.minDurationMs);
    }
    if (params.maxDurationMs !== undefined) {
      conditions.push(`duration_ms <= $${idx++}`);
      values.push(params.maxDurationMs);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countResult = await this.runQuery(
      `SELECT COUNT(*)::int AS count FROM ${s}.traces ${where}`,
      values,
    );
    const total = countResult.rows[0]?.count ?? 0;

    const result = await this.runQuery(
      `SELECT * FROM ${s}.traces ${where}
       ORDER BY start_time DESC
       LIMIT $${idx++} OFFSET $${idx++}`,
      [...values, limit, offset],
    );

    return {
      traces: result.rows.map(mapRowToTraceRecord),
      total,
      hasMore: offset + result.rows.length < total,
      limit,
      offset,
      executionTimeMs: Date.now() - start,
    };
  }

  async getTraceById(traceId: string, projectId: string): Promise<TraceRecord | null> {
    const s = this.schema;
    const result = await this.runQuery(
      `SELECT * FROM ${s}.traces WHERE trace_id = $1 AND project_id = $2`,
      [traceId, projectId],
    );
    return result.rows.length > 0 ? mapRowToTraceRecord(result.rows[0]) : null;
  }

  async getTraceServices(projectId: string, from?: Date, to?: Date): Promise<string[]> {
    const s = this.schema;
    const conditions = ['project_id = $1'];
    const values: unknown[] = [projectId];
    let idx = 2;
    if (from) { conditions.push(`start_time >= $${idx++}`); values.push(from); }
    if (to) { conditions.push(`start_time <= $${idx++}`); values.push(to); }

    const result = await this.runQuery(
      `SELECT DISTINCT service_name FROM ${s}.traces WHERE ${conditions.join(' AND ')} ORDER BY service_name ASC`,
      values,
    );
    return result.rows
      .map((r) => r.service_name as string)
      .filter((v) => v != null && v !== '');
  }

  async getServiceDependencies(
    projectId: string,
    from?: Date,
    to?: Date,
  ): Promise<ServiceDependencyResult> {
    const s = this.schema;
    const values: unknown[] = [projectId];
    let idx = 2;
    let timeFilter = '';

    if (from) {
      timeFilter += ` AND child.start_time >= $${idx++}`;
      values.push(from);
    }
    if (to) {
      timeFilter += ` AND child.start_time <= $${idx++}`;
      values.push(to);
    }

    const result = await this.runQuery(
      `SELECT
        parent.service_name AS source_service,
        child.service_name AS target_service,
        COUNT(child.span_id)::int AS call_count
      FROM ${s}.spans child
      INNER JOIN ${s}.spans parent
        ON child.parent_span_id = parent.span_id
        AND child.trace_id = parent.trace_id
        AND parent.project_id = child.project_id
      WHERE child.project_id = $1
        AND child.service_name <> parent.service_name
        ${timeFilter}
      GROUP BY parent.service_name, child.service_name`,
      values,
    );

    const serviceCallCounts = new Map<string, number>();
    const edges: ServiceDependency[] = [];

    for (const row of result.rows) {
      const source = row.source_service as string;
      const target = row.target_service as string;
      const count = row.call_count as number;

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
    const s = this.schema;
    const values: unknown[] = [projectId];
    let idx = 2;
    let timeFilter = '';

    if (from) {
      timeFilter += ` AND start_time >= $${idx++}`;
      values.push(from);
    }
    if (to) {
      timeFilter += ` AND start_time <= $${idx++}`;
      values.push(to);
    }

    // True window p95 straight from raw spans via percentile_cont (not a max of
    // per-bucket percentiles from a continuous aggregate).
    const result = await this.runQuery(
      `SELECT
        service_name,
        COUNT(*)::int AS total_calls,
        SUM(CASE WHEN status_code = 'ERROR' THEN 1 ELSE 0 END)::int AS total_errors,
        AVG(duration_ms)::double precision AS avg_latency_ms,
        percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) AS p95_latency_ms
      FROM ${s}.spans
      WHERE project_id = $1${timeFilter}
      GROUP BY service_name`,
      values,
    );

    return result.rows.map((r) => ({
      serviceName: r.service_name as string,
      totalCalls: Number(r.total_calls ?? 0),
      totalErrors: Number(r.total_errors ?? 0),
      avgLatencyMs: Number(r.avg_latency_ms ?? 0),
      p95LatencyMs: r.p95_latency_ms != null ? Number(r.p95_latency_ms) : null,
    }));
  }

  async getSpanTimeseries(params: SpanTimeseriesParams): Promise<SpanTimeseriesBucket[]> {
    const { projectIds, from, to, bucket, serviceName } = params;
    if (projectIds.length === 0) return [];

    const s = this.schema;
    // bucket is a validated union ('hour' | 'day'), safe to inline as a literal.
    const trunc = bucket === 'day' ? 'day' : 'hour';
    const values: unknown[] = [projectIds, from, to];
    let svcFilter = '';
    if (serviceName) {
      svcFilter = ` AND service_name = $4`;
      values.push(serviceName);
    }

    const result = await this.runQuery(
      `SELECT
        date_trunc('${trunc}', start_time) AS bucket,
        COUNT(*)::int AS span_count,
        SUM(CASE WHEN status_code = 'ERROR' THEN 1 ELSE 0 END)::int AS error_count,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY duration_ms) AS p50,
        percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) AS p95,
        percentile_cont(0.99) WITHIN GROUP (ORDER BY duration_ms) AS p99
      FROM ${s}.spans
      WHERE project_id = ANY($1) AND start_time >= $2 AND start_time <= $3${svcFilter}
      GROUP BY bucket
      ORDER BY bucket ASC`,
      values,
    );

    return result.rows.map((r) => ({
      time: new Date(r.bucket as unknown as string),
      spanCount: Number(r.span_count ?? 0),
      errorCount: Number(r.error_count ?? 0),
      p50: r.p50 != null ? Number(r.p50) : null,
      p95: r.p95 != null ? Number(r.p95) : null,
      p99: r.p99 != null ? Number(r.p99) : null,
    }));
  }

  async deleteSpansByTimeRange(params: DeleteSpansByTimeRangeParams): Promise<DeleteResult> {
    const start = Date.now();
    const s = this.schema;
    const pids = Array.isArray(params.projectId) ? params.projectId : [params.projectId];

    const conditions = ['project_id = ANY($1)', 'time >= $2', 'time <= $3'];
    const values: unknown[] = [pids, params.from, params.to];
    let idx = 4;

    if (params.serviceName) {
      const svc = Array.isArray(params.serviceName) ? params.serviceName : [params.serviceName];
      conditions.push(`service_name = ANY($${idx++})`);
      values.push(svc);
    }

    const result = await this.runQuery(
      `DELETE FROM ${s}.spans WHERE ${conditions.join(' AND ')}`,
      values,
    );

    // Also clean up orphaned traces
    await this.runQuery(
      `DELETE FROM ${s}.traces WHERE project_id = ANY($1)
       AND NOT EXISTS (SELECT 1 FROM ${s}.spans WHERE spans.trace_id = traces.trace_id AND spans.project_id = traces.project_id)`,
      [pids],
    );

    return {
      deleted: Number(result.rowCount ?? 0),
      executionTimeMs: Date.now() - start,
    };
  }

  // =========================================================================
  // Metric Operations
  // =========================================================================

  async ingestMetrics(metrics: MetricRecord[]): Promise<IngestMetricsResult> {
    if (metrics.length === 0) {
      return { ingested: 0, failed: 0, durationMs: 0 };
    }

    const start = Date.now();
    const s = this.schema;

    const times: Date[] = [];
    const orgIds: string[] = [];
    const projectIds: string[] = [];
    const metricNames: string[] = [];
    const metricTypes: string[] = [];
    const values: number[] = [];
    const isMonotonics: (boolean | null)[] = [];
    const serviceNames: string[] = [];
    const attributesJsons: (string | null)[] = [];
    const resourceAttrsJsons: (string | null)[] = [];
    const histogramDataJsons: (string | null)[] = [];

    for (const m of metrics) {
      times.push(m.time);
      orgIds.push(sanitizeNull(m.organizationId));
      projectIds.push(sanitizeNull(m.projectId));
      metricNames.push(sanitizeNull(m.metricName));
      metricTypes.push(m.metricType);
      values.push(m.value);
      isMonotonics.push(m.isMonotonic ?? null);
      serviceNames.push(sanitizeNull(m.serviceName));
      attributesJsons.push(m.attributes ? JSON.stringify(m.attributes) : null);
      resourceAttrsJsons.push(m.resourceAttributes ? JSON.stringify(m.resourceAttributes) : null);
      histogramDataJsons.push(m.histogramData ? JSON.stringify(m.histogramData) : null);
    }

    // Compute has_exemplars flags
    const hasExemplarsFlags: boolean[] = metrics.map(m => (m.exemplars?.length ?? 0) > 0);

    try {
      const insertResult = await this.runQuery(
        `INSERT INTO ${s}.metrics (
          time, organization_id, project_id, metric_name, metric_type,
          value, is_monotonic, service_name, attributes, resource_attributes, histogram_data, has_exemplars
        )
        SELECT * FROM UNNEST(
          $1::timestamptz[], $2::uuid[], $3::uuid[], $4::text[], $5::text[],
          $6::double precision[], $7::boolean[], $8::text[], $9::jsonb[], $10::jsonb[], $11::jsonb[], $12::boolean[]
        )
        RETURNING id, time`,
        [times, orgIds, projectIds, metricNames, metricTypes,
         values, isMonotonics, serviceNames, attributesJsons, resourceAttrsJsons, histogramDataJsons, hasExemplarsFlags],
      );

      // Insert exemplars if any metrics have them
      const exemplarTimes: Date[] = [];
      const exemplarMetricIds: string[] = [];
      const exemplarOrgIds: string[] = [];
      const exemplarProjectIds: string[] = [];
      const exemplarValues: number[] = [];
      const exemplarTimesReal: (Date | null)[] = [];
      const exemplarTraceIds: (string | null)[] = [];
      const exemplarSpanIds: (string | null)[] = [];
      const exemplarAttrsJsons: (string | null)[] = [];

      for (let i = 0; i < metrics.length; i++) {
        const m = metrics[i];
        if (m.exemplars && m.exemplars.length > 0) {
          const row = insertResult.rows[i];
          const metricId = row.id as string;
          const metricTime = row.time as Date;

          for (const ex of m.exemplars) {
            exemplarTimes.push(metricTime);
            exemplarMetricIds.push(metricId);
            exemplarOrgIds.push(sanitizeNull(m.organizationId));
            exemplarProjectIds.push(sanitizeNull(m.projectId));
            exemplarValues.push(ex.exemplarValue);
            exemplarTimesReal.push(ex.exemplarTime ?? null);
            exemplarTraceIds.push(ex.traceId ?? null);
            exemplarSpanIds.push(ex.spanId ?? null);
            exemplarAttrsJsons.push(ex.attributes ? JSON.stringify(ex.attributes) : null);
          }
        }
      }

      if (exemplarTimes.length > 0) {
        await this.runQuery(
          `INSERT INTO ${s}.metric_exemplars (
            time, metric_id, organization_id, project_id,
            exemplar_value, exemplar_time, trace_id, span_id, attributes
          )
          SELECT * FROM UNNEST(
            $1::timestamptz[], $2::uuid[], $3::uuid[], $4::uuid[],
            $5::double precision[], $6::timestamptz[], $7::text[], $8::text[], $9::jsonb[]
          )`,
          [exemplarTimes, exemplarMetricIds, exemplarOrgIds, exemplarProjectIds,
           exemplarValues, exemplarTimesReal, exemplarTraceIds, exemplarSpanIds, exemplarAttrsJsons],
        );
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
    const s = this.schema;
    const limit = params.limit ?? 50;
    const offset = params.offset ?? 0;

    const conditions: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    // Time range
    conditions.push(`m.time ${params.fromExclusive ? '>' : '>='} $${idx++}`);
    values.push(params.from);
    conditions.push(`m.time ${params.toExclusive ? '<' : '<='} $${idx++}`);
    values.push(params.to);

    // Project filter
    const pids = Array.isArray(params.projectId) ? params.projectId : [params.projectId];
    conditions.push(`m.project_id = ANY($${idx++})`);
    values.push(pids);

    // Optional filters
    if (params.organizationId) {
      const oids = Array.isArray(params.organizationId) ? params.organizationId : [params.organizationId];
      conditions.push(`m.organization_id = ANY($${idx++})`);
      values.push(oids);
    }
    if (params.metricName) {
      const names = Array.isArray(params.metricName) ? params.metricName : [params.metricName];
      conditions.push(`m.metric_name = ANY($${idx++})`);
      values.push(names);
    }
    if (params.metricType) {
      const types = Array.isArray(params.metricType) ? params.metricType : [params.metricType];
      conditions.push(`m.metric_type = ANY($${idx++})`);
      values.push(types);
    }
    if (params.serviceName) {
      const svcs = Array.isArray(params.serviceName) ? params.serviceName : [params.serviceName];
      conditions.push(`m.service_name = ANY($${idx++})`);
      values.push(svcs);
    }
    if (params.attributes) {
      conditions.push(`m.attributes @> $${idx++}::jsonb`);
      values.push(JSON.stringify(params.attributes));
    }

    const where = `WHERE ${conditions.join(' AND ')}`;
    const sortOrder = params.sortOrder ?? 'desc';

    // Count total
    const countResult = await this.runQuery(
      `SELECT COUNT(*)::int AS count FROM ${s}.metrics m ${where}`,
      values,
    );
    const total = countResult.rows[0]?.count ?? 0;

    // Fetch rows
    const dataResult = await this.runQuery(
      `SELECT m.* FROM ${s}.metrics m ${where}
       ORDER BY m.time ${sortOrder}
       LIMIT $${idx++} OFFSET $${idx++}`,
      [...values, limit, offset],
    );

    let metricsResult = dataResult.rows.map(mapRowToStoredMetricRecord);

    // Optionally load exemplars
    if (params.includeExemplars && metricsResult.length > 0) {
      const metricIds = metricsResult.map((m) => m.id);
      const exResult = await this.runQuery(
        `SELECT * FROM ${s}.metric_exemplars WHERE metric_id = ANY($1::uuid[])`,
        [metricIds],
      );

      const exemplarsByMetricId = new Map<string, MetricExemplar[]>();
      for (const row of exResult.rows) {
        const mid = row.metric_id as string;
        if (!exemplarsByMetricId.has(mid)) {
          exemplarsByMetricId.set(mid, []);
        }
        exemplarsByMetricId.get(mid)!.push({
          exemplarValue: Number(row.exemplar_value),
          exemplarTime: row.exemplar_time ? (row.exemplar_time as Date) : undefined,
          traceId: row.trace_id as string | undefined,
          spanId: row.span_id as string | undefined,
          attributes: row.attributes as Record<string, unknown> | undefined,
        });
      }

      metricsResult = metricsResult.map((m) => ({
        ...m,
        exemplars: exemplarsByMetricId.get(m.id) ?? undefined,
        hasExemplars: exemplarsByMetricId.has(m.id),
      }));
    }

    return {
      metrics: metricsResult,
      total,
      hasMore: offset + metricsResult.length < total,
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

    const s = this.schema;

    const intervalSql = METRIC_INTERVAL_MAP[params.interval];
    const conditions: string[] = [];
    const values: unknown[] = [intervalSql];
    let idx = 2;

    // Time range
    conditions.push(`time >= $${idx++}`);
    values.push(params.from);
    conditions.push(`time <= $${idx++}`);
    values.push(params.to);

    // Project filter
    const pids = Array.isArray(params.projectId) ? params.projectId : [params.projectId];
    conditions.push(`project_id = ANY($${idx++})`);
    values.push(pids);

    // Metric name
    conditions.push(`metric_name = $${idx++}`);
    values.push(params.metricName);

    // Optional filters
    if (params.organizationId) {
      const oids = Array.isArray(params.organizationId) ? params.organizationId : [params.organizationId];
      conditions.push(`organization_id = ANY($${idx++})`);
      values.push(oids);
    }
    if (params.metricType) {
      conditions.push(`metric_type = $${idx++}`);
      values.push(params.metricType);
    }
    if (params.serviceName) {
      const svcs = Array.isArray(params.serviceName) ? params.serviceName : [params.serviceName];
      conditions.push(`service_name = ANY($${idx++})`);
      values.push(svcs);
    }
    if (params.attributes) {
      conditions.push(`attributes @> $${idx++}::jsonb`);
      values.push(JSON.stringify(params.attributes));
    }

    const where = `WHERE ${conditions.join(' AND ')}`;

    // Build aggregation expression
    let aggExpr: string;
    switch (params.aggregation) {
      case 'avg':
        aggExpr = 'AVG(value)';
        break;
      case 'sum':
        aggExpr = 'SUM(value)';
        break;
      case 'min':
        aggExpr = 'MIN(value)';
        break;
      case 'max':
        aggExpr = 'MAX(value)';
        break;
      case 'count':
        aggExpr = 'COUNT(*)';
        break;
      case 'last':
        aggExpr = '(array_agg(value ORDER BY time DESC))[1]';
        break;
      case 'p50':
        aggExpr = 'percentile_cont(0.5) WITHIN GROUP (ORDER BY value)';
        break;
      case 'p95':
        aggExpr = 'percentile_cont(0.95) WITHIN GROUP (ORDER BY value)';
        break;
      case 'p99':
        aggExpr = 'percentile_cont(0.99) WITHIN GROUP (ORDER BY value)';
        break;
      default:
        aggExpr = 'AVG(value)';
    }

    // Build groupBy columns (parameterized to prevent SQL injection)
    const groupByColumns: string[] = [];
    const selectExtra: string[] = [];
    if (params.groupBy && params.groupBy.length > 0) {
      for (const key of params.groupBy) {
        const alias = `label_${groupByColumns.length}`;
        selectExtra.push(`attributes->>$${idx++} AS ${alias}`);
        values.push(key);
        groupByColumns.push(alias);
      }
    }

    const selectCols = [
      `time_bucket($1, time) AS bucket`,
      `${aggExpr} AS agg_value`,
      ...selectExtra,
    ].join(', ');

    const groupByCols = ['bucket', ...groupByColumns].join(', ');

    const result = await this.runQuery(
      `SELECT ${selectCols}
       FROM ${s}.metrics
       ${where}
       GROUP BY ${groupByCols}
       ORDER BY bucket ASC`,
      values,
    );

    const timeseries: MetricTimeBucket[] = result.rows.map((row: Record<string, unknown>) => {
      const bucket: MetricTimeBucket = {
        bucket: row.bucket as Date,
        value: Number(row.agg_value),
      };
      if (params.groupBy && params.groupBy.length > 0) {
        const labels: Record<string, string> = {};
        for (let i = 0; i < params.groupBy.length; i++) {
          labels[params.groupBy[i]] = (row[`label_${i}`] as string) ?? '';
        }
        bucket.labels = labels;
      }
      return bucket;
    });

    return {
      metricName: params.metricName,
      metricType: params.metricType ?? 'gauge',
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
    const s = this.schema;

    const rollupTable = params.interval === '1d'
      ? 'metrics_daily_stats'
      : 'metrics_hourly_stats';

    const aggColumn: Record<string, string> = {
      avg: 'avg_value',
      sum: 'sum_value',
      min: 'min_value',
      max: 'max_value',
      count: 'point_count',
    };
    const col = aggColumn[params.aggregation] || 'avg_value';

    const projectIds = Array.isArray(params.projectId) ? params.projectId : [params.projectId];
    const placeholders: unknown[] = [params.from, params.to, projectIds, params.metricName];

    let serviceFilter = '';
    if (params.serviceName) {
      const services = Array.isArray(params.serviceName) ? params.serviceName : [params.serviceName];
      placeholders.push(services);
      serviceFilter = ` AND service_name = ANY($${placeholders.length})`;
    }

    const sql = `
      SELECT bucket, ${col} AS agg_value
      FROM ${s}.${rollupTable}
      WHERE bucket >= $1 AND bucket <= $2
        AND project_id = ANY($3)
        AND metric_name = $4
        ${serviceFilter}
      ORDER BY bucket ASC
    `;

    const { rows } = await this.runQuery(sql, placeholders);

    // Resolve metric type
    let metricType = params.metricType;
    if (!metricType && rows.length > 0) {
      const typeRes = await this.runQuery(
        `SELECT metric_type FROM ${s}.${rollupTable} WHERE metric_name = $1 LIMIT 1`,
        [params.metricName],
      );
      metricType = typeRes.rows[0]?.metric_type || 'gauge';
    }

    return {
      metricName: params.metricName,
      metricType: (metricType || 'gauge') as MetricType,
      timeseries: rows.map((r: Record<string, unknown>) => ({
        bucket: new Date(r.bucket as string),
        value: Number(r.agg_value) || 0,
      })),
      executionTimeMs: Date.now() - start,
    };
  }

  async getMetricNames(params: MetricNamesParams): Promise<MetricNamesResult> {
    const start = Date.now();
    const s = this.schema;

    const conditions: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    // Project filter
    const pids = Array.isArray(params.projectId) ? params.projectId : [params.projectId];
    conditions.push(`project_id = ANY($${idx++})`);
    values.push(pids);

    // Optional filters
    if (params.organizationId) {
      const oids = Array.isArray(params.organizationId) ? params.organizationId : [params.organizationId];
      conditions.push(`organization_id = ANY($${idx++})`);
      values.push(oids);
    }
    if (params.metricType) {
      const types = Array.isArray(params.metricType) ? params.metricType : [params.metricType];
      conditions.push(`metric_type = ANY($${idx++})`);
      values.push(types);
    }
    if (params.from) {
      conditions.push(`time >= $${idx++}`);
      values.push(params.from);
    }
    if (params.to) {
      conditions.push(`time <= $${idx++}`);
      values.push(params.to);
    }

    const where = `WHERE ${conditions.join(' AND ')}`;
    const limitClause = params.limit ? `LIMIT $${idx++}` : '';
    const limitValues = params.limit ? [params.limit] : [];

    const result = await this.runQuery(
      `SELECT DISTINCT metric_name, metric_type
       FROM ${s}.metrics
       ${where}
       ORDER BY metric_name ASC
       ${limitClause}`,
      [...values, ...limitValues],
    );

    return {
      names: result.rows.map((row: Record<string, unknown>) => ({
        name: row.metric_name as string,
        type: row.metric_type as MetricType,
      })),
      executionTimeMs: Date.now() - start,
    };
  }

  async getMetricLabelKeys(params: MetricLabelParams): Promise<MetricLabelResult> {
    const start = Date.now();
    const s = this.schema;

    const conditions: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    // Project filter
    const pids = Array.isArray(params.projectId) ? params.projectId : [params.projectId];
    conditions.push(`project_id = ANY($${idx++})`);
    values.push(pids);

    // Metric name
    conditions.push(`metric_name = $${idx++}`);
    values.push(params.metricName);

    // Optional filters
    if (params.organizationId) {
      const oids = Array.isArray(params.organizationId) ? params.organizationId : [params.organizationId];
      conditions.push(`organization_id = ANY($${idx++})`);
      values.push(oids);
    }
    if (params.from) {
      conditions.push(`time >= $${idx++}`);
      values.push(params.from);
    }
    if (params.to) {
      conditions.push(`time <= $${idx++}`);
      values.push(params.to);
    }

    const where = `WHERE ${conditions.join(' AND ')}`;
    const limitClause = params.limit ? `LIMIT $${idx++}` : '';
    const limitValues = params.limit ? [params.limit] : [];

    const result = await this.runQuery(
      `SELECT DISTINCT jsonb_object_keys(attributes) AS key
       FROM ${s}.metrics
       ${where} AND attributes IS NOT NULL
       ORDER BY key ASC
       ${limitClause}`,
      [...values, ...limitValues],
    );

    return {
      keys: result.rows.map((row: Record<string, unknown>) => row.key as string),
      executionTimeMs: Date.now() - start,
    };
  }

  async getMetricLabelValues(params: MetricLabelParams, labelKey: string): Promise<MetricLabelResult> {
    const start = Date.now();
    const s = this.schema;

    const conditions: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    // Project filter
    const pids = Array.isArray(params.projectId) ? params.projectId : [params.projectId];
    conditions.push(`project_id = ANY($${idx++})`);
    values.push(pids);

    // Metric name
    conditions.push(`metric_name = $${idx++}`);
    values.push(params.metricName);

    // Must have the key
    conditions.push(`attributes ? $${idx++}`);
    values.push(labelKey);

    // Optional filters
    if (params.organizationId) {
      const oids = Array.isArray(params.organizationId) ? params.organizationId : [params.organizationId];
      conditions.push(`organization_id = ANY($${idx++})`);
      values.push(oids);
    }
    if (params.from) {
      conditions.push(`time >= $${idx++}`);
      values.push(params.from);
    }
    if (params.to) {
      conditions.push(`time <= $${idx++}`);
      values.push(params.to);
    }

    const where = `WHERE ${conditions.join(' AND ')}`;
    const limitClause = params.limit ? `LIMIT $${idx++}` : '';
    const limitValues = params.limit ? [params.limit] : [];

    const result = await this.runQuery(
      `SELECT DISTINCT attributes->>$${idx++} AS value
       FROM ${s}.metrics
       ${where}
       ORDER BY value ASC
       ${limitClause}`,
      [...values, ...limitValues, labelKey],
    );

    return {
      values: result.rows
        .map((row: Record<string, unknown>) => row.value as string)
        .filter((v) => v != null),
      executionTimeMs: Date.now() - start,
    };
  }

  async deleteMetricsByTimeRange(params: DeleteMetricsByTimeRangeParams): Promise<DeleteResult> {
    const start = Date.now();
    const s = this.schema;
    const pids = Array.isArray(params.projectId) ? params.projectId : [params.projectId];

    const conditions = ['project_id = ANY($1)', 'time >= $2', 'time <= $3'];
    const values: unknown[] = [pids, params.from, params.to];
    let idx = 4;

    if (params.metricName) {
      const names = Array.isArray(params.metricName) ? params.metricName : [params.metricName];
      conditions.push(`metric_name = ANY($${idx++})`);
      values.push(names);
    }
    if (params.serviceName) {
      const svcs = Array.isArray(params.serviceName) ? params.serviceName : [params.serviceName];
      conditions.push(`service_name = ANY($${idx++})`);
      values.push(svcs);
    }

    const where = conditions.join(' AND ');

    // Delete exemplars first (they reference metrics)
    await this.runQuery(
      `DELETE FROM ${s}.metric_exemplars WHERE metric_id IN (
        SELECT id FROM ${s}.metrics WHERE ${where}
      )`,
      values,
    );

    // Delete metrics
    const result = await this.runQuery(
      `DELETE FROM ${s}.metrics WHERE ${where}`,
      values,
    );

    return {
      deleted: Number(result.rowCount ?? 0),
      executionTimeMs: Date.now() - start,
    };
  }

  async getMetricsOverview(params: MetricsOverviewParams): Promise<MetricsOverviewResult> {
    const start = Date.now();
    const s = this.schema;
    const projectIds = Array.isArray(params.projectId) ? params.projectId : [params.projectId];
    const placeholders: unknown[] = [params.from, params.to, projectIds];

    let serviceFilter = '';
    if (params.serviceName) {
      placeholders.push(params.serviceName);
      serviceFilter = ` AND service_name = $${placeholders.length}`;
    }

    // Try continuous aggregate first
    let rows: Record<string, unknown>[];
    try {
      const sql = `
        SELECT
          metric_name, metric_type, service_name,
          SUM(point_count)::bigint AS point_count,
          CASE WHEN SUM(point_count) > 0
            THEN SUM(sum_value) / SUM(point_count)
            ELSE 0
          END AS avg_value,
          MIN(min_value) AS min_value,
          MAX(max_value) AS max_value
        FROM ${s}.metrics_hourly_stats
        WHERE bucket >= $1 AND bucket <= $2
          AND project_id = ANY($3)
          ${serviceFilter}
        GROUP BY metric_name, metric_type, service_name
        ORDER BY service_name, metric_name
      `;
      const result = await this.runQuery(sql, placeholders);
      rows = result.rows;
    } catch {
      // Fallback to raw metrics table
      const sql = `
        SELECT
          metric_name, metric_type, service_name,
          COUNT(*)::bigint AS point_count,
          AVG(value) AS avg_value,
          MIN(value) AS min_value,
          MAX(value) AS max_value
        FROM ${s}.metrics
        WHERE time >= $1 AND time <= $2
          AND project_id = ANY($3)
          ${serviceFilter}
        GROUP BY metric_name, metric_type, service_name
        ORDER BY service_name, metric_name
      `;
      const result = await this.runQuery(sql, placeholders);
      rows = result.rows;
    }

    // Get latest value per metric (from raw table, last 5 min)
    const latestPlaceholders: unknown[] = [new Date(Date.now() - 5 * 60 * 1000), projectIds];
    let latestServiceFilter = '';
    if (params.serviceName) {
      latestPlaceholders.push(params.serviceName);
      latestServiceFilter = ` AND service_name = $${latestPlaceholders.length}`;
    }

    let latestMap = new Map<string, number>();
    try {
      const latestSql = `
        SELECT DISTINCT ON (metric_name, service_name)
          metric_name, service_name, value AS latest_value
        FROM ${s}.metrics
        WHERE time >= $1 AND project_id = ANY($2)
          ${latestServiceFilter}
        ORDER BY metric_name, service_name, time DESC
      `;
      const { rows: latestRows } = await this.runQuery(latestSql, latestPlaceholders);
      latestMap = new Map(
        latestRows.map((r: Record<string, unknown>) => [
          `${r.metric_name}:${r.service_name}`,
          Number(r.latest_value),
        ]),
      );
    } catch {
      // If latest value query fails, just use avg from the aggregate
    }

    const serviceMap = new Map<string, MetricOverviewItem[]>();
    for (const row of rows) {
      const serviceName = row.service_name as string;
      const key = `${row.metric_name}:${serviceName}`;
      const item: MetricOverviewItem = {
        metricName: row.metric_name as string,
        metricType: (row.metric_type as MetricType) || 'gauge',
        serviceName,
        latestValue: latestMap.get(key) ?? Number(row.avg_value) ?? 0,
        avgValue: Number(row.avg_value) ?? 0,
        minValue: Number(row.min_value) ?? 0,
        maxValue: Number(row.max_value) ?? 0,
        pointCount: Number(row.point_count) ?? 0,
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

function mapRowToLogRecord(row: Record<string, unknown>): LogRecord {
  return {
    time: row.time as Date,
    organizationId: row.organization_id as string | undefined,
    projectId: row.project_id as string,
    service: row.service as string,
    level: row.level as LogLevel,
    message: row.message as string,
    metadata: row.metadata as Record<string, unknown> | undefined,
    traceId: row.trace_id as string | undefined,
    spanId: row.span_id as string | undefined,
    sessionId: row.session_id as string | undefined,
    hostname: row.hostname as string | undefined,
  };
}

function mapRowToStoredLogRecord(row: Record<string, unknown>): StoredLogRecord {
  return {
    id: row.id as string,
    ...mapRowToLogRecord(row),
  };
}

function mapRowToSpanRecord(row: Record<string, unknown>): SpanRecord {
  return {
    time: row.time as Date,
    spanId: row.span_id as string,
    traceId: row.trace_id as string,
    parentSpanId: row.parent_span_id as string | undefined,
    organizationId: row.organization_id as string | undefined,
    projectId: row.project_id as string,
    serviceName: row.service_name as string,
    operationName: row.operation_name as string,
    startTime: row.start_time as Date,
    endTime: row.end_time as Date,
    durationMs: row.duration_ms as number,
    kind: row.kind as SpanKind | undefined,
    statusCode: row.status_code as SpanStatusCode | undefined,
    statusMessage: row.status_message as string | undefined,
    attributes: row.attributes as Record<string, unknown> | undefined,
    events: row.events as Array<Record<string, unknown>> | undefined,
    links: row.links as Array<Record<string, unknown>> | undefined,
    resourceAttributes: row.resource_attributes as Record<string, unknown> | undefined,
  };
}

function mapRowToTraceRecord(row: Record<string, unknown>): TraceRecord {
  return {
    traceId: row.trace_id as string,
    organizationId: row.organization_id as string | undefined,
    projectId: row.project_id as string,
    serviceName: row.service_name as string,
    rootServiceName: row.root_service_name as string | undefined,
    rootOperationName: row.root_operation_name as string | undefined,
    startTime: row.start_time as Date,
    endTime: row.end_time as Date,
    durationMs: row.duration_ms as number,
    spanCount: row.span_count as number,
    error: row.error as boolean,
  };
}

function mapRowToStoredMetricRecord(row: Record<string, unknown>): StoredMetricRecord {
  return {
    id: row.id as string,
    time: row.time as Date,
    organizationId: row.organization_id as string,
    projectId: row.project_id as string,
    metricName: row.metric_name as string,
    metricType: row.metric_type as MetricType,
    value: Number(row.value),
    isMonotonic: row.is_monotonic as boolean | undefined,
    serviceName: row.service_name as string,
    attributes: row.attributes as Record<string, unknown> | undefined,
    resourceAttributes: row.resource_attributes as Record<string, unknown> | undefined,
    histogramData: row.histogram_data as StoredMetricRecord['histogramData'],
    hasExemplars: Boolean(row.has_exemplars),
  };
}
