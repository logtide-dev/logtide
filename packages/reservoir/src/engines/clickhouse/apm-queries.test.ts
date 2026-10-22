import { describe, it, expect, vi } from 'vitest';
import type { ClickHouseClient } from '@clickhouse/client';
import {
  assembleLatencyHistogram,
  buildSpanConditions,
  buildTraceConditions,
  entryProbeSql,
  latencyHistogramSql,
  normalizeEntryParams,
  operationStatsSql,
  routeAttributeFilters,
  spanOrderSql,
  traceOrderSql,
  traceSpanMatchSql,
} from './apm-queries.js';
import { ClickHouseEngine } from './clickhouse-engine.js';
import { LATENCY_HISTOGRAM_BOUNDS_MS } from '../../core/constants.js';
import type { MetadataFilter, SpanQueryParams, TraceQueryParams } from '../../core/types.js';

const from = new Date('2026-01-01T10:00:00.000Z');
const to = new Date('2026-01-01T11:00:00.000Z');
const spanBase: SpanQueryParams = { projectId: 'p1', from, to };
const traceBase: TraceQueryParams = { projectId: 'p1', from, to };
const eq = (key: string, value: string): MetadataFilter => ({ key, op: 'equals', value, include_missing: false });

type Call = { query: string; query_params: Record<string, unknown> };

function stubEngine(rowsPerCall: Record<string, unknown>[][] = []) {
  let call = 0;
  const query = vi.fn(async (_args: unknown) => {
    const rows = rowsPerCall[call++] ?? [];
    return { json: async () => rows };
  });
  const client = { query } as unknown as ClickHouseClient;
  const engine = new ClickHouseEngine(
    { host: 'localhost', port: 18123, database: 'unused', username: 'default', password: '' },
    { client, skipInitialize: true },
  );
  return { engine, query, calls: () => query.mock.calls.map((c) => c[0] as Call) };
}

const whereOf = (sql: string) => sql.slice(sql.indexOf(' WHERE '), sql.includes(' ORDER BY ') ? sql.indexOf(' ORDER BY ') : undefined);

