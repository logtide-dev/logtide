import { describe, it, expect, vi } from 'vitest';
import type { Document } from 'mongodb';
import {
  assembleOperationStats,
  bucketIndexExpr,
  buildSpanFilter,
  buildTraceFilter,
  entrySpanMatch,
  isTraceSpanMatchActive,
  latencyHistogramPipeline,
  operationStatsPipeline,
  percentilesFromBuckets,
  routeAttributeFilters,
  spanSort,
  traceMatchPipeline,
  traceSort,
} from './apm-queries.js';
import { MongoDBEngine } from './mongodb-engine.js';
import { DEFAULT_OPERATION_KINDS, LATENCY_HISTOGRAM_BOUNDS_MS } from '../../core/constants.js';
import { latencyBucketIndex } from '../../core/aggregation-helpers.js';
import type { MetadataFilter, SpanQueryParams, StorageConfig, TraceQueryParams } from '../../core/types.js';

const config: StorageConfig = { host: 'localhost', port: 27017, database: 'unused', username: '', password: '' };
const PROJECT = '00000000-0000-0000-0000-000000000001';
const FROM = new Date('2026-01-05T10:00:00Z');
const TO = new Date('2026-01-05T12:00:00Z');
const spanBase: SpanQueryParams = { projectId: PROJECT, from: FROM, to: TO };
const traceBase: TraceQueryParams = { projectId: PROJECT, from: FROM, to: TO };
const equals = (key: string, value: string): MetadataFilter => ({ key, op: 'equals', value, include_missing: false });

describe('buildSpanFilter', () => {
  it('operation and legacy operationName both filter operation_name', () => {
    expect(buildSpanFilter({ ...spanBase, operationName: 'GET /x' }).operation_name).toBe('GET /x');
    expect(buildSpanFilter({ ...spanBase, operationName: ['GET /x', 'POST /y'] }).operation_name).toEqual({ $in: ['GET /x', 'POST /y'] });
    expect(buildSpanFilter({ ...spanBase, operation: 'GET /x' }).operation_name).toBe('GET /x');
    const both = buildSpanFilter({ ...spanBase, operationName: ['GET /x', 'POST /y'], operation: 'GET /x' });
    expect(both.operation_name).toEqual({ $in: ['GET /x', 'POST /y'] });
    expect(both.$and).toContainEqual({ operation_name: 'GET /x' });
  });

  it('keeps the project, window and typed filters', () => {
    const filter = buildSpanFilter({ ...spanBase, toExclusive: true, serviceName: ['api', 'db'], kind: 'SERVER', statusCode: ['ERROR'], traceId: 't1' });
    expect(filter).toMatchObject({
      project_id: PROJECT,
      time: { $gte: FROM, $lt: TO },
      service_name: { $in: ['api', 'db'] },
      kind: 'SERVER',
      status_code: 'ERROR',
      trace_id: 't1',
    });
    expect(filter.$and).toBeUndefined();
  });

  it('attribute filters compile against attributes with the metadata rules', () => {
    const json = JSON.stringify(buildSpanFilter({ ...spanBase, attributeFilters: [equals('http.status_code', '500')] }));
    expect(json).toContain('"$attributes"');
    expect(json).toContain('"http.status_code"');
    expect(json).toContain('"$getField"');
  });

  it('attribute filters route resource-prefixed keys to resource_attributes', () => {
    const routed = routeAttributeFilters([equals('resource.service.version', '1.2'), equals('http.route', '/x')]);
    expect(routed.attributes.map((f) => f.key)).toEqual(['http.route']);
    expect(routed.resource.map((f) => f.key)).toEqual(['service.version']);
    const json = JSON.stringify(buildSpanFilter({ ...spanBase, attributeFilters: [equals('resource.service.version', '1.2')] }));
    expect(json).toContain('"$resource_attributes"');
    expect(json).toContain('"service.version"');
    expect(json).not.toContain('"$attributes"');
  });

  it('a bare resource. key stays an attribute key', () => {
    expect(routeAttributeFilters([equals('resource.', 'x')]).attributes.map((f) => f.key)).toEqual(['resource.']);
  });
});

