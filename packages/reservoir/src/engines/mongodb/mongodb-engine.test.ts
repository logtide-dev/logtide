import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { StorageConfig } from '../../core/types.js';
import { MongoDBEngine } from './mongodb-engine.js';
import { MongoDBQueryTranslator } from './query-translator.js';
import { resolvedValueExpr, scalarTextExpr } from './json-path.js';

// ============================================================================
// Query Translator Unit Tests (no DB needed)
// ============================================================================

describe('MongoDBQueryTranslator', () => {
  const translator = new MongoDBQueryTranslator();

  describe('translateQuery', () => {
    it('builds a filter with projectId and time range', () => {
      const native = translator.translateQuery({
        projectId: 'p1',
        from: new Date('2024-01-01'),
        to: new Date('2024-01-02'),
      });

      const filter = native.query as Record<string, unknown>;
      expect(filter.project_id).toBe('p1');
      expect(filter.time).toEqual({
        $gte: new Date('2024-01-01'),
        $lte: new Date('2024-01-02'),
      });
      expect(native.metadata?.limit).toBe(50);
    });

    it('handles array projectId with $in', () => {
      const native = translator.translateQuery({
        projectId: ['p1', 'p2'],
        from: new Date('2024-01-01'),
        to: new Date('2024-01-02'),
      });
      const filter = native.query as Record<string, unknown>;
      expect(filter.project_id).toEqual({ $in: ['p1', 'p2'] });
    });

    it('handles exclusive time ranges', () => {
      const native = translator.translateQuery({
        projectId: 'p1',
        from: new Date('2024-01-01'),
        to: new Date('2024-01-02'),
        fromExclusive: true,
        toExclusive: true,
      });
      const filter = native.query as Record<string, unknown>;
      expect(filter.time).toEqual({
        $gt: new Date('2024-01-01'),
        $lt: new Date('2024-01-02'),
      });
    });

    it('adds service and level filters', () => {
      const native = translator.translateQuery({
        projectId: 'p1',
        from: new Date('2024-01-01'),
        to: new Date('2024-01-02'),
        service: 'api',
        level: ['error', 'critical'],
      });
      const filter = native.query as Record<string, unknown>;
      expect(filter.service).toBe('api');
      expect(filter.level).toEqual({ $in: ['error', 'critical'] });
    });

    // Legacy `search` is converted to text terms; whole-word regexes replace $text.
    const wordRe = (token: string) => `(?:^|[^\\p{L}\\p{N}_])${token}(?:$|[^\\p{L}\\p{N}_])`;

    it('fulltext search ANDs a whole-word regex per word, never $text', () => {
      const native = translator.translateQuery({
        projectId: 'p1',
        from: new Date('2024-01-01'),
        to: new Date('2024-01-02'),
        search: 'connection error',
      });
      const filter = native.query as Record<string, unknown>;
      expect(filter.$text).toBeUndefined();
      expect(filter.$and).toEqual([
        { message: { $regex: wordRe('connection'), $options: 'i' } },
        { message: { $regex: wordRe('error'), $options: 'i' } },
      ]);
    });

    it('uses regex for substring search mode', () => {
      const native = translator.translateQuery({
        projectId: 'p1',
        from: new Date('2024-01-01'),
        to: new Date('2024-01-02'),
        search: 'test',
        searchMode: 'substring',
      });
      const filter = native.query as Record<string, unknown>;
      expect(filter.$and).toEqual([{ message: { $regex: 'test', $options: 'i' } }]);
      expect(filter.$text).toBeUndefined();
    });

    it('splits fulltext search with special characters into words', () => {
      const native = translator.translateQuery({
        projectId: 'p1',
        from: new Date('2024-01-01'),
        to: new Date('2024-01-02'),
        search: 'error: connection_failed',
      });
      const filter = native.query as Record<string, unknown>;
      expect(filter.$and).toEqual([
        { message: { $regex: wordRe('error'), $options: 'i' } },
        { message: { $regex: wordRe('connection_failed'), $options: 'i' } },
      ]);
      expect(filter.$text).toBeUndefined();
    });

    it('escapes regex special characters in substring search', () => {
      const native = translator.translateQuery({
        projectId: 'p1',
        from: new Date('2024-01-01'),
        to: new Date('2024-01-02'),
        search: 'test.*injection',
        searchMode: 'substring',
      });
      const filter = native.query as Record<string, unknown>;
      expect(filter.$and).toEqual([{ message: { $regex: 'test\\.\\*injection', $options: 'i' } }]);
    });

    it('adds traceId filter', () => {
      const native = translator.translateQuery({
        projectId: 'p1',
        from: new Date('2024-01-01'),
        to: new Date('2024-01-02'),
        traceId: 'abc123',
      });
      const filter = native.query as Record<string, unknown>;
      expect(filter.trace_id).toBe('abc123');
    });

    it('handles cursor pagination (desc)', () => {
      const cursorTime = new Date('2024-01-01T12:00:00Z');
      const cursor = Buffer.from(`${cursorTime.toISOString()},uuid-123`).toString('base64');

      const native = translator.translateQuery({
        projectId: 'p1',
        from: new Date('2024-01-01'),
        to: new Date('2024-01-02'),
        cursor,
      });
      const filter = native.query as Record<string, unknown>;
      // The cursor clause lives in the shared $and list, never at the top level.
      expect(filter.$or).toBeUndefined();
      expect(filter.$and).toEqual([{
        $or: [
          { time: { $lt: cursorTime } },
          { time: cursorTime, id: { $lt: 'uuid-123' } },
        ],
      }]);
    });

    it('handles cursor pagination (asc)', () => {
      const cursorTime = new Date('2024-01-01T12:00:00Z');
      const cursor = Buffer.from(`${cursorTime.toISOString()},uuid-123`).toString('base64');

      const native = translator.translateQuery({
        projectId: 'p1',
        from: new Date('2024-01-01'),
        to: new Date('2024-01-02'),
        cursor,
        sortOrder: 'asc',
      });
      const filter = native.query as Record<string, unknown>;
      expect(filter.$and).toEqual([{
        $or: [
          { time: { $gt: cursorTime } },
          { time: cursorTime, id: { $gt: 'uuid-123' } },
        ],
      }]);
    });

    it('ignores invalid cursor', () => {
      const native = translator.translateQuery({
        projectId: 'p1',
        from: new Date('2024-01-01'),
        to: new Date('2024-01-02'),
        cursor: 'not-valid-base64!!!',
      });
      const filter = native.query as Record<string, unknown>;
      expect(filter.$or).toBeUndefined();
      expect(filter.$and).toBeUndefined();
    });

    it('sets sort direction based on sortOrder', () => {
      const nativeDesc = translator.translateQuery({
        projectId: 'p1',
        from: new Date('2024-01-01'),
        to: new Date('2024-01-02'),
      });
      expect(nativeDesc.metadata?.sort).toEqual({ time: -1, id: -1 });

      const nativeAsc = translator.translateQuery({
        projectId: 'p1',
        from: new Date('2024-01-01'),
        to: new Date('2024-01-02'),
        sortOrder: 'asc',
      });
      expect(nativeAsc.metadata?.sort).toEqual({ time: 1, id: 1 });
    });

    it('adds hostname filter on metadata.hostname', () => {
      const native = translator.translateQuery({
        projectId: 'p1',
        from: new Date('2024-01-01'),
        to: new Date('2024-01-02'),
        hostname: 'web-01',
      });
      const filter = native.query as Record<string, unknown>;
      expect(filter['metadata.hostname']).toBe('web-01');
    });
  });

  describe('translateAggregate', () => {
    it('builds filter and returns intervalMs', () => {
      const native = translator.translateAggregate({
        projectId: 'p1',
        from: new Date('2024-01-01'),
        to: new Date('2024-01-02'),
        interval: '1h',
      });
      const filter = native.query as Record<string, unknown>;
      expect(filter.project_id).toBe('p1');
      expect(native.metadata?.intervalMs).toBe(3_600_000);
    });
  });

  describe('translateCount', () => {
    it('builds filter for count', () => {
      const native = translator.translateCount({
        projectId: 'p1',
        from: new Date('2024-01-01'),
        to: new Date('2024-01-02'),
        level: 'error',
      });
      const filter = native.query as Record<string, unknown>;
      expect(filter.project_id).toBe('p1');
      expect(filter.level).toBe('error');
    });
  });

  describe('translateDistinct', () => {
    it('returns field and mongoField for a valid column', () => {
      const native = translator.translateDistinct({
        field: 'service',
        projectId: 'p1',
        from: new Date('2024-01-01'),
        to: new Date('2024-01-02'),
      });
      expect(native.metadata?.mongoField).toBe('service');
      expect(native.metadata?.limit).toBe(1000);
    });

    it('resolves metadata fields like metadata filters, never by dot notation', () => {
      const scope = { projectId: 'p1', from: new Date('2024-01-01'), to: new Date('2024-01-02') };
      const hostname = translator.translateDistinct({ ...scope, field: 'metadata.hostname' });
      expect(hostname.metadata?.mongoField).toBeUndefined();
      expect(hostname.metadata?.valueExpr).toEqual(scalarTextExpr(resolvedValueExpr('metadata', 'hostname')));
      // The browser SDK's flat `performance.metric` key: literal key first, then the nested path.
      const top = translator.translateTopValues({ ...scope, field: 'metadata.performance.metric' });
      expect(top.metadata?.valueExpr).toEqual(scalarTextExpr(resolvedValueExpr('metadata', 'performance.metric')));
      expect(JSON.stringify(top.metadata?.valueExpr)).not.toContain('$metadata.performance');
      // Built-in columns keep their path.
      expect(translator.translateTopValues({ ...scope, field: 'service' }).metadata).toMatchObject({ mongoField: 'service', valueExpr: '$service' });
    });

    it('throws for invalid field name', () => {
      expect(() => translator.translateDistinct({
        field: 'DROP TABLE',
        projectId: 'p1',
        from: new Date('2024-01-01'),
        to: new Date('2024-01-02'),
      })).toThrow('Invalid field name');
    });
  });

  describe('translateTopValues', () => {
    it('returns field and limit', () => {
      const native = translator.translateTopValues({
        field: 'service',
        projectId: 'p1',
        from: new Date('2024-01-01'),
        to: new Date('2024-01-02'),
        limit: 5,
      });
      expect(native.metadata?.mongoField).toBe('service');
      expect(native.metadata?.limit).toBe(5);
    });
  });

  describe('translateDelete', () => {
    it('builds filter with time range (from inclusive, to exclusive)', () => {
      const native = translator.translateDelete({
        projectId: 'p1',
        from: new Date('2024-01-01'),
        to: new Date('2024-01-02'),
      });
      const filter = native.query as Record<string, unknown>;
      expect(filter.project_id).toBe('p1');
      expect(filter.time).toEqual({
        $gte: new Date('2024-01-01'),
        $lt: new Date('2024-01-02'),
      });
    });

    it('handles array projectId', () => {
      const native = translator.translateDelete({
        projectId: ['p1', 'p2'],
        from: new Date('2024-01-01'),
        to: new Date('2024-01-02'),
      });
      const filter = native.query as Record<string, unknown>;
      expect(filter.project_id).toEqual({ $in: ['p1', 'p2'] });
    });

    it('adds service and level filters', () => {
      const native = translator.translateDelete({
        projectId: 'p1',
        from: new Date('2024-01-01'),
        to: new Date('2024-01-02'),
        service: 'api',
        level: ['error', 'critical'],
      });
      const filter = native.query as Record<string, unknown>;
      expect(filter.service).toBe('api');
      expect(filter.level).toEqual({ $in: ['error', 'critical'] });
    });
  });
});

