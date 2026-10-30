import { describe, it, expect, vi } from 'vitest';
import { Long, type Document } from 'mongodb';
import {
  assembleFacets,
  assembleHistogram,
  assembleSessions,
  discoverKeysPipeline,
  facetsPipeline,
  histogramPipeline,
  listSessionsPipeline,
} from './log-analytics.js';
import { resolvedValueExpr, scalarTextExpr } from './json-path.js';
import { decodeSessionCursor, encodeSessionCursor } from '../../core/aggregation-helpers.js';
import { MongoDBQueryTranslator } from './query-translator.js';
import { MongoDBEngine } from './mongodb-engine.js';
import type { LogFacetField, LogFacetsParams, LogHistogramParams, StorageConfig } from '../../core/types.js';

const at = (iso: string) => new Date(`2026-01-05T${iso}Z`);
const row = (iso: string, level: string, n: number) => ({ _id: { b: at(iso).getTime(), level }, n });

const config: StorageConfig = { host: 'localhost', port: 27017, database: 'unused', username: '', password: '' };
const PROJECT = '00000000-0000-0000-0000-000000000001';

describe('assembleHistogram', () => {
  it('zero-fills missing buckets and keeps only non-zero levels', () => {
    const result = assembleHistogram(
      { from: at('10:00:00'), to: at('10:15:00'), bucketSeconds: 300 },
      [row('10:00:00', 'info', 2), row('10:00:00', 'error', 1), row('10:10:00', 'warn', 4), row('10:10:00', 'debug', 0)],
    );
    expect(result.bucketSeconds).toBe(300);
    expect(result.buckets.map((b) => b.time.toISOString())).toEqual([
      '2026-01-05T10:00:00.000Z',
      '2026-01-05T10:05:00.000Z',
      '2026-01-05T10:10:00.000Z',
      '2026-01-05T10:15:00.000Z',
    ]);
    expect(result.buckets[0]).toMatchObject({ total: 3, byLevel: { info: 2, error: 1 } });
    expect(result.buckets[1]).toMatchObject({ total: 0, byLevel: {} });
    expect(result.buckets[2]).toMatchObject({ total: 4, byLevel: { warn: 4 } });
    expect(result.buckets[3]).toMatchObject({ total: 0, byLevel: {} });
  });

  it('aligns buckets to the unix epoch', () => {
    const result = assembleHistogram({ from: at('10:07:30'), to: at('10:12:00'), bucketSeconds: 300 }, []);
    expect(result.buckets[0].time.toISOString()).toBe('2026-01-05T10:05:00.000Z');
  });

  it('drops the bucket at an aligned exclusive end', () => {
    const result = assembleHistogram({ from: at('10:00:00'), to: at('10:15:00'), toExclusive: true, bucketSeconds: 300 }, []);
    expect(result.buckets.map((b) => b.time.toISOString()).at(-1)).toBe('2026-01-05T10:10:00.000Z');
  });

  it('accepts bucket starts and counts returned as BSON longs', () => {
    const result = assembleHistogram(
      { from: at('10:00:00'), to: at('10:05:00'), bucketSeconds: 300 },
      [{ _id: { b: Long.fromNumber(at('10:05:00').getTime()), level: 'error' }, n: Long.fromNumber(7) }],
    );
    expect(result.buckets[1]).toMatchObject({ total: 7, byLevel: { error: 7 } });
  });
});

describe('MongoDBEngine.histogram validation', () => {
  const engine = new MongoDBEngine(config);
  const base: LogHistogramParams = { projectId: PROJECT, from: at('10:00:00'), to: at('11:00:00'), bucketSeconds: 60 };

  it('rejects a bucket size that is not a positive integer', async () => {
    await expect(engine.histogram({ ...base, bucketSeconds: 0 })).rejects.toBeInstanceOf(RangeError);
    await expect(engine.histogram({ ...base, bucketSeconds: 1.5 })).rejects.toBeInstanceOf(RangeError);
  });

  it('rejects too many buckets with a readable message', async () => {
    const tooMany = { ...base, from: new Date(0), to: new Date((1001 * 60 - 1) * 1000) };
    await expect(engine.histogram(tooMany)).rejects.toBeInstanceOf(RangeError);
    await expect(engine.histogram(tooMany)).rejects.toThrow('this range needs 1,001 buckets of 60 s');
  });
});