describe('spanSort', () => {
  it('defaults to start_time ascending with a span_id tie-break', () => {
    expect(spanSort({})).toEqual({ start_time: 1, span_id: 1 });
  });

  it('sortBy duration maps to duration_ms', () => {
    expect(spanSort({ sortBy: 'duration', sortOrder: 'desc' })).toEqual({ duration_ms: -1, span_id: 1 });
    expect(spanSort({ sortBy: 'duration_ms', sortOrder: 'desc' })).toEqual({ duration_ms: -1, span_id: 1 });
  });

  it('legacy sort columns keep working', () => {
    expect(spanSort({ sortBy: 'end_time' })).toEqual({ end_time: 1, span_id: 1 });
    expect(spanSort({ sortBy: 'service_name', sortOrder: 'asc' })).toEqual({ service_name: 1, span_id: 1 });
    expect(spanSort({ sortBy: 'operation_name', sortOrder: 'desc' })).toEqual({ operation_name: -1, span_id: 1 });
  });

  it('an unknown value falls back to start_time', () => {
    expect(spanSort({ sortBy: 'attributes; drop' as never })).toEqual({ start_time: 1, span_id: 1 });
    expect(spanSort({ sortBy: 'constructor' as never })).toEqual({ start_time: 1, span_id: 1 });
  });
});

describe('traceSort', () => {
  it('defaults to start_time descending with a trace_id tie-break', () => {
    expect(traceSort({})).toEqual({ start_time: -1, trace_id: 1 });
  });

  it('sorts by duration either way', () => {
    expect(traceSort({ sortBy: 'duration', sortOrder: 'asc' })).toEqual({ duration_ms: 1, trace_id: 1 });
    expect(traceSort({ sortBy: 'duration' })).toEqual({ duration_ms: -1, trace_id: 1 });
    expect(traceSort({ sortBy: 'start_time', sortOrder: 'asc' })).toEqual({ start_time: 1, trace_id: 1 });
  });
});

describe('trace span-match block', () => {
  it('is active with an operation or attribute filters', () => {
    expect(isTraceSpanMatchActive(traceBase)).toBe(false);
    expect(isTraceSpanMatchActive({ ...traceBase, attributeFilters: [] })).toBe(false);
    expect(isTraceSpanMatchActive({ ...traceBase, operation: 'GET /x' })).toBe(true);
    expect(isTraceSpanMatchActive({ ...traceBase, attributeFilters: [equals('a', 'b')] })).toBe(true);
  });

  it('pipeline starts on spans with the window $match', () => {
    const pipeline = traceMatchPipeline({ ...traceBase, operation: 'GET /x' }, traceSort({}), 0, 20);
    expect(pipeline[0]).toEqual({ $match: { project_id: PROJECT, time: { $gte: FROM, $lte: TO }, operation_name: 'GET /x' } });
    expect(pipeline[1]).toEqual({ $group: { _id: { p: '$project_id', t: '$trace_id' } } });
  });

  it('one span must match the operation and every attribute filter together', () => {
    const pipeline = traceMatchPipeline(
      { ...traceBase, operation: 'GET /x', attributeFilters: [equals('http.method', 'POST'), equals('db.system', 'pg')] },
      traceSort({}), 0, 20,
    );
    const match = pipeline[0].$match as Document;
    expect(match.operation_name).toBe('GET /x');
    expect(match.$and).toHaveLength(2);
  });

  it('joins traces of the same project and applies the trace filters there', () => {
    const pipeline = traceMatchPipeline({ ...traceBase, operation: 'GET /x', error: true, minDurationMs: 10 }, traceSort({}), 0, 20);
    const lookup = pipeline.find((s) => s.$lookup)!.$lookup as Document;
    expect(lookup).toMatchObject({ from: 'traces', localField: '_id.t', foreignField: 'trace_id' });
    expect(JSON.stringify(lookup.pipeline)).toContain('"$$p"');
    const traceMatch = pipeline.slice(pipeline.findIndex((s) => s.$replaceRoot)).find((s) => s.$match)!.$match as Document;
    expect(traceMatch).toMatchObject({ project_id: PROJECT, start_time: { $gte: FROM, $lte: TO }, error: true, duration_ms: { $gte: 10 } });
  });

  it('serviceName keeps its trace-level meaning while the block is active', () => {
    const pipeline = traceMatchPipeline({ ...traceBase, operation: 'GET /x', serviceName: ['api'] }, traceSort({}), 0, 20);
    expect((pipeline[0].$match as Document).service_name).toBeUndefined();
    const traceMatch = pipeline.slice(pipeline.findIndex((s) => s.$replaceRoot)).find((s) => s.$match)!.$match as Document;
    expect(traceMatch.service_name).toBe('api');
  });

  it('pages with the requested sort and counts the same matches', () => {
    const sort = traceSort({ sortBy: 'duration', sortOrder: 'asc' });
    const facet = traceMatchPipeline({ ...traceBase, operation: 'GET /x' }, sort, 40, 20).at(-1)!.$facet as Document;
    expect(facet.total).toEqual([{ $count: 'n' }]);
    expect(facet.page).toEqual([{ $sort: sort }, { $skip: 40 }, { $limit: 20 }, { $project: { _id: 0 } }]);
  });
});

