import { describe, it, expect } from 'vitest';
import {
  buildSpanConditions,
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