describe('MongoDBEngine.histogram query', () => {
  it('aggregates the pipeline on the logs collection with allowDiskUse', async () => {
    const calls: { pipeline: Document[]; options: Record<string, unknown> }[] = [];
    const collection = {
      aggregate: vi.fn((pipeline: Document[], options: Record<string, unknown>) => {
        calls.push({ pipeline, options });
        return { toArray: async () => [row('10:05:00', 'error', 2)] };
      }),
    };
    const db = { collection: vi.fn(() => collection) };
    const engine = new MongoDBEngine(config, { db: db as never, skipInitialize: true });
    const result = await engine.histogram({ projectId: PROJECT, from: at('10:00:00'), to: at('10:10:00'), bucketSeconds: 300, service: 'api' });
    expect(db.collection).toHaveBeenCalledWith('logs');
    expect(calls).toHaveLength(1);
    expect(calls[0].options.allowDiskUse).toBe(true);
    expect(calls[0].pipeline[0]).toMatchObject({ $match: { project_id: PROJECT, service: 'api' } });
    expect(result.buckets.map((b) => b.total)).toEqual([0, 2, 0]);
  });
});

describe('histogramPipeline', () => {
  it('histogram reuses the log filter and epoch-aligned arithmetic', () => {
    const translator = new MongoDBQueryTranslator();
    const filter = translator.buildLogFilter({
      projectId: PROJECT,
      from: at('10:00:00'),
      to: at('11:00:00'),
      textQuery: { all: [{ kind: 'word', value: 'timeout' }], anyOf: [], none: [] },
      exclude: { level: ['debug'] },
    });
    const pipeline = histogramPipeline(filter, 300_000);
    expect(pipeline[0]).toEqual({ $match: filter });
    const match = JSON.stringify(pipeline[0]);
    expect(match).toContain(`"project_id":"${PROJECT}"`);
    expect(match).toContain('"$regex"');
    expect(match).toContain('"$nin":["debug"]');
    const group = JSON.stringify(pipeline[1]);
    expect(group).toContain('"$mod":[{"$toLong":"$time"},300000]');
    expect(group).toContain('"level":"$level"');
    expect(JSON.stringify(pipeline)).not.toContain('$dateTrunc');
  });
});

// ----------------------------------------------------------------------------
// Facets
// ----------------------------------------------------------------------------

/** A fake logs collection that records aggregate calls and answers with `rows`. */
function fakeLogsDb(rows: Document[]) {
  const calls: { pipeline: Document[]; options: Record<string, unknown> }[] = [];
  const collection = {
    aggregate: vi.fn((pipeline: Document[], options: Record<string, unknown>) => {
      calls.push({ pipeline, options });
      return { toArray: async () => rows };
    }),
  };
  const db = { collection: vi.fn(() => collection) };
  return { db, calls };
}

const facetBase: LogFacetsParams = { projectId: PROJECT, from: at('10:00:00'), to: at('11:00:00'), fields: [{ builtin: 'level' }] };

function topNOf(pipeline: Document[]): Document {
  const group = pipeline.find((stage) => stage.$group && JSON.stringify(stage).includes('$topN'));
  expect(group, 'a $group stage with $topN').toBeDefined();
  return group!.$group.values.$topN as Document;
}

describe('MongoDBEngine.facets validation', () => {
  it('limit defaults to 10 and clamps to 1..50', async () => {
    const { db, calls } = fakeLogsDb([]);
    const engine = new MongoDBEngine(config, { db: db as never, skipInitialize: true });
    await engine.facets(facetBase);
    await engine.facets({ ...facetBase, limit: 0 });
    await engine.facets({ ...facetBase, limit: 99 });
    expect(calls.map((c) => topNOf(c.pipeline).n)).toEqual([10, 1, 50]);
    expect(calls.every((c) => c.options.allowDiskUse === true)).toBe(true);
    expect(db.collection).toHaveBeenCalledWith('logs');
  });

  it('rejects no fields and more than 20 fields', async () => {
    const engine = new MongoDBEngine(config, { db: fakeLogsDb([]).db as never, skipInitialize: true });
    await expect(engine.facets({ ...facetBase, fields: [] })).rejects.toBeInstanceOf(RangeError);
    const fields = Array.from({ length: 21 }, (_, i) => ({ metadata: `k${i}` }));
    await expect(engine.facets({ ...facetBase, fields })).rejects.toBeInstanceOf(RangeError);
  });

  it('answers from the grouped rows in request order', async () => {
    const { db } = fakeLogsDb([{ _id: 1, total: 3, values: [{ v: 'eu', c: 3 }] }]);
    const engine = new MongoDBEngine(config, { db: db as never, skipInitialize: true });
    const result = await engine.facets({ ...facetBase, fields: [{ builtin: 'service' }, { metadata: 'region' }] });
    expect(result.facets).toEqual([
      { field: 'service', values: [], otherCount: 0 },
      { field: 'metadata.region', values: [{ value: 'eu', count: 3 }], otherCount: 0 },
    ]);
  });
});

