import { describe, it, expect } from 'vitest';
import {
  buildSpanConditions,
  entryKinds,
  entryProbeSql,
  latencyCounts,
  latencyHistogramSql,
  operationStatRows,
  operationStatsSql,
  routeAttributeFilters,
  spanOrderSql,
  traceOrderSql,
  traceSpanMatchSql,
} from './apm-queries.js';
import type { MetadataFilter, SpanQueryParams } from '../../core/types.js';

const from = new Date('2026-01-05T10:00:00.000Z');
const to = new Date('2026-01-05T12:00:00.000Z');
const eq = (key: string, value: string): MetadataFilter => ({ key, op: 'equals', value, include_missing: false });

describe('buildSpanConditions', () => {
  it('keeps the time range first and today filters', () => {
    const r = buildSpanConditions({ projectId: 'p1', serviceName: ['api'], kind: 'SERVER', statusCode: 'ERROR', traceId: 't1', from, to }, 1);
    expect(r.conditions).toEqual([
      'time >= $1',
      'time <= $2',
      'project_id = ANY($3)',
      'trace_id = ANY($4)',
      'service_name = ANY($5)',
      'kind = ANY($6)',
      'status_code = ANY($7)',
    ]);
    expect(r.values).toEqual([from, to, ['p1'], ['t1'], ['api'], ['SERVER'], ['ERROR']]);
    expect(r.nextIdx).toBe(8);
  });

  it('exclusive bounds', () => {
    const r = buildSpanConditions({ from, to, fromExclusive: true, toExclusive: true }, 1);
    expect(r.conditions).toEqual(['time > $1', 'time < $2']);
  });

  it('operation and legacy operationName both filter operation_name', () => {
    expect(buildSpanConditions({ operationName: 'GET /x', from, to }, 1).conditions).toContain('operation_name = ANY($3)');
    expect(buildSpanConditions({ operationName: ['a', 'b'], from, to }, 1).values).toContainEqual(['a', 'b']);
    expect(buildSpanConditions({ operation: 'GET /x', from, to } as SpanQueryParams, 1).conditions).toContain('operation_name = $3');
    const both = buildSpanConditions({ operationName: ['a', 'b'], operation: 'a', from, to } as SpanQueryParams, 1);
    expect(both.conditions).toEqual(['time >= $1', 'time <= $2', 'operation_name = ANY($3)', 'operation_name = $4']);
  });

  it('attribute filters route resource-prefixed keys to resource_attributes', () => {
    const r = buildSpanConditions({ from, to, attributeFilters: [eq('resource.service.version', '1.2'), eq('http.route', '/x')] }, 1);
    expect(r.conditions[2]).toContain('attributes ?');
    expect(r.conditions[2]).not.toContain('resource_attributes');
    expect(r.conditions[3]).toContain('resource_attributes ?');
    expect(r.values).toEqual([from, to, 'http.route', ['http', 'route'], '/x', 'service.version', ['service', 'version'], '1.2']);
  });
});

describe('routeAttributeFilters', () => {
  it('strips the resource prefix and keeps other keys', () => {
    const { attributes, resource } = routeAttributeFilters([eq('resource.host.name', 'a'), eq('db.system', 'pg'), eq('resource.', 'x')]);
    expect(resource.map((f) => f.key)).toEqual(['host.name']);
    expect(attributes.map((f) => f.key)).toEqual(['db.system', 'resource.']);
  });
});

describe('spanOrderSql', () => {
  it('sortBy duration maps to duration_ms with a span_id tie-break', () => {
    expect(spanOrderSql({ sortBy: 'duration', sortOrder: 'desc' })).toBe('ORDER BY duration_ms DESC, span_id ASC');
    expect(spanOrderSql({ sortBy: 'duration_ms', sortOrder: 'desc' })).toBe('ORDER BY duration_ms DESC, span_id ASC');
  });

  it('legacy keys keep working, text keys sort in byte order', () => {
    expect(spanOrderSql({ sortBy: 'end_time' })).toBe('ORDER BY end_time ASC, span_id ASC');
    expect(spanOrderSql({ sortBy: 'service_name', sortOrder: 'desc' })).toBe('ORDER BY service_name COLLATE "C" DESC, span_id ASC');
  });

  it('defaults and unknown values fall back to start_time ASC', () => {
    expect(spanOrderSql({})).toBe('ORDER BY start_time ASC, span_id ASC');
    expect(spanOrderSql({ sortBy: 'span_id; DROP TABLE spans' as never, sortOrder: 'sideways' as never })).toBe(
      'ORDER BY start_time ASC, span_id ASC',
    );
    expect(spanOrderSql({ sortBy: 'constructor' as never })).toBe('ORDER BY start_time ASC, span_id ASC');
  });
});