describe('buildTraceFilter', () => {
  it('keeps the trace-level filters', () => {
    expect(buildTraceFilter({ ...traceBase, organizationId: 'o1', serviceName: ['api', 'web'], maxDurationMs: 99 })).toEqual({
      project_id: PROJECT,
      start_time: { $gte: FROM, $lte: TO },
      organization_id: 'o1',
      service_name: { $in: ['api', 'web'] },
      duration_ms: { $lte: 99 },
    });
  });
});

// ----------------------------------------------------------------------------
// Engine wiring (mocked collections)
// ----------------------------------------------------------------------------

function fakeDb(aggregateRows: Document[] = [], findRows: Document[] = []) {
  const calls: { col: string; op: string; args: unknown[] }[] = [];
  const cursor = (rows: Document[], col: string) => {
    const c = {
      sort: (s: Document) => { calls.push({ col, op: 'sort', args: [s] }); return c; },
      skip: () => c,
      limit: () => c,
      toArray: async () => rows,
    };
    return c;
  };
  const collection = (col: string) => ({
    find: vi.fn((filter: Document) => { calls.push({ col, op: 'find', args: [filter] }); return cursor(findRows, col); }),
    countDocuments: vi.fn(async () => findRows.length),
    aggregate: vi.fn((pipeline: Document[], options: Document) => {
      calls.push({ col, op: 'aggregate', args: [pipeline, options] });
      return { toArray: async () => aggregateRows };
    }),
  });
  const cols = new Map<string, ReturnType<typeof collection>>();
  const db = { collection: vi.fn((name: string) => cols.get(name) ?? (cols.set(name, collection(name)), cols.get(name)!)) };
  return { db, calls };
}

const traceDoc = (traceId: string) => ({
  trace_id: traceId, project_id: PROJECT, service_name: 'api', start_time: FROM, end_time: TO, duration_ms: 5, span_count: 1, error: false,
});

describe('MongoDBEngine span and trace queries', () => {
  it('querySpans filters operationName and sorts with the tie-break', async () => {
    const { db, calls } = fakeDb();
    const engine = new MongoDBEngine(config, { db: db as never, skipInitialize: true });
    await engine.querySpans({ ...spanBase, operationName: 'POST /orders', sortBy: 'duration', sortOrder: 'desc' });
    const find = calls.find((c) => c.op === 'find')!;
    expect(find.col).toBe('spans');
    expect((find.args[0] as Document).operation_name).toBe('POST /orders');
    expect(calls.find((c) => c.op === 'sort')!.args[0]).toEqual({ duration_ms: -1, span_id: 1 });
  });

  it('queryTraces without the block reads traces with the trace sort', async () => {
    const { db, calls } = fakeDb([], [traceDoc('t1')]);
    const engine = new MongoDBEngine(config, { db: db as never, skipInitialize: true });
    const result = await engine.queryTraces({ ...traceBase, sortBy: 'duration', sortOrder: 'asc' });
    expect(calls.find((c) => c.op === 'find')!.col).toBe('traces');
    expect(calls.find((c) => c.op === 'sort')!.args[0]).toEqual({ duration_ms: 1, trace_id: 1 });
    expect(result.traces.map((t) => t.traceId)).toEqual(['t1']);
  });

  it('queryTraces with the block aggregates on spans and reads total and page', async () => {
    const { db, calls } = fakeDb([{ total: [{ n: 3 }], page: [traceDoc('t2'), traceDoc('t3')] }]);
    const engine = new MongoDBEngine(config, { db: db as never, skipInitialize: true });
    const result = await engine.queryTraces({ ...traceBase, operation: 'GET /x', limit: 2 });
    const agg = calls.find((c) => c.op === 'aggregate')!;
    expect(agg.col).toBe('spans');
    expect((agg.args[1] as Document).allowDiskUse).toBe(true);
    expect(result).toMatchObject({ total: 3, hasMore: true, limit: 2, offset: 0 });
    expect(result.traces.map((t) => t.traceId)).toEqual(['t2', 't3']);
  });

  it('queryTraces with the block and no match returns an empty page', async () => {
    const { db } = fakeDb([{ total: [], page: [] }]);
    const engine = new MongoDBEngine(config, { db: db as never, skipInitialize: true });
    expect(await engine.queryTraces({ ...traceBase, operation: 'GET /x' })).toMatchObject({ traces: [], total: 0, hasMore: false });
  });
});