describe('assembleFacets', () => {
  it('otherCount is the field total minus returned counts', () => {
    const result = assembleFacets([{ builtin: 'service' }], [{ _id: 0, total: 10, values: [{ v: 'api', c: 4 }, { v: 'auth', c: 3 }] }], 2);
    expect(result.facets[0]).toEqual({ field: 'service', values: [{ value: 'api', count: 4 }, { value: 'auth', count: 3 }], otherCount: 3 });
  });

  it('keeps request order and labels', () => {
    const fields: LogFacetField[] = [{ builtin: 'service' }, { metadata: 'region' }, { builtin: 'level' }];
    const rows = [
      { _id: 2, total: 1, values: [{ v: 'info', c: 1 }] },
      { _id: 0, total: 1, values: [{ v: 'api', c: 1 }] },
      { _id: 1, total: 1, values: [{ v: 'eu', c: 1 }] },
    ];
    expect(assembleFacets(fields, rows, 10).facets.map((f) => f.field)).toEqual(['service', 'metadata.region', 'level']);
  });

  it('a field without values returns an empty list', () => {
    expect(assembleFacets([{ metadata: 'nothing' }], [], 10).facets).toEqual([{ field: 'metadata.nothing', values: [], otherCount: 0 }]);
  });

  it('accepts counts returned as BSON longs', () => {
    const rows = [{ _id: Long.fromNumber(0), total: Long.fromNumber(9), values: [{ v: 'api', c: Long.fromNumber(9) }] }];
    expect(assembleFacets([{ builtin: 'service' }], rows, 10).facets[0]).toEqual({ field: 'service', values: [{ value: 'api', count: 9 }], otherCount: 0 });
  });
});

describe('facetsPipeline', () => {
  const translator = new MongoDBQueryTranslator();
  const filter = translator.buildLogFilter({ projectId: PROJECT, from: at('10:00:00'), to: at('11:00:00'), service: 'api' });

  it('starts with the shared log filter and counts each field once per log', () => {
    const pipeline = facetsPipeline(filter, [{ builtin: 'level' }, { builtin: 'service' }], 10);
    expect(pipeline[0]).toEqual({ $match: filter });
    const project = pipeline[1].$project as Document;
    expect(project.kv).toEqual([
      { f: { $literal: 0 }, v: '$level' },
      { f: { $literal: 1 }, v: '$service' },
    ]);
    expect(pipeline[2]).toEqual({ $unwind: '$kv' });
    expect(pipeline[3]).toEqual({ $match: { 'kv.v': { $nin: [null, ''] } } });
  });

  it('ties break in byte order after the count', () => {
    const topN = topNOf(facetsPipeline(filter, [{ builtin: 'service' }], 3));
    expect(topN.sortBy).toEqual({ count: -1, '_id.v': 1 });
    expect(topN.n).toBe(3);
  });

  it('metadata fields facet by the text form of the resolved key', () => {
    const pipeline = facetsPipeline(filter, [{ metadata: 'http.method' }], 10);
    const v = (pipeline[1].$project as Document).kv[0].v;
    expect(v).toEqual(scalarTextExpr(resolvedValueExpr('metadata', 'http.method')));
  });

  it('hostname facets only string hostnames from metadata', () => {
    const pipeline = facetsPipeline(filter, [{ builtin: 'hostname' }], 10);
    const json = JSON.stringify((pipeline[1].$project as Document).kv[0].v);
    expect(json).toContain('"$metadata.hostname"');
    expect(json).toContain('"string"');
  });
});

