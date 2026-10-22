import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GLOBAL_SCOPE } from '../../core/types.js';
import type { StorageConfig, LogRecord, SpanRecord, TraceRecord } from '../../core/types.js';

const mockQuery = vi.fn();
const mockEnd = vi.fn();

vi.mock('pg', () => {
  return {
    default: {
      Pool: vi.fn(function () {
        return {
          query: mockQuery,
          end: mockEnd,
        };
      }),
    },
  };
});

import { TimescaleEngine } from './timescale-engine.js';
import { TimescaleQueryTranslator } from './query-translator.js';
import { decodeSessionCursor, encodeSessionCursor } from '../../core/aggregation-helpers.js';

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

    it('adds session_id column and index for standalone installs', async () => {
      mockQuery.mockResolvedValue({ rows: [] });
      await engine.connect();
      await engine.initialize();
      const calls = mockQuery.mock.calls.map((c) => String(c[0]));
      expect(calls.some((q) => q.includes('ADD COLUMN IF NOT EXISTS session_id TEXT'))).toBe(true);
      expect(calls.some((q) => q.includes('idx_logs_session_id'))).toBe(true);
    });

    it('creates the spans hypertable and the traces table for standalone installs', async () => {
      mockQuery.mockResolvedValue({ rows: [] });
      await engine.connect();
      await engine.initialize();
      const calls = mockQuery.mock.calls.map((c) => String(c[0]));
      expect(calls.some((q) => q.includes('CREATE TABLE IF NOT EXISTS public.spans'))).toBe(true);
      expect(calls.some((q) => q.includes("create_hypertable('public.spans'"))).toBe(true);
      expect(calls.some((q) => q.includes('CREATE TABLE IF NOT EXISTS public.traces'))).toBe(true);
      expect(calls.some((q) => q.includes('PRIMARY KEY (trace_id, project_id)'))).toBe(true);
      for (const index of [
        'idx_spans_trace_id', 'idx_spans_project_time', 'idx_spans_service', 'idx_spans_operation', 'idx_spans_parent',
        'idx_traces_project_time', 'idx_traces_service', 'idx_traces_duration',
      ]) {
        expect(calls.some((q) => q.includes(index)), index).toBe(true);
      }
    });

    it('does not add retention policies to the standalone span tables', async () => {
      mockQuery.mockResolvedValue({ rows: [] });
      await engine.connect();
      await engine.initialize();
      const calls = mockQuery.mock.calls.map((c) => String(c[0]));
      expect(calls.some((q) => q.includes('add_retention_policy'))).toBe(false);
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
      const params = mockQuery.mock.calls[0][1] as unknown[];
      // Legacy fulltext search is the AND of its words, one term per word.
      expect(sql.match(/plainto_tsquery\('english', \$\d+\)/g)).toHaveLength(2);
      expect(sql.match(/message ~\* \$\d+/g)).toHaveLength(2);
      expect(params).toContain('error');
      expect(params).toContain('message');
      expect(params).not.toContain('error message');
      expect(params).toContain('\\merror\\M');
      expect(params).toContain('\\mmessage\\M');
    });

    it('reads textQuery instead of a legacy search passed next to it', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      await engine.connect();

      await engine.query({
        projectId: 'proj-1',
        from: new Date('2024-01-01'),
        to: new Date('2024-01-02'),
        search: 'ignored',
        textQuery: { all: [{ kind: 'phrase', value: 'refused by' }], anyOf: [], none: [] },
      });

      const sql = mockQuery.mock.calls[0][0] as string;
      const params = mockQuery.mock.calls[0][1] as unknown[];
      expect(sql).toContain('message ILIKE $');
      expect(sql).not.toContain('plainto_tsquery');
      expect(params).toContain('%refused by%');
      expect(params).not.toContain('ignored');
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

  describe('histogram', () => {
    const from = new Date('2026-01-05T10:00:00Z');
    const to = new Date('2026-01-05T10:20:00Z');

    it('maps grouped rows into zero-filled epoch-aligned buckets', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          { bucket_s: String(from.getTime() / 1000), level: 'info', n: 3 },
          { bucket_s: String(from.getTime() / 1000 + 1200), level: 'error', n: 1 },
        ],
      });
      await engine.connect();

      const result = await engine.histogram({ projectId: 'proj-1', from, to, bucketSeconds: 600 });

      expect(result.bucketSeconds).toBe(600);
      expect(result.buckets.map((b) => [b.time.toISOString(), b.total, b.byLevel])).toEqual([
        ['2026-01-05T10:00:00.000Z', 3, { info: 3 }],
        ['2026-01-05T10:10:00.000Z', 0, {}],
        ['2026-01-05T10:20:00.000Z', 1, { error: 1 }],
      ]);
      const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('AS bucket_s');
      expect(sql).toContain('FROM public.logs WHERE project_id = $2');
      expect(params[0]).toBe(600);
    });

    it('rejects invalid bucket sizes and oversized ranges before querying', async () => {
      await engine.connect();
      await expect(engine.histogram({ projectId: 'proj-1', from, to, bucketSeconds: 0 })).rejects.toBeInstanceOf(RangeError);
      await expect(engine.histogram({ projectId: 'proj-1', from, to, bucketSeconds: 1.5 })).rejects.toBeInstanceOf(RangeError);
      await expect(
        engine.histogram({ projectId: 'proj-1', from: new Date(0), to, bucketSeconds: 1 }),
      ).rejects.toBeInstanceOf(RangeError);
      expect(mockQuery).not.toHaveBeenCalled();
    });
  });

  describe('facets', () => {
    const from = new Date('2026-01-05T10:00:00Z');
    const to = new Date('2026-01-05T10:20:00Z');
    const lastParam = () => (mockQuery.mock.calls.at(-1) as [string, unknown[]])[1].at(-1);

    it('limit defaults to 10 and clamps to 1..50', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] });
      await engine.connect();
      await engine.facets({ projectId: 'proj-1', from, to, fields: [{ builtin: 'level' }] });
      expect(lastParam()).toBe(10);
      await engine.facets({ projectId: 'proj-1', from, to, fields: [{ builtin: 'level' }], limit: 0 });
      expect(lastParam()).toBe(1);
      await engine.facets({ projectId: 'proj-1', from, to, fields: [{ builtin: 'level' }], limit: 99 });
      expect(lastParam()).toBe(50);
    });

    it('rejects more than 20 fields before querying', async () => {
      await engine.connect();
      const fields = Array.from({ length: 21 }, (_, i) => ({ metadata: `k${i}` }));
      await expect(engine.facets({ projectId: 'proj-1', from, to, fields })).rejects.toBeInstanceOf(RangeError);
      await expect(engine.facets({ projectId: 'proj-1', from, to, fields: [] })).rejects.toBeInstanceOf(RangeError);
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('maps rows to facets in request order', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          { f: 1, v: 'api', cnt: '3', total: '4' },
          { f: 0, v: 'error', cnt: '2', total: '2' },
        ],
      });
      await engine.connect();
      const result = await engine.facets({
        projectId: 'proj-1', from, to, fields: [{ builtin: 'level' }, { builtin: 'service' }], limit: 1,
      });
      expect(result.facets).toEqual([
        { field: 'level', values: [{ value: 'error', count: 2 }], otherCount: 0 },
        { field: 'service', values: [{ value: 'api', count: 3 }], otherCount: 1 },
      ]);
    });
  });

  describe('discoverMetadataKeys', () => {
    const from = new Date('2026-01-05T10:00:00Z');
    const to = new Date('2026-01-05T11:00:00Z');
    const sampleParam = () => (mockQuery.mock.calls.at(-1) as [string, unknown[]])[1][3];

    it('sample size defaults to 1000 and clamps to 1..5000', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] });
      await engine.connect();
      await engine.discoverMetadataKeys({ projectId: 'proj-1', from, to });
      expect(sampleParam()).toBe(1000);
      await engine.discoverMetadataKeys({ projectId: 'proj-1', from, to, sampleSize: 99999 });
      expect(sampleParam()).toBe(5000);
      await engine.discoverMetadataKeys({ projectId: 'proj-1', from, to, sampleSize: 0 });
      expect(sampleParam()).toBe(1);
    });

    it('maps rows and reads bigint counts', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ key: 'env', occurrences: '12' }, { key: 'http.method', occurrences: 3 }] });
      await engine.connect();
      expect(await engine.discoverMetadataKeys({ projectId: 'proj-1', from, to })).toEqual([
        { key: 'env', occurrences: 12 },
        { key: 'http.method', occurrences: 3 },
      ]);
    });

    it('rejects a reversed range before querying', async () => {
      await engine.connect();
      await expect(engine.discoverMetadataKeys({ projectId: 'proj-1', from: to, to: from })).rejects.toBeInstanceOf(RangeError);
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('casts the project list to uuid for a uuid project column', async () => {
      const uuidEngine = new TimescaleEngine(config, { projectIdType: 'uuid' });
      mockQuery.mockResolvedValueOnce({ rows: [] });
      await uuidEngine.connect();
      await uuidEngine.discoverMetadataKeys({ projectId: 'proj-1', from, to });
      expect(String(mockQuery.mock.calls.at(-1)?.[0])).toContain('unnest($1::uuid[])');
    });
  });

  describe('listSessions / hasSessions', () => {
    const from = new Date('2026-01-05T10:00:00Z');
    const to = new Date('2026-01-05T11:00:00Z');
    const row = (sessionId: string, last: string) => ({
      session_id: sessionId,
      service: 'api',
      first_event: new Date('2026-01-05T10:00:00Z'),
      last_event: new Date(last),
      event_count: '3',
      error_count: '1',
    });

    it('returns limit rows and a cursor at the last one when more exist', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [row('s1', '2026-01-05T10:05:00.123Z'), row('s2', '2026-01-05T10:05:00.123Z'), row('s3', '2026-01-05T10:01:00Z')],
      });
      await engine.connect();
      const result = await engine.listSessions({ projectId: 'proj-1', from, to, limit: 2 });
      expect(result.sessions.map((s) => s.sessionId)).toEqual(['s1', 's2']);
      expect(result.sessions[0]).toEqual({
        sessionId: 's1', service: 'api', firstEvent: new Date('2026-01-05T10:00:00Z'),
        lastEvent: new Date('2026-01-05T10:05:00.123Z'), eventCount: 3, errorCount: 1,
      });
      expect(decodeSessionCursor(result.nextCursor!)).toEqual({ lastEvent: new Date('2026-01-05T10:05:00.123Z'), sessionId: 's2' });
      expect((mockQuery.mock.calls[0][1] as unknown[]).at(-1)).toBe(3);
    });

    it('a short page has no cursor; a cursor continues after its row', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [row('s3', '2026-01-05T10:01:00Z')] });
      await engine.connect();
      const cursor = encodeSessionCursor(new Date('2026-01-05T10:05:00.123Z'), 's2');
      const result = await engine.listSessions({ projectId: 'proj-1', from, to, limit: 2, cursor });
      expect(result).toEqual({ sessions: [expect.objectContaining({ sessionId: 's3' })] });
      const params = mockQuery.mock.calls[0][1] as unknown[];
      expect(params).toContainEqual(new Date('2026-01-05T10:05:00.123Z'));
      expect(params).toContain('s2');
    });

    it('limit clamps to the sessions maximum and fetches one extra row', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      await engine.connect();
      await engine.listSessions({ projectId: 'proj-1', from, to, limit: 9999 });
      expect((mockQuery.mock.calls[0][1] as unknown[]).at(-1)).toBe(201);
    });

    it('rejects an undecodable cursor and a bad limit before querying', async () => {
      await engine.connect();
      await expect(engine.listSessions({ projectId: 'proj-1', from, to, limit: 2, cursor: '%%%' })).rejects.toBeInstanceOf(RangeError);
      await expect(engine.listSessions({ projectId: 'proj-1', from, to, limit: 0 })).rejects.toBeInstanceOf(RangeError);
      await expect(engine.hasSessions({ projectId: 'proj-1', from: to, to: from })).rejects.toBeInstanceOf(RangeError);
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('hasSessions is true when the probe finds a row', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] }).mockResolvedValueOnce({ rows: [] });
      await engine.connect();
      expect(await engine.hasSessions({ projectId: 'proj-1', from, to })).toBe(true);
      expect(await engine.hasSessions({ projectId: 'proj-1', from, to })).toBe(false);
      expect(mockQuery.mock.calls[0][0] as string).toContain('LIMIT 1');
    });
  });

  describe('countEstimate', () => {
    const countParams = {
      projectId: 'proj-1',
      from: new Date('2024-01-01'),
      to: new Date('2024-01-02'),
    };

    it('returns an exact COUNT when the planner estimate is small', async () => {
      // EXPLAIN reports a small estimate, so we fall back to an exact count.
      mockQuery.mockResolvedValueOnce({ rows: [{ 'QUERY PLAN': [{ Plan: { 'Plan Rows': 3 } }] }] });
      mockQuery.mockResolvedValueOnce({ rows: [{ count: '42' }] });
      await engine.connect();

      const result = await engine.countEstimate(countParams);

      expect(result.count).toBe(42);
      expect(mockQuery).toHaveBeenCalledTimes(2);
      const explainSql = mockQuery.mock.calls[0][0] as string;
      const countSql = mockQuery.mock.calls[1][0] as string;
      expect(explainSql).toContain('EXPLAIN (FORMAT JSON)');
      expect(countSql).toContain('COUNT(*)');
      expect(countSql).not.toContain('EXPLAIN');
    });

    it('keeps the fast planner estimate for large datasets', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ 'QUERY PLAN': [{ Plan: { 'Plan Rows': 1_000_000 } }] }] });
      await engine.connect();

      const result = await engine.countEstimate(countParams);

      expect(result.count).toBe(1_000_000);
      // Only the EXPLAIN runs; no exact count.
      expect(mockQuery).toHaveBeenCalledTimes(1);
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

    it('adds MAX(time) when includeLastSeen is set', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ value: 'a', count: '2', last_seen: new Date('2026-01-01T00:00:00Z') }],
      });
      await engine.connect();

      const result = await engine.topValues({
        field: 'metadata.geo_place',
        projectId: 'p1',
        from: new Date('2026-01-01'),
        to: new Date('2026-01-02'),
        limit: 10,
        includeLastSeen: true,
      });

      const sql = mockQuery.mock.calls.at(-1)![0] as string;
      expect(sql).toContain('MAX(time) AS last_seen');
      expect(result.values[0].lastSeen).toBe('2026-01-01T00:00:00.000Z');
    });

    it('omits last_seen when includeLastSeen is not set', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ value: 'a', count: '2' }] });
      await engine.connect();

      const result = await engine.topValues({
        field: 'service',
        projectId: 'p1',
        from: new Date(),
        to: new Date(),
        limit: 5,
      });

      expect(mockQuery.mock.calls.at(-1)![0]).not.toContain('last_seen');
      expect(result.values[0].lastSeen).toBeUndefined();
      expect('lastSeen' in result.values[0]).toBe(false);
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

    it('filters operation_name for a string or a list', async () => {
      mockQuery.mockResolvedValue({ rows: [{ count: 0 }] });
      await engine.connect();

      await engine.querySpans({ projectId: 'proj-1', operationName: 'GET /x', from: new Date('2024-01-01'), to: new Date('2024-01-02') });
      await engine.querySpans({ projectId: 'proj-1', operationName: ['GET /x', 'POST /y'], from: new Date('2024-01-01'), to: new Date('2024-01-02') });

      for (const [i, expected] of [[0, ['GET /x']], [2, ['GET /x', 'POST /y']]] as const) {
        const [countSql, countParams] = mockQuery.mock.calls[i] as [string, unknown[]];
        const [selectSql] = mockQuery.mock.calls[i + 1] as [string, unknown[]];
        expect(countSql).toMatch(/operation_name = ANY\(\$\d+\)/);
        expect(selectSql).toMatch(/operation_name = ANY\(\$\d+\)/);
        expect(countParams).toContainEqual(expected);
      }
    });

    it('applies attribute filters and the sort to count and page alike', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ count: 0 }] });
      mockQuery.mockResolvedValueOnce({ rows: [] });
      await engine.connect();

      await engine.querySpans({
        projectId: 'proj-1',
        attributeFilters: [{ key: 'resource.service.version', op: 'equals', value: '1.2', include_missing: false }],
        sortBy: 'duration',
        sortOrder: 'desc',
        from: new Date('2024-01-01'),
        to: new Date('2024-01-02'),
      });

      const [countSql, countParams] = mockQuery.mock.calls[0] as [string, unknown[]];
      const [pageSql] = mockQuery.mock.calls[1] as [string, unknown[]];
      expect(countSql).toContain('COALESCE(resource_attributes -> (');
      expect(countParams).toContainEqual(['service.version', 'service', 'version']);
      expect(pageSql).toContain('COALESCE(resource_attributes -> (');
      expect(pageSql).toContain('ORDER BY duration_ms DESC, span_id ASC');
    });

    it('falls back to start_time ASC for an unknown sort key', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ count: 0 }] });
      mockQuery.mockResolvedValueOnce({ rows: [] });
      await engine.connect();

      await engine.querySpans({
        projectId: 'proj-1',
        sortBy: 'kind; DROP TABLE spans' as never,
        from: new Date('2024-01-01'),
        to: new Date('2024-01-02'),
      });

      const pageSql = mockQuery.mock.calls[1][0] as string;
      expect(pageSql).toContain('ORDER BY start_time ASC, span_id ASC');
      expect(pageSql).not.toContain('DROP');
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

    it('matches operation and attributes on one span; count and page share the WHERE', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ count: 0 }] });
      mockQuery.mockResolvedValueOnce({ rows: [] });
      await engine.connect();

      await engine.queryTraces({
        projectId: 'proj-1',
        serviceName: ['api'],
        operation: 'GET /x',
        attributeFilters: [{ key: 'http.method', op: 'equals', value: 'GET', include_missing: false }],
        from: new Date('2024-01-01'),
        to: new Date('2024-01-02'),
        sortBy: 'duration',
        sortOrder: 'asc',
        limit: 5,
      });

      const [countSql, countParams] = mockQuery.mock.calls[0] as [string, unknown[]];
      const [pageSql, pageParams] = mockQuery.mock.calls[1] as [string, unknown[]];
      const where = (sql: string) => sql.slice(sql.indexOf('WHERE')).split(/\s+ORDER BY/)[0].trim();
      expect(where(pageSql)).toBe(where(countSql));
      expect(countSql).toContain('EXISTS (SELECT 1 FROM public.spans s WHERE s.project_id = traces.project_id');
      expect(countSql).toContain('s.operation_name = $');
      // serviceName keeps its trace-level meaning (F3 contract).
      expect(countSql).toContain('service_name = ANY(');
      expect(countSql).not.toContain('s.service_name');
      expect(pageSql).toContain('ORDER BY duration_ms ASC, trace_id ASC');
      expect(pageParams.slice(0, countParams.length)).toEqual(countParams);
      expect(pageParams.slice(countParams.length)).toEqual([5, 0]);
    });

    it('defaults to start_time desc with a trace_id tie-break and no span block', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ count: 0 }] });
      mockQuery.mockResolvedValueOnce({ rows: [] });
      await engine.connect();

      await engine.queryTraces({ projectId: 'proj-1', from: new Date('2024-01-01'), to: new Date('2024-01-02') });

      expect(mockQuery.mock.calls[0][0] as string).not.toContain('EXISTS');
      expect(mockQuery.mock.calls[1][0] as string).toContain('ORDER BY start_time DESC, trace_id ASC');
    });
  });

  describe('getOperationStats', () => {
    const scope = { projectId: 'proj-1', from: new Date('2026-01-05T10:00:00Z'), to: new Date('2026-01-05T12:00:00Z') };
    const statRow = { service_name: 'api', operation_name: 'GET /x', cnt: '2', error_count: '0', avg_ms: 15, p: [15, 19.5, 19.9] };
    const sqlOf = (i: number) => mockQuery.mock.calls[i][0] as string;

    it('uses the entry kinds when they have spans', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [statRow] });
      await engine.connect();
      const rows = await engine.getOperationStats(scope);
      expect(rows).toEqual([{ service: 'api', operation: 'GET /x', count: 2, errorCount: 0, avgMs: 15, p50Ms: 15, p95Ms: 19.5, p99Ms: 19.9 }]);
      expect(mockQuery).toHaveBeenCalledTimes(1);
      expect(sqlOf(0)).toContain('kind = ANY(');
    });

    it('falls back to root spans when the default kinds have none', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [statRow] });
      await engine.connect();
      expect(await engine.getOperationStats(scope)).toHaveLength(1);
      expect(mockQuery).toHaveBeenCalledTimes(2);
      expect(sqlOf(1)).toContain("(parent_span_id IS NULL OR parent_span_id = '')");
    });

    it('explicit kinds never fall back', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      await engine.connect();
      expect(await engine.getOperationStats({ ...scope, kinds: ['CLIENT'] })).toEqual([]);
      expect(mockQuery).toHaveBeenCalledTimes(1);
      expect(mockQuery.mock.calls[0][1]).toContainEqual(['CLIENT']);
    });

    it('limit defaults to 100 and clamps to 500; empty kinds reject before querying', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [statRow] }).mockResolvedValueOnce({ rows: [statRow] });
      await engine.connect();
      await engine.getOperationStats(scope);
      expect((mockQuery.mock.calls[0][1] as unknown[]).at(-1)).toBe(100);
      await engine.getOperationStats({ ...scope, limit: 9999 });
      expect((mockQuery.mock.calls[1][1] as unknown[]).at(-1)).toBe(500);
      await expect(engine.getOperationStats({ ...scope, kinds: [] })).rejects.toBeInstanceOf(RangeError);
      expect(mockQuery).toHaveBeenCalledTimes(2);
    });
  });

  describe('getLatencyHistogram', () => {
    const scope = { projectId: 'proj-1', from: new Date('2026-01-05T10:00:00Z'), to: new Date('2026-01-05T12:00:00Z') };
    const sqlOf = (i: number) => mockQuery.mock.calls[i][0] as string;

    it('entry spans with counts answer in one query', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ idx: 3, n: '4' }] });
      await engine.connect();
      const result = await engine.getLatencyHistogram(scope);
      expect(result.bounds).toEqual([1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 30000, 60000]);
      expect(result.counts).toHaveLength(17);
      expect(result.counts[3]).toBe(4);
      expect(mockQuery).toHaveBeenCalledTimes(1);
    });

    it('no entry span in scope falls back to root spans', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ idx: 16, n: 1 }] });
      await engine.connect();
      const result = await engine.getLatencyHistogram(scope);
      expect(result.counts[16]).toBe(1);
      expect(mockQuery).toHaveBeenCalledTimes(2);
      expect(sqlOf(1)).toContain("(parent_span_id IS NULL OR parent_span_id = '')");
    });

    it('with an operation, the fallback is decided by a probe on the service scope', async () => {
      // Entry spans exist (probe hit) but none for this operation: zeros, no fallback.
      mockQuery.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });
      await engine.connect();
      const zeros = await engine.getLatencyHistogram({ ...scope, operation: 'job loop' });
      expect(zeros.counts).toEqual(Array.from({ length: 17 }, () => 0));
      expect(mockQuery).toHaveBeenCalledTimes(2);
      expect(sqlOf(1)).toMatch(/^SELECT 1 FROM public\.spans WHERE .* LIMIT 1$/);
      expect(sqlOf(1)).not.toContain('operation_name');

      // No entry span at all (probe miss): root spans of that operation.
      mockQuery.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ idx: 0, n: 2 }] });
      const roots = await engine.getLatencyHistogram({ ...scope, operation: 'page load' });
      expect(roots.counts[0]).toBe(2);
      expect(sqlOf(4)).toContain("(parent_span_id IS NULL OR parent_span_id = '')");
      expect(sqlOf(4)).toContain('operation_name = $');
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

    it('metadata fields resolve the bound key once, with the shared candidates and S5 text', () => {
      const params = { projectId: 'proj-1', from: new Date('2024-01-01'), to: new Date('2024-01-02'), limit: 5 };
      const top = translator.translateTopValues({ ...params, field: 'metadata.performance.metric', includeLastSeen: true });
      expect(top.query).not.toContain('performance');
      expect(top.query).toContain('FROM (SELECT CASE WHEN jsonb_typeof(COALESCE(metadata -> ($4::text[])[1], ');
      expect(top.query).toContain("WHERE value IS NOT NULL AND value != '' GROUP BY value ORDER BY count DESC LIMIT $5");
      expect(top.query).toContain('MAX(time) AS last_seen');
      expect(top.parameters).toEqual(['proj-1', params.from, params.to, ['performance.metric', 'performance', 'metric'], 5]);
      const distinct = translator.translateDistinct({ ...params, field: 'metadata.region' });
      expect(distinct.query).toContain("SELECT CASE WHEN jsonb_typeof(metadata->$4) IN ('string', 'number', 'boolean')");
      expect(distinct.parameters).toEqual(['proj-1', params.from, params.to, 'region', 5]);
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
