import { describe, it, expect, vi } from 'vitest';
import { Reservoir } from './client.js';
import { StorageEngineFactory } from './factory.js';
import { MongoDBEngine } from './engines/mongodb/mongodb-engine.js';
import type { StorageEngine } from './core/storage-engine.js';
import type { StorageConfig, QueryParams, AggregateParams } from './core/types.js';

const config: StorageConfig = {
  host: 'localhost',
  port: 5432,
  database: 'logtide',
  username: 'logtide',
  password: 'secret',
};

describe('Reservoir', () => {
  it('creates a reservoir instance', () => {
    const reservoir = new Reservoir('timescale', config);
    expect(reservoir).toBeDefined();
  });

  it('throws if used before initialization', async () => {
    const reservoir = new Reservoir('timescale', config);

    const queryParams: QueryParams = {
      from: new Date(),
      to: new Date(),
    };

    await expect(reservoir.query(queryParams))
      .rejects.toThrow('Reservoir not initialized');
  });

  it('throws if ingest called before initialization', async () => {
    const reservoir = new Reservoir('timescale', config);

    await expect(reservoir.ingest([]))
      .rejects.toThrow('Reservoir not initialized');
  });

  it('throws if ingestReturning called before initialization', async () => {
    const reservoir = new Reservoir('timescale', config);

    await expect(reservoir.ingestReturning([]))
      .rejects.toThrow('Reservoir not initialized');
  });

  it('throws if aggregate called before initialization', async () => {
    const reservoir = new Reservoir('timescale', config);

    const params: AggregateParams = {
      from: new Date(),
      to: new Date(),
      interval: '1h',
    };

    await expect(reservoir.aggregate(params))
      .rejects.toThrow('Reservoir not initialized');
  });

  it('returns capabilities without initialization', () => {
    const reservoir = new Reservoir('timescale', config);
    const caps = reservoir.getCapabilities();

    expect(caps.engine).toBe('timescale');
    expect(caps.supportsFullTextSearch).toBe(true);
    expect(caps.supportsTransactions).toBe(true);
    expect(caps.maxBatchSize).toBe(10000);
  });

  it('close is safe to call when not initialized', async () => {
    const reservoir = new Reservoir('timescale', config);
    await expect(reservoir.close()).resolves.toBeUndefined();
  });

  describe('purgeProject', () => {
    it('throws if called before initialization', async () => {
      const reservoir = new Reservoir('timescale', config);
      await expect(reservoir.purgeProject('p1')).rejects.toThrow('Reservoir not initialized');
    });

    it('delegates to all three engine delete methods and sums deleted counts', async () => {
      const reservoir = new Reservoir('timescale', config);
      const r = reservoir as any;
      r.initialized = true;
      r.engine = {
        deleteByTimeRange: vi.fn().mockResolvedValue({ deleted: 5 }),
        deleteSpansByTimeRange: vi.fn().mockResolvedValue({ deleted: 3 }),
        deleteMetricsByTimeRange: vi.fn().mockResolvedValue({ deleted: 2 }),
      };

      const result = await reservoir.purgeProject('test-project-id');

      expect(result.deleted).toBe(10);
      expect(r.engine.deleteByTimeRange).toHaveBeenCalledWith({
        projectId: 'test-project-id',
        from: new Date(0),
        to: new Date('2100-01-01T00:00:00Z'),
      });
      expect(r.engine.deleteSpansByTimeRange).toHaveBeenCalledWith({
        projectId: 'test-project-id',
        from: new Date(0),
        to: new Date('2100-01-01T00:00:00Z'),
      });
      expect(r.engine.deleteMetricsByTimeRange).toHaveBeenCalledWith({
        projectId: 'test-project-id',
        from: new Date(0),
        to: new Date('2100-01-01T00:00:00Z'),
      });
    });

    it('returns zero deleted when engine returns empty counts', async () => {
      const reservoir = new Reservoir('timescale', config);
      const r = reservoir as any;
      r.initialized = true;
      r.engine = {
        deleteByTimeRange: vi.fn().mockResolvedValue({ deleted: 0 }),
        deleteSpansByTimeRange: vi.fn().mockResolvedValue({ deleted: 0 }),
        deleteMetricsByTimeRange: vi.fn().mockResolvedValue({ deleted: 0 }),
      };

      const result = await reservoir.purgeProject('empty-project');
      expect(result.deleted).toBe(0);
    });
  });
});