describe('traceSpanMatchSql', () => {
  it('is inactive without operation or attribute filters', () => {
    expect(traceSpanMatchSql({ from }, 5, 'public')).toEqual({ condition: null, values: [], nextIdx: 5 });
    expect(traceSpanMatchSql({ from, attributeFilters: [] }, 5, 'public').condition).toBeNull();
  });

  it('trace span-match block is an EXISTS on the same project and trace, bounded below by the window', () => {
    const r = traceSpanMatchSql({ from, operation: 'GET /x' }, 4, 'public');
    expect(r.condition).toBe(
      'EXISTS (SELECT 1 FROM public.spans s WHERE s.project_id = traces.project_id AND s.trace_id = traces.trace_id AND s.time >= $4 AND s.operation_name = $5)',
    );
    expect(r.values).toEqual([from, 'GET /x']);
    expect(r.nextIdx).toBe(6);
  });

  it('attribute filters apply to the same span', () => {
    const r = traceSpanMatchSql({ from, attributeFilters: [eq('http.method', 'POST'), eq('resource.env', 'prod')] }, 1, 'public');
    expect(r.condition).toContain('s.attributes ?');
    expect(r.condition).toContain('s.resource_attributes->>$');
    expect(r.condition?.match(/EXISTS/g)).toHaveLength(1);
  });
});

describe('traceOrderSql', () => {
  it('trace sort defaults to start_time desc with trace_id tie-break', () => {
    expect(traceOrderSql({})).toBe('ORDER BY start_time DESC, trace_id ASC');
  });

  it('sortBy duration asc', () => {
    expect(traceOrderSql({ sortBy: 'duration', sortOrder: 'asc' })).toBe('ORDER BY duration_ms ASC, trace_id ASC');
  });
});

describe('entry span queries', () => {
  const scope = { projectId: 'p1', from, to };

  it('kinds default to SERVER and CONSUMER', () => {
    expect(entryKinds(undefined)).toEqual(['SERVER', 'CONSUMER']);
    expect(entryKinds(['CLIENT'])).toEqual(['CLIENT']);
    const r = operationStatsSql('public', { ...scope, limit: 100 }, 'kinds');
    expect(r.parameters).toContainEqual(['SERVER', 'CONSUMER']);
    expect(r.query).toContain('kind = ANY($4)');
  });

  it('scope is the project, the inclusive window and the optional service', () => {
    const r = operationStatsSql('public', { ...scope, service: 'api', limit: 7 }, 'kinds');
    expect(r.query).toContain('FROM public.spans WHERE project_id = $1 AND time >= $2 AND time <= $3 AND service_name = $4 AND kind = ANY($5)');
    expect(r.parameters).toEqual(['p1', from, to, 'api', ['SERVER', 'CONSUMER'], 7]);
  });

  it('root mode selects parent_span_id IS NULL OR parent_span_id = \'\'', () => {
    const r = operationStatsSql('public', { ...scope, limit: 100 }, 'root');
    expect(r.query).toContain("(parent_span_id IS NULL OR parent_span_id = '')");
    expect(r.query).not.toContain('kind = ANY');
    expect(r.parameters).toEqual(['p1', from, to, 100]);
  });

  it('stats use exact percentiles and order by count then names in byte order', () => {
    const sql = operationStatsSql('public', { ...scope, limit: 100 }, 'kinds').query as string;
    expect(sql).toContain('percentile_cont(ARRAY[0.5, 0.95, 0.99]) WITHIN GROUP (ORDER BY duration_ms)');
    expect(sql).toContain("COUNT(*) FILTER (WHERE status_code = 'ERROR')");
    expect(sql).toContain('GROUP BY service_name, operation_name');
    expect(sql).toMatch(/ORDER BY cnt DESC, service_name COLLATE "C" ASC, operation_name COLLATE "C" ASC LIMIT \$\d+$/);
  });

  it('the entry probe looks for one span of the default kinds in scope', () => {
    const r = entryProbeSql('public', { ...scope, service: 'api' });
    expect(r.query).toBe('SELECT 1 FROM public.spans WHERE project_id = $1 AND time >= $2 AND time <= $3 AND service_name = $4 AND kind = ANY($5) LIMIT 1');
    expect(r.parameters).toEqual(['p1', from, to, 'api', ['SERVER', 'CONSUMER']]);
  });

  it('latency thresholds are the negated bounds, upper-inclusive buckets', () => {
    const r = latencyHistogramSql('public', { ...scope, operation: 'GET /x' }, 'kinds');
    expect(r.query).toContain('16 - width_bucket((-duration_ms)::float8, $');
    expect(r.query).toContain('operation_name = $');
    expect(r.parameters).toContainEqual([-60000, -30000, -20000, -10000, -5000, -2000, -1000, -500, -200, -100, -50, -20, -10, -5, -2, -1]);
  });

  it('maps stat rows and bucket rows', () => {
    expect(
      operationStatRows([{ service_name: 'api', operation_name: 'GET', cnt: '4', error_count: '1', avg_ms: 2.5, p: [2.5, 3.85, 3.97] }]),
    ).toEqual([{ service: 'api', operation: 'GET', count: 4, errorCount: 1, avgMs: 2.5, p50Ms: 2.5, p95Ms: 3.85, p99Ms: 3.97 }]);
    const counts = latencyCounts([{ idx: 0, n: '2' }, { idx: '16', n: 1 }]);
    expect(counts).toHaveLength(17);
    expect(counts[0]).toBe(2);
    expect(counts[16]).toBe(1);
    expect(counts.slice(1, 16).every((c) => c === 0)).toBe(true);
  });
});
