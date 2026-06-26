import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { MongoClient } from 'mongodb';
import { MongoDBEngine } from './mongodb-engine.js';
import type { LogRecord, SpanRecord, TraceRecord, MetricRecord, StorageConfig } from '../../core/types.js';

const TEST_CONFIG: StorageConfig = {
  host: 'localhost',
  port: 27017,
  database: 'logtide_integration_test',
  username: '',
  password: '',
};

function makeLog(overrides: Partial<LogRecord> = {}): LogRecord {
  return {
    time: new Date('2025-01-15T12:00:00Z'),
    projectId: 'proj-1',
    service: 'api',
    level: 'info',
    message: 'test log message',
    metadata: { hostname: 'server-1', env: 'test' },
    traceId: 'trace-abc',
    spanId: 'span-123',
    ...overrides,
  };
}

function makeSpan(overrides: Partial<SpanRecord> = {}): SpanRecord {
  return {
    time: new Date('2025-01-15T12:00:00Z'),
    spanId: `span-${Math.random().toString(36).slice(2, 10)}`,
    traceId: 'trace-abc',
    projectId: 'proj-1',
    serviceName: 'api',
    operationName: 'GET /users',
    startTime: new Date('2025-01-15T12:00:00Z'),
    endTime: new Date('2025-01-15T12:00:01Z'),
    durationMs: 1000,
    ...overrides,
  };
}

function makeTrace(overrides: Partial<TraceRecord> = {}): TraceRecord {
  return {
    traceId: 'trace-abc',
    projectId: 'proj-1',
    serviceName: 'api',
    startTime: new Date('2025-01-15T12:00:00Z'),
    endTime: new Date('2025-01-15T12:00:05Z'),
    durationMs: 5000,
    spanCount: 3,
    error: false,
    ...overrides,
  };
}

function makeMetric(overrides: Partial<MetricRecord> = {}): MetricRecord {
  return {
    time: new Date('2025-01-15T12:00:00Z'),
    organizationId: 'org-1',
    projectId: 'proj-1',
    metricName: 'http.request.duration',
    metricType: 'gauge',
    value: 42.5,
    serviceName: 'api',
    ...overrides,
  };
}

