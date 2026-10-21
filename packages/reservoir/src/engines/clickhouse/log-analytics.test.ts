import { describe, it, expect, vi } from 'vitest';
import type { ClickHouseClient } from '@clickhouse/client';
import { assembleFacets, assembleHistogram, translateDiscoverKeys } from './log-analytics.js';
import { ClickHouseQueryTranslator } from './query-translator.js';
import { ClickHouseEngine } from './clickhouse-engine.js';
import type { LogFacetField, LogFacetsParams, LogHistogramParams } from '../../core/types.js';

const at = (iso: string) => new Date(iso);
const ms = (iso: string) => String(at(iso).getTime());

function stubEngine(rows: Record<string, unknown>[] = []) {
  const query = vi.fn(async (_args: unknown) => ({ json: async () => rows }));
  const client = { query } as unknown as ClickHouseClient;
  const engine = new ClickHouseEngine(
    { host: 'localhost', port: 18123, database: 'unused', username: 'default', password: '' },
    { client, skipInitialize: true },
  );
  return { engine, query };
}

const base: LogHistogramParams = {
  projectId: '00000000-0000-0000-0000-000000000001',
  from: at('2026-01-01T10:00:00.000Z'),
  to: at('2026-01-01T10:15:00.000Z'),
  bucketSeconds: 300,
};

describe('clickhouse histogram', () => {
  it('zero-fills missing buckets and keeps only non-zero levels', () => {
    const result = assembleHistogram(base, [
      { bucket_ms: ms('2026-01-01T10:00:00.000Z'), level: 'info', n: '2' },
      { bucket_ms: ms('2026-01-01T10:00:00.000Z'), level: 'error', n: '1' },
      { bucket_ms: ms('2026-01-01T10:10:00.000Z'), level: 'warn', n: '4' },
      { bucket_ms: ms('2026-01-01T10:10:00.000Z'), level: 'debug', n: '0' },
    ]);
    expect(result.bucketSeconds).toBe(300);
    expect(result.buckets.map((b) => b.time.toISOString())).toEqual([
      '2026-01-01T10:00:00.000Z',
      '2026-01-01T10:05:00.000Z',
      '2026-01-01T10:10:00.000Z',
      '2026-01-01T10:15:00.000Z',
    ]);
    expect(result.buckets[0]).toMatchObject({ total: 3, byLevel: { info: 2, error: 1 } });
    expect(result.buckets[1]).toMatchObject({ total: 0, byLevel: {} });
    expect(result.buckets[2]).toMatchObject({ total: 4, byLevel: { warn: 4 } });
    expect(result.buckets[3]).toMatchObject({ total: 0, byLevel: {} });
  });

  it('aligns buckets to the unix epoch', () => {
    const result = assembleHistogram({ ...base, from: at('2026-01-01T10:07:30.000Z') }, []);
    expect(result.buckets[0].time.toISOString()).toBe('2026-01-01T10:05:00.000Z');
  });

  it('drops the bucket at an aligned exclusive end', () => {
    const result = assembleHistogram({ ...base, toExclusive: true }, []);
    expect(result.buckets.at(-1)?.time.toISOString()).toBe('2026-01-01T10:10:00.000Z');
    expect(result.buckets).toHaveLength(3);
  });

  it('rejects a bucket size that is not a positive integer before querying', async () => {
    const { engine, query } = stubEngine();
    await expect(engine.histogram({ ...base, bucketSeconds: 0 })).rejects.toBeInstanceOf(RangeError);
    await expect(engine.histogram({ ...base, bucketSeconds: 1.5 })).rejects.toBeInstanceOf(RangeError);
    expect(query).not.toHaveBeenCalled();
  });

  it('rejects too many buckets with a readable message', async () => {
    const { engine, query } = stubEngine();
    const params = { ...base, from: new Date(0), to: new Date((1001 * 60 - 1) * 1000), bucketSeconds: 60 };
    await expect(engine.histogram(params)).rejects.toThrow(
      'A histogram can have at most 1,000 buckets (this range needs 1,001 buckets of 60 s)',
    );
    expect(query).not.toHaveBeenCalled();
  });

  it('histogram reuses the log filter', () => {
    const translator = new ClickHouseQueryTranslator('logs');
    const native = translator.translateHistogram({
      ...base,
      textQuery: { all: [{ kind: 'word', value: 'timeout' }], anyOf: [], none: [] },
      exclude: { service: ['worker'] },
    });
    const query = native.query as string;
    expect(query).toContain('intDiv(toUnixTimestamp64Milli(time), {p_bms:Int64}) * {p_bms:Int64} AS bucket_ms');
    expect(query).toContain(' PREWHERE project_id = {p_project_id:String} AND time >= {p_from:DateTime64(3)}');
    expect(query).toContain('lowerUTF8(message) LIKE {p_tq0:String}');
    expect(query).toContain('service NOT IN {p_ex_service:Array(String)}');
    expect(query).toContain('GROUP BY bucket_ms, level');
    expect((native.parameters as Record<string, unknown>[])[0].p_bms).toBe(300_000);
  });

  it('the engine maps grouped rows to zero-filled buckets', async () => {
    const { engine, query } = stubEngine([
      { bucket_ms: ms('2026-01-01T10:05:00.000Z'), level: 'error', n: '7' },
    ]);
    const result = await engine.histogram(base);
    expect(query).toHaveBeenCalledTimes(1);
    expect(result.buckets.map((b) => b.total)).toEqual([0, 7, 0, 0]);
    expect(result.buckets[1].byLevel).toEqual({ error: 7 });
  });

  it('the engine derives the text query from legacy search', async () => {
    const { engine, query } = stubEngine();
    await engine.histogram({ ...base, search: 'timeout' });
    const args = query.mock.calls[0][0] as { query: string; query_params: Record<string, unknown> };
    expect(args.query).toContain('match(message, {p_tq1:String})');
    expect(args.query_params.p_tq0).toBe('%timeout%');
  });
});

