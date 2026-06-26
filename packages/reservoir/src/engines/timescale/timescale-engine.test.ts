import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GLOBAL_SCOPE } from '../../core/types.js';
import type { StorageConfig, LogRecord, SpanRecord, TraceRecord } from '../../core/types.js';

const mockQuery = vi.fn();
const mockEnd = vi.fn();

vi.mock('pg', () => {
  return {
    default: {
      Pool: vi.fn(() => ({
        query: mockQuery,
        end: mockEnd,
      })),
    },
  };
});

import { TimescaleEngine } from './timescale-engine.js';
import { TimescaleQueryTranslator } from './query-translator.js';

const config: StorageConfig = {
  host: 'localhost',
  port: 5432,
  database: 'logtide',
  username: 'logtide',
  password: 'secret',
  schema: 'public',
};

function makeLog(overrides: Partial<LogRecord> = {}): LogRecord {
  return {
    time: new Date('2024-01-01T00:00:00Z'),
    projectId: 'proj-1',
    service: 'api',
    level: 'info',
    message: 'hello world',
    metadata: { hostname: 'host-1' },
    ...overrides,
  };
}

describe('TimescaleEngine', () => {
  let engine: TimescaleEngine;

  beforeEach(() => {
    vi.clearAllMocks();
    engine = new TimescaleEngine(config);
  });

  describe('connect / disconnect', () => {
    it('connects and creates a pool', async () => {
      await engine.connect();
      const pg = await import('pg');
      expect(pg.default.Pool).toHaveBeenCalledWith(
        expect.objectContaining({
          host: 'localhost',
          port: 5432,
          database: 'logtide',
          user: 'logtide',
          password: 'secret',
        }),
      );
    });

    it('disconnect calls pool.end', async () => {
      await engine.connect();
      await engine.disconnect();
      expect(mockEnd).toHaveBeenCalled();
    });

    it('disconnect without connect is safe', async () => {
      await engine.disconnect();
      expect(mockEnd).not.toHaveBeenCalled();
    });

    it('does not create pool when injected', async () => {
      const mockPool = { query: mockQuery, end: mockEnd } as unknown as import('pg').Pool;
      const injectedEngine = new TimescaleEngine(config, { pool: mockPool });
      await injectedEngine.connect(); // should be a no-op
      const pg = await import('pg');
      // Pool constructor should only have been called by the non-injected engine setup
      const callsBeforeConnect = pg.default.Pool.mock.calls.length;
      await injectedEngine.connect();
      expect(pg.default.Pool.mock.calls.length).toBe(callsBeforeConnect);
    });

    it('does not end pool when not owned', async () => {
      const mockPool = { query: mockQuery, end: mockEnd } as unknown as import('pg').Pool;
      const injectedEngine = new TimescaleEngine(config, { pool: mockPool });
      await injectedEngine.disconnect();
      expect(mockEnd).not.toHaveBeenCalled();
    });
  });

  describe('healthCheck', () => {
    it('returns healthy when query is fast', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });
      await engine.connect();
      const result = await engine.healthCheck();
      expect(result.status).toBe('healthy');
      expect(result.connected).toBe(true);
      expect(result.engine).toBe('timescale');
      expect(result.responseTimeMs).toBeGreaterThanOrEqual(0);
    });

    it('returns unhealthy on error', async () => {
      mockQuery.mockRejectedValueOnce(new Error('connection refused'));
      await engine.connect();
      const result = await engine.healthCheck();
      expect(result.status).toBe('unhealthy');
      expect(result.connected).toBe(false);
      expect(result.error).toBe('connection refused');
    });

    it('returns unhealthy when not connected', async () => {
      const result = await engine.healthCheck();
      expect(result.status).toBe('unhealthy');
      expect(result.connected).toBe(false);
      expect(result.error).toBe('Not connected. Call connect() first.');
    });
  });

  describe('initialize', () => {
    it('creates schema, table, and indices', async () => {
      mockQuery.mockResolvedValue({ rows: [] });
      await engine.connect();
      await engine.initialize();

      const calls = mockQuery.mock.calls.map((c) => (c[0] as string).trim());
      expect(calls.some((q) => q.includes('CREATE SCHEMA IF NOT EXISTS public'))).toBe(true);
      expect(calls.some((q) => q.includes('CREATE TABLE IF NOT EXISTS public.logs'))).toBe(true);
      expect(calls.some((q) => q.includes('idx_logs_fulltext'))).toBe(true);
      expect(calls.some((q) => q.includes('idx_logs_composite'))).toBe(true);
      expect(calls.some((q) => q.includes('idx_logs_span_id'))).toBe(true);
    });

    it('skips initialization when skipInitialize is set', async () => {
      const skipEngine = new TimescaleEngine(config, { skipInitialize: true });
      await skipEngine.connect();
      await skipEngine.initialize();
      // Only the pool creation call, no schema/table calls
      expect(mockQuery).not.toHaveBeenCalled();
    });
  });

  describe('ingest', () => {
    it('inserts a batch of logs', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 2 });
      await engine.connect();

      const logs = [makeLog(), makeLog({ service: 'worker' })];
      const result = await engine.ingest(logs);

      expect(result.ingested).toBe(2);
      expect(result.failed).toBe(0);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);

      const insertCall = mockQuery.mock.calls[0];
      expect((insertCall[0] as string)).toContain('INSERT INTO public.logs');
      expect((insertCall[0] as string)).toContain('UNNEST');
      expect((insertCall[1] as unknown[]).length).toBe(9); // 9 column arrays (incl. session_id)
    });

    it('returns empty result for empty batch', async () => {
      await engine.connect();
      const result = await engine.ingest([]);
      expect(result.ingested).toBe(0);
      expect(result.failed).toBe(0);
      expect(result.durationMs).toBe(0);
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('sanitizes null bytes in strings', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      await engine.connect();

      const log = makeLog({ message: 'hello\0world', service: 'api\0test' });
      await engine.ingest([log]);

      const params = mockQuery.mock.calls[0][1] as unknown[];
      // UNNEST arrays: [times, projectIds, services, levels, messages, ...]
      expect((params[4] as string[])[0]).toBe('helloworld');
      expect((params[2] as string[])[0]).toBe('apitest');
    });

    it('handles insert errors', async () => {
      mockQuery.mockRejectedValueOnce(new Error('unique violation'));
      await engine.connect();

      const result = await engine.ingest([makeLog()]);
      expect(result.ingested).toBe(0);
      expect(result.failed).toBe(1);
      expect(result.errors).toHaveLength(1);
      expect(result.errors![0].error).toBe('unique violation');
    });
  });

  describe('ingestReturning', () => {
    it('inserts and returns rows with RETURNING *', async () => {
      const returnedRow = {
        id: 'uuid-1',
        time: new Date('2024-01-01T00:00:00Z'),
        project_id: 'proj-1',
        service: 'api',
        level: 'info',
        message: 'hello world',
        metadata: { hostname: 'host-1' },
        trace_id: null,
        span_id: null,
      };
      mockQuery.mockResolvedValueOnce({ rows: [returnedRow] });
      await engine.connect();

      const result = await engine.ingestReturning([makeLog()]);
      expect(result.ingested).toBe(1);
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].id).toBe('uuid-1');
      expect(result.rows[0].projectId).toBe('proj-1');

      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).toContain('RETURNING *');
    });

    it('returns empty result for empty batch', async () => {
      await engine.connect();
      const result = await engine.ingestReturning([]);
      expect(result.ingested).toBe(0);
      expect(result.rows).toHaveLength(0);
    });

    it('handles errors gracefully', async () => {
      mockQuery.mockRejectedValueOnce(new Error('disk full'));
      await engine.connect();

      const result = await engine.ingestReturning([makeLog()]);
      expect(result.ingested).toBe(0);
      expect(result.failed).toBe(1);
      expect(result.rows).toHaveLength(0);
      expect(result.errors![0].error).toBe('disk full');
    });
  });

  describe('query', () => {
    it('queries with basic filters', async () => {
      const row = {
        time: new Date('2024-01-01T00:00:00Z'),
        id: 'uuid-1',
        project_id: 'proj-1',
        service: 'api',
        level: 'info',
        message: 'hello',
        metadata: {},
        trace_id: null,
        span_id: null,
      };
      mockQuery.mockResolvedValueOnce({ rows: [row] });
      await engine.connect();

      const result = await engine.query({
        projectId: 'proj-1',
        from: new Date('2024-01-01'),
        to: new Date('2024-01-02'),
        limit: 10,
      });

      expect(result.logs).toHaveLength(1);
      expect(result.logs[0].projectId).toBe('proj-1');
      expect(result.hasMore).toBe(false);
      expect(result.limit).toBe(10);
      expect(result.executionTimeMs).toBeGreaterThanOrEqual(0);
    });

    it('handles limit+1 pattern for hasMore', async () => {
      const rows = Array.from({ length: 11 }, (_, i) => ({
        time: new Date('2024-01-01T00:00:00Z'),
        id: `uuid-${i}`,
        project_id: 'proj-1',
        service: 'api',
        level: 'info',
        message: `msg-${i}`,
        metadata: {},
        trace_id: null,
        span_id: null,
      }));
      mockQuery.mockResolvedValueOnce({ rows });
      await engine.connect();

      const result = await engine.query({
        projectId: 'proj-1',
        from: new Date('2024-01-01'),
        to: new Date('2024-01-02'),
        limit: 10,
      });

      expect(result.logs).toHaveLength(10);
      expect(result.hasMore).toBe(true);
      expect(result.nextCursor).toBeDefined();

      // decode cursor
      const decoded = Buffer.from(result.nextCursor!, 'base64').toString('utf-8');
      expect(decoded).toContain('uuid-9');
    });

    it('handles array filters', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      await engine.connect();

      await engine.query({
        projectId: ['proj-1', 'proj-2'],
        level: ['info', 'error'],
        from: new Date('2024-01-01'),
        to: new Date('2024-01-02'),
      });

      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).toContain('project_id = ANY($1)');
      expect(sql).toContain('level = ANY($2)');
    });

    it('handles fulltext search', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      await engine.connect();

      await engine.query({
        projectId: 'proj-1',
        from: new Date('2024-01-01'),
        to: new Date('2024-01-02'),
        search: 'error message',
      });

      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).toContain("to_tsvector('english', message) @@ plainto_tsquery('english'");
    });

    it('handles substring search', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      await engine.connect();

      await engine.query({
        projectId: 'proj-1',
        from: new Date('2024-01-01'),
        to: new Date('2024-01-02'),
        search: 'test%value',
        searchMode: 'substring',
      });

      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).toContain('message ILIKE');
      const params = mockQuery.mock.calls[0][1] as unknown[];
      // escaped % in search term
      expect(params).toContainEqual('%test\\%value%');
    });

    it('handles cursor pagination', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      await engine.connect();

      const cursor = Buffer.from('2024-01-01T00:00:00.000Z,uuid-5').toString('base64');
      await engine.query({
        projectId: 'proj-1',
        from: new Date('2024-01-01'),
        to: new Date('2024-01-02'),
        cursor,
      });

      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).toContain('(time, id) <');
    });
  });

  describe('aggregate', () => {
    it('groups results by time bucket and level', async () => {
      const bucket1 = new Date('2024-01-01T00:00:00Z');
      const bucket2 = new Date('2024-01-01T01:00:00Z');
      mockQuery.mockResolvedValueOnce({
        rows: [
          { bucket: bucket1, level: 'info', total: '10' },
          { bucket: bucket1, level: 'error', total: '3' },
          { bucket: bucket2, level: 'info', total: '5' },
        ],
      });
      await engine.connect();

      const result = await engine.aggregate({
        projectId: 'proj-1',
        from: new Date('2024-01-01'),
        to: new Date('2024-01-02'),
        interval: '1h',
      });

      expect(result.timeseries).toHaveLength(2);
      expect(result.timeseries[0].total).toBe(13);
      expect(result.timeseries[0].byLevel!.info).toBe(10);
      expect(result.timeseries[0].byLevel!.error).toBe(3);
      expect(result.timeseries[1].total).toBe(5);
      expect(result.total).toBe(18);
      expect(result.executionTimeMs).toBeGreaterThanOrEqual(0);
    });

    it('passes correct interval to SQL', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      await engine.connect();

      await engine.aggregate({
        projectId: 'proj-1',
        from: new Date('2024-01-01'),
        to: new Date('2024-01-02'),
        interval: '5m',
      });

      const params = mockQuery.mock.calls[0][1] as unknown[];
      expect(params[0]).toBe('5 minutes');
    });
  });

  describe('topValues', () => {
    it('queries top values with GROUP BY', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          { value: 'api', count: '150' },
          { value: 'worker', count: '50' },
        ],
      });
      await engine.connect();

      const result = await engine.topValues({
        field: 'service',
        projectId: 'proj-1',
        from: new Date('2024-01-01'),
        to: new Date('2024-01-02'),
        limit: 10,
      });

      expect(result.values).toHaveLength(2);
      expect(result.values[0].value).toBe('api');
      expect(result.values[0].count).toBe(150);
      expect(result.values[1].value).toBe('worker');
      expect(result.values[1].count).toBe(50);

      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).toContain('service AS value');
      expect(sql).toContain('COUNT(*)');
      expect(sql).toContain('GROUP BY value');
      expect(sql).toContain('ORDER BY count DESC');
    });

    it('includes level filter when provided', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      await engine.connect();

      await engine.topValues({
        field: 'message',
        projectId: 'proj-1',
        from: new Date('2024-01-01'),
        to: new Date('2024-01-02'),
        level: ['error', 'critical'],
      });

      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).toContain('level = ANY');
    });

    it('returns empty for no results', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      await engine.connect();

      const result = await engine.topValues({
        field: 'service',
        projectId: 'proj-1',
        from: new Date('2024-01-01'),
        to: new Date('2024-01-02'),
      });

      expect(result.values).toHaveLength(0);
    });
  });

  describe('getCapabilities', () => {
    it('returns correct capabilities', () => {
      const caps = engine.getCapabilities();
      expect(caps.engine).toBe('timescale');
      expect(caps.supportsFullTextSearch).toBe(true);
      expect(caps.supportsAggregations).toBe(true);
      expect(caps.supportsStreaming).toBe(true);
      expect(caps.supportsTransactions).toBe(true);
      expect(caps.maxBatchSize).toBe(10000);
      expect(caps.nativeCompression).toBe(true);
      expect(caps.nativeTiering).toBe(false);
      expect(caps.supportedOperators).toContain('=');
      expect(caps.supportedOperators).toContain('like');
      expect(caps.supportedIntervals).toContain('1h');
      expect(caps.supportedIntervals).toContain('1d');
    });
  });

  describe('getSegments', () => {
    it('returns empty array', async () => {
      await engine.connect();
      const result = await engine.getSegments(new Date(), new Date());
      expect(result).toEqual([]);
    });
  });

  describe('migrate', () => {
    it('is a no-op placeholder', async () => {
      await engine.connect();
      await expect(engine.migrate('1')).resolves.toBeUndefined();
    });
  });

  // =========================================================================
  // Span & Trace Operations
  // =========================================================================

  describe('ingestSpans', () => {
    const makeSpan = (overrides: Partial<SpanRecord> = {}): SpanRecord => ({
      time: new Date('2024-01-01T00:00:00Z'),
      spanId: 'span-1',
      traceId: 'trace-1',
      projectId: 'proj-1',
      serviceName: 'api',
      operationName: 'GET /users',
      startTime: new Date('2024-01-01T00:00:00Z'),
      endTime: new Date('2024-01-01T00:00:01Z'),
      durationMs: 1000,
      ...overrides,
    });

    it('inserts a batch of spans', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      await engine.connect();

      const spans = [makeSpan(), makeSpan({ spanId: 'span-2', operationName: 'POST /orders' })];
      const result = await engine.ingestSpans(spans);

      expect(result.ingested).toBe(2);
      expect(result.failed).toBe(0);

      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).toContain('INSERT INTO public.spans');
      expect(sql).toContain('UNNEST');
      expect((mockQuery.mock.calls[0][1] as unknown[]).length).toBe(18);
    });

    it('returns empty result for empty batch', async () => {
      await engine.connect();
      const result = await engine.ingestSpans([]);
      expect(result.ingested).toBe(0);
      expect(result.failed).toBe(0);
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('handles insert errors', async () => {
      mockQuery.mockRejectedValueOnce(new Error('table not found'));
      await engine.connect();

      const result = await engine.ingestSpans([makeSpan()]);
      expect(result.ingested).toBe(0);
      expect(result.failed).toBe(1);
      expect(result.errors![0].error).toBe('table not found');
    });

    it('passes optional fields as null when missing', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      await engine.connect();

      await engine.ingestSpans([makeSpan()]);

      const params = mockQuery.mock.calls[0][1] as unknown[];
      // parentSpanIds (index 3)
      expect((params[3] as (string | null)[])[0]).toBeNull();
      // orgIds (index 4)
      expect((params[4] as (string | null)[])[0]).toBeNull();
      // kinds (index 11)
      expect((params[11] as (string | null)[])[0]).toBeNull();
    });
  });

  describe('upsertTrace', () => {
    const makeTrace = (overrides: Partial<TraceRecord> = {}): TraceRecord => ({
      traceId: 'trace-1',
      projectId: 'proj-1',
      serviceName: 'api',
      startTime: new Date('2024-01-01T00:00:00Z'),
      endTime: new Date('2024-01-01T00:00:05Z'),
      durationMs: 5000,
      spanCount: 3,
      error: false,
      ...overrides,
    });

    it('upserts a trace with a single atomic ON CONFLICT statement', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      await engine.connect();

      await engine.upsertTrace(makeTrace());

      // A single statement now does the whole upsert (no read-modify-write).
      expect(mockQuery).toHaveBeenCalledTimes(1);
      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).toContain('INSERT INTO public.traces');
      expect(sql).toContain('ON CONFLICT (trace_id, project_id) DO UPDATE');
    });

    it('merges times and span count in SQL, not via a prior read', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      await engine.connect();

      await engine.upsertTrace(makeTrace({
        startTime: new Date('2024-01-01T00:00:00Z'),
        endTime: new Date('2024-01-01T00:00:05Z'),
        spanCount: 1,
      }));

      // Only one query: no SELECT of the existing row.
      expect(mockQuery).toHaveBeenCalledTimes(1);
      const sql = mockQuery.mock.calls[0][0] as string;
      // Time window widened and span_count accumulated atomically in SQL.
      expect(sql).toContain('LEAST(public.traces.start_time, EXCLUDED.start_time)');
      expect(sql).toContain('GREATEST(public.traces.end_time, EXCLUDED.end_time)');
      expect(sql).toContain('public.traces.span_count + EXCLUDED.span_count');

      // Params carry the raw new values; the merge is done by the DB.
      const params = mockQuery.mock.calls[0][1] as unknown[];
      expect((params[6] as Date).toISOString()).toBe('2024-01-01T00:00:00.000Z'); // start_time
      expect((params[7] as Date).toISOString()).toBe('2024-01-01T00:00:05.000Z'); // end_time
      expect(params[9]).toBe(1); // span_count
    });
  });

  describe('querySpans', () => {
    it('queries spans with filters and pagination', async () => {
      // COUNT query
      mockQuery.mockResolvedValueOnce({ rows: [{ count: 15 }] });
      // SELECT query
      mockQuery.mockResolvedValueOnce({
        rows: [{
          time: new Date('2024-01-01T00:00:00Z'),
          span_id: 'span-1',
          trace_id: 'trace-1',
          parent_span_id: null,
          organization_id: null,
          project_id: 'proj-1',
          service_name: 'api',
          operation_name: 'GET /users',
          start_time: new Date('2024-01-01T00:00:00Z'),
          end_time: new Date('2024-01-01T00:00:01Z'),
          duration_ms: 1000,
          kind: 'server',
          status_code: 'ok',
          status_message: null,
          attributes: null,
          events: null,
          links: null,
          resource_attributes: null,
        }],
      });
      await engine.connect();

      const result = await engine.querySpans({
        projectId: 'proj-1',
        from: new Date('2024-01-01'),
        to: new Date('2024-01-02'),
        limit: 10,
      });

      expect(result.spans).toHaveLength(1);
      expect(result.spans[0].spanId).toBe('span-1');
      expect(result.spans[0].serviceName).toBe('api');
      expect(result.total).toBe(15);
      expect(result.hasMore).toBe(true);
      expect(result.limit).toBe(10);

      const countSql = mockQuery.mock.calls[0][0] as string;
      expect(countSql).toContain('COUNT(*)');
      expect(countSql).toContain('public.spans');

      const selectSql = mockQuery.mock.calls[1][0] as string;
      expect(selectSql).toContain('FROM public.spans');
      expect(selectSql).toContain('project_id = ANY');
      expect(selectSql).toContain('LIMIT');
      expect(selectSql).toContain('OFFSET');
    });

    it('applies service and kind filters', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ count: 0 }] });
      mockQuery.mockResolvedValueOnce({ rows: [] });
      await engine.connect();

      await engine.querySpans({
        projectId: 'proj-1',
        serviceName: 'api',
        kind: 'client',
        from: new Date('2024-01-01'),
        to: new Date('2024-01-02'),
      });

      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).toContain('service_name = ANY');
      expect(sql).toContain('kind = ANY');
    });
  });

  describe('getSpansByTraceId', () => {
    it('fetches all spans for a trace ordered by start_time', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          { time: new Date(), span_id: 'span-1', trace_id: 'trace-1', parent_span_id: null, organization_id: null, project_id: 'proj-1', service_name: 'api', operation_name: 'op1', start_time: new Date('2024-01-01T00:00:00Z'), end_time: new Date('2024-01-01T00:00:01Z'), duration_ms: 1000, kind: null, status_code: null, status_message: null, attributes: null, events: null, links: null, resource_attributes: null },
          { time: new Date(), span_id: 'span-2', trace_id: 'trace-1', parent_span_id: 'span-1', organization_id: null, project_id: 'proj-1', service_name: 'db', operation_name: 'query', start_time: new Date('2024-01-01T00:00:00.500Z'), end_time: new Date('2024-01-01T00:00:00.800Z'), duration_ms: 300, kind: null, status_code: null, status_message: null, attributes: null, events: null, links: null, resource_attributes: null },
        ],
      });
      await engine.connect();

      const spans = await engine.getSpansByTraceId('trace-1', 'proj-1');

      expect(spans).toHaveLength(2);
      expect(spans[0].spanId).toBe('span-1');
      expect(spans[1].parentSpanId).toBe('span-1');

      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).toContain('trace_id = $1');
      expect(sql).toContain('project_id = $2');
      expect(sql).toContain('ORDER BY start_time ASC');
    });
  });

  describe('queryTraces', () => {
    it('queries traces with filters', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ count: 1 }] });
      mockQuery.mockResolvedValueOnce({
        rows: [{
          trace_id: 'trace-1',
          organization_id: null,
          project_id: 'proj-1',
          service_name: 'api',
          root_service_name: 'api',
          root_operation_name: 'GET /users',
          start_time: new Date('2024-01-01T00:00:00Z'),
          end_time: new Date('2024-01-01T00:00:05Z'),
          duration_ms: 5000,
          span_count: 3,
          error: false,
        }],
      });
      await engine.connect();

      const result = await engine.queryTraces({
        projectId: 'proj-1',
        from: new Date('2024-01-01'),
        to: new Date('2024-01-02'),
        error: false,
        minDurationMs: 1000,
      });

      expect(result.traces).toHaveLength(1);
      expect(result.traces[0].traceId).toBe('trace-1');
      expect(result.traces[0].durationMs).toBe(5000);
      expect(result.total).toBe(1);

      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).toContain('public.traces');
      expect(sql).toContain('error = $');
      expect(sql).toContain('duration_ms >= $');
    });
  });

  describe('getTraceById', () => {
    it('returns trace when found', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{
          trace_id: 'trace-1',
          organization_id: null,
          project_id: 'proj-1',
          service_name: 'api',
          root_service_name: 'api',
          root_operation_name: 'GET /users',
          start_time: new Date('2024-01-01T00:00:00Z'),
          end_time: new Date('2024-01-01T00:00:05Z'),
          duration_ms: 5000,
          span_count: 3,
          error: false,
        }],
      });
      await engine.connect();

      const trace = await engine.getTraceById('trace-1', 'proj-1');

      expect(trace).not.toBeNull();
      expect(trace!.traceId).toBe('trace-1');
      expect(trace!.spanCount).toBe(3);
    });

    it('returns null when not found', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      await engine.connect();

      const trace = await engine.getTraceById('nonexistent', 'proj-1');
      expect(trace).toBeNull();
    });
  });

  describe('getServiceDependencies', () => {
    it('returns nodes and edges from span relationships', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          { source_service: 'api', target_service: 'db', call_count: 10 },
          { source_service: 'api', target_service: 'cache', call_count: 5 },
        ],
      });
      await engine.connect();

      const result = await engine.getServiceDependencies(
        'proj-1',
        new Date('2024-01-01'),
        new Date('2024-01-02'),
      );

      expect(result.edges).toHaveLength(2);
      expect(result.edges[0]).toEqual({ source: 'api', target: 'db', callCount: 10 });
      expect(result.edges[1]).toEqual({ source: 'api', target: 'cache', callCount: 5 });

      expect(result.nodes).toHaveLength(3);
      const apiNode = result.nodes.find(n => n.name === 'api');
      expect(apiNode!.callCount).toBe(15);

      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).toContain('INNER JOIN');
      expect(sql).toContain('parent_span_id = parent.span_id');
      expect(sql).toContain('service_name <> parent.service_name');
    });

    it('returns empty result when no dependencies', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      await engine.connect();

      const result = await engine.getServiceDependencies('proj-1');
      expect(result.nodes).toHaveLength(0);
      expect(result.edges).toHaveLength(0);
    });
  });

  describe('getServiceHealthStats', () => {
    it('computes per-service stats with a true window p95 from raw spans', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          { service_name: 'api', total_calls: '100', total_errors: '5', avg_latency_ms: 120.5, p95_latency_ms: 480 },
          { service_name: 'db', total_calls: '40', total_errors: '0', avg_latency_ms: 12, p95_latency_ms: null },
        ],
      });
      await engine.connect();

      const result = await engine.getServiceHealthStats(
        'proj-1',
        new Date('2024-01-01'),
        new Date('2024-01-02'),
      );

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        serviceName: 'api',
        totalCalls: 100,
        totalErrors: 5,
        avgLatencyMs: 120.5,
        p95LatencyMs: 480,
      });
      expect(result[1].p95LatencyMs).toBeNull();

      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).toContain('percentile_cont(0.95)');
      expect(sql).toContain('FROM public.spans');
      expect(sql).toContain('GROUP BY service_name');
    });
  });

  describe('getSpanTimeseries', () => {
    it('returns empty without querying when no projects are given', async () => {
      await engine.connect();
      const result = await engine.getSpanTimeseries({
        projectIds: [],
        from: new Date('2024-01-01'),
        to: new Date('2024-01-02'),
        bucket: 'hour',
      });
      expect(result).toEqual([]);
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('buckets span volume + latency percentiles from raw spans', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          { bucket: '2024-01-01T00:00:00Z', span_count: 100, error_count: 5, p50: 80, p95: 480, p99: 900 },
          { bucket: '2024-01-01T01:00:00Z', span_count: 40, error_count: 0, p50: 10, p95: null, p99: null },
        ],
      });
      await engine.connect();

      const result = await engine.getSpanTimeseries({
        projectIds: ['proj-1', 'proj-2'],
        from: new Date('2024-01-01'),
        to: new Date('2024-01-02'),
        bucket: 'hour',
        serviceName: 'api',
      });

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        time: new Date('2024-01-01T00:00:00Z'),
        spanCount: 100,
        errorCount: 5,
        p50: 80,
        p95: 480,
        p99: 900,
      });
      expect(result[1].p95).toBeNull();

      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).toContain("date_trunc('hour', start_time)");
      expect(sql).toContain('percentile_cont(0.5)');
      expect(sql).toContain('percentile_cont(0.95)');
      expect(sql).toContain('percentile_cont(0.99)');
      expect(sql).toContain('FROM public.spans');
      expect(sql).toContain('project_id = ANY($1)');
      // serviceName adds the 4th positional filter
      const params = mockQuery.mock.calls[0][1] as unknown[];
      expect(params[3]).toBe('api');
    });

    it('uses a daily bucket for wide ranges', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      await engine.connect();
      await engine.getSpanTimeseries({
        projectIds: ['proj-1'],
        from: new Date('2024-01-01'),
        to: new Date('2024-01-08'),
        bucket: 'day',
      });
      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).toContain("date_trunc('day', start_time)");
    });
  });

  describe('deleteSpansByTimeRange', () => {
    it('deletes spans and orphaned traces', async () => {
      // DELETE spans
      mockQuery.mockResolvedValueOnce({ rowCount: 5 });
      // DELETE orphaned traces
      mockQuery.mockResolvedValueOnce({ rowCount: 1 });
      await engine.connect();

      const result = await engine.deleteSpansByTimeRange({
        projectId: 'proj-1',
        from: new Date('2024-01-01'),
        to: new Date('2024-01-02'),
      });

      expect(result.deleted).toBe(5);

      const deleteSql = mockQuery.mock.calls[0][0] as string;
      expect(deleteSql).toContain('DELETE FROM public.spans');
      expect(deleteSql).toContain('project_id = ANY');
      expect(deleteSql).toContain('time >= $2');
      expect(deleteSql).toContain('time <= $3');

      const orphanSql = mockQuery.mock.calls[1][0] as string;
      expect(orphanSql).toContain('DELETE FROM public.traces');
      expect(orphanSql).toContain('NOT EXISTS');
    });

    it('applies service filter when provided', async () => {
      mockQuery.mockResolvedValueOnce({ rowCount: 2 });
      mockQuery.mockResolvedValueOnce({ rowCount: 0 });
      await engine.connect();

      await engine.deleteSpansByTimeRange({
        projectId: 'proj-1',
        from: new Date('2024-01-01'),
        to: new Date('2024-01-02'),
        serviceName: 'api',
      });

      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).toContain('service_name = ANY');
    });
  });
});

