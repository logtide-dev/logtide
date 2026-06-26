import { MongoClient, type Db, type Collection, type Document, MongoBulkWriteError, type WriteError } from 'mongodb';
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
  MetricAggregationFn,
  MetricOverviewItem,
  MetricsOverviewParams,
  MetricsOverviewResult,
} from '../../core/types.js';
import { MongoDBQueryTranslator, INTERVAL_MS } from './query-translator.js';

export interface MongoDBEngineOptions {
  /** Use an existing MongoClient instead of creating a new one */
  client?: MongoClient;
  /** Database name override (defaults to config.database) */
  dbName?: string;
  /** Logs collection name (default: 'logs') */
  tableName?: string;
  /** Skip schema initialization */
  skipInitialize?: boolean;
  /** Force time-series collections on/off; undefined = auto-detect */
  useTimeSeries?: boolean;
  /** Use an existing Db instance (test/injection) */
  db?: Db;
}

/** Interval to $dateTrunc unit/binSize for MongoDB 5.0+ */
const INTERVAL_DATETRUNC: Record<AggregationInterval, { unit: string; binSize: number }> = {
  '1m': { unit: 'minute', binSize: 1 },
  '5m': { unit: 'minute', binSize: 5 },
  '15m': { unit: 'minute', binSize: 15 },
  '1h': { unit: 'hour', binSize: 1 },
  '6h': { unit: 'hour', binSize: 6 },
  '1d': { unit: 'day', binSize: 1 },
  '1w': { unit: 'week', binSize: 1 },
};

const AGG_ACCUMULATORS: Record<MetricAggregationFn, Document> = {
  avg: { $avg: '$value' },
  sum: { $sum: '$value' },
  min: { $min: '$value' },
  max: { $max: '$value' },
  count: { $sum: 1 },
  last: { $last: '$value' },
  p50: { $push: '$value' },
  p95: { $push: '$value' },
  p99: { $push: '$value' },
};

const PERCENTILE_FRACTIONS: Record<string, number> = {
  p50: 0.5,
  p95: 0.95,
  p99: 0.99,
};

// =============================================================================
// Context comment helpers
// =============================================================================

const MONGO_SAFE_RE = /[^a-zA-Z0-9_:-]/g;
function mongoSafe(v: string | null | undefined): string {
  if (!v) return '-';
  const c = v.replace(MONGO_SAFE_RE, '');
  return c.length > 0 ? c : '-';
}
function mongoCommentValue(): string | undefined {
  if (process.env.LOGTIDE_CONTEXT_SQL_COMMENT === 'false') return undefined;
  const ctx = currentOrNull();
  if (!ctx) return undefined;
  return `req=${mongoSafe(ctx.requestId)} origin=${mongoSafe(ctx.origin)} org=${mongoSafe(
    ctx.organizationId
  )} actor=${mongoSafe(ctx.actor.type)}:${mongoSafe(ctx.actor.id)}`;
}

/** Spread into options to inject the $comment field if a context is active. */
function ctxOpts(): { comment?: string } {
  const c = mongoCommentValue();
  return c ? { comment: c } : {};
}

export class MongoDBEngine extends StorageEngine {
  private mongoClient: MongoClient | null = null;
  private ownsClient: boolean;
  private translator: MongoDBQueryTranslator;
  private options: MongoDBEngineOptions;
  private useTimeSeries = false;
  private useDateTrunc = false;

  private get tableName(): string {
    return this.options.tableName ?? 'logs';
  }

  constructor(config: StorageConfig, options: MongoDBEngineOptions = {}) {
    super(config);
    this.options = options;
    this.ownsClient = !options.client;
    if (options.client) {
      this.mongoClient = options.client;
    }
    this.translator = new MongoDBQueryTranslator();
  }

  /** Build a time-bucketing expression, using $dateTrunc when available */
  private buildBucketExpr(interval: AggregationInterval, intervalMs: number): Document {
    if (this.useDateTrunc) {
      return {
        $dateTrunc: {
          date: '$time',
          unit: INTERVAL_DATETRUNC[interval].unit,
          binSize: INTERVAL_DATETRUNC[interval].binSize,
        },
      };
    }
    return {
      $toDate: {
        $subtract: [{ $toLong: '$time' }, { $mod: [{ $toLong: '$time' }, intervalMs] }],
      },
    };
  }

  // =========================================================================
  // Lifecycle
  // =========================================================================

  async connect(): Promise<void> {
    if (this.mongoClient) return;

    const auth = this.config.username
      ? `${encodeURIComponent(this.config.username)}:${encodeURIComponent(this.config.password)}@`
      : '';
    const queryParams = this.config.options
      ? '?' + Object.entries(this.config.options).map(([k, v]) => `${k}=${v}`).join('&')
      : '';
    const url = `mongodb://${auth}${this.config.host}:${this.config.port}/${this.config.database}${queryParams}`;

    this.mongoClient = new MongoClient(url, {
      maxPoolSize: this.config.poolSize ?? 100,
      minPoolSize: 5,
      maxIdleTimeMS: 60_000,
      connectTimeoutMS: this.config.connectionTimeoutMs ?? 5_000,
      socketTimeoutMS: 30_000,
      serverSelectionTimeoutMS: this.config.connectionTimeoutMs ?? 5_000,
      tls: this.config.ssl ?? false,
    });

    await this.mongoClient.connect();
  }

  async disconnect(): Promise<void> {
    if (this.mongoClient && this.ownsClient) {
      await this.mongoClient.close();
      this.mongoClient = null;
    }
  }