// ----------------------------------------------------------------------------
// Operation stats and latency histogram
// ----------------------------------------------------------------------------

const statsBase = { projectId: PROJECT, from: FROM, to: TO };

describe('entry span selection', () => {
  it('kinds default to SERVER and CONSUMER', () => {
    const match = operationStatsPipeline({ ...statsBase, limit: 100 }, 'kinds', 'native')[0].$match as Document;
    expect(match).toEqual({ project_id: PROJECT, time: { $gte: FROM, $lte: TO }, kind: { $in: ['SERVER', 'CONSUMER'] } });
  });

  it('explicit kinds and the service scope pass through', () => {
    const match = operationStatsPipeline({ ...statsBase, service: 'api', kinds: ['CLIENT'], limit: 100 }, 'kinds', 'native')[0].$match as Document;
    expect(match).toEqual({ project_id: PROJECT, time: { $gte: FROM, $lte: TO }, service_name: 'api', kind: { $in: ['CLIENT'] } });
  });

  it('root mode selects parent_span_id null or empty', () => {
    const match = entrySpanMatch(statsBase, 'root', DEFAULT_OPERATION_KINDS);
    expect(match).toEqual({ project_id: PROJECT, time: { $gte: FROM, $lte: TO }, parent_span_id: { $in: [null, ''] } });
  });
});

describe('operationStatsPipeline', () => {
  it('native strategy emits $percentile and orders by count then names', () => {
    const pipeline = operationStatsPipeline({ ...statsBase, limit: 7 }, 'kinds', 'native');
    const group = pipeline[1].$group as Document;
    expect(group._id).toEqual({ s: '$service_name', o: '$operation_name' });
    expect(group.p).toEqual({ $percentile: { input: '$duration_ms', p: [0.5, 0.95, 0.99], method: 'approximate' } });
    expect(pipeline[2]).toEqual({ $sort: { count: -1, '_id.s': 1, '_id.o': 1 } });
    expect(pipeline[3]).toEqual({ $limit: 7 });
  });

  it('buckets strategy never emits $percentile and groups by latency bucket', () => {
    const pipeline = operationStatsPipeline({ ...statsBase, limit: 7 }, 'kinds', 'buckets');
    expect(JSON.stringify(pipeline)).not.toContain('$percentile');
    const group = pipeline[1].$group as Document;
    expect(group._id).toEqual({ s: '$service_name', o: '$operation_name', b: bucketIndexExpr() });
    expect(group).toMatchObject({ min: { $min: '$duration_ms' }, max: { $max: '$duration_ms' } });
  });
});