describe('TimescaleQueryTranslator', () => {
  const translator = new TimescaleQueryTranslator('public', 'logs');

  describe('translateQuery', () => {
    it('generates basic query with time range', () => {
      const result = translator.translateQuery({
        projectId: 'proj-1',
        from: new Date('2024-01-01'),
        to: new Date('2024-01-02'),
      });

      expect(result.query).toContain('SELECT * FROM public.logs');
      expect(result.query).toContain('project_id = $1');
      expect(result.query).toContain('time >= $2');
      expect(result.query).toContain('time <= $3');
      expect(result.query).toContain('ORDER BY time DESC, id DESC');
      expect(result.query).toContain('LIMIT $4');
      expect(result.parameters).toHaveLength(4);
      // limit+1 pattern
      expect(result.parameters![3]).toBe(51);
    });

    it('generates query with all filters', () => {
      const result = translator.translateQuery({
        projectId: 'proj-1',
        service: 'api',
        level: 'error',
        hostname: 'host-1',
        traceId: 'trace-123',
        from: new Date('2024-01-01'),
        to: new Date('2024-01-02'),
        limit: 20,
      });

      expect(result.query).toContain('project_id = $1');
      expect(result.query).toContain('service = $2');
      expect(result.query).toContain('level = $3');
      expect(result.query).toContain("metadata->>'hostname' = $4");
      expect(result.query).toContain('trace_id = $5');
      expect(result.parameters![result.parameters!.length - 1]).toBe(21); // limit+1
    });

    it('emits project_id filter when projectId is a string', () => {
      const result = translator.translateQuery({
        projectId: 'proj-1',
        from: new Date('2024-01-01'),
        to: new Date('2024-01-02'),
      });

      expect(result.query).toContain('project_id = $1');
      expect(result.query).not.toContain('organization_id');
    });

    it('skips project_id filter for GLOBAL_SCOPE', () => {
      const result = translator.translateQuery({
        projectId: GLOBAL_SCOPE,
        from: new Date('2024-01-01'),
        to: new Date('2024-01-02'),
      });

      expect(result.query).not.toContain('project_id');
      expect(result.query).not.toContain('organization_id');
    });

    it('uses ANY for array values', () => {
      const result = translator.translateQuery({
        projectId: ['proj-1', 'proj-2'],
        service: ['api', 'worker'],
        from: new Date('2024-01-01'),
        to: new Date('2024-01-02'),
      });

      expect(result.query).toContain('project_id = ANY($1)');
      expect(result.query).toContain('service = ANY($2)');
    });

    it('handles offset', () => {
      const result = translator.translateQuery({
        projectId: 'proj-1',
        from: new Date('2024-01-01'),
        to: new Date('2024-01-02'),
        offset: 100,
      });

      expect(result.query).toContain('OFFSET');
      expect(result.parameters).toContain(100);
    });
  });

  describe('translateQuery exclusive bounds', () => {
    it('uses > for fromExclusive', () => {
      const result = translator.translateQuery({
        projectId: 'proj-1',
        from: new Date('2024-01-01'),
        to: new Date('2024-01-02'),
        fromExclusive: true,
      });

      expect(result.query).toContain('time > $');
      expect(result.query).not.toMatch(/time >= \$/);
    });

    it('uses < for toExclusive', () => {
      const result = translator.translateQuery({
        projectId: 'proj-1',
        from: new Date('2024-01-01'),
        to: new Date('2024-01-02'),
        toExclusive: true,
      });

      expect(result.query).toContain('time < $');
      // Should not have time <= for the to bound
      expect(result.query).not.toMatch(/time <= \$/);
    });

    it('supports sortOrder asc', () => {
      const result = translator.translateQuery({
        projectId: 'proj-1',
        from: new Date('2024-01-01'),
        to: new Date('2024-01-02'),
        sortOrder: 'asc',
      });

      expect(result.query).toContain('ORDER BY time ASC, id ASC');
    });
  });

  describe('translateTopValues', () => {
    it('generates GROUP BY query for service field', () => {
      const result = translator.translateTopValues({
        field: 'service',
        projectId: 'proj-1',
        from: new Date('2024-01-01'),
        to: new Date('2024-01-02'),
        limit: 5,
      });

      expect(result.query).toContain('service AS value');
      expect(result.query).toContain('COUNT(*) AS count');
      expect(result.query).toContain('GROUP BY value');
      expect(result.query).toContain('ORDER BY count DESC');
      expect(result.query).toContain('LIMIT');
    });

    it('includes level filter', () => {
      const result = translator.translateTopValues({
        field: 'message',
        projectId: 'proj-1',
        from: new Date('2024-01-01'),
        to: new Date('2024-01-02'),
        level: ['error', 'critical'],
      });

      expect(result.query).toContain('level = ANY');
    });

    it('rejects unsafe field names', () => {
      expect(() =>
        translator.translateTopValues({
          field: 'service; DROP TABLE logs',
          projectId: 'proj-1',
          from: new Date('2024-01-01'),
          to: new Date('2024-01-02'),
        })
      ).toThrow();
    });
  });

  describe('translateAggregate', () => {
    it('generates aggregate query', () => {
      const result = translator.translateAggregate({
        projectId: 'proj-1',
        from: new Date('2024-01-01'),
        to: new Date('2024-01-02'),
        interval: '1h',
      });

      expect(result.query).toContain('time_bucket($1, time) AS bucket');
      expect(result.query).toContain('level');
      expect(result.query).toContain('COUNT(*)');
      expect(result.query).toContain('GROUP BY bucket, level');
      expect(result.query).toContain('ORDER BY bucket ASC');
      expect(result.parameters![0]).toBe('1 hour');
    });

    it('maps all interval values correctly', () => {
      const intervals = [
        ['1m', '1 minute'],
        ['5m', '5 minutes'],
        ['15m', '15 minutes'],
        ['1h', '1 hour'],
        ['6h', '6 hours'],
        ['1d', '1 day'],
        ['1w', '1 week'],
      ] as const;

      for (const [input, expected] of intervals) {
        const result = translator.translateAggregate({
          projectId: 'proj-1',
          from: new Date('2024-01-01'),
          to: new Date('2024-01-02'),
          interval: input,
        });
        expect(result.parameters![0]).toBe(expected);
      }
    });
  });
});