// ----------------------------------------------------------------------------
// Metadata key discovery
// ----------------------------------------------------------------------------

describe('MongoDBEngine.discoverMetadataKeys', () => {
  const discoverBase = { projectId: PROJECT, from: at('10:00:00'), to: at('11:00:00') };
  const limitOf = (pipeline: Document[]) => pipeline.find((stage) => '$limit' in stage)!.$limit;

  it('sample size defaults to 1000 and clamps to 1..5000', async () => {
    const { db, calls } = fakeLogsDb([]);
    const engine = new MongoDBEngine(config, { db: db as never, skipInitialize: true });
    await engine.discoverMetadataKeys(discoverBase);
    await engine.discoverMetadataKeys({ ...discoverBase, sampleSize: 0 });
    await engine.discoverMetadataKeys({ ...discoverBase, sampleSize: 99_999 });
    expect(calls.map((c) => limitOf(c.pipeline))).toEqual([1000, 1, 5000]);
    expect(db.collection).toHaveBeenCalledWith('logs');
  });

  it('maps rows to keys in occurrence then byte order', async () => {
    const { db } = fakeLogsDb([
      { _id: 'b', occurrences: 2 },
      { _id: 'a', occurrences: Long.fromNumber(2) },
      { _id: 'z', occurrences: 5 },
    ]);
    const engine = new MongoDBEngine(config, { db: db as never, skipInitialize: true });
    expect(await engine.discoverMetadataKeys(discoverBase)).toEqual([
      { key: 'z', occurrences: 5 },
      { key: 'a', occurrences: 2 },
      { key: 'b', occurrences: 2 },
    ]);
  });
});

describe('discoverKeysPipeline', () => {
  const pipeline = discoverKeysPipeline({ projectId: [PROJECT, 'p2'], from: at('10:00:00'), to: at('11:00:00'), sampleSize: 50 });

  it('samples the newest logs of the projects in range first', () => {
    expect(pipeline[0]).toEqual({ $match: { project_id: { $in: [PROJECT, 'p2'] }, time: { $gte: at('10:00:00'), $lte: at('11:00:00') } } });
    expect(pipeline[1]).toEqual({ $sort: { time: -1, id: -1 } });
    expect(pipeline[2]).toEqual({ $limit: 50 });
  });

  it('counts each key once per log, busiest first, at most 500 keys', () => {
    const json = JSON.stringify(pipeline);
    expect(json).toContain('"$objectToArray"');
    expect(json).toContain('"$setUnion"');
    const tail = pipeline.slice(-4);
    expect(tail[0]).toEqual({ $unwind: '$keys' });
    expect(tail[1]).toEqual({ $group: { _id: '$keys', occurrences: { $sum: 1 } } });
    expect(tail[2]).toEqual({ $sort: { occurrences: -1, _id: 1 } });
    expect(tail[3]).toEqual({ $limit: 500 });
  });

  it('a single project is an equality match', () => {
    const single = discoverKeysPipeline({ projectId: PROJECT, from: at('10:00:00'), to: at('11:00:00'), sampleSize: 5 });
    expect((single[0].$match as Document).project_id).toBe(PROJECT);
  });
});

// ----------------------------------------------------------------------------
// Sessions
// ----------------------------------------------------------------------------

describe('listSessionsPipeline', () => {
  const base = { projectId: PROJECT, from: at('10:00:00'), to: at('11:00:00') };

  it('scopes the project and window and skips empty session ids before grouping', () => {
    const pipeline = listSessionsPipeline({ ...base, service: 'api' }, 10, null);
    expect(pipeline[0]).toEqual({
      $match: { project_id: PROJECT, time: { $gte: at('10:00:00'), $lte: at('11:00:00') }, session_id: { $nin: [null, ''] }, service: 'api' },
    });
    expect(pipeline[1]).toEqual({
      $group: {
        _id: '$session_id',
        service: { $min: '$service' },
        first: { $min: '$time' },
        last: { $max: '$time' },
        eventCount: { $sum: 1 },
        errorCount: { $sum: { $cond: [{ $in: ['$level', ['error', 'critical']] }, 1, 0] } },
      },
    });
  });

  it('orders by last event desc then session id and fetches one extra group', () => {
    const pipeline = listSessionsPipeline(base, 10, null);
    expect(pipeline.slice(-2)).toEqual([{ $sort: { last: -1, _id: 1 } }, { $limit: 11 }]);
  });

  it('a cursor keeps groups strictly after the last row', () => {
    const lastEvent = at('10:05:00');
    const pipeline = listSessionsPipeline(base, 10, { lastEvent, sessionId: 's-1' });
    expect(pipeline[2]).toEqual({ $match: { $or: [{ last: { $lt: lastEvent } }, { last: lastEvent, _id: { $gt: 's-1' } }] } });
  });
});