describe('bucketIndexExpr', () => {
  it('counts the bounds below the duration (upper-inclusive, overflow last)', () => {
    expect(bucketIndexExpr()).toEqual({
      $size: { $filter: { input: [...LATENCY_HISTOGRAM_BOUNDS_MS], cond: { $lt: ['$$this', '$duration_ms'] } } },
    });
  });

  it('latency pipeline groups entry spans of the operation by bucket', () => {
    const pipeline = latencyHistogramPipeline({ ...statsBase, service: 'api', operation: 'GET /x' }, 'kinds');
    expect(pipeline[0]).toEqual({
      $match: { project_id: PROJECT, time: { $gte: FROM, $lte: TO }, service_name: 'api', kind: { $in: ['SERVER', 'CONSUMER'] }, operation_name: 'GET /x' },
    });
    expect(pipeline[1]).toEqual({ $group: { _id: bucketIndexExpr(), n: { $sum: 1 } } });
  });
});

describe('percentilesFromBuckets', () => {
  const counts = (index: number, n: number) => Array.from({ length: LATENCY_HISTOGRAM_BOUNDS_MS.length + 1 }, (_, i) => (i === index ? n : 0));

  it('interpolates inside a bucket and stays within min and max', () => {
    // Ten spans in (20, 50] ms, observed between 21 and 49 ms.
    const [p50, p95, p99] = percentilesFromBuckets(LATENCY_HISTOGRAM_BOUNDS_MS, counts(5, 10), [0.5, 0.95, 0.99], 21, 49);
    expect(p50).toBeGreaterThanOrEqual(21);
    expect(p50).toBeLessThan(50);
    expect(p99).toBeLessThanOrEqual(49);
    expect(p50 <= p95 && p95 <= p99).toBe(true);
  });

  it('a single value is every percentile', () => {
    expect(percentilesFromBuckets(LATENCY_HISTOGRAM_BOUNDS_MS, counts(9, 1), [0.5, 0.99], 700, 700)).toEqual([700, 700]);
  });

  it('the overflow bucket ends at the maximum', () => {
    const [p99] = percentilesFromBuckets(LATENCY_HISTOGRAM_BOUNDS_MS, counts(16, 4), [0.99], 61000, 90000);
    expect(p99).toBeGreaterThan(61000);
    expect(p99).toBeLessThanOrEqual(90000);
  });

  it('tracks uniform durations closely across buckets', () => {
    const c = counts(0, 0);
    for (let d = 1; d <= 100; d++) c[latencyBucketIndex(d)]++;
    const [p50, p95] = percentilesFromBuckets(LATENCY_HISTOGRAM_BOUNDS_MS, c, [0.5, 0.95], 1, 100);
    expect(Math.abs(p50 - 50.5)).toBeLessThanOrEqual(1.5);
    expect(Math.abs(p95 - 95.05)).toBeLessThanOrEqual(1.5);
  });
});

describe('assembleOperationStats', () => {
  it('maps native rows and orders by count, then service and operation in byte order', () => {
    const rows = [
      { _id: { s: 'b', o: 'x' }, count: 2, errors: 0, avg: 5, p: [1, 2, 3] },
      { _id: { s: 'a', o: 'y' }, count: 2, errors: 1, avg: 4, p: [4, 5, 6] },
      { _id: { s: 'z', o: 'q' }, count: 9, errors: 0, avg: 1, p: [1, 1, 1] },
    ];
    expect(assembleOperationStats(rows, 'native', 2)).toEqual([
      { service: 'z', operation: 'q', count: 9, errorCount: 0, avgMs: 1, p50Ms: 1, p95Ms: 1, p99Ms: 1 },
      { service: 'a', operation: 'y', count: 2, errorCount: 1, avgMs: 4, p50Ms: 4, p95Ms: 5, p99Ms: 6 },
    ]);
  });

  it('merges bucket rows per operation', () => {
    const rows = [
      { _id: { s: 'api', o: 'GET', b: 1 }, n: 1, errors: 0, sum: 2, min: 2, max: 2 },
      { _id: { s: 'api', o: 'GET', b: 3 }, n: 2, errors: 1, sum: 16, min: 7, max: 9 },
    ];
    const [stat] = assembleOperationStats(rows, 'buckets', 100);
    expect(stat).toMatchObject({ service: 'api', operation: 'GET', count: 3, errorCount: 1, avgMs: 6 });
    expect(stat.p50Ms).toBeGreaterThanOrEqual(2);
    expect(stat.p99Ms).toBeLessThanOrEqual(9);
  });
});