describe('clickhouse span conditions', () => {
  it('operation and legacy operationName both filter operation_name', () => {
    const qp: Record<string, unknown> = {};
    const conditions = buildSpanConditions({ ...spanBase, operationName: ['GET /a', 'GET /b'], operation: 'GET /a' }, qp);
    expect(conditions).toContain('operation_name IN {p_ops:Array(String)}');
    expect(conditions).toContain('operation_name = {p_op:String}');
    expect(qp).toMatchObject({ p_ops: ['GET /a', 'GET /b'], p_op: 'GET /a' });

    const single: Record<string, unknown> = {};
    expect(buildSpanConditions({ ...spanBase, operationName: 'GET /a' }, single)).toContain('operation_name IN {p_ops:Array(String)}');
    expect(single.p_ops).toEqual(['GET /a']);
  });

  it('keeps the project, time and existing filters', () => {
    const qp: Record<string, unknown> = {};
    const conditions = buildSpanConditions({ ...spanBase, toExclusive: true, serviceName: 'api', kind: ['SERVER'], statusCode: 'ERROR', traceId: 't1' }, qp);
    expect(conditions).toEqual([
      'time >= {p_from:DateTime64(3)}',
      'time < {p_to:DateTime64(3)}',
      'project_id IN {p_pids:Array(String)}',
      'trace_id IN {p_tids:Array(String)}',
      'service_name IN {p_svc:Array(String)}',
      'kind IN {p_kind:Array(String)}',
      'status_code IN {p_sc:Array(String)}',
    ]);
    expect(qp).toMatchObject({ p_pids: ['p1'], p_tids: ['t1'], p_svc: ['api'], p_kind: ['SERVER'], p_sc: ['ERROR'] });
  });

  it('attribute filters route resource-prefixed keys to resource_attributes', () => {
    expect(routeAttributeFilters([eq('resource.service.version', '1.2'), eq('http.route', '/x')])).toEqual({
      attributes: [eq('http.route', '/x')],
      resource: [eq('service.version', '1.2')],
    });
    const qp: Record<string, unknown> = {};
    const conditions = buildSpanConditions({ ...spanBase, attributeFilters: [eq('resource.service.version', '1.2'), eq('http.route', '/x')] }, qp);
    const sql = conditions.join(' AND ');
    expect(sql).toContain('JSONHas(attributes, {p_afk0:String})');
    expect(sql).toContain('JSONHas(resource_attributes, {p_rfk0:String})');
    expect(qp).toMatchObject({ p_afk0: 'http.route', p_rfk0: 'service.version', p_rfk0s0: 'service', p_rfk0s1: 'version', p_rfv0: '1.2' });
  });

  it('sortBy duration maps to duration_ms with a span_id tie-break', () => {
    expect(spanOrderSql({ ...spanBase, sortBy: 'duration_ms', sortOrder: 'desc' })).toBe('ORDER BY duration_ms DESC, span_id ASC');
    expect(spanOrderSql({ ...spanBase, sortBy: 'duration', sortOrder: 'desc' })).toBe('ORDER BY duration_ms DESC, span_id ASC');
    expect(spanOrderSql({ ...spanBase, sortBy: 'end_time' })).toBe('ORDER BY end_time ASC, span_id ASC');
    expect(spanOrderSql(spanBase)).toBe('ORDER BY start_time ASC, span_id ASC');
    expect(spanOrderSql({ ...spanBase, sortBy: 'constructor' as never })).toBe('ORDER BY start_time ASC, span_id ASC');
  });

  it('querySpans count and page share the WHERE and the page is parametrized', async () => {
    const { engine, calls } = stubEngine([[{ count: '0' }], []]);
    await engine.querySpans({ ...spanBase, operationName: 'GET /a', attributeFilters: [eq('http.method', 'GET')], limit: 5, offset: 10 });
    const [count, page] = calls();
    expect(count.query).toMatch(/^SELECT count\(\) AS count FROM spans WHERE /);
    expect(whereOf(page.query)).toBe(whereOf(count.query));
    expect(page.query).toContain('ORDER BY start_time ASC, span_id ASC LIMIT {p_limit:UInt32} OFFSET {p_offset:UInt32}');
    expect(page.query_params).toMatchObject({ p_ops: ['GET /a'], p_limit: 5, p_offset: 10 });
  });
});

