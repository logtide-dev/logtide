import { describe, it, expect, vi } from 'vitest';
import type { Document } from 'mongodb';
import {
  buildSpanFilter,
  buildTraceFilter,
  isTraceSpanMatchActive,
  routeAttributeFilters,
  spanSort,
  traceMatchPipeline,
  traceSort,
} from './apm-queries.js';
import { MongoDBEngine } from './mongodb-engine.js';
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