  async healthCheck(): Promise<HealthStatus> {
    const start = Date.now();
    try {
      await this.getDb().command({ ping: 1 });
      const responseTimeMs = Date.now() - start;
      let status: HealthStatus['status'] = 'healthy';
      if (responseTimeMs >= 200) status = 'unhealthy';
      else if (responseTimeMs >= 50) status = 'degraded';
      return { status, engine: 'mongodb', connected: true, responseTimeMs };
    } catch (err) {
      return {
        status: 'unhealthy',
        engine: 'mongodb',
        connected: false,
        responseTimeMs: Date.now() - start,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async initialize(): Promise<void> {
    if (this.options.skipInitialize) return;

    const db = this.getDb();

    // Detect MongoDB version for time-series and $dateTrunc support
    try {
      const info = await db.admin().serverInfo();
      const [major] = info.version.split('.').map(Number);
      this.useDateTrunc = major >= 5;

      if (this.options.useTimeSeries !== undefined) {
        this.useTimeSeries = this.options.useTimeSeries;
      } else {
        this.useTimeSeries = major >= 5;
      }
    } catch {
      this.useTimeSeries = false;
      this.useDateTrunc = false;
    }

    // Create collections
    await this.ensureLogsCollection(db);
    await this.ensureCollection(db, 'spans');
    await this.ensureCollection(db, 'traces');
    await this.ensureCollection(db, 'metrics');
    await this.ensureCollection(db, 'metric_exemplars');

    // Create indexes
    await this.createLogsIndexes(db);
    await this.createSpansIndexes(db);
    await this.createTracesIndexes(db);
    await this.createMetricsIndexes(db);
  }

  async migrate(_version: string): Promise<void> {
    // placeholder
  }

  getCapabilities(): EngineCapabilities {
    return {
      engine: 'mongodb',
      supportsFullTextSearch: true,
      supportsAggregations: true,
      supportsStreaming: true,
      supportsTransactions: true,
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

  // =========================================================================
  // Log Operations
  // =========================================================================

  async ingest(logs: LogRecord[]): Promise<IngestResult> {
    if (logs.length === 0) return { ingested: 0, failed: 0, durationMs: 0 };

    const start = Date.now();
    const col = this.logsCol();

    try {
      const docs = logs.map((log) => toMongoLogDoc(log, log.id ?? randomUUID()));
      const result = await col.insertMany(docs, { ...ctxOpts(), ordered: false });
      return { ingested: result.insertedCount, failed: logs.length - result.insertedCount, durationMs: Date.now() - start };
    } catch (err) {
      if (err instanceof MongoBulkWriteError) {
        const inserted = err.result?.insertedCount ?? 0;
        return {
          ingested: inserted,
          failed: logs.length - inserted,
          durationMs: Date.now() - start,
          errors: extractWriteErrors(err),
        };
      }
      return {
        ingested: 0,
        failed: logs.length,
        durationMs: Date.now() - start,
        errors: [{ index: 0, error: err instanceof Error ? err.message : String(err) }],
      };
    }
  }

  async ingestReturning(logs: LogRecord[]): Promise<IngestReturningResult> {
    if (logs.length === 0) return { ingested: 0, failed: 0, durationMs: 0, rows: [] };

    const start = Date.now();
    const col = this.logsCol();
    const logsWithIds = logs.map((log) => ({ ...log, id: log.id ?? randomUUID() }));

    const toRow = (log: (typeof logsWithIds)[number]): StoredLogRecord => ({
      id: log.id,
      time: log.time,
      projectId: log.projectId,
      organizationId: log.organizationId,
      service: log.service,
      level: log.level,
      message: log.message,
      metadata: log.metadata,
      traceId: log.traceId,
      spanId: log.spanId,
      hostname: log.hostname,
    });

    try {
      const docs = logsWithIds.map((log) => toMongoLogDoc(log, log.id));
      await col.insertMany(docs, { ...ctxOpts(), ordered: false });

      const rows: StoredLogRecord[] = logsWithIds.map(toRow);

      return { ingested: logs.length, failed: 0, durationMs: Date.now() - start, rows };
    } catch (err) {
      if (err instanceof MongoBulkWriteError) {
        const inserted = err.result?.insertedCount ?? 0;
        // With ordered:false every doc is attempted; the failed ones are reported
        // with their indices. The inserted rows are therefore all inputs except
        // those indices. Return them so downstream SIEM/pipeline processing still
        // runs for the records that actually landed.
        const writeErrors = extractWriteErrors(err);
        const failedIdx = new Set(writeErrors.map((e) => e.index));
        const rows = logsWithIds.filter((_, i) => !failedIdx.has(i)).map(toRow);
        return {
          ingested: inserted,
          failed: logs.length - inserted,
          durationMs: Date.now() - start,
          rows,
          errors: writeErrors,
        };
      }
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
    const col = this.logsCol();
    const native = this.translator.translateQuery(params);
    const filter = native.query as Document;
    const { limit, offset, sort } = native.metadata as { limit: number; offset: number; sort: Document };

    const docs = await col
      .find(filter, { ...ctxOpts(), projection: { _id: 0 } })
      .sort(sort)
      .skip(offset)
      .limit(limit + 1)
      .toArray();

    const hasMore = docs.length > limit;
    const trimmed = hasMore ? docs.slice(0, limit) : docs;

    let nextCursor: string | undefined;
    if (hasMore && trimmed.length > 0) {
      const last = trimmed[trimmed.length - 1];
      const lastTime = last.time instanceof Date ? last.time : new Date(last.time);
      nextCursor = Buffer.from(`${lastTime.toISOString()},${last.id}`).toString('base64');
    }

    return {
      logs: trimmed.map(mapDocToStoredLogRecord),
      total: trimmed.length,
      hasMore,
      limit,
      offset,
      nextCursor,
      executionTimeMs: Date.now() - start,
    };
  }

  async aggregate(params: AggregateParams): Promise<AggregateResult> {
    const start = Date.now();
    const col = this.logsCol();
    const native = this.translator.translateAggregate(params);
    const filter = native.query as Document;
    const intervalMs = native.metadata!.intervalMs as number;

    const bucketExpr = this.buildBucketExpr(params.interval, intervalMs);

    const pipeline: Document[] = [
      { $match: filter },
      {
        $group: {
          _id: { bucket: bucketExpr, level: '$level' },
          total: { $sum: 1 },
        },
      },
      { $sort: { '_id.bucket': 1 } },
    ];

    const rows = await col.aggregate(pipeline, { ...ctxOpts(), allowDiskUse: true }).toArray();

    const bucketMap = new Map<string, TimeBucket>();
    for (const row of rows) {
      const bucketTime = row._id.bucket instanceof Date ? row._id.bucket : new Date(row._id.bucket);
      const key = bucketTime.toISOString();
      let bucket = bucketMap.get(key);
      if (!bucket) {
        bucket = { bucket: bucketTime, total: 0, byLevel: {} as Record<LogLevel, number> };
        bucketMap.set(key, bucket);
      }
      const count = Number(row.total);
      bucket.total += count;
      if (row._id.level && bucket.byLevel) {
        bucket.byLevel[row._id.level as LogLevel] = count;
      }
    }

    const timeseries = Array.from(bucketMap.values());
    const total = timeseries.reduce((sum, b) => sum + b.total, 0);

    return { timeseries, total, executionTimeMs: Date.now() - start };
  }

  async getById(params: GetByIdParams): Promise<StoredLogRecord | null> {
    const col = this.logsCol();
    const doc = await col.findOne(
      { id: params.id, project_id: params.projectId },
      { ...ctxOpts(), projection: { _id: 0 } },
    );
    return doc ? mapDocToStoredLogRecord(doc) : null;
  }

  async getByIds(params: GetByIdsParams): Promise<StoredLogRecord[]> {
    if (params.ids.length === 0) return [];
    const col = this.logsCol();
    const docs = await col
      .find(
        { id: { $in: params.ids }, project_id: params.projectId },
        { ...ctxOpts(), projection: { _id: 0 } },
      )
      .sort({ time: -1 })
      .toArray();
    return docs.map(mapDocToStoredLogRecord);
  }

  async count(params: CountParams): Promise<CountResult> {
    const start = Date.now();
    const col = this.logsCol();
    const native = this.translator.translateCount(params);
    const filter = native.query as Document;
    const count = await col.countDocuments(filter, { ...ctxOpts() });
    return { count, executionTimeMs: Date.now() - start };
  }

  async countEstimate(params: CountParams): Promise<CountResult> {
    const start = Date.now();
    const col = this.logsCol();
    const native = this.translator.translateCount(params);
    const filter = native.query as Document;

    // For simple filters, countDocuments is fast, but if it's entirely unfiltered or
    // only filtering on time (which might cover the whole collection), estimated is faster.
    // Given our use case (always filtering by project_id and time), countDocuments
    // is usually the only way because estimatedDocumentCount doesn't take a filter.
    // However, we can add a timeout to prevent it from hanging on massive datasets.
    try {
      const count = await col.countDocuments(filter, { ...ctxOpts(), maxTimeMS: 2000 });
      return { count, executionTimeMs: Date.now() - start };
    } catch (err) {
      // If it times out, return a large safe fallback or try explain()
      return { count: 100_000, executionTimeMs: Date.now() - start };
    }
  }

  async distinct(params: DistinctParams): Promise<DistinctResult> {
    const start = Date.now();
    const col = this.logsCol();
    const native = this.translator.translateDistinct(params);
    const filter = native.query as Document;
    const mongoField = native.metadata!.mongoField as string;
    const limit = native.metadata!.limit as number;

    const pipeline: Document[] = [
      { $match: filter },
      // Pre-filter before $group to reduce the number of docs aggregated.
      // Exclude only null and empty string. NOTE: `$gt: ''` would wrongly drop all
      // numeric/boolean values too, since in BSON sort order those types compare
      // below strings; use $nin so non-string metadata values survive.
      { $match: { [mongoField]: { $exists: true, $nin: [null, ''] } } },
      { $group: { _id: `$${mongoField}` } },
      { $sort: { _id: 1 } },
      { $limit: limit },
      { $project: { value: '$_id', _id: 0 } },
    ];

    const rows = await col.aggregate(pipeline, { ...ctxOpts() }).toArray();
    return {
      values: rows.map((r) => String(r.value)).filter((v) => v !== '' && v !== 'null'),
      executionTimeMs: Date.now() - start,
    };
  }

  async topValues(params: TopValuesParams): Promise<TopValuesResult> {
    const start = Date.now();
    const col = this.logsCol();
    const native = this.translator.translateTopValues(params);
    const filter = native.query as Document;
    const mongoField = native.metadata!.mongoField as string;
    const limit = native.metadata!.limit as number;

    const pipeline: Document[] = [
      { $match: filter },
      { $group: { _id: `$${mongoField}`, count: { $sum: 1 } } },
      { $match: { _id: { $ne: null } } },
      { $sort: { count: -1 } },
      { $limit: limit },
      { $project: { value: '$_id', count: 1, _id: 0 } },
    ];

    const rows = await col.aggregate(pipeline, { ...ctxOpts() }).toArray();
    return {
      values: rows
        .filter((r) => r.value != null && String(r.value) !== '')
        .map((r) => ({ value: String(r.value), count: Number(r.count) })),
      executionTimeMs: Date.now() - start,
    };
  }

  async deleteByTimeRange(params: DeleteByTimeRangeParams): Promise<DeleteResult> {
    const start = Date.now();
    const col = this.logsCol();
    const native = this.translator.translateDelete(params);
    const filter = native.query as Document;
    const result = await col.deleteMany(filter, { ...ctxOpts() });
    return { deleted: result.deletedCount, executionTimeMs: Date.now() - start };
  }

  // =========================================================================
  // Span & Trace Operations
  // =========================================================================

  async ingestSpans(spans: SpanRecord[]): Promise<IngestSpansResult> {
    if (spans.length === 0) return { ingested: 0, failed: 0, durationMs: 0 };

    const start = Date.now();
    const col = this.spansCol();

    try {
      const docs = spans.map(toMongoSpanDoc);
      const result = await col.insertMany(docs, { ...ctxOpts(), ordered: false });
      return { ingested: result.insertedCount, failed: spans.length - result.insertedCount, durationMs: Date.now() - start };
    } catch (err) {
      if (err instanceof MongoBulkWriteError) {
        const inserted = err.result?.insertedCount ?? 0;
        return {
          ingested: inserted,
          failed: spans.length - inserted,
          durationMs: Date.now() - start,
          errors: extractWriteErrors(err),
        };
      }
      return {
        ingested: 0,
        failed: spans.length,
        durationMs: Date.now() - start,
        errors: [{ index: 0, error: err instanceof Error ? err.message : String(err) }],
      };
    }
  }

  async upsertTrace(trace: TraceRecord): Promise<void> {
    const col = this.tracesCol();
    const filter = { trace_id: trace.traceId, project_id: trace.projectId };

    // Single bulkWrite: upsert + compute duration_ms in one network round trip
    await col.bulkWrite(
      [
        {
          updateOne: {
            filter,
            update: {
              $min: { start_time: trace.startTime },
              $max: { end_time: trace.endTime, error: trace.error },
              $inc: { span_count: trace.spanCount },
              $set: {
                service_name: trace.serviceName,
                root_service_name: trace.rootServiceName ?? null,
                root_operation_name: trace.rootOperationName ?? null,
                updated_at: new Date(),
              },
              $setOnInsert: {
                trace_id: trace.traceId,
                project_id: trace.projectId,
                organization_id: trace.organizationId ?? null,
              },
            },
            upsert: true,
          },
        },
        {
          updateOne: {
            filter,
            update: [{ $set: { duration_ms: { $subtract: [{ $toLong: '$end_time' }, { $toLong: '$start_time' }] } } }],
          },
        },
      ],
      { ordered: true },
    );
  }

  async querySpans(params: SpanQueryParams): Promise<SpanQueryResult> {
    const start = Date.now();
    const col = this.spansCol();
    const limit = params.limit ?? 50;
    const offset = params.offset ?? 0;

    const filter = this.buildSpanFilter(params);
    const sortBy = params.sortBy === 'start_time' || params.sortBy === 'time' ? params.sortBy : 'start_time';
    const sortOrder = params.sortOrder === 'desc' ? -1 : 1;

    const [docs, total] = await Promise.all([
      col.find(filter, { ...ctxOpts(), projection: { _id: 0 } })
        .sort({ [sortBy]: sortOrder })
        .skip(offset)
        .limit(limit)
        .toArray(),
      col.countDocuments(filter, { ...ctxOpts() }),
    ]);

    return {
      spans: docs.map(mapDocToSpanRecord),
      total,
      hasMore: offset + docs.length < total,
      limit,
      offset,
      executionTimeMs: Date.now() - start,
    };
  }

  async getSpansByTraceId(traceId: string, projectId: string): Promise<SpanRecord[]> {
    const col = this.spansCol();
    const docs = await col
      .find({ trace_id: traceId, project_id: projectId }, { ...ctxOpts(), projection: { _id: 0 } })
      .sort({ start_time: 1 })
      .toArray();
    return docs.map(mapDocToSpanRecord);
  }

  async queryTraces(params: TraceQueryParams): Promise<TraceQueryResult> {
    const start = Date.now();
    const col = this.tracesCol();
    const limit = params.limit ?? 50;
    const offset = params.offset ?? 0;

    const filter = this.buildTraceFilter(params);

    const [docs, total] = await Promise.all([
      col.find(filter, { ...ctxOpts(), projection: { _id: 0 } })
        .sort({ start_time: -1 })
        .skip(offset)
        .limit(limit)
        .toArray(),
      col.countDocuments(filter, { ...ctxOpts() }),
    ]);

    return {
      traces: docs.map(mapDocToTraceRecord),
      total,
      hasMore: offset + docs.length < total,
      limit,
      offset,
      executionTimeMs: Date.now() - start,
    };
  }

  async getTraceById(traceId: string, projectId: string): Promise<TraceRecord | null> {
    const col = this.tracesCol();
    const doc = await col.findOne(
      { trace_id: traceId, project_id: projectId },
      { ...ctxOpts(), projection: { _id: 0 } },
    );
    return doc ? mapDocToTraceRecord(doc) : null;
  }

  async getTraceServices(projectId: string, from?: Date, to?: Date): Promise<string[]> {
    const col = this.tracesCol();
    const filter: Document = { project_id: projectId };
    if (from || to) {
      const timeFilter: Document = {};
      if (from) timeFilter.$gte = from;
      if (to) timeFilter.$lte = to;
      filter.start_time = timeFilter;
    }
    const values = await col.distinct('service_name', filter, { ...ctxOpts() });
    return (values as string[]).filter((v) => v != null && v !== '').sort();
  }

  async getServiceDependencies(
    projectId: string,
    from?: Date,
    to?: Date,
  ): Promise<ServiceDependencyResult> {
    const col = this.spansCol();

    // Client-side join for performance (O(n) vs $lookup O(n²))
    const filter: Document = {
      project_id: projectId,
      parent_span_id: { $ne: null },
    };
    if (from || to) {
      const timeFilter: Document = {};
      if (from) timeFilter.$gte = from;
      if (to) timeFilter.$lte = to;
      filter.start_time = timeFilter;
    }

    // Fetch all spans with parent references - minimal projection
    const allSpans = await col
      .find(filter, {
        ...ctxOpts(),
        projection: { span_id: 1, parent_span_id: 1, service_name: 1, trace_id: 1, _id: 0 },
      })
      .toArray();

    // Also fetch parent spans to build the spanId → serviceName map
    const parentSpanIds = [...new Set(allSpans.map((s) => s.parent_span_id).filter(Boolean))];
    if (parentSpanIds.length === 0) {
      return { nodes: [], edges: [] };
    }

    const parentSpans = await col
      .find(
        { project_id: projectId, span_id: { $in: parentSpanIds } },
        { ...ctxOpts(), projection: { span_id: 1, service_name: 1, _id: 0 } },
      )
      .toArray();

    const spanToService = new Map<string, string>();
    for (const s of parentSpans) {
      spanToService.set(String(s.span_id), String(s.service_name));
    }

    // Count cross-service edges
    const edgeMap = new Map<string, number>();
    for (const span of allSpans) {
      const parentService = spanToService.get(String(span.parent_span_id));
      const childService = String(span.service_name);
      if (parentService && parentService !== childService) {
        const key = `${parentService}→${childService}`;
        edgeMap.set(key, (edgeMap.get(key) ?? 0) + 1);
      }
    }

    const serviceCallCounts = new Map<string, number>();
    const edges: ServiceDependency[] = [];
    for (const [key, callCount] of edgeMap) {
      const [source, target] = key.split('→');
      serviceCallCounts.set(source, (serviceCallCounts.get(source) ?? 0) + callCount);
      serviceCallCounts.set(target, (serviceCallCounts.get(target) ?? 0) + callCount);
      edges.push({ source, target, callCount });
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
    const col = this.spansCol();

    const match: Document = { project_id: projectId };
    if (from || to) {
      const timeFilter: Document = {};
      if (from) timeFilter.$gte = from;
      if (to) timeFilter.$lte = to;
      match.start_time = timeFilter;
    }

    // True window p95 from raw spans via $percentile (approximate t-digest, over
    // the whole window - not a max of per-bucket percentiles). Requires Mongo 7.0+.
    const pipeline: Document[] = [
      { $match: match },
      {
        $group: {
          _id: '$service_name',
          total_calls: { $sum: 1 },
          total_errors: { $sum: { $cond: [{ $eq: ['$status_code', 'ERROR'] }, 1, 0] } },
          avg_latency_ms: { $avg: '$duration_ms' },
          p95_latency_ms: { $percentile: { input: '$duration_ms', p: [0.95], method: 'approximate' } },
        },
      },
    ];

    const rows = await col.aggregate(pipeline, { ...ctxOpts() }).toArray();

    return rows.map((r) => {
      const p95 = Array.isArray(r.p95_latency_ms) ? r.p95_latency_ms[0] : r.p95_latency_ms;
      return {
        serviceName: String(r._id),
        totalCalls: Number(r.total_calls ?? 0),
        totalErrors: Number(r.total_errors ?? 0),
        avgLatencyMs: Number(r.avg_latency_ms ?? 0),
        p95LatencyMs: p95 != null ? Number(p95) : null,
      };
    });
  }

  async getSpanTimeseries(params: SpanTimeseriesParams): Promise<SpanTimeseriesBucket[]> {
    const { projectIds, from, to, bucket, serviceName } = params;
    if (projectIds.length === 0) return [];

    const col = this.spansCol();
    const match: Document = {
      project_id: { $in: projectIds },
      start_time: { $gte: from, $lte: to },
    };
    if (serviceName) match.service_name = serviceName;

    // $dateTrunc (Mongo 5.0+) for the bucket; $percentile (Mongo 7.0+, approximate
    // t-digest) for the latency percentiles - same convention as getServiceHealthStats.
    const pipeline: Document[] = [
      { $match: match },
      {
        $group: {
          _id: { $dateTrunc: { date: '$start_time', unit: bucket, binSize: 1 } },
          span_count: { $sum: 1 },
          error_count: { $sum: { $cond: [{ $eq: ['$status_code', 'ERROR'] }, 1, 0] } },
          p: {
            $percentile: { input: '$duration_ms', p: [0.5, 0.95, 0.99], method: 'approximate' },
          },
        },
      },
      { $sort: { _id: 1 } },
    ];

    const rows = await col.aggregate(pipeline, { ...ctxOpts() }).toArray();

    return rows.map((r) => {
      const p = Array.isArray(r.p) ? r.p : [];
      return {
        time: r._id instanceof Date ? r._id : new Date(r._id as string),
        spanCount: Number(r.span_count ?? 0),
        errorCount: Number(r.error_count ?? 0),
        p50: p[0] != null ? Number(p[0]) : null,
        p95: p[1] != null ? Number(p[1]) : null,
        p99: p[2] != null ? Number(p[2]) : null,
      };
    });
  }

  async deleteSpansByTimeRange(params: DeleteSpansByTimeRangeParams): Promise<DeleteResult> {
    const start = Date.now();
    const col = this.spansCol();
    const pids = Array.isArray(params.projectId) ? params.projectId : [params.projectId];

    const filter: Document = {
      project_id: { $in: pids },
      time: { $gte: params.from, $lte: params.to },
    };

    if (params.serviceName) {
      const svc = Array.isArray(params.serviceName) ? params.serviceName : [params.serviceName];
      filter.service_name = { $in: svc };
    }

    const result = await col.deleteMany(filter, { ...ctxOpts() });
    return { deleted: result.deletedCount, executionTimeMs: Date.now() - start };
  }

  // =========================================================================
  // Metric Operations
  // =========================================================================

  async ingestMetrics(metrics: MetricRecord[]): Promise<IngestMetricsResult> {
    if (metrics.length === 0) return { ingested: 0, failed: 0, durationMs: 0 };

    const start = Date.now();
    const db = this.getDb();

    try {
      const metricDocs: Document[] = [];
      const exemplarDocs: Document[] = [];

      for (const metric of metrics) {
        const metricId = randomUUID();
        const hasExemplars = (metric.exemplars?.length ?? 0) > 0;

        metricDocs.push({
          id: metricId,
          time: metric.time,
          organization_id: metric.organizationId ?? null,
          project_id: metric.projectId,
          metric_name: metric.metricName,
          metric_type: metric.metricType,
          value: metric.value,
          is_monotonic: metric.isMonotonic ?? null,
          service_name: metric.serviceName || 'unknown',
          attributes: metric.attributes ?? null,
          resource_attributes: metric.resourceAttributes ?? null,
          histogram_data: metric.histogramData ?? null,
          has_exemplars: hasExemplars,
        });

        if (hasExemplars && metric.exemplars) {
          for (const ex of metric.exemplars) {
            exemplarDocs.push({
              id: randomUUID(),
              time: metric.time,
              metric_id: metricId,
              organization_id: metric.organizationId ?? null,
              project_id: metric.projectId,
              exemplar_value: ex.exemplarValue,
              exemplar_time: ex.exemplarTime ?? null,
              trace_id: ex.traceId ?? null,
              span_id: ex.spanId ?? null,
              attributes: ex.attributes ?? null,
            });
          }
        }
      }

      const insertOps: Promise<unknown>[] = [
        db.collection('metrics').insertMany(metricDocs, { ...ctxOpts(), ordered: false }),
      ];
      if (exemplarDocs.length > 0) {
        insertOps.push(db.collection('metric_exemplars').insertMany(exemplarDocs, { ...ctxOpts(), ordered: false }));
      }
      await Promise.all(insertOps);

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
    const db = this.getDb();
    const col = db.collection('metrics');
    const limit = params.limit ?? 50;
    const offset = params.offset ?? 0;

    const filter = this.buildMetricFilter(params);
    const sortOrder = params.sortOrder === 'asc' ? 1 : -1;

    const [docs, total] = await Promise.all([
      col.find(filter, { ...ctxOpts(), projection: { _id: 0 } })
        .sort({ time: sortOrder })
        .skip(offset)
        .limit(limit)
        .toArray(),
      col.countDocuments(filter, { ...ctxOpts() }),
    ]);

    let metricsResult = docs.map(mapDocToStoredMetricRecord);

    // Fetch exemplars if requested
    if (params.includeExemplars) {
      const metricIds = metricsResult.filter((m) => m.hasExemplars).map((m) => m.id);
      if (metricIds.length > 0) {
        const exemplarDocs = await db
          .collection('metric_exemplars')
          .find({ metric_id: { $in: metricIds } }, { ...ctxOpts(), projection: { _id: 0 } })
          .sort({ time: 1 })
          .toArray();

        const exemplarsByMetricId = new Map<string, MetricExemplar[]>();
        for (const doc of exemplarDocs) {
          const metricId = String(doc.metric_id);
          if (!exemplarsByMetricId.has(metricId)) {
            exemplarsByMetricId.set(metricId, []);
          }
          exemplarsByMetricId.get(metricId)!.push({
            exemplarValue: Number(doc.exemplar_value),
            exemplarTime: doc.exemplar_time ? new Date(doc.exemplar_time) : undefined,
            traceId: doc.trace_id ? String(doc.trace_id) : undefined,
            spanId: doc.span_id ? String(doc.span_id) : undefined,
            attributes: doc.attributes as Record<string, unknown> | undefined,
          });
        }

        metricsResult = metricsResult.map((m) => ({
          ...m,
          exemplars: exemplarsByMetricId.get(m.id) ?? m.exemplars,
        }));
      }
    }

    return {
      metrics: metricsResult,
      total,
      hasMore: offset + docs.length < total,
      limit,
      offset,
      executionTimeMs: Date.now() - start,
    };
  }

  async aggregateMetrics(params: MetricAggregateParams): Promise<MetricAggregateResult> {
    const start = Date.now();
    const db = this.getDb();
    const col = db.collection('metrics');

    const filter = this.buildMetricAggFilter(params);
    const intervalMs = INTERVAL_MS[params.interval];

    const bucketExpr = this.buildBucketExpr(params.interval, intervalMs);

    const groupId: Document = { bucket: bucketExpr };
    if (params.groupBy && params.groupBy.length > 0) {
      for (const key of params.groupBy) {
        groupId[`label_${key}`] = `$attributes.${key}`;
      }
    }

    const aggExpr = AGG_ACCUMULATORS[params.aggregation] ?? AGG_ACCUMULATORS.avg;

    const pipeline: Document[] = [{ $match: filter }];

    // $last requires sorted input - must come after $match for index usage
    if (params.aggregation === 'last') {
      pipeline.push({ $sort: { time: 1 } });
    }

    const isPercentile = params.aggregation in PERCENTILE_FRACTIONS;

    pipeline.push(
      { $group: { _id: groupId, agg_value: aggExpr } },
    );

    // For percentile aggregations, sort the collected values and pick the nth element
    if (isPercentile) {
      const fraction = PERCENTILE_FRACTIONS[params.aggregation];
      pipeline.push({
        $addFields: {
          agg_value: {
            $let: {
              vars: {
                sorted: { $sortArray: { input: '$agg_value', sortBy: 1 } },
              },
              in: {
                $arrayElemAt: [
                  '$$sorted',
                  { $floor: { $multiply: [fraction, { $size: '$$sorted' }] } },
                ],
              },
            },
          },
        },
      });
    }

    pipeline.push({ $sort: { '_id.bucket': 1 } });

    const rows = await col.aggregate(pipeline, { ...ctxOpts(), allowDiskUse: true }).toArray();

    const timeseries = rows.map((row) => {
      const bucket: { bucket: Date; value: number; labels?: Record<string, string> } = {
        bucket: row._id.bucket instanceof Date ? row._id.bucket : new Date(row._id.bucket),
        value: Number(row.agg_value),
      };

      if (params.groupBy && params.groupBy.length > 0) {
        const labels: Record<string, string> = {};
        for (const key of params.groupBy) {
          labels[key] = String(row._id[`label_${key}`] ?? '');
        }
        bucket.labels = labels;
      }

      return bucket;
    });

    // Determine metricType
    let metricType: MetricType = params.metricType ?? 'gauge';
    if (!params.metricType) {
      const pids = Array.isArray(params.projectId) ? params.projectId : [params.projectId];
      const sample = await col.findOne(
        { metric_name: params.metricName, project_id: { $in: pids } },
        { ...ctxOpts(), projection: { metric_type: 1, _id: 0 } },
      );
      if (sample?.metric_type) {
        metricType = sample.metric_type as MetricType;
      }
    }

    return {
      metricName: params.metricName,
      metricType,
      timeseries,
      executionTimeMs: Date.now() - start,
    };
  }

  async getMetricNames(params: MetricNamesParams): Promise<MetricNamesResult> {
    const start = Date.now();
    const db = this.getDb();
    const col = db.collection('metrics');
    const limit = params.limit ?? 1000;

    const filter = this.buildMetricNamesFilter(params);

    const pipeline: Document[] = [
      { $match: filter },
      { $group: { _id: { name: '$metric_name', type: '$metric_type' } } },
      { $sort: { '_id.name': 1 } },
      { $limit: limit },
      { $project: { name: '$_id.name', type: '$_id.type', _id: 0 } },
    ];

    const rows = await col.aggregate(pipeline, { ...ctxOpts() }).toArray();

    return {
      names: rows.map((row) => ({
        name: String(row.name),
        type: String(row.type) as MetricType,
      })),
      executionTimeMs: Date.now() - start,
    };
  }

  async getMetricLabelKeys(params: MetricLabelParams): Promise<MetricLabelResult> {
    const start = Date.now();
    const db = this.getDb();
    const col = db.collection('metrics');
    const limit = params.limit ?? 100;

    const filter = this.buildMetricLabelFilter(params);

    const pipeline: Document[] = [
      { $match: filter },
      { $project: { keys: { $objectToArray: { $ifNull: ['$attributes', {}] } } } },
      { $unwind: '$keys' },
      { $group: { _id: '$keys.k' } },
      { $sort: { _id: 1 } },
      { $limit: limit },
    ];

    const rows = await col.aggregate(pipeline, { ...ctxOpts() }).toArray();

    return {
      keys: rows.map((r) => String(r._id)),
      executionTimeMs: Date.now() - start,
    };
  }

  async getMetricLabelValues(params: MetricLabelParams, labelKey: string): Promise<MetricLabelResult> {
    const start = Date.now();
    const db = this.getDb();
    const col = db.collection('metrics');
    const limit = params.limit ?? 100;

    const filter = this.buildMetricLabelFilter(params);

    const pipeline: Document[] = [
      { $match: filter },
      { $group: { _id: `$attributes.${labelKey}` } },
      { $match: { _id: { $nin: [null, ''] } } },
      { $sort: { _id: 1 } },
      { $limit: limit },
    ];

    const rows = await col.aggregate(pipeline, { ...ctxOpts() }).toArray();

    return {
      values: rows.map((r) => String(r._id)),
      executionTimeMs: Date.now() - start,
    };
  }

  async deleteMetricsByTimeRange(params: DeleteMetricsByTimeRangeParams): Promise<DeleteResult> {
    const start = Date.now();
    const db = this.getDb();
    const pids = Array.isArray(params.projectId) ? params.projectId : [params.projectId];

    const filter: Document = {
      project_id: { $in: pids },
      time: { $gte: params.from, $lte: params.to },
    };

    if (params.metricName) {
      const names = Array.isArray(params.metricName) ? params.metricName : [params.metricName];
      filter.metric_name = { $in: names };
    }
    if (params.serviceName) {
      const svc = Array.isArray(params.serviceName) ? params.serviceName : [params.serviceName];
      filter.service_name = { $in: svc };
    }

    // When filtering by metric/service, only the matching metrics' exemplars must
    // be removed. Exemplars carry no metric_name/service_name, only metric_id, so
    // collect the matching metric ids before deleting the metrics.
    const filtered = params.metricName !== undefined || params.serviceName !== undefined;
    let exemplarFilter: Document;
    if (filtered) {
      const matched = await db
        .collection('metrics')
        .find(filter, { projection: { id: 1 }, ...ctxOpts() })
        .toArray();
      const ids = matched.map((m) => m.id);
      exemplarFilter = { metric_id: { $in: ids } };
    } else {
      exemplarFilter = {
        project_id: { $in: pids },
        time: { $gte: params.from, $lte: params.to },
      };
    }

    // Delete metrics
    const result = await db.collection('metrics').deleteMany(filter, { ...ctxOpts() });

    // Delete the corresponding exemplars (scoped to the matching metrics when filtered).
    if (!filtered || (exemplarFilter.metric_id as { $in: unknown[] }).$in.length > 0) {
      await db.collection('metric_exemplars').deleteMany(exemplarFilter, { ...ctxOpts() });
    }

    return { deleted: result.deletedCount, executionTimeMs: Date.now() - start };
  }

  async getMetricsOverview(params: MetricsOverviewParams): Promise<MetricsOverviewResult> {
    const start = Date.now();
    const db = this.getDb();
    const projectIds = Array.isArray(params.projectId) ? params.projectId : [params.projectId];

    const match: Record<string, unknown> = {
      project_id: { $in: projectIds },
      time: { $gte: params.from, $lte: params.to },
    };
    if (params.serviceName) match.service_name = params.serviceName;

    const pipeline = [
      { $match: match },
      // $last is order-dependent, so sort by time first to make latest_value the
      // value at the most recent timestamp (otherwise it is arbitrary).
      { $sort: { time: 1 as const } },
      {
        $group: {
          _id: {
            metric_name: '$metric_name',
            metric_type: '$metric_type',
            service_name: '$service_name',
          },
          point_count: { $sum: 1 },
          avg_value: { $avg: '$value' },
          min_value: { $min: '$value' },
          max_value: { $max: '$value' },
          latest_value: { $last: '$value' },
        },
      },
      { $sort: { '_id.service_name': 1 as const, '_id.metric_name': 1 as const } },
    ];

    const cursor = db.collection('metrics').aggregate(pipeline, { ...ctxOpts(), allowDiskUse: true });
    const docs = await cursor.toArray();

    const serviceMap = new Map<string, MetricOverviewItem[]>();
    for (const doc of docs) {
      const serviceName = doc._id.service_name as string;
      const item: MetricOverviewItem = {
        metricName: doc._id.metric_name as string,
        metricType: (doc._id.metric_type as MetricType) || 'gauge',
        serviceName,
        latestValue: Number(doc.latest_value) ?? 0,
        avgValue: Number(doc.avg_value) ?? 0,
        minValue: Number(doc.min_value) ?? 0,
        maxValue: Number(doc.max_value) ?? 0,
        pointCount: Number(doc.point_count) ?? 0,
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

  // =========================================================================
  // Private helpers
  // =========================================================================

  private getDb(): Db {
    if (this.options?.db) return this.options.db;
    if (!this.mongoClient) {
      throw new Error('Not connected. Call connect() first.');
    }
    return this.mongoClient.db(this.options.dbName ?? this.config.database);
  }

  private logsCol(): Collection<Document> {
    return this.getDb().collection(this.tableName);
  }

  private spansCol(): Collection<Document> {
    return this.getDb().collection('spans');
  }

  private tracesCol(): Collection<Document> {
    return this.getDb().collection('traces');
  }

  private async ensureLogsCollection(db: Db): Promise<void> {
    const existing = await db.listCollections({ name: this.tableName }).toArray();
    if (existing.length > 0) return;

    if (this.useTimeSeries) {
      try {
        await db.createCollection(this.tableName, {
          timeseries: {
            timeField: 'time',
            metaField: 'project_id',
            granularity: 'seconds',
          },
        });
        return;
      } catch {
        // Time-series creation failed - fallback to regular collection
        this.useTimeSeries = false;
      }
    }

    await db.createCollection(this.tableName);
  }

  private async ensureCollection(db: Db, name: string): Promise<void> {
    const existing = await db.listCollections({ name }).toArray();
    if (existing.length === 0) {
      await db.createCollection(name);
    }
  }

  private async createLogsIndexes(db: Db): Promise<void> {
    const col = db.collection(this.tableName);

    await safeCreateIndex(col, { project_id: 1, time: -1 }, 'idx_project_time');
    await safeCreateIndex(col, { id: 1, project_id: 1 }, 'idx_id_project');
    await safeCreateIndex(col, { trace_id: 1, project_id: 1 }, 'idx_trace_project', { sparse: true });
    await safeCreateIndex(col, { span_id: 1, project_id: 1 }, 'idx_span_project', { sparse: true });

    // Compound indexes for filtered queries
    await safeCreateIndex(col, { project_id: 1, service: 1, time: -1 }, 'idx_project_service_time');
    await safeCreateIndex(col, { project_id: 1, level: 1, time: -1 }, 'idx_project_level_time');
    await safeCreateIndex(col, { project_id: 1, service: 1, level: 1, time: -1 }, 'idx_project_service_level_time');
    // hostname is stored in metadata.hostname (nested), not top-level - index accordingly.
    // The top-level `hostname` field is always null (ingestion puts it in metadata).
    await safeCreateIndex(col, { 'metadata.hostname': 1, project_id: 1, time: -1 }, 'idx_project_metadata_hostname_time', { sparse: true });

    // Text index for $text search (not supported on time-series timeField/metaField)
    if (!this.useTimeSeries) {
      await safeCreateIndex(col, { message: 'text' }, 'idx_message_text');
    }
  }

  private async createSpansIndexes(db: Db): Promise<void> {
    const col = db.collection('spans');
    await safeCreateIndex(col, { project_id: 1, trace_id: 1, start_time: 1 }, 'idx_span_trace');
    await safeCreateIndex(col, { project_id: 1, time: -1 }, 'idx_span_time');
    await safeCreateIndex(col, { span_id: 1, project_id: 1 }, 'idx_span_id');
    await safeCreateIndex(col, { parent_span_id: 1, trace_id: 1 }, 'idx_span_parent', { sparse: true });

    // Compound indexes for filtered span queries
    await safeCreateIndex(col, { project_id: 1, service_name: 1, time: -1 }, 'idx_span_service_time');
    await safeCreateIndex(col, { project_id: 1, service_name: 1, status_code: 1, time: -1 }, 'idx_span_service_status_time');
  }

  private async createTracesIndexes(db: Db): Promise<void> {
    const col = db.collection('traces');
    await safeCreateIndex(col, { trace_id: 1, project_id: 1 }, 'idx_trace_key', { unique: true });
    await safeCreateIndex(col, { project_id: 1, start_time: -1 }, 'idx_trace_time');

    // Compound indexes for filtered trace queries
    await safeCreateIndex(col, { project_id: 1, error: 1, start_time: -1 }, 'idx_trace_error_time');
    await safeCreateIndex(col, { project_id: 1, duration_ms: -1, start_time: -1 }, 'idx_trace_duration_time');
  }

  private async createMetricsIndexes(db: Db): Promise<void> {
    const metricsCol = db.collection('metrics');
    await safeCreateIndex(metricsCol, { project_id: 1, metric_name: 1, time: -1 }, 'idx_metric_name_time');
    await safeCreateIndex(metricsCol, { project_id: 1, time: -1 }, 'idx_metric_time');
    await safeCreateIndex(metricsCol, { id: 1 }, 'idx_metric_id');

    // Compound index for metric queries with service filter
    await safeCreateIndex(metricsCol, { project_id: 1, metric_name: 1, service_name: 1, time: -1 }, 'idx_metric_name_service_time');

    const exemplarCol = db.collection('metric_exemplars');
    await safeCreateIndex(exemplarCol, { metric_id: 1 }, 'idx_exemplar_metric');
    await safeCreateIndex(exemplarCol, { project_id: 1, time: -1 }, 'idx_exemplar_time');
  }

  private buildSpanFilter(params: SpanQueryParams): Document {
    const filter: Document = {};

    if (params.projectId) {
      const pids = Array.isArray(params.projectId) ? params.projectId : [params.projectId];
      filter.project_id = pids.length === 1 ? pids[0] : { $in: pids };
    }

    const timeFilter: Document = {};
    timeFilter[params.fromExclusive ? '$gt' : '$gte'] = params.from;
    timeFilter[params.toExclusive ? '$lt' : '$lte'] = params.to;
    filter.time = timeFilter;

    if (params.traceId) {
      const tids = Array.isArray(params.traceId) ? params.traceId : [params.traceId];
      filter.trace_id = tids.length === 1 ? tids[0] : { $in: tids };
    }
    if (params.serviceName) {
      const svc = Array.isArray(params.serviceName) ? params.serviceName : [params.serviceName];
      filter.service_name = svc.length === 1 ? svc[0] : { $in: svc };
    }
    if (params.kind) {
      const k = Array.isArray(params.kind) ? params.kind : [params.kind];
      filter.kind = k.length === 1 ? k[0] : { $in: k };
    }
    if (params.statusCode) {
      const sc = Array.isArray(params.statusCode) ? params.statusCode : [params.statusCode];
      filter.status_code = sc.length === 1 ? sc[0] : { $in: sc };
    }

    return filter;
  }

  private buildTraceFilter(params: TraceQueryParams): Document {
    const filter: Document = {};

    if (params.projectId) {
      const pids = Array.isArray(params.projectId) ? params.projectId : [params.projectId];
      filter.project_id = pids.length === 1 ? pids[0] : { $in: pids };
    }

    filter.start_time = { $gte: params.from, $lte: params.to };

    if (params.organizationId) {
      const oids = Array.isArray(params.organizationId) ? params.organizationId : [params.organizationId];
      filter.organization_id = oids.length === 1 ? oids[0] : { $in: oids };
    }
    if (params.serviceName) {
      const svc = Array.isArray(params.serviceName) ? params.serviceName : [params.serviceName];
      filter.service_name = svc.length === 1 ? svc[0] : { $in: svc };
    }
    if (params.error !== undefined) {
      filter.error = params.error;
    }
    if (params.minDurationMs !== undefined) {
      filter.duration_ms = { ...filter.duration_ms, $gte: params.minDurationMs };
    }
    if (params.maxDurationMs !== undefined) {
      filter.duration_ms = { ...filter.duration_ms, $lte: params.maxDurationMs };
    }

    return filter;
  }

  private buildMetricFilter(params: MetricQueryParams): Document {
    const pids = Array.isArray(params.projectId) ? params.projectId : [params.projectId];
    const filter: Document = {
      project_id: pids.length === 1 ? pids[0] : { $in: pids },
    };

    const timeFilter: Document = {};
    timeFilter[params.fromExclusive ? '$gt' : '$gte'] = params.from;
    timeFilter[params.toExclusive ? '$lt' : '$lte'] = params.to;
    filter.time = timeFilter;

    if (params.organizationId) {
      const oids = Array.isArray(params.organizationId) ? params.organizationId : [params.organizationId];
      filter.organization_id = oids.length === 1 ? oids[0] : { $in: oids };
    }
    if (params.metricName) {
      const names = Array.isArray(params.metricName) ? params.metricName : [params.metricName];
      filter.metric_name = names.length === 1 ? names[0] : { $in: names };
    }
    if (params.metricType) {
      const types = Array.isArray(params.metricType) ? params.metricType : [params.metricType];
      filter.metric_type = types.length === 1 ? types[0] : { $in: types };
    }
    if (params.serviceName) {
      const svc = Array.isArray(params.serviceName) ? params.serviceName : [params.serviceName];
      filter.service_name = svc.length === 1 ? svc[0] : { $in: svc };
    }

    // Attribute label filtering
    if (params.attributes) {
      for (const [key, val] of Object.entries(params.attributes)) {
        filter[`attributes.${key}`] = val;
      }
    }

    return filter;
  }

  private buildMetricAggFilter(params: MetricAggregateParams): Document {
    const pids = Array.isArray(params.projectId) ? params.projectId : [params.projectId];
    const filter: Document = {
      project_id: pids.length === 1 ? pids[0] : { $in: pids },
      metric_name: params.metricName,
      time: { $gte: params.from, $lte: params.to },
    };

    if (params.organizationId) {
      const oids = Array.isArray(params.organizationId) ? params.organizationId : [params.organizationId];
      filter.organization_id = oids.length === 1 ? oids[0] : { $in: oids };
    }
    if (params.metricType) {
      filter.metric_type = params.metricType;
    }
    if (params.serviceName) {
      const svc = Array.isArray(params.serviceName) ? params.serviceName : [params.serviceName];
      filter.service_name = svc.length === 1 ? svc[0] : { $in: svc };
    }
    if (params.attributes) {
      for (const [key, val] of Object.entries(params.attributes)) {
        filter[`attributes.${key}`] = val;
      }
    }

    return filter;
  }

  private buildMetricNamesFilter(params: MetricNamesParams): Document {
    const pids = Array.isArray(params.projectId) ? params.projectId : [params.projectId];
    const filter: Document = {
      project_id: pids.length === 1 ? pids[0] : { $in: pids },
    };

    if (params.organizationId) {
      const oids = Array.isArray(params.organizationId) ? params.organizationId : [params.organizationId];
      filter.organization_id = oids.length === 1 ? oids[0] : { $in: oids };
    }
    if (params.metricType) {
      const types = Array.isArray(params.metricType) ? params.metricType : [params.metricType];
      filter.metric_type = types.length === 1 ? types[0] : { $in: types };
    }
    if (params.from) {
      filter.time = { ...filter.time, $gte: params.from };
    }
    if (params.to) {
      filter.time = { ...filter.time, $lte: params.to };
    }

    return filter;
  }

  private buildMetricLabelFilter(params: MetricLabelParams): Document {
    const pids = Array.isArray(params.projectId) ? params.projectId : [params.projectId];
    const filter: Document = {
      project_id: pids.length === 1 ? pids[0] : { $in: pids },
      metric_name: params.metricName,
    };

    if (params.organizationId) {
      const oids = Array.isArray(params.organizationId) ? params.organizationId : [params.organizationId];
      filter.organization_id = oids.length === 1 ? oids[0] : { $in: oids };
    }
    if (params.from) {
      filter.time = { ...filter.time, $gte: params.from };
    }
    if (params.to) {
      filter.time = { ...filter.time, $lte: params.to };
    }

    return filter;
  }
}

// =============================================================================
// Document mappers (module-level pure functions)
// =============================================================================

function toMongoLogDoc(log: LogRecord, id: string): Document {
  return {
    id,
    time: log.time,
    project_id: log.projectId,
    organization_id: log.organizationId ?? null,
    service: log.service,
    level: log.level,
    message: log.message,
    metadata: log.metadata ?? null,
    trace_id: log.traceId ?? null,
    span_id: log.spanId ?? null,
    session_id: log.sessionId ?? null,
    hostname: log.hostname ?? null,
  };
}

function toMongoSpanDoc(span: SpanRecord): Document {
  return {
    time: span.time,
    span_id: span.spanId,
    trace_id: span.traceId,
    parent_span_id: span.parentSpanId ?? null,
    organization_id: span.organizationId ?? null,
    project_id: span.projectId,
    service_name: span.serviceName,
    operation_name: span.operationName,
    start_time: span.startTime,
    end_time: span.endTime,
    duration_ms: span.durationMs,
    kind: span.kind ?? null,
    status_code: span.statusCode ?? null,
    status_message: span.statusMessage ?? null,
    attributes: span.attributes ?? null,
    events: span.events ?? null,
    links: span.links ?? null,
    resource_attributes: span.resourceAttributes ?? null,
  };
}

function mapDocToStoredLogRecord(doc: Document): StoredLogRecord {
  return {
    id: String(doc.id),
    time: doc.time instanceof Date ? doc.time : new Date(doc.time),
    projectId: String(doc.project_id),
    organizationId: doc.organization_id ? String(doc.organization_id) : undefined,
    service: String(doc.service),
    level: String(doc.level) as LogLevel,
    message: String(doc.message),
    metadata: doc.metadata as Record<string, unknown> | undefined ?? undefined,
    traceId: doc.trace_id ? String(doc.trace_id) : undefined,
    spanId: doc.span_id ? String(doc.span_id) : undefined,
    sessionId: doc.session_id ? String(doc.session_id) : undefined,
    hostname: doc.hostname ? String(doc.hostname) : undefined,
  };
}

function mapDocToSpanRecord(doc: Document): SpanRecord {
  return {
    time: doc.time instanceof Date ? doc.time : new Date(doc.time),
    spanId: String(doc.span_id),
    traceId: String(doc.trace_id),
    parentSpanId: doc.parent_span_id ? String(doc.parent_span_id) : undefined,
    organizationId: doc.organization_id ? String(doc.organization_id) : undefined,
    projectId: String(doc.project_id),
    serviceName: String(doc.service_name),
    operationName: String(doc.operation_name),
    startTime: doc.start_time instanceof Date ? doc.start_time : new Date(doc.start_time),
    endTime: doc.end_time instanceof Date ? doc.end_time : new Date(doc.end_time),
    durationMs: Number(doc.duration_ms),
    kind: doc.kind ? (String(doc.kind) as SpanKind) : undefined,
    statusCode: doc.status_code ? (String(doc.status_code) as SpanStatusCode) : undefined,
    statusMessage: doc.status_message ? String(doc.status_message) : undefined,
    attributes: doc.attributes as Record<string, unknown> | undefined ?? undefined,
    events: doc.events as Array<Record<string, unknown>> | undefined ?? undefined,
    links: doc.links as Array<Record<string, unknown>> | undefined ?? undefined,
    resourceAttributes: doc.resource_attributes as Record<string, unknown> | undefined ?? undefined,
  };
}

function mapDocToTraceRecord(doc: Document): TraceRecord {
  return {
    traceId: String(doc.trace_id),
    organizationId: doc.organization_id ? String(doc.organization_id) : undefined,
    projectId: String(doc.project_id),
    serviceName: String(doc.service_name),
    rootServiceName: doc.root_service_name ? String(doc.root_service_name) : undefined,
    rootOperationName: doc.root_operation_name ? String(doc.root_operation_name) : undefined,
    startTime: doc.start_time instanceof Date ? doc.start_time : new Date(doc.start_time),
    endTime: doc.end_time instanceof Date ? doc.end_time : new Date(doc.end_time),
    durationMs: Number(doc.duration_ms),
    spanCount: Number(doc.span_count),
    error: !!doc.error,
  };
}

function mapDocToStoredMetricRecord(doc: Document): StoredMetricRecord {
  return {
    id: String(doc.id),
    time: doc.time instanceof Date ? doc.time : new Date(doc.time),
    organizationId: doc.organization_id ? String(doc.organization_id) : '',
    projectId: String(doc.project_id),
    metricName: String(doc.metric_name),
    metricType: String(doc.metric_type) as MetricType,
    value: Number(doc.value),
    isMonotonic: doc.is_monotonic != null ? !!doc.is_monotonic : undefined,
    serviceName: String(doc.service_name),
    attributes: doc.attributes as Record<string, unknown> | undefined ?? undefined,
    resourceAttributes: doc.resource_attributes as Record<string, unknown> | undefined ?? undefined,
    histogramData: doc.histogram_data ?? undefined,
    hasExemplars: !!doc.has_exemplars,
  };
}

function extractWriteErrors(err: MongoBulkWriteError): Array<{ index: number; error: string }> {
  const errors = err.writeErrors;
  if (!errors) return [];
  const arr = Array.isArray(errors) ? errors : [errors];
  return arr.map((e: WriteError) => ({ index: e.index, error: e.errmsg ?? String(e) }));
}

async function safeCreateIndex(
  col: Collection<Document>,
  spec: Document,
  name: string,
  options?: { unique?: boolean; sparse?: boolean },
): Promise<void> {
  try {
    await col.createIndex(spec, { name, ...options });
  } catch {
    // Index may already exist or be incompatible - skip silently
  }
}