// ============================================================================
// Engine Unit Tests (mocked MongoClient)
// ============================================================================

describe('MongoDBEngine', () => {
  const config: StorageConfig = {
    host: 'localhost',
    port: 27017,
    database: 'logtide_test',
    username: 'test',
    password: 'test',
  };

  describe('constructor', () => {
    it('creates an engine with default options', () => {
      const engine = new MongoDBEngine(config);
      expect(engine).toBeInstanceOf(MongoDBEngine);
    });

    it('accepts injected client', () => {
      const mockClient = {} as import('mongodb').MongoClient;
      const engine = new MongoDBEngine(config, { client: mockClient });
      expect(engine).toBeInstanceOf(MongoDBEngine);
    });
  });

  describe('getCapabilities', () => {
    it('returns mongodb engine capabilities', () => {
      const engine = new MongoDBEngine(config);
      const caps = engine.getCapabilities();
      expect(caps.engine).toBe('mongodb');
      expect(caps.supportsFullTextSearch).toBe(true);
      expect(caps.supportsAggregations).toBe(true);
      expect(caps.supportsTransactions).toBe(true);
      expect(caps.maxBatchSize).toBe(100_000);
      expect(caps.nativeCompression).toBe(true);
      expect(caps.supportedIntervals).toHaveLength(7);
    });
  });

  describe('getSegments', () => {
    it('returns empty array', async () => {
      const engine = new MongoDBEngine(config);
      const segments = await engine.getSegments(new Date(), new Date());
      expect(segments).toEqual([]);
    });
  });

  describe('migrate', () => {
    it('is a no-op placeholder', async () => {
      const engine = new MongoDBEngine(config);
      await expect(engine.migrate('1.0.0')).resolves.toBeUndefined();
    });
  });

  describe('connect guard', () => {
    it('throws when calling methods without connect', async () => {
      const engine = new MongoDBEngine(config);
      await expect(engine.ingest([{
        time: new Date(),
        projectId: 'p1',
        service: 'svc',
        level: 'info',
        message: 'test',
      }])).rejects.toThrow('Not connected');
    });
  });

  describe('disconnect', () => {
    it('does not close injected client', async () => {
      const closeFn = vi.fn();
      const mockClient = { close: closeFn } as unknown as import('mongodb').MongoClient;
      const engine = new MongoDBEngine(config, { client: mockClient });
      await engine.disconnect();
      expect(closeFn).not.toHaveBeenCalled();
    });
  });

  describe('ingest with empty array', () => {
    it('returns zero counts for empty input', async () => {
      const engine = new MongoDBEngine(config);
      const result = await engine.ingest([]);
      expect(result).toEqual({ ingested: 0, failed: 0, durationMs: 0 });
    });
  });

  describe('ingestReturning with empty array', () => {
    it('returns zero counts and empty rows for empty input', async () => {
      const engine = new MongoDBEngine(config);
      const result = await engine.ingestReturning([]);
      expect(result).toEqual({ ingested: 0, failed: 0, durationMs: 0, rows: [] });
    });
  });

  describe('ingestSpans with empty array', () => {
    it('returns zero counts for empty input', async () => {
      const engine = new MongoDBEngine(config);
      const result = await engine.ingestSpans([]);
      expect(result).toEqual({ ingested: 0, failed: 0, durationMs: 0 });
    });
  });

  describe('ingestMetrics with empty array', () => {
    it('returns zero counts for empty input', async () => {
      const engine = new MongoDBEngine(config);
      const result = await engine.ingestMetrics([]);
      expect(result).toEqual({ ingested: 0, failed: 0, durationMs: 0 });
    });
  });
});