describe('MongoDBEngine operation stats wiring', () => {
  function fakeSpansDb(answers: Document[][], probe: Document | null = null) {
    const pipelines: Document[][] = [];
    const finds: Document[] = [];
    const collection = {
      aggregate: vi.fn((pipeline: Document[]) => {
        pipelines.push(pipeline);
        const rows = answers.shift() ?? [];
        return { toArray: async () => rows };
      }),
      findOne: vi.fn(async (filter: Document) => {
        finds.push(filter);
        return probe;
      }),
    };
    return { db: { collection: vi.fn(() => collection) }, pipelines, finds };
  }
  const native = { _id: { s: 'web', o: 'page' }, count: 3, errors: 0, avg: 10, p: [10, 10, 10] };

  it('falls back to root spans when the scope has no entry span', async () => {
    const { db, pipelines } = fakeSpansDb([[], [native]]);
    const engine = new MongoDBEngine(config, { db: db as never, skipInitialize: true, percentileStrategy: 'native' });
    const stats = await engine.getOperationStats(statsBase);
    expect(stats.map((s) => s.operation)).toEqual(['page']);
    expect((pipelines[0][0].$match as Document).kind).toEqual({ $in: ['SERVER', 'CONSUMER'] });
    expect((pipelines[1][0].$match as Document).parent_span_id).toEqual({ $in: [null, ''] });
    expect(pipelines[0][3]).toEqual({ $limit: 100 });
  });

  it('explicit kinds never fall back', async () => {
    const { db, pipelines } = fakeSpansDb([[], [native]]);
    const engine = new MongoDBEngine(config, { db: db as never, skipInitialize: true, percentileStrategy: 'native' });
    expect(await engine.getOperationStats({ ...statsBase, kinds: ['SERVER'] })).toEqual([]);
    expect(pipelines).toHaveLength(1);
  });

  it('limit clamps to 500 and the auto strategy without server info uses buckets', async () => {
    const { db, pipelines } = fakeSpansDb([[{ _id: { s: 'a', o: 'b', b: 2 }, n: 1, errors: 0, sum: 3, min: 3, max: 3 }]]);
    const engine = new MongoDBEngine(config, { db: db as never, skipInitialize: true });
    const stats = await engine.getOperationStats({ ...statsBase, limit: 9999 });
    expect(JSON.stringify(pipelines[0])).not.toContain('$percentile');
    expect(stats).toEqual([{ service: 'a', operation: 'b', count: 1, errorCount: 0, avgMs: 3, p50Ms: 3, p95Ms: 3, p99Ms: 3 }]);
  });

  it('native limit is clamped to 500', async () => {
    const { db, pipelines } = fakeSpansDb([[native]]);
    const engine = new MongoDBEngine(config, { db: db as never, skipInitialize: true, percentileStrategy: 'native' });
    await engine.getOperationStats({ ...statsBase, limit: 9999 });
    expect(pipelines[0][3]).toEqual({ $limit: 500 });
  });

  it('latency histogram decides the entry mode before the operation filter', async () => {
    const { db, pipelines, finds } = fakeSpansDb([[{ _id: 0, n: 2 }, { _id: 16, n: 1 }]], null);
    const engine = new MongoDBEngine(config, { db: db as never, skipInitialize: true });
    const result = await engine.getLatencyHistogram({ ...statsBase, service: 'worker', operation: 'job loop' });
    expect(finds[0]).toEqual({ project_id: PROJECT, time: { $gte: FROM, $lte: TO }, service_name: 'worker', kind: { $in: ['SERVER', 'CONSUMER'] } });
    expect(pipelines[0][0].$match).toMatchObject({ parent_span_id: { $in: [null, ''] }, operation_name: 'job loop' });
    expect(result.bounds).toEqual([...LATENCY_HISTOGRAM_BOUNDS_MS]);
    expect(result.counts).toHaveLength(17);
    expect(result.counts[0]).toBe(2);
    expect(result.counts[16]).toBe(1);
  });

  it('latency histogram rejects a reversed range', async () => {
    const engine = new MongoDBEngine(config, { db: fakeSpansDb([]).db as never, skipInitialize: true });
    await expect(engine.getLatencyHistogram({ projectId: PROJECT, from: TO, to: FROM })).rejects.toBeInstanceOf(RangeError);
  });
});