describe('MongoDBEngine (integration)', () => {
  let engine: MongoDBEngine;
  let directClient: MongoClient;
  let available = false;

  beforeAll(async () => {
    // Probe MongoDB availability
    const url = `mongodb://${TEST_CONFIG.host}:${TEST_CONFIG.port}/${TEST_CONFIG.database}`;
    directClient = new MongoClient(url, { serverSelectionTimeoutMS: 3000 });

    try {
      await directClient.connect();
      await directClient.db().command({ ping: 1 });
    } catch {
      console.warn(`MongoDB not available at ${TEST_CONFIG.host}:${TEST_CONFIG.port} - skipping integration tests`);
      try { await directClient.close(); } catch { /* ignore */ }
      return;
    }

    engine = new MongoDBEngine(TEST_CONFIG, { tableName: 'test_logs', skipInitialize: false });
    await engine.connect();
    await engine.initialize();
    available = true;
  }, 30_000);

  afterAll(async () => {
    if (!available) return;
    try {
      const db = directClient.db(TEST_CONFIG.database);
      await db.dropDatabase();
    } catch { /* ignore */ }
    await engine.disconnect();
    await directClient.close();
  });

  beforeEach(async ({ skip }) => {
    if (!available) return skip();
    // Clear all user collections before each test
    const db = directClient.db(TEST_CONFIG.database);
    const collections = await db.listCollections().toArray();
    for (const col of collections) {
      if (col.name.startsWith('system.')) continue;
      await db.collection(col.name).deleteMany({});
    }
  });

  // =========================================================================
  // Health & Lifecycle
  // =========================================================================

  describe('healthCheck', () => {
    it('returns healthy status', async () => {
      const health = await engine.healthCheck();
      expect(health.status).toBe('healthy');
      expect(health.engine).toBe('mongodb');
      expect(health.connected).toBe(true);
    });
  });

  describe('getCapabilities', () => {
    it('returns mongodb capabilities', () => {
      const caps = engine.getCapabilities();
      expect(caps.engine).toBe('mongodb');
      expect(caps.supportsFullTextSearch).toBe(true);
      expect(caps.supportsAggregations).toBe(true);
      expect(caps.supportsTransactions).toBe(true);
      expect(caps.maxBatchSize).toBe(100_000);
      expect(caps.nativeCompression).toBe(true);
    });
  });

  // =========================================================================
  // Log Ingestion
  // =========================================================================

  describe('ingest', () => {
    it('ingests a batch of logs', async () => {
      const logs = [makeLog(), makeLog({ service: 'worker', level: 'error' })];
      const result = await engine.ingest(logs);

      expect(result.ingested).toBe(2);
      expect(result.failed).toBe(0);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('returns empty result for empty batch', async () => {
      const result = await engine.ingest([]);
      expect(result.ingested).toBe(0);
      expect(result.failed).toBe(0);
    });
  });

  describe('ingestReturning', () => {
    it('ingests and returns records with generated IDs', async () => {
      const logs = [makeLog(), makeLog({ message: 'second log' })];
      const result = await engine.ingestReturning(logs);

      expect(result.ingested).toBe(2);
      expect(result.rows).toHaveLength(2);
      expect(result.rows[0].id).toBeTruthy();
      expect(result.rows[1].id).toBeTruthy();
      expect(result.rows[0].id).not.toBe(result.rows[1].id);
      expect(result.rows[0].service).toBe('api');
      expect(result.rows[1].message).toBe('second log');
    });

    it('returns empty rows for empty batch', async () => {
      const result = await engine.ingestReturning([]);
      expect(result.rows).toHaveLength(0);
    });
  });

  // =========================================================================
  // Log Queries
  // =========================================================================

  describe('query', () => {
    beforeEach(async () => {
      const logs = [
        makeLog({ time: new Date('2025-01-15T10:00:00Z'), service: 'api', level: 'info', message: 'request started' }),
        makeLog({ time: new Date('2025-01-15T11:00:00Z'), service: 'api', level: 'error', message: 'request failed with timeout' }),
        makeLog({ time: new Date('2025-01-15T12:00:00Z'), service: 'worker', level: 'warn', message: 'queue backlog growing' }),
        makeLog({ time: new Date('2025-01-15T13:00:00Z'), service: 'api', level: 'info', message: 'request completed' }),
        makeLog({ time: new Date('2025-01-15T14:00:00Z'), service: 'worker', level: 'error', message: 'worker crashed unexpectedly', projectId: 'proj-2' }),
      ];
      await engine.ingest(logs);
    });

    it('queries all logs within time range', async () => {
      const result = await engine.query({
        projectId: 'proj-1',
        from: new Date('2025-01-15T00:00:00Z'),
        to: new Date('2025-01-16T00:00:00Z'),
      });

      expect(result.logs).toHaveLength(4);
      expect(result.hasMore).toBe(false);
    });

    it('filters by service', async () => {
      const result = await engine.query({
        projectId: 'proj-1',
        service: 'worker',
        from: new Date('2025-01-15T00:00:00Z'),
        to: new Date('2025-01-16T00:00:00Z'),
      });

      expect(result.logs).toHaveLength(1);
      expect(result.logs[0].service).toBe('worker');
    });

    it('filters by level', async () => {
      const result = await engine.query({
        projectId: 'proj-1',
        level: 'error',
        from: new Date('2025-01-15T00:00:00Z'),
        to: new Date('2025-01-16T00:00:00Z'),
      });

      expect(result.logs).toHaveLength(1);
      expect(result.logs[0].level).toBe('error');
    });

    it('filters by project', async () => {
      const result = await engine.query({
        projectId: 'proj-2',
        from: new Date('2025-01-15T00:00:00Z'),
        to: new Date('2025-01-16T00:00:00Z'),
      });

      expect(result.logs).toHaveLength(1);
      expect(result.logs[0].projectId).toBe('proj-2');
    });

    it('orders by time DESC by default', async () => {
      const result = await engine.query({
        projectId: 'proj-1',
        from: new Date('2025-01-15T00:00:00Z'),
        to: new Date('2025-01-16T00:00:00Z'),
      });

      const times = result.logs.map((l) => l.time.getTime());
      for (let i = 1; i < times.length; i++) {
        expect(times[i]).toBeLessThanOrEqual(times[i - 1]);
      }
    });

    it('supports sortOrder asc', async () => {
      const result = await engine.query({
        projectId: 'proj-1',
        from: new Date('2025-01-15T00:00:00Z'),
        to: new Date('2025-01-16T00:00:00Z'),
        sortOrder: 'asc',
      });

      const times = result.logs.map((l) => l.time.getTime());
      for (let i = 1; i < times.length; i++) {
        expect(times[i]).toBeGreaterThanOrEqual(times[i - 1]);
      }
    });

    it('supports limit and hasMore', async () => {
      const result = await engine.query({
        projectId: 'proj-1',
        from: new Date('2025-01-15T00:00:00Z'),
        to: new Date('2025-01-16T00:00:00Z'),
        limit: 2,
      });

      expect(result.logs).toHaveLength(2);
      expect(result.hasMore).toBe(true);
      expect(result.nextCursor).toBeTruthy();
    });

    it('supports cursor pagination', async () => {
      const page1 = await engine.query({
        projectId: 'proj-1',
        from: new Date('2025-01-15T00:00:00Z'),
        to: new Date('2025-01-16T00:00:00Z'),
        limit: 2,
      });

      expect(page1.logs).toHaveLength(2);
      expect(page1.nextCursor).toBeTruthy();

      const page2 = await engine.query({
        projectId: 'proj-1',
        from: new Date('2025-01-15T00:00:00Z'),
        to: new Date('2025-01-16T00:00:00Z'),
        limit: 2,
        cursor: page1.nextCursor!,
      });

      expect(page2.logs).toHaveLength(2);
      // Pages should not overlap
      const page1Ids = page1.logs.map((l) => l.id);
      const page2Ids = page2.logs.map((l) => l.id);
      for (const id of page2Ids) {
        expect(page1Ids).not.toContain(id);
      }
    });

    it('supports substring search', async () => {
      const result = await engine.query({
        projectId: 'proj-1',
        from: new Date('2025-01-15T00:00:00Z'),
        to: new Date('2025-01-16T00:00:00Z'),
        search: 'timeout',
        searchMode: 'substring',
      });

      expect(result.logs).toHaveLength(1);
      expect(result.logs[0].message).toContain('timeout');
    });

    it('supports multiple level filter', async () => {
      const result = await engine.query({
        projectId: 'proj-1',
        level: ['error', 'warn'],
        from: new Date('2025-01-15T00:00:00Z'),
        to: new Date('2025-01-16T00:00:00Z'),
      });

      expect(result.logs).toHaveLength(2);
      for (const log of result.logs) {
        expect(['error', 'warn']).toContain(log.level);
      }
    });

    it('filters by hostname in metadata', async () => {
      const result = await engine.query({
        projectId: 'proj-1',
        hostname: 'server-1',
        from: new Date('2025-01-15T00:00:00Z'),
        to: new Date('2025-01-16T00:00:00Z'),
      });

      expect(result.logs.length).toBeGreaterThan(0);
    });
  });

  describe('query with exclusive bounds', () => {
    beforeEach(async () => {
      await engine.ingest([
        makeLog({ time: new Date('2025-01-15T10:00:00.000Z'), message: 'at-start' }),
        makeLog({ time: new Date('2025-01-15T11:00:00.000Z'), message: 'middle' }),
        makeLog({ time: new Date('2025-01-15T12:00:00.000Z'), message: 'at-end' }),
      ]);
    });

    it('fromExclusive excludes exact from time', async () => {
      const result = await engine.query({
        projectId: 'proj-1',
        from: new Date('2025-01-15T10:00:00.000Z'),
        fromExclusive: true,
        to: new Date('2025-01-16T00:00:00Z'),
      });

      expect(result.logs).toHaveLength(2);
      expect(result.logs.every((l) => l.message !== 'at-start')).toBe(true);
    });

    it('toExclusive excludes exact to time', async () => {
      const result = await engine.query({
        projectId: 'proj-1',
        from: new Date('2025-01-15T00:00:00Z'),
        to: new Date('2025-01-15T12:00:00.000Z'),
        toExclusive: true,
      });

      expect(result.logs).toHaveLength(2);
      expect(result.logs.every((l) => l.message !== 'at-end')).toBe(true);
    });
  });

  // =========================================================================
  // Aggregations
  // =========================================================================

  describe('aggregate', () => {
    beforeEach(async () => {
      await engine.ingest([
        makeLog({ time: new Date('2025-01-15T10:00:00Z'), level: 'info' }),
        makeLog({ time: new Date('2025-01-15T10:30:00Z'), level: 'error' }),
        makeLog({ time: new Date('2025-01-15T11:00:00Z'), level: 'info' }),
        makeLog({ time: new Date('2025-01-15T11:30:00Z'), level: 'warn' }),
      ]);
    });

    it('aggregates by hour with byLevel', async () => {
      const result = await engine.aggregate({
        projectId: 'proj-1',
        from: new Date('2025-01-15T00:00:00Z'),
        to: new Date('2025-01-16T00:00:00Z'),
        interval: '1h',
      });

      expect(result.timeseries.length).toBeGreaterThan(0);
      expect(result.total).toBe(4);
      for (const bucket of result.timeseries) {
        expect(bucket.byLevel).toBeDefined();
      }
    });
  });

  // =========================================================================
  // getById / getByIds
  // =========================================================================

  describe('getById', () => {
    it('returns log by ID', async () => {
      const ingestResult = await engine.ingestReturning([makeLog()]);
      const log = await engine.getById({
        id: ingestResult.rows[0].id,
        projectId: 'proj-1',
      });

      expect(log).not.toBeNull();
      expect(log!.id).toBe(ingestResult.rows[0].id);
      expect(log!.service).toBe('api');
    });

    it('returns null for non-existent ID', async () => {
      const log = await engine.getById({
        id: '00000000-0000-0000-0000-000000000000',
        projectId: 'proj-1',
      });
      expect(log).toBeNull();
    });

    it('returns null for wrong project', async () => {
      const ingestResult = await engine.ingestReturning([makeLog()]);
      const log = await engine.getById({
        id: ingestResult.rows[0].id,
        projectId: 'wrong-project',
      });
      expect(log).toBeNull();
    });
  });

  describe('getByIds', () => {
    it('returns multiple logs by IDs', async () => {
      const ingestResult = await engine.ingestReturning([
        makeLog({ message: 'first' }),
        makeLog({ message: 'second' }),
        makeLog({ message: 'third' }),
      ]);

      const ids = ingestResult.rows.map((r) => r.id);
      const logs = await engine.getByIds({ ids: ids.slice(0, 2), projectId: 'proj-1' });
      expect(logs).toHaveLength(2);
    });

    it('returns empty array for empty ids', async () => {
      const logs = await engine.getByIds({ ids: [], projectId: 'proj-1' });
      expect(logs).toHaveLength(0);
    });
  });

  // =========================================================================
  // Count
  // =========================================================================

  describe('count', () => {
    beforeEach(async () => {
      await engine.ingest([
        makeLog({ level: 'info', service: 'api' }),
        makeLog({ level: 'error', service: 'api' }),
        makeLog({ level: 'error', service: 'worker' }),
        makeLog({ level: 'info', service: 'worker', projectId: 'proj-2' }),
      ]);
    });

    it('counts all logs for a project', async () => {
      const result = await engine.count({
        projectId: 'proj-1',
        from: new Date('2025-01-15T00:00:00Z'),
        to: new Date('2025-01-16T00:00:00Z'),
      });
      expect(result.count).toBe(3);
    });

    it('counts with level filter', async () => {
      const result = await engine.count({
        projectId: 'proj-1',
        level: 'error',
        from: new Date('2025-01-15T00:00:00Z'),
        to: new Date('2025-01-16T00:00:00Z'),
      });
      expect(result.count).toBe(2);
    });

    it('counts with service filter', async () => {
      const result = await engine.count({
        projectId: 'proj-1',
        service: 'api',
        from: new Date('2025-01-15T00:00:00Z'),
        to: new Date('2025-01-16T00:00:00Z'),
      });
      expect(result.count).toBe(2);
    });
  });

  // =========================================================================
  // Distinct & TopValues
  // =========================================================================

  describe('distinct', () => {
    beforeEach(async () => {
      await engine.ingest([
        makeLog({ service: 'api', metadata: { hostname: 'server-1' } }),
        makeLog({ service: 'worker', metadata: { hostname: 'server-2' } }),
        makeLog({ service: 'api', metadata: { hostname: 'server-1' } }),
        makeLog({ service: 'scheduler', metadata: { hostname: 'server-3' } }),
      ]);
    });

    it('gets distinct services', async () => {
      const result = await engine.distinct({
        field: 'service',
        projectId: 'proj-1',
        from: new Date('2025-01-15T00:00:00Z'),
        to: new Date('2025-01-16T00:00:00Z'),
      });

      expect(result.values).toHaveLength(3);
      expect(result.values.sort()).toEqual(['api', 'scheduler', 'worker']);
    });

    it('gets distinct hostnames from metadata', async () => {
      const result = await engine.distinct({
        field: 'metadata.hostname',
        projectId: 'proj-1',
        from: new Date('2025-01-15T00:00:00Z'),
        to: new Date('2025-01-16T00:00:00Z'),
      });

      expect(result.values).toHaveLength(3);
      expect(result.values.sort()).toEqual(['server-1', 'server-2', 'server-3']);
    });

    it('respects limit', async () => {
      const result = await engine.distinct({
        field: 'service',
        projectId: 'proj-1',
        from: new Date('2025-01-15T00:00:00Z'),
        to: new Date('2025-01-16T00:00:00Z'),
        limit: 2,
      });

      expect(result.values).toHaveLength(2);
    });
  });

  describe('topValues', () => {
    beforeEach(async () => {
      await engine.ingest([
        makeLog({ service: 'api', level: 'info' }),
        makeLog({ service: 'api', level: 'error' }),
        makeLog({ service: 'api', level: 'error' }),
        makeLog({ service: 'worker', level: 'info' }),
        makeLog({ service: 'scheduler', level: 'warn', projectId: 'proj-2' }),
      ]);
    });

    it('returns top values by count', async () => {
      const result = await engine.topValues({
        field: 'service',
        projectId: 'proj-1',
        from: new Date('2025-01-15T00:00:00Z'),
        to: new Date('2025-01-16T00:00:00Z'),
      });

      expect(result.values.length).toBeGreaterThanOrEqual(2);
      const apiEntry = result.values.find((v) => v.value === 'api');
      expect(apiEntry).toBeDefined();
      expect(apiEntry!.count).toBe(3);

      const workerEntry = result.values.find((v) => v.value === 'worker');
      expect(workerEntry).toBeDefined();
      expect(workerEntry!.count).toBe(1);
    });

    it('filters by level', async () => {
      const result = await engine.topValues({
        field: 'service',
        projectId: 'proj-1',
        from: new Date('2025-01-15T00:00:00Z'),
        to: new Date('2025-01-16T00:00:00Z'),
        level: 'error',
      });

      expect(result.values).toHaveLength(1);
      expect(result.values[0].value).toBe('api');
      expect(result.values[0].count).toBe(2);
    });

    it('respects limit', async () => {
      const result = await engine.topValues({
        field: 'service',
        projectId: 'proj-1',
        from: new Date('2025-01-15T00:00:00Z'),
        to: new Date('2025-01-16T00:00:00Z'),
        limit: 1,
      });

      expect(result.values).toHaveLength(1);
      expect(result.values[0].value).toBe('api');
    });

    it('respects project filter', async () => {
      const result = await engine.topValues({
        field: 'service',
        projectId: 'proj-2',
        from: new Date('2025-01-15T00:00:00Z'),
        to: new Date('2025-01-16T00:00:00Z'),
      });

      expect(result.values).toHaveLength(1);
      expect(result.values[0].value).toBe('scheduler');
    });
  });

  // =========================================================================
  // Delete
  // =========================================================================

  describe('deleteByTimeRange', () => {
    it('deletes logs within time range', async () => {
      await engine.ingest([
        makeLog({ time: new Date('2025-01-10T12:00:00Z') }),
        makeLog({ time: new Date('2025-01-15T12:00:00Z') }),
      ]);

      const result = await engine.deleteByTimeRange({
        projectId: 'proj-1',
        from: new Date('2025-01-01T00:00:00Z'),
        to: new Date('2025-01-12T00:00:00Z'),
      });

      expect(result.deleted).toBe(1);
      expect(result.executionTimeMs).toBeGreaterThanOrEqual(0);

      const remaining = await engine.count({
        projectId: 'proj-1',
        from: new Date('2025-01-01T00:00:00Z'),
        to: new Date('2025-01-20T00:00:00Z'),
      });

      expect(remaining.count).toBe(1);
    });
  });

  // =========================================================================
  // Span & Trace Operations
  // =========================================================================

  describe('ingestSpans', () => {
    it('ingests a batch of spans', async () => {
      const spans = [
        makeSpan({ spanId: 'span-1' }),
        makeSpan({ spanId: 'span-2', operationName: 'POST /orders' }),
      ];
      const result = await engine.ingestSpans(spans);

      expect(result.ingested).toBe(2);
      expect(result.failed).toBe(0);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('returns empty result for empty batch', async () => {
      const result = await engine.ingestSpans([]);
      expect(result.ingested).toBe(0);
    });

    it('ingests spans with all optional fields', async () => {
      const span = makeSpan({
        spanId: 'span-full',
        parentSpanId: 'span-parent',
        kind: 'server',
        statusCode: 'ok',
        statusMessage: 'all good',
        attributes: { 'http.method': 'GET' },
        events: [{ name: 'exception', timestamp: '2025-01-15T12:00:00.500Z' }],
        links: [{ traceId: 'other-trace', spanId: 'other-span' }],
        resourceAttributes: { 'service.version': '1.0.0' },
      });
      const result = await engine.ingestSpans([span]);
      expect(result.ingested).toBe(1);

      const spans = await engine.getSpansByTraceId('trace-abc', 'proj-1');
      expect(spans).toHaveLength(1);
      expect(spans[0].kind).toBe('server');
      expect(spans[0].statusCode).toBe('ok');
      expect(spans[0].parentSpanId).toBe('span-parent');
      expect(spans[0].attributes).toEqual({ 'http.method': 'GET' });
    });
  });

  describe('upsertTrace', () => {
    it('inserts a new trace', async () => {
      await engine.upsertTrace(makeTrace({ traceId: 'trace-new' }));

      const trace = await engine.getTraceById('trace-new', 'proj-1');
      expect(trace).not.toBeNull();
      expect(trace!.traceId).toBe('trace-new');
      expect(trace!.spanCount).toBe(3);
      expect(trace!.error).toBe(false);
    });

    it('merges times and span count on update', async () => {
      await engine.upsertTrace(makeTrace({
        traceId: 'trace-merge',
        startTime: new Date('2025-01-15T12:00:01Z'),
        endTime: new Date('2025-01-15T12:00:04Z'),
        spanCount: 2,
      }));

      await engine.upsertTrace(makeTrace({
        traceId: 'trace-merge',
        startTime: new Date('2025-01-15T12:00:00Z'),
        endTime: new Date('2025-01-15T12:00:05Z'),
        spanCount: 1,
      }));

      const trace = await engine.getTraceById('trace-merge', 'proj-1');
      expect(trace).not.toBeNull();
      expect(trace!.spanCount).toBe(3);
      expect(trace!.durationMs).toBeGreaterThanOrEqual(4000);
    });

    it('sticky error flag via $max', async () => {
      await engine.upsertTrace(makeTrace({ traceId: 'trace-err', error: true }));
      await engine.upsertTrace(makeTrace({ traceId: 'trace-err', error: false }));

      const trace = await engine.getTraceById('trace-err', 'proj-1');
      expect(trace).not.toBeNull();
      expect(trace!.error).toBe(true);
    });
  });

  describe('querySpans', () => {
    beforeEach(async () => {
      await engine.ingestSpans([
        makeSpan({ spanId: 'span-q1', time: new Date('2025-01-15T10:00:00Z'), startTime: new Date('2025-01-15T10:00:00Z'), serviceName: 'api', kind: 'server' }),
        makeSpan({ spanId: 'span-q2', time: new Date('2025-01-15T11:00:00Z'), startTime: new Date('2025-01-15T11:00:00Z'), serviceName: 'db', kind: 'client' }),
        makeSpan({ spanId: 'span-q3', time: new Date('2025-01-15T12:00:00Z'), startTime: new Date('2025-01-15T12:00:00Z'), serviceName: 'api', kind: 'server', projectId: 'proj-2' }),
      ]);
    });

    it('queries all spans for a project', async () => {
      const result = await engine.querySpans({
        projectId: 'proj-1',
        from: new Date('2025-01-15T00:00:00Z'),
        to: new Date('2025-01-16T00:00:00Z'),
      });

      expect(result.spans).toHaveLength(2);
      expect(result.total).toBe(2);
    });

    it('filters by service name', async () => {
      const result = await engine.querySpans({
        projectId: 'proj-1',
        serviceName: 'db',
        from: new Date('2025-01-15T00:00:00Z'),
        to: new Date('2025-01-16T00:00:00Z'),
      });

      expect(result.spans).toHaveLength(1);
      expect(result.spans[0].serviceName).toBe('db');
    });

    it('filters by kind', async () => {
      const result = await engine.querySpans({
        projectId: 'proj-1',
        kind: 'server',
        from: new Date('2025-01-15T00:00:00Z'),
        to: new Date('2025-01-16T00:00:00Z'),
      });

      expect(result.spans).toHaveLength(1);
      expect(result.spans[0].kind).toBe('server');
    });

    it('supports limit and hasMore', async () => {
      const result = await engine.querySpans({
        projectId: 'proj-1',
        from: new Date('2025-01-15T00:00:00Z'),
        to: new Date('2025-01-16T00:00:00Z'),
        limit: 1,
      });

      expect(result.spans).toHaveLength(1);
      expect(result.hasMore).toBe(true);
    });
  });

  describe('getSpansByTraceId', () => {
    beforeEach(async () => {
      await engine.ingestSpans([
        makeSpan({ spanId: 'root', traceId: 'trace-t1', startTime: new Date('2025-01-15T12:00:00Z') }),
        makeSpan({ spanId: 'child', traceId: 'trace-t1', parentSpanId: 'root', startTime: new Date('2025-01-15T12:00:00.500Z') }),
        makeSpan({ spanId: 'other', traceId: 'trace-t2' }),
      ]);
    });

    it('returns spans for specific trace ordered by start_time', async () => {
      const spans = await engine.getSpansByTraceId('trace-t1', 'proj-1');

      expect(spans).toHaveLength(2);
      expect(spans[0].spanId).toBe('root');
      expect(spans[1].spanId).toBe('child');
      expect(spans[0].startTime.getTime()).toBeLessThanOrEqual(spans[1].startTime.getTime());
    });

    it('returns empty for non-existent trace', async () => {
      const spans = await engine.getSpansByTraceId('nonexistent', 'proj-1');
      expect(spans).toHaveLength(0);
    });
  });

  describe('queryTraces', () => {
    beforeEach(async () => {
      await engine.upsertTrace(makeTrace({
        traceId: 'trace-qt1',
        startTime: new Date('2025-01-15T12:00:00Z'),
        endTime: new Date('2025-01-15T12:00:01Z'),
        durationMs: 1000,
        error: false,
      }));
      await engine.upsertTrace(makeTrace({
        traceId: 'trace-qt2',
        startTime: new Date('2025-01-15T12:00:00Z'),
        endTime: new Date('2025-01-15T12:00:05Z'),
        durationMs: 5000,
        error: true,
      }));
      await engine.upsertTrace(makeTrace({
        traceId: 'trace-qt3',
        startTime: new Date('2025-01-15T12:00:00Z'),
        endTime: new Date('2025-01-15T12:00:00.200Z'),
        durationMs: 200,
        error: false,
        projectId: 'proj-2',
      }));
    });

    it('queries traces for a project', async () => {
      const result = await engine.queryTraces({
        projectId: 'proj-1',
        from: new Date('2025-01-15T00:00:00Z'),
        to: new Date('2025-01-16T00:00:00Z'),
      });

      expect(result.traces).toHaveLength(2);
      expect(result.total).toBe(2);
    });

    it('filters by error status', async () => {
      const result = await engine.queryTraces({
        projectId: 'proj-1',
        error: true,
        from: new Date('2025-01-15T00:00:00Z'),
        to: new Date('2025-01-16T00:00:00Z'),
      });

      expect(result.traces).toHaveLength(1);
      expect(result.traces[0].traceId).toBe('trace-qt2');
      expect(result.traces[0].error).toBe(true);
    });

    it('filters by minimum duration', async () => {
      const result = await engine.queryTraces({
        projectId: 'proj-1',
        minDurationMs: 2000,
        from: new Date('2025-01-15T00:00:00Z'),
        to: new Date('2025-01-16T00:00:00Z'),
      });

      expect(result.traces).toHaveLength(1);
      expect(result.traces[0].durationMs).toBeGreaterThanOrEqual(2000);
    });
  });

  describe('getTraceById', () => {
    beforeEach(async () => {
      await engine.upsertTrace(makeTrace({ traceId: 'trace-get1' }));
    });

    it('returns trace when found', async () => {
      const trace = await engine.getTraceById('trace-get1', 'proj-1');

      expect(trace).not.toBeNull();
      expect(trace!.traceId).toBe('trace-get1');
      expect(trace!.serviceName).toBe('api');
    });

    it('returns null for non-existent trace', async () => {
      const trace = await engine.getTraceById('nonexistent', 'proj-1');
      expect(trace).toBeNull();
    });

    it('returns null for wrong project', async () => {
      const trace = await engine.getTraceById('trace-get1', 'wrong-project');
      expect(trace).toBeNull();
    });
  });

  describe('getTraceServices', () => {
    beforeEach(async () => {
      await engine.upsertTrace(makeTrace({ traceId: 'ts-1', projectId: 'proj-svc', serviceName: 'api' }));
      await engine.upsertTrace(makeTrace({ traceId: 'ts-2', projectId: 'proj-svc', serviceName: 'worker' }));
      await engine.upsertTrace(makeTrace({ traceId: 'ts-3', projectId: 'proj-svc', serviceName: 'api' }));
    });

    it('returns distinct service names across all traces', async () => {
      const services = await engine.getTraceServices('proj-svc');
      expect(services.sort()).toEqual(['api', 'worker']);
    });

    it('scopes by project', async () => {
      const services = await engine.getTraceServices('proj-svc-empty');
      expect(services).toEqual([]);
    });
  });

  describe('getServiceDependencies', () => {
    beforeEach(async () => {
      await engine.ingestSpans([
        makeSpan({ spanId: 'parent-1', traceId: 'trace-dep', serviceName: 'api', startTime: new Date('2025-01-15T12:00:00Z') }),
        makeSpan({ spanId: 'child-1', traceId: 'trace-dep', parentSpanId: 'parent-1', serviceName: 'db', startTime: new Date('2025-01-15T12:00:00.100Z') }),
        makeSpan({ spanId: 'child-2', traceId: 'trace-dep', parentSpanId: 'parent-1', serviceName: 'cache', startTime: new Date('2025-01-15T12:00:00.200Z') }),
      ]);
    });

    it('returns service dependency graph', async () => {
      const result = await engine.getServiceDependencies(
        'proj-1',
        new Date('2025-01-15T00:00:00Z'),
        new Date('2025-01-16T00:00:00Z'),
      );

      expect(result.edges).toHaveLength(2);

      const dbEdge = result.edges.find((e) => e.target === 'db');
      expect(dbEdge).toBeDefined();
      expect(dbEdge!.source).toBe('api');
      expect(dbEdge!.callCount).toBe(1);

      const cacheEdge = result.edges.find((e) => e.target === 'cache');
      expect(cacheEdge).toBeDefined();
      expect(cacheEdge!.source).toBe('api');

      expect(result.nodes.length).toBeGreaterThanOrEqual(2);
    });

    it('returns empty when no cross-service calls', async () => {
      const db = directClient.db(TEST_CONFIG.database);
      await db.collection('spans').deleteMany({});

      await engine.ingestSpans([
        makeSpan({ spanId: 'p1', traceId: 'trace-same', serviceName: 'api' }),
        makeSpan({ spanId: 'c1', traceId: 'trace-same', parentSpanId: 'p1', serviceName: 'api' }),
      ]);

      const result = await engine.getServiceDependencies('proj-1');
      expect(result.edges).toHaveLength(0);
      expect(result.nodes).toHaveLength(0);
    });
  });

  describe('getServiceHealthStats', () => {
    beforeEach(async () => {
      const db = directClient.db(TEST_CONFIG.database);
      await db.collection('spans').deleteMany({});
      const spans = [];
      for (let i = 1; i <= 100; i++) {
        spans.push(
          makeSpan({
            spanId: `health-${i}`,
            traceId: 'trace-health',
            serviceName: 'api',
            startTime: new Date('2025-03-01T10:00:00Z'),
            durationMs: i,
            statusCode: i <= 10 ? 'ERROR' : 'OK',
          }),
        );
      }
      await engine.ingestSpans(spans);
    });

    it('computes a true window p95 from raw spans', async () => {
      const stats = await engine.getServiceHealthStats(
        'proj-1',
        new Date('2025-03-01T00:00:00Z'),
        new Date('2025-03-02T00:00:00Z'),
      );

      const api = stats.find((s) => s.serviceName === 'api');
      expect(api).toBeDefined();
      expect(api!.totalCalls).toBe(100);
      expect(api!.totalErrors).toBe(10);
      expect(api!.avgLatencyMs).toBeGreaterThan(45);
      expect(api!.avgLatencyMs).toBeLessThan(56);
      // Approximate but a true window p95 over durations 1..100 (~95), not MAX.
      expect(api!.p95LatencyMs!).toBeGreaterThanOrEqual(88);
      expect(api!.p95LatencyMs!).toBeLessThanOrEqual(100);
    });

    it('returns no rows outside the window', async () => {
      const stats = await engine.getServiceHealthStats(
        'proj-1',
        new Date('2030-01-01T00:00:00Z'),
        new Date('2030-01-02T00:00:00Z'),
      );
      expect(stats).toHaveLength(0);
    });
  });

  describe('deleteSpansByTimeRange', () => {
    beforeEach(async () => {
      await engine.ingestSpans([
        makeSpan({ spanId: 'old-span', time: new Date('2025-01-10T12:00:00Z'), startTime: new Date('2025-01-10T12:00:00Z') }),
        makeSpan({ spanId: 'new-span', time: new Date('2025-01-15T12:00:00Z'), startTime: new Date('2025-01-15T12:00:00Z') }),
      ]);
    });

    it('deletes spans within time range', async () => {
      const result = await engine.deleteSpansByTimeRange({
        projectId: 'proj-1',
        from: new Date('2025-01-01T00:00:00Z'),
        to: new Date('2025-01-12T00:00:00Z'),
      });

      expect(result.deleted).toBe(1);
      expect(result.executionTimeMs).toBeGreaterThanOrEqual(0);

      const remaining = await engine.querySpans({
        projectId: 'proj-1',
        from: new Date('2025-01-01T00:00:00Z'),
        to: new Date('2025-01-20T00:00:00Z'),
      });

      expect(remaining.spans).toHaveLength(1);
      expect(remaining.spans[0].spanId).toBe('new-span');
    });
  });

  // =========================================================================
  // Metrics
  // =========================================================================

  describe('ingestMetrics', () => {
    it('ingests a batch of metrics', async () => {
      const metrics = [
        makeMetric({ metricName: 'cpu.usage', value: 0.75 }),
        makeMetric({ metricName: 'memory.usage', value: 0.60 }),
      ];
      const result = await engine.ingestMetrics(metrics);

      expect(result.ingested).toBe(2);
      expect(result.failed).toBe(0);
    });

    it('returns empty result for empty batch', async () => {
      const result = await engine.ingestMetrics([]);
      expect(result.ingested).toBe(0);
    });
  });

  describe('queryMetrics', () => {
    beforeEach(async () => {
      await engine.ingestMetrics([
        makeMetric({ time: new Date('2025-01-15T10:00:00Z'), metricName: 'cpu.usage', value: 0.5 }),
        makeMetric({ time: new Date('2025-01-15T11:00:00Z'), metricName: 'cpu.usage', value: 0.7 }),
        makeMetric({ time: new Date('2025-01-15T12:00:00Z'), metricName: 'memory.usage', value: 0.8 }),
      ]);
    });

    it('queries metrics by name', async () => {
      const result = await engine.queryMetrics({
        projectId: 'proj-1',
        metricName: 'cpu.usage',
        from: new Date('2025-01-15T00:00:00Z'),
        to: new Date('2025-01-16T00:00:00Z'),
      });

      expect(result.metrics).toHaveLength(2);
      expect(result.total).toBe(2);
      for (const m of result.metrics) {
        expect(m.metricName).toBe('cpu.usage');
      }
    });

    it('supports limit and hasMore', async () => {
      const result = await engine.queryMetrics({
        projectId: 'proj-1',
        metricName: 'cpu.usage',
        from: new Date('2025-01-15T00:00:00Z'),
        to: new Date('2025-01-16T00:00:00Z'),
        limit: 1,
      });

      expect(result.metrics).toHaveLength(1);
      expect(result.hasMore).toBe(true);
    });
  });

  describe('aggregateMetrics', () => {
    beforeEach(async () => {
      await engine.ingestMetrics([
        makeMetric({ time: new Date('2025-01-15T10:00:00Z'), metricName: 'cpu.usage', value: 0.5 }),
        makeMetric({ time: new Date('2025-01-15T10:30:00Z'), metricName: 'cpu.usage', value: 0.7 }),
        makeMetric({ time: new Date('2025-01-15T11:00:00Z'), metricName: 'cpu.usage', value: 0.9 }),
      ]);
    });

    it('aggregates with avg', async () => {
      const result = await engine.aggregateMetrics({
        projectId: 'proj-1',
        metricName: 'cpu.usage',
        from: new Date('2025-01-15T00:00:00Z'),
        to: new Date('2025-01-16T00:00:00Z'),
        interval: '1h',
        aggregation: 'avg',
      });

      expect(result.timeseries.length).toBeGreaterThan(0);
    });

    it('aggregates with sum', async () => {
      const result = await engine.aggregateMetrics({
        projectId: 'proj-1',
        metricName: 'cpu.usage',
        from: new Date('2025-01-15T00:00:00Z'),
        to: new Date('2025-01-16T00:00:00Z'),
        interval: '1d',
        aggregation: 'sum',
      });

      expect(result.timeseries.length).toBeGreaterThan(0);
      // Sum of 0.5 + 0.7 + 0.9 = 2.1
      const totalValue = result.timeseries.reduce((s, t) => s + t.value, 0);
      expect(totalValue).toBeCloseTo(2.1, 1);
    });

    it('aggregates with last', async () => {
      const result = await engine.aggregateMetrics({
        projectId: 'proj-1',
        metricName: 'cpu.usage',
        from: new Date('2025-01-15T00:00:00Z'),
        to: new Date('2025-01-16T00:00:00Z'),
        interval: '1d',
        aggregation: 'last',
      });

      expect(result.timeseries.length).toBeGreaterThan(0);
    });
  });

  describe('getMetricNames', () => {
    beforeEach(async () => {
      await engine.ingestMetrics([
        makeMetric({ metricName: 'cpu.usage' }),
        makeMetric({ metricName: 'memory.usage' }),
        makeMetric({ metricName: 'cpu.usage' }),
      ]);
    });

    it('returns distinct metric names', async () => {
      const result = await engine.getMetricNames({
        projectId: 'proj-1',
        from: new Date('2025-01-15T00:00:00Z'),
        to: new Date('2025-01-16T00:00:00Z'),
      });

      expect(result.names).toHaveLength(2);
      const names = result.names.map((n) => n.name).sort();
      expect(names).toEqual(['cpu.usage', 'memory.usage']);
    });
  });

  describe('deleteMetricsByTimeRange', () => {
    it('deletes metrics within time range', async () => {
      await engine.ingestMetrics([
        makeMetric({ time: new Date('2025-01-10T12:00:00Z'), metricName: 'old' }),
        makeMetric({ time: new Date('2025-01-15T12:00:00Z'), metricName: 'new' }),
      ]);

      const result = await engine.deleteMetricsByTimeRange({
        projectId: 'proj-1',
        from: new Date('2025-01-01T00:00:00Z'),
        to: new Date('2025-01-12T00:00:00Z'),
      });

      expect(result.deleted).toBe(1);
    });
  });
});