describe('clickhouse trace conditions', () => {
  it('trace span-match block is a tuple IN inside the window', () => {
    const qp: Record<string, unknown> = {};
    const sql = traceSpanMatchSql({ ...traceBase, operation: 'GET /x', attributeFilters: [eq('http.status_code', '500')] }, qp)!;
    expect(sql).toMatch(/^\(project_id, trace_id\) IN \(SELECT project_id, trace_id FROM spans WHERE /);
    expect(sql).toContain('project_id IN {p_pids:Array(String)}');
    expect(sql).toContain('time >= {p_from:DateTime64(3)}');
    expect(sql).toContain('time <= {p_to:DateTime64(3)}');
    expect(sql).toContain('operation_name = {p_op:String}');
    expect(sql).toContain('JSONHas(attributes, {p_tafk0:String})');
    expect(qp).toMatchObject({ p_op: 'GET /x', p_tafk0: 'http.status_code', p_tafv0: '500' });
  });

  it('no operation and no attribute filter means no span-match block', () => {
    expect(traceSpanMatchSql(traceBase, {})).toBeNull();
    expect(traceSpanMatchSql({ ...traceBase, attributeFilters: [] }, {})).toBeNull();
  });

  it('serviceName stays trace level when the block is active', () => {
    const qp: Record<string, unknown> = {};
    const active = buildTraceConditions({ ...traceBase, serviceName: ['api'], operation: 'GET /x' }, qp);
    expect(active).toContain('service_name IN {p_svc:Array(String)}');
    const block = active.find((c) => c.includes('IN (SELECT'));
    expect(block).toBeDefined();
    expect(block).not.toContain('service_name');
    expect(qp.p_svc).toEqual(['api']);
    expect(qp).not.toHaveProperty('p_ssvc');

    const inactive = buildTraceConditions({ ...traceBase, serviceName: 'api' }, {}).join(' AND ');
    expect(inactive).toContain('service_name IN {p_svc:Array(String)}');
    expect(inactive).not.toContain('IN (SELECT');
  });

  it('trace sort defaults to start_time desc with a trace_id tie-break', () => {
    expect(traceOrderSql(traceBase)).toBe('ORDER BY start_time DESC, trace_id ASC');
    expect(traceOrderSql({ ...traceBase, sortBy: 'duration', sortOrder: 'asc' })).toBe('ORDER BY duration_ms ASC, trace_id ASC');
    expect(traceOrderSql({ ...traceBase, sortBy: 'start_time', sortOrder: 'asc' })).toBe('ORDER BY start_time ASC, trace_id ASC');
  });

  it('queryTraces count and page share the WHERE over traces FINAL', async () => {
    const { engine, calls } = stubEngine([[{ count: '0' }], []]);
    await engine.queryTraces({ ...traceBase, operation: 'GET /x', sortBy: 'duration', limit: 3 });
    const [count, page] = calls();
    expect(count.query).toMatch(/^SELECT count\(\) AS count FROM traces FINAL WHERE /);
    expect(whereOf(page.query)).toBe(whereOf(count.query));
    expect(page.query).toContain('ORDER BY duration_ms DESC, trace_id ASC LIMIT {p_limit:UInt32} OFFSET {p_offset:UInt32}');
    expect(page.query_params).toMatchObject({ p_op: 'GET /x', p_limit: 3, p_offset: 0 });
  });
});

const statsBase = { projectId: 'p1', from, to };

describe('clickhouse operation stats sql', () => {
  it('kinds default to SERVER and CONSUMER', () => {
    const native = operationStatsSql(normalizeEntryParams(statsBase), 'kinds');
    expect(native.query).toContain('kind IN {p_kinds:Array(String)}');
    expect(native.parameters[0]).toMatchObject({ p_kinds: ['SERVER', 'CONSUMER'], p_pid: 'p1', p_limit: 100 });
    const explicit = operationStatsSql(normalizeEntryParams({ ...statsBase, kinds: ['CLIENT'] }), 'kinds');
    expect(explicit.parameters[0]).toMatchObject({ p_kinds: ['CLIENT'] });
  });

  it('limit defaults to 100 and clamps to 1..500', () => {
    expect(normalizeEntryParams(statsBase).limit).toBe(100);
    expect(normalizeEntryParams({ ...statsBase, limit: 9999 }).limit).toBe(500);
    expect(normalizeEntryParams({ ...statsBase, limit: 0 }).limit).toBe(1);
  });

  it('scope is the project, the window on time and the service', () => {
    const native = operationStatsSql(normalizeEntryParams({ ...statsBase, service: 'api' }), 'kinds');
    expect(native.query).toContain(
      "WHERE project_id = {p_pid:String} AND time >= {p_from:DateTime64(3)} AND time <= {p_to:DateTime64(3)} AND service_name = {p_service:String}",
    );
    expect(native.parameters[0]).toMatchObject({ p_service: 'api' });
  });

  it("root mode selects parent_span_id IS NULL OR parent_span_id = ''", () => {
    const native = operationStatsSql(normalizeEntryParams(statsBase), 'root');
    expect(native.query).toContain("(parent_span_id IS NULL OR parent_span_id = '')");
    expect(native.query).not.toContain('kind IN');
  });

  it('stats aggregate per operation and order by count then names', () => {
    const query = operationStatsSql(normalizeEntryParams(statsBase), 'kinds').query;
    expect(query).toContain("countIf(status_code = 'ERROR') AS error_count");
    expect(query).toContain('avg(duration_ms) AS avg_ms');
    expect(query).toContain('quantiles(0.5, 0.95, 0.99)(duration_ms) AS p');
    expect(query).toContain('GROUP BY service_name, operation_name ORDER BY n DESC, service_name ASC, operation_name ASC LIMIT {p_limit:UInt32}');
  });

  it('the entry probe looks for one span of the entry kinds in scope, never by operation', () => {
    const native = entryProbeSql(normalizeEntryParams({ ...statsBase, service: 'api', operation: 'GET /x' }));
    expect(native.query).toMatch(/^SELECT 1 FROM spans WHERE project_id = \{p_pid:String\} .* AND kind IN \{p_kinds:Array\(String\)\} LIMIT 1$/);
    expect(native.query).not.toContain('operation_name');
  });

  it('latency buckets count the bounds below each duration', () => {
    const native = latencyHistogramSql(normalizeEntryParams({ ...statsBase, operation: 'GET /x' }), 'kinds');
    expect(native.query).toContain('arrayCount(b -> b < duration_ms, {p_bounds:Array(UInt32)}) AS bucket');
    expect(native.query).toContain('operation_name = {p_op:String}');
    expect(native.parameters[0]).toMatchObject({ p_bounds: [...LATENCY_HISTOGRAM_BOUNDS_MS], p_op: 'GET /x' });
    expect(assembleLatencyHistogram([{ bucket: 0, n: '2' }, { bucket: 16, n: '1' }]).counts).toEqual([2, ...Array(15).fill(0), 1]);
  });
});

describe('clickhouse operation stats and latency engine flow', () => {
  const statRow = { service: 'api', operation: 'GET /x', n: '3', error_count: '1', avg_ms: 20, p: [10, 30, 40] };

  it('maps rows and skips the probe when entry spans exist', async () => {
    const { engine, calls } = stubEngine([[statRow]]);
    expect(await engine.getOperationStats(statsBase)).toEqual([
      { service: 'api', operation: 'GET /x', count: 3, errorCount: 1, avgMs: 20, p50Ms: 10, p95Ms: 30, p99Ms: 40 },
    ]);
    expect(calls()).toHaveLength(1);
  });

  it('falls back to root spans whenever no span of the entry kinds is in scope', async () => {
    const none = stubEngine([[], [statRow]]);
    expect(await none.engine.getOperationStats(statsBase)).toHaveLength(1);
    expect(none.calls().map((c) => c.query)).toEqual([
      expect.stringContaining('kind IN {p_kinds:Array(String)}'),
      expect.stringContaining("(parent_span_id IS NULL OR parent_span_id = '')"),
    ]);
  });

  it('explicit kinds never fall back and an empty kinds list is rejected', async () => {
    const { engine, calls } = stubEngine([[]]);
    expect(await engine.getOperationStats({ ...statsBase, kinds: ['SERVER'] })).toEqual([]);
    expect(calls()).toHaveLength(1);
    await expect(engine.getOperationStats({ ...statsBase, kinds: [] })).rejects.toBeInstanceOf(RangeError);
  });

  it('latency decides the fallback before the operation filter', async () => {
    const entries = stubEngine([[{ '1': 1 }], [{ bucket: 3, n: '2' }]]);
    const result = await entries.engine.getLatencyHistogram({ ...statsBase, operation: 'GET /x' });
    expect(result.bounds).toEqual([...LATENCY_HISTOGRAM_BOUNDS_MS]);
    expect(result.counts[3]).toBe(2);
    const [probe, histogram] = entries.calls();
    expect(probe.query).not.toContain('operation_name');
    expect(histogram.query).toContain('kind IN {p_kinds:Array(String)}');
    expect(histogram.query).toContain('operation_name = {p_op:String}');

    const roots = stubEngine([[], [{ bucket: 0, n: '1' }]]);
    expect((await roots.engine.getLatencyHistogram(statsBase)).counts[0]).toBe(1);
    expect(roots.calls()).toHaveLength(2);
    expect(roots.calls()[1].query).toContain("(parent_span_id IS NULL OR parent_span_id = '')");
  });
});