const facetBase: LogFacetsParams = {
  projectId: '00000000-0000-0000-0000-000000000001',
  from: at('2026-01-01T10:00:00.000Z'),
  to: at('2026-01-01T11:00:00.000Z'),
  fields: [{ builtin: 'level' }],
};

function lastCall(query: ReturnType<typeof stubEngine>['query']) {
  return query.mock.calls.at(-1)![0] as { query: string; query_params: Record<string, unknown> };
}

describe('clickhouse facets', () => {
  it('limit defaults to 10 and clamps to 1..50', async () => {
    const { engine, query } = stubEngine();
    await engine.facets(facetBase);
    expect(lastCall(query).query_params.p_limit).toBe(10);
    await engine.facets({ ...facetBase, limit: 0 });
    expect(lastCall(query).query_params.p_limit).toBe(1);
    await engine.facets({ ...facetBase, limit: 99 });
    expect(lastCall(query).query_params.p_limit).toBe(50);
  });

  it('rejects more than 20 fields before querying', async () => {
    const { engine, query } = stubEngine();
    const fields: LogFacetField[] = Array.from({ length: 21 }, (_, i) => ({ metadata: `k${i}` }));
    await expect(engine.facets({ ...facetBase, fields })).rejects.toBeInstanceOf(RangeError);
    await expect(engine.facets({ ...facetBase, fields: [] })).rejects.toBeInstanceOf(RangeError);
    expect(query).not.toHaveBeenCalled();
  });

  it('otherCount is the field total minus returned counts', () => {
    const result = assembleFacets([{ builtin: 'service' }], [
      { f: 0, v: 'api', cnt: '4', total: '10' },
      { f: 0, v: 'auth', cnt: '3', total: '10' },
    ], 10);
    expect(result.facets).toEqual([
      { field: 'service', values: [{ value: 'api', count: 4 }, { value: 'auth', count: 3 }], otherCount: 3 },
    ]);
  });

  it('keeps request order and labels', () => {
    const result = assembleFacets([{ builtin: 'service' }, { metadata: 'region' }, { builtin: 'level' }], [
      { f: 2, v: 'error', cnt: '2', total: '2' },
      { f: 0, v: 'api', cnt: '1', total: '1' },
      { f: 1, v: 'eu', cnt: '1', total: '1' },
    ], 10);
    expect(result.facets.map((f) => f.field)).toEqual(['service', 'metadata.region', 'level']);
    expect(result.facets[2].values).toEqual([{ value: 'error', count: 2 }]);
  });

  it('a field without values returns an empty list', () => {
    const result = assembleFacets([{ builtin: 'level' }, { metadata: 'missing' }], [
      { f: 0, v: 'info', cnt: '1', total: '1' },
    ], 10);
    expect(result.facets[1]).toEqual({ field: 'metadata.missing', values: [], otherCount: 0 });
  });

  it('ties break in byte order and each field keeps its own top values', () => {
    const translator = new ClickHouseQueryTranslator('logs');
    const native = translator.translateFacets({ ...facetBase, fields: [{ builtin: 'hostname' }, { metadata: 'http.method' }] }, 5);
    const query = native.query as string;
    const params = (native.parameters as Record<string, unknown>[])[0];
    expect(query).toContain('sum(count()) OVER (PARTITION BY f) AS total');
    expect(query).toContain('ORDER BY f ASC, cnt DESC, v ASC LIMIT {p_limit:UInt32} BY f');
    expect(query).toContain('(0, toNullable(hostname))');
    expect(query).toContain('(1, multiIf(');
    expect(query).toContain('if(JSONHas(metadata, {p_fk1:String})');
    expect(query).toContain("WHERE v IS NOT NULL AND v != ''");
    expect(params).toMatchObject({ p_limit: 5, p_fk1: 'http.method', p_fk1s0: 'http', p_fk1s1: 'method' });
  });

  it('facets reuse the log filter', () => {
    const translator = new ClickHouseQueryTranslator('logs');
    const native = translator.translateFacets({
      ...facetBase,
      textQuery: { all: [{ kind: 'phrase', value: 'refused' }], anyOf: [], none: [] },
      metadataFilters: [{ key: 'env', op: 'equals', value: 'prod', include_missing: false }],
    }, 10);
    const query = native.query as string;
    expect(query).toContain(' PREWHERE project_id = {p_project_id:String} AND time >= {p_from:DateTime64(3)}');
    expect(query).toContain('lowerUTF8(message) LIKE {p_tq0:String}');
    expect(query).toContain('JSONExtractRaw(metadata, {p_mfk0:String})');
  });

  it('the engine maps rows to facets in request order', async () => {
    const { engine } = stubEngine([
      { f: 1, v: 'api', cnt: '3', total: '5' },
      { f: 0, v: 'error', cnt: '2', total: '2' },
    ]);
    const result = await engine.facets({ ...facetBase, fields: [{ builtin: 'level' }, { builtin: 'service' }], limit: 1 });
    expect(result.facets).toEqual([
      { field: 'level', values: [{ value: 'error', count: 2 }], otherCount: 0 },
      { field: 'service', values: [{ value: 'api', count: 3 }], otherCount: 2 },
    ]);
  });
});