describe('1.6 contract', () => {
  function ready(engine: Record<string, unknown>) {
    const r = new Reservoir('timescale', config) as any;
    r.initialized = true;
    r.engine = engine;
    return r as Reservoir;
  }
  const P = { projectId: 'p', from: new Date(0), to: new Date(1) };
  const H = { projectId: 'p', from: new Date(0), to: new Date(3_600_000) };
  const word = (value: string) => ({ kind: 'word' as const, value });

  it('converts legacy fulltext search to textQuery and keeps search', async () => {
    const engine = { query: vi.fn().mockResolvedValue({ logs: [] }) };
    await ready(engine).query({ ...P, search: 'timeout redis' });
    expect(engine.query.mock.calls[0][0]).toMatchObject({
      search: 'timeout redis',
      textQuery: { all: [{ kind: 'word', value: 'timeout' }, { kind: 'word', value: 'redis' }], anyOf: [], none: [] },
    });
  });

  it('converts legacy substring search to one phrase', async () => {
    const engine = { count: vi.fn().mockResolvedValue({ count: 1 }) };
    await ready(engine).count({ ...P, search: 'conn ref', searchMode: 'substring' });
    expect(engine.count.mock.calls[0][0]).toMatchObject({
      search: 'conn ref',
      searchMode: 'substring',
      textQuery: { all: [{ kind: 'phrase', value: 'conn ref' }], anyOf: [], none: [] },
    });
  });

  it('a caller textQuery wins over search', async () => {
    const engine = { countEstimate: vi.fn().mockResolvedValue({ count: 1 }) };
    const textQuery = { all: [], anyOf: [[word('a'), word('b')]], none: [] };
    await ready(engine).countEstimate({ ...P, search: 'x', textQuery });
    expect(engine.countEstimate.mock.calls[0][0].textQuery).toEqual(textQuery);
  });

  it('drops empty textQuery and exclude before the engine', async () => {
    const engine = { query: vi.fn().mockResolvedValue({ logs: [] }) };
    await ready(engine).query({ ...P, textQuery: { all: [], anyOf: [], none: [] }, exclude: { level: [] } });
    const sent = engine.query.mock.calls[0][0];
    expect(sent).not.toHaveProperty('textQuery');
    expect(sent).not.toHaveProperty('exclude');
  });

  it('rejects malformed text terms before the engine', async () => {
    const engine = { query: vi.fn() };
    await expect(ready(engine).query({ ...P, textQuery: { all: [word('')], anyOf: [], none: [] } })).rejects.toThrow(RangeError);
    expect(engine.query).not.toHaveBeenCalled();
  });

  it('does not mutate caller params', async () => {
    const engine = { query: vi.fn().mockResolvedValue({ logs: [] }), countEstimate: vi.fn().mockResolvedValue({ count: 0 }) };
    const params = { ...P, search: 'a b' };
    const snapshot = structuredClone(params);
    const r = ready(engine);
    await Promise.all([r.query(params), r.countEstimate(params)]);
    expect(params).toEqual(snapshot);
    expect(engine.countEstimate.mock.calls[0][0].textQuery).toBeDefined();
    expect(engine.query.mock.calls[0][0]).not.toBe(params);
  });

  it('does not mutate caller params of the new methods', async () => {
    const engine = {
      histogram: vi.fn().mockResolvedValue({ buckets: [], bucketSeconds: 600 }),
      facets: vi.fn().mockResolvedValue({ facets: [] }),
      querySpans: vi.fn().mockResolvedValue({ spans: [] }),
      listSessions: vi.fn().mockResolvedValue({ sessions: [] }),
    };
    const r = ready(engine);
    const histogram = { ...H, bucketSeconds: 600, search: 'x' };
    const facets = { ...H, fields: [{ builtin: 'level' as const }] };
    const spans = { ...H, operation: 'GET /users', sortBy: 'duration' as const };
    const sessions = { ...H, limit: 999 };
    const snapshots = structuredClone({ histogram, facets, spans, sessions });
    await r.histogram(histogram);
    await r.facets(facets);
    await r.querySpans(spans);
    await r.listSessions(sessions);
    expect({ histogram, facets, spans, sessions }).toEqual(snapshots);
  });

  it('answers matchNothing without the engine', async () => {
    const engine = { query: vi.fn(), count: vi.fn(), countEstimate: vi.fn(), histogram: vi.fn(), facets: vi.fn() };
    const r = ready(engine);
    expect(await r.query({ ...P, matchNothing: true })).toEqual({ logs: [], total: 0, hasMore: false, limit: 50, offset: 0 });
    expect(await r.query({ ...P, matchNothing: true, limit: 20, offset: 40 })).toEqual({ logs: [], total: 0, hasMore: false, limit: 20, offset: 40 });
    expect(await r.count({ ...P, matchNothing: true })).toEqual({ count: 0 });
    expect(await r.countEstimate({ ...P, matchNothing: true })).toEqual({ count: 0 });
    const histogram = await r.histogram({ ...P, to: new Date(1_200_000), bucketSeconds: 600, matchNothing: true });
    expect(histogram.buckets.map((b) => b.total)).toEqual([0, 0, 0]);
    expect(histogram.buckets.map((b) => b.time.getTime())).toEqual([0, 600_000, 1_200_000]);
    expect(histogram.bucketSeconds).toBe(600);
    expect(await r.facets({ ...P, fields: [{ metadata: 'env' }], matchNothing: true })).toEqual({ facets: [{ field: 'metadata.env', values: [], otherCount: 0 }] });
    expect(await r.facets({ ...P, fields: [{ builtin: 'service' }, { metadata: 'user.id' }, { builtin: 'level' }], matchNothing: true })).toEqual({
      facets: [
        { field: 'service', values: [], otherCount: 0 },
        { field: 'metadata.user.id', values: [], otherCount: 0 },
        { field: 'level', values: [], otherCount: 0 },
      ],
    });
    for (const fn of Object.values(engine)) expect(fn).not.toHaveBeenCalled();
  });

  it('still validates params when matchNothing is set', async () => {
    const engine = { histogram: vi.fn(), facets: vi.fn() };
    const r = ready(engine);
    await expect(r.histogram({ ...P, bucketSeconds: 0, matchNothing: true })).rejects.toThrow(RangeError);
    await expect(r.facets({ ...P, fields: [], matchNothing: true })).rejects.toThrow(RangeError);
  });

  it('never sends matchNothing to an engine', async () => {
    const engine = {
      query: vi.fn().mockResolvedValue({ logs: [] }),
      count: vi.fn().mockResolvedValue({ count: 0 }),
      countEstimate: vi.fn().mockResolvedValue({ count: 0 }),
      histogram: vi.fn().mockResolvedValue({ buckets: [], bucketSeconds: 600 }),
      facets: vi.fn().mockResolvedValue({ facets: [] }),
    };
    const r = ready(engine);
    await r.query({ ...P, matchNothing: false });
    await r.count({ ...P, matchNothing: false });
    await r.countEstimate({ ...P, matchNothing: false });
    await r.histogram({ ...H, bucketSeconds: 600, matchNothing: false });
    await r.facets({ ...H, fields: [{ builtin: 'level' }], matchNothing: false });
    for (const fn of Object.values(engine)) {
      expect(fn).toHaveBeenCalledOnce();
      expect(fn.mock.calls[0][0]).not.toHaveProperty('matchNothing');
    }
  });

  it('rejects oversized histograms before the engine', async () => {
    const engine = { histogram: vi.fn() };
    await expect(ready(engine).histogram({ ...P, to: new Date(7_200_000), bucketSeconds: 1 })).rejects.toThrow(RangeError);
    expect(engine.histogram).not.toHaveBeenCalled();
  });

  it('normalizes the histogram filter part', async () => {
    const engine = { histogram: vi.fn().mockResolvedValue({ buckets: [], bucketSeconds: 600 }) };
    await ready(engine).histogram({ ...H, bucketSeconds: 600, search: 'timeout' });
    expect(engine.histogram.mock.calls[0][0]).toMatchObject({ bucketSeconds: 600, textQuery: { all: [word('timeout')], anyOf: [], none: [] } });
  });

  it('applies defaults for facets, discover, operation stats and sessions', async () => {
    const engine = {
      facets: vi.fn().mockResolvedValue({ facets: [] }),
      discoverMetadataKeys: vi.fn().mockResolvedValue([]),
      getOperationStats: vi.fn().mockResolvedValue([]),
      listSessions: vi.fn().mockResolvedValue({ sessions: [] }),
    };
    const r = ready(engine);
    await r.facets({ ...H, fields: [{ builtin: 'level' }], search: 'redis' });
    await r.discoverMetadataKeys({ ...H });
    await r.getOperationStats({ ...H });
    await r.listSessions({ ...H, limit: 999 });
    expect(engine.facets.mock.calls[0][0]).toMatchObject({ fields: [{ builtin: 'level' }], limit: 10, textQuery: { all: [word('redis')] } });
    expect(engine.discoverMetadataKeys.mock.calls[0][0]).toMatchObject({ projectId: 'p', sampleSize: 1000 });
    expect(engine.getOperationStats.mock.calls[0][0]).toMatchObject({ projectId: 'p', limit: 100 });
    expect(engine.getOperationStats.mock.calls[0][0].kinds).toBeUndefined();
    expect(engine.listSessions.mock.calls[0][0]).toMatchObject({ projectId: 'p', limit: 200 });
  });

  it('clamps limits and keeps explicit kinds', async () => {
    const engine = {
      facets: vi.fn().mockResolvedValue({ facets: [] }),
      discoverMetadataKeys: vi.fn().mockResolvedValue([]),
      getOperationStats: vi.fn().mockResolvedValue([]),
    };
    const r = ready(engine);
    await r.facets({ ...H, fields: [{ metadata: 'env' }], limit: 500 });
    await r.discoverMetadataKeys({ ...H, sampleSize: 99_999 });
    await r.getOperationStats({ ...H, kinds: ['CLIENT'], limit: 10_000 });
    expect(engine.facets.mock.calls[0][0].limit).toBe(50);
    expect(engine.discoverMetadataKeys.mock.calls[0][0].sampleSize).toBe(5000);
    expect(engine.getOperationStats.mock.calls[0][0]).toMatchObject({ kinds: ['CLIENT'], limit: 500 });
  });

  it('rejects invalid params of the new methods before the engine', async () => {
    const engine = {
      facets: vi.fn(),
      discoverMetadataKeys: vi.fn(),
      getOperationStats: vi.fn(),
      getLatencyHistogram: vi.fn(),
      listSessions: vi.fn(),
      hasSessions: vi.fn(),
    };
    const r = ready(engine);
    const reversed = { projectId: 'p', from: new Date(10), to: new Date(0) };
    await expect(r.facets({ ...P, fields: [{ metadata: 'bad key' }] })).rejects.toThrow(RangeError);
    await expect(r.discoverMetadataKeys(reversed)).rejects.toThrow(RangeError);
    await expect(r.getOperationStats({ ...P, kinds: [] })).rejects.toThrow(RangeError);
    await expect(r.getLatencyHistogram(reversed)).rejects.toThrow(RangeError);
    await expect(r.listSessions({ ...P, limit: 0 })).rejects.toThrow(RangeError);
    await expect(r.listSessions({ ...P, limit: 5, cursor: 'garbage' })).rejects.toThrow(RangeError);
    await expect(r.hasSessions(reversed)).rejects.toThrow(RangeError);
    await expect(r.hasSessions({ projectId: 'p', from: new Date(Number.NaN), to: new Date(0) })).rejects.toThrow(RangeError);
    for (const fn of Object.values(engine)) expect(fn).not.toHaveBeenCalled();
  });

  it('forwards latency histogram and hasSessions params once validated', async () => {
    const engine = {
      getLatencyHistogram: vi.fn().mockResolvedValue({ bounds: [], counts: [] }),
      hasSessions: vi.fn().mockResolvedValue(true),
    };
    const r = ready(engine);
    expect(await r.hasSessions({ ...H })).toBe(true);
    await r.getLatencyHistogram({ ...H, service: 'api', operation: 'GET /users' });
    expect(engine.hasSessions.mock.calls[0][0]).toEqual(H);
    expect(engine.getLatencyHistogram.mock.calls[0][0]).toEqual({ ...H, service: 'api', operation: 'GET /users' });
  });

  it('maps span operation and duration sort', async () => {
    const engine = { querySpans: vi.fn().mockResolvedValue({ spans: [] }) };
    const r = ready(engine);
    await r.querySpans({ ...H, operation: 'GET /users', sortBy: 'duration', sortOrder: 'desc' });
    const sent = engine.querySpans.mock.calls[0][0];
    expect(sent).toMatchObject({ operationName: 'GET /users', sortBy: 'duration_ms', sortOrder: 'desc' });
    expect(sent).not.toHaveProperty('operation');
    await expect(r.querySpans({ ...H, operation: 'a', operationName: 'b' })).rejects.toThrow(RangeError);
    expect(engine.querySpans).toHaveBeenCalledOnce();
  });

  it('keeps existing span sorts as they are', async () => {
    const engine = { querySpans: vi.fn().mockResolvedValue({ spans: [] }) };
    await ready(engine).querySpans({ ...H, sortBy: 'start_time' });
    expect(engine.querySpans.mock.calls[0][0]).toMatchObject({ sortBy: 'start_time' });
  });

  it('rejects an unknown trace sortBy', async () => {
    const engine = { queryTraces: vi.fn().mockResolvedValue({ traces: [] }) };
    const r = ready(engine);
    await expect(r.queryTraces({ ...H, sortBy: 'duration_ms' as any })).rejects.toThrow(RangeError);
    expect(engine.queryTraces).not.toHaveBeenCalled();
    await r.queryTraces({ ...H, sortBy: 'duration', sortOrder: 'asc' });
    expect(engine.queryTraces.mock.calls[0][0]).toMatchObject({ sortBy: 'duration', sortOrder: 'asc' });
  });

  it('fromEngine wraps an engine and initialize connects it', async () => {
    const engine = { connect: vi.fn(), initialize: vi.fn(), getCapabilities: () => ({ engine: 'clickhouse' }) } as unknown as StorageEngine;
    const r = Reservoir.fromEngine(engine);
    await r.initialize();
    expect((engine as any).connect).toHaveBeenCalledOnce();
    expect((engine as any).initialize).toHaveBeenCalledOnce();
    expect(r.getEngine()).toBe(engine);
    expect(r.getEngineType()).toBe('clickhouse');
  });

  it('the engine constructor overload never calls the factory', () => {
    const spy = vi.spyOn(StorageEngineFactory, 'create');
    try {
      const engine = { connect: vi.fn(), initialize: vi.fn(), getCapabilities: () => ({ engine: 'mongodb' }) } as unknown as StorageEngine;
      const r = new Reservoir(engine);
      expect(r.getEngine()).toBe(engine);
      expect(Reservoir.fromEngine(engine).getEngine()).toBe(engine);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it('fromEngine accepts a MongoDB engine with an empty username', () => {
    const mongo = { host: 'localhost', port: 27017, database: 'x_conformance', username: '', password: '' };
    expect(() => new Reservoir('mongodb', mongo)).toThrow('username is required');
    expect(Reservoir.fromEngine(new MongoDBEngine(mongo)).getEngineType()).toBe('mongodb');
  });

  it('a wrapped engine answers through the normalizing client', async () => {
    const engine = {
      connect: vi.fn(),
      initialize: vi.fn(),
      getCapabilities: () => ({ engine: 'timescale' }),
      query: vi.fn().mockResolvedValue({ logs: [] }),
    } as unknown as StorageEngine;
    const r = Reservoir.fromEngine(engine);
    await expect(r.query({ ...P })).rejects.toThrow('Reservoir not initialized');
    await r.initialize();
    await r.query({ ...P, search: 'x' });
    expect((engine as any).query.mock.calls[0][0]).toMatchObject({ textQuery: { all: [word('x')], anyOf: [], none: [] } });
  });

  it.each(['histogram', 'facets', 'discoverMetadataKeys', 'getOperationStats', 'getLatencyHistogram', 'listSessions', 'hasSessions'])(
    '%s throws before initialization', async (m) => {
      await expect((new Reservoir('timescale', config) as any)[m]({})).rejects.toThrow('Reservoir not initialized');
    });

  it.each(['count', 'countEstimate', 'querySpans', 'queryTraces'])('%s throws before initialization', async (m) => {
    await expect((new Reservoir('timescale', config) as any)[m]({})).rejects.toThrow('Reservoir not initialized');
  });
});