describe('assembleSessions', () => {
  const group = (id: string, last: string, extra: Partial<Record<string, unknown>> = {}) => ({
    _id: id, service: 'api', first: at('10:00:00'), last: at(last), eventCount: 2, errorCount: Long.fromNumber(1), ...extra,
  });

  it('maps groups and returns a cursor only when more exist', () => {
    const page = assembleSessions([group('s1', '10:05:00'), group('s2', '10:05:00'), group('s3', '10:01:00')], 2);
    expect(page.sessions).toEqual([
      { sessionId: 's1', service: 'api', firstEvent: at('10:00:00'), lastEvent: at('10:05:00'), eventCount: 2, errorCount: 1 },
      { sessionId: 's2', service: 'api', firstEvent: at('10:00:00'), lastEvent: at('10:05:00'), eventCount: 2, errorCount: 1 },
    ]);
    expect(decodeSessionCursor(page.nextCursor!)).toEqual({ lastEvent: at('10:05:00'), sessionId: 's2' });
    expect(assembleSessions([group('s1', '10:05:00')], 2)).toEqual({ sessions: [expect.objectContaining({ sessionId: 's1' })] });
  });
});

describe('MongoDBEngine sessions', () => {
  const base = { projectId: PROJECT, from: at('10:00:00'), to: at('11:00:00') };

  it('limit clamps to 200 and the pipeline fetches one extra group', async () => {
    const { db, calls } = fakeLogsDb([]);
    const engine = new MongoDBEngine(config, { db: db as never, skipInitialize: true });
    expect(await engine.listSessions({ ...base, limit: 9999 })).toEqual({ sessions: [] });
    expect(calls[0].pipeline.at(-1)).toEqual({ $limit: 201 });
    expect(calls[0].options.allowDiskUse).toBe(true);
    expect(db.collection).toHaveBeenCalledWith('logs');
  });

  it('passes a decoded cursor and rejects an invalid one', async () => {
    const { db, calls } = fakeLogsDb([]);
    const engine = new MongoDBEngine(config, { db: db as never, skipInitialize: true });
    await engine.listSessions({ ...base, limit: 5, cursor: encodeSessionCursor(at('10:05:00'), 's-9') });
    expect(JSON.stringify(calls[0].pipeline[2])).toContain('"s-9"');
    await expect(engine.listSessions({ ...base, limit: 5, cursor: 'not a cursor' })).rejects.toBeInstanceOf(RangeError);
    await expect(engine.listSessions({ ...base, limit: 0 })).rejects.toBeInstanceOf(RangeError);
  });

  it('hasSessions probes one log with the same match', async () => {
    const finds: Document[] = [];
    let answer: Document | null = { _id: 1 };
    const collection = { findOne: vi.fn(async (filter: Document, options: Document) => { finds.push({ filter, options }); return answer; }) };
    const engine = new MongoDBEngine(config, { db: { collection: vi.fn(() => collection) } as never, skipInitialize: true });
    expect(await engine.hasSessions(base)).toBe(true);
    answer = null;
    expect(await engine.hasSessions(base)).toBe(false);
    expect(finds[0]).toMatchObject({
      filter: { project_id: PROJECT, time: { $gte: at('10:00:00'), $lte: at('11:00:00') }, session_id: { $nin: [null, ''] } },
      options: { projection: { _id: 1 } },
    });
    await expect(engine.hasSessions({ projectId: PROJECT, from: at('11:00:00'), to: at('10:00:00') })).rejects.toBeInstanceOf(RangeError);
  });
});