describe('clickhouse metadata key discovery', () => {
  const discoverBase = {
    projectId: '00000000-0000-0000-0000-000000000001',
    from: at('2026-01-01T10:00:00.000Z'),
    to: at('2026-01-01T11:00:00.000Z'),
  };

  it('sample size defaults to 1000 and clamps to 1..5000', async () => {
    const { engine, query } = stubEngine();
    await engine.discoverMetadataKeys(discoverBase);
    expect(lastCall(query).query_params.p_n).toBe(1000);
    await engine.discoverMetadataKeys({ ...discoverBase, sampleSize: 9999 });
    expect(lastCall(query).query_params.p_n).toBe(5000);
    await engine.discoverMetadataKeys({ ...discoverBase, sampleSize: 0 });
    expect(lastCall(query).query_params.p_n).toBe(1);
  });

  it('sql reads the newest logs of the listed projects first', () => {
    const native = translateDiscoverKeys({ ...discoverBase, projectId: ['p1', 'p2'], sampleSize: 10 });
    const query = native.query as string;
    const params = (native.parameters as Record<string, unknown>[])[0];
    expect(query).toContain(
      'FROM logs PREWHERE project_id IN {p_pids:Array(String)} AND time >= {p_from:DateTime64(3)} AND time <= {p_to:DateTime64(3)} ORDER BY time DESC LIMIT {p_n:UInt32}',
    );
    expect(query).toContain('ORDER BY occurrences DESC, key ASC LIMIT 500');
    expect(params).toMatchObject({ p_pids: ['p1', 'p2'], p_n: 10 });
  });

  it('objects expand one level, skipping children with a dot in their name', () => {
    const query = translateDiscoverKeys({ ...discoverBase, sampleSize: 10 }).query as string;
    expect(query).toContain("if(JSONType(kv.2) = 'Object'");
    expect(query).toContain("arrayFilter(c -> position(c, '.') = 0, JSONExtractKeys(kv.2))");
    expect(query).toContain('arrayDistinct(');
  });

  it('the engine maps rows to key occurrences', async () => {
    const { engine } = stubEngine([
      { key: 'env', occurrences: '3' },
      { key: 'http.method', occurrences: '1' },
    ]);
    expect(await engine.discoverMetadataKeys(discoverBase)).toEqual([
      { key: 'env', occurrences: 3 },
      { key: 'http.method', occurrences: 1 },
    ]);
  });

  it('rejects a reversed range before querying', async () => {
    const { engine, query } = stubEngine();
    await expect(engine.discoverMetadataKeys({ ...discoverBase, from: discoverBase.to, to: discoverBase.from })).rejects.toBeInstanceOf(RangeError);
    expect(query).not.toHaveBeenCalled();
  });
});
