import { describe, it, expect } from 'vitest';
import { ClickHouseQueryTranslator } from './query-translator.js';
import type { CountParams, MetadataFilter, QueryParams } from '../../core/types.js';

const translator = new ClickHouseQueryTranslator('logs');

const baseParams = {
  projectId: '00000000-0000-0000-0000-000000000001',
  from: new Date('2026-01-01T00:00:00Z'),
  to: new Date('2026-01-02T00:00:00Z'),
};

function paramsOf(r: { parameters?: unknown[] }): Record<string, unknown> {
  return (r.parameters ?? [])[0] as Record<string, unknown>;
}

/** The PREWHERE and WHERE text of a query, without ORDER BY / LIMIT. */
function filterText(query: string): string {
  const start = query.indexOf(' PREWHERE ');
  const end = query.indexOf(' ORDER BY ');
  return query.slice(start, end === -1 ? undefined : end);
}

function prewhereText(query: string): string {
  const start = query.indexOf(' PREWHERE ') + ' PREWHERE '.length;
  const where = query.indexOf(' WHERE ', start);
  const order = query.indexOf(' ORDER BY ', start);
  const end = where !== -1 ? where : order;
  return query.slice(start, end === -1 ? undefined : end);
}

function whereText(query: string): string {
  const start = query.indexOf(' WHERE ');
  if (start === -1) return '';
  const end = query.indexOf(' ORDER BY ', start);
  return query.slice(start + ' WHERE '.length, end === -1 ? undefined : end);
}

const allFilters: CountParams = {
  ...baseParams,
  service: ['api', 'worker'],
  level: 'error',
  hostname: ['web-1'],
  traceId: 'trace-1',
  sessionId: 'sess-1',
  spanId: 'span-9',
  metadataFilters: [{ key: 'env', op: 'equals', value: 'prod', include_missing: false } as MetadataFilter],
  exclude: { service: ['auth'], level: ['debug'], hostname: ['web-2'] },
};

describe('ClickHouseQueryTranslator log filters', () => {
  it('count and query share predicates', () => {
    const q = translator.translateQuery(allFilters as QueryParams);
    const c = translator.translateCount(allFilters);
    expect(filterText(c.query as string)).toBe(filterText(q.query as string));
    expect(prewhereText(c.query as string)).toContain('trace_id = {p_trace_id:String}');
    expect(prewhereText(c.query as string)).toContain('session_id = {p_session_id:String}');
    const { p_limit: _limit, ...queryFilterParams } = paramsOf(q);
    expect(paramsOf(c)).toEqual(queryFilterParams);
  });

  it('spanId goes to PREWHERE', () => {
    for (const r of [
      translator.translateQuery({ ...baseParams, spanId: 'span-9' }),
      translator.translateCount({ ...baseParams, spanId: 'span-9' }),
    ]) {
      expect(prewhereText(r.query as string)).toContain('span_id = {p_span_id:String}');
      expect(paramsOf(r).p_span_id).toBe('span-9');
    }
  });

  it('exclude uses NOT IN with distinct parameter names', () => {
    const r = translator.translateQuery({
      ...baseParams,
      exclude: { service: ['worker'], level: ['debug'], hostname: ['web-2'] },
    });
    const where = whereText(r.query as string);
    expect(where).toContain('service NOT IN {p_ex_service:Array(String)}');
    expect(where).toContain('level NOT IN {p_ex_level:Array(String)}');
    expect(where).toContain('hostname NOT IN {p_ex_hostname:Array(String)}');
    expect(paramsOf(r).p_ex_service).toEqual(['worker']);
    expect(paramsOf(r).p_ex_level).toEqual(['debug']);
    expect(paramsOf(r).p_ex_hostname).toEqual(['web-2']);
  });

  it('include and exclude on service coexist', () => {
    const r = translator.translateCount({ ...baseParams, service: ['api', 'worker'], exclude: { service: ['worker'] } });
    const where = whereText(r.query as string);
    expect(where).toContain('service IN {p_service:Array(String)}');
    expect(where).toContain('service NOT IN {p_ex_service:Array(String)}');
    expect(paramsOf(r).p_service).toEqual(['api', 'worker']);
    expect(paramsOf(r).p_ex_service).toEqual(['worker']);
  });

  it('empty exclude arrays add nothing', () => {
    const plain = translator.translateQuery(baseParams);
    const empty = translator.translateQuery({ ...baseParams, exclude: { service: [], level: [], hostname: [] } });
    expect(empty.query).toBe(plain.query);
    expect(paramsOf(empty)).toEqual(paramsOf(plain));
    const emptyCount = translator.translateCount({ ...baseParams, exclude: {} });
    expect(emptyCount.query).toBe(translator.translateCount(baseParams).query);
  });

  it('hostname include uses the materialized column', () => {
    const one = translator.translateQuery({ ...baseParams, hostname: 'web-1' });
    expect(whereText(one.query as string)).toContain('hostname = {p_hostname:String}');
    const many = translator.translateCount({ ...baseParams, hostname: ['web-1', 'web-2'] });
    expect(whereText(many.query as string)).toContain('hostname IN {p_hostname:Array(String)}');
    expect(one.query).not.toContain("JSONExtractString(metadata, 'hostname')");
    expect(many.query).not.toContain("JSONExtractString(metadata, 'hostname')");
  });

  it('the project and time bounds stay in PREWHERE', () => {
    const r = translator.translateCount({ ...baseParams, fromExclusive: true, toExclusive: true });
    const prewhere = prewhereText(r.query as string);
    expect(prewhere).toContain('project_id = {p_project_id:String}');
    expect(prewhere).toContain('time > {p_from:DateTime64(3)}');
    expect(prewhere).toContain('time < {p_to:DateTime64(3)}');
  });

  it('exposes buildLogPredicates with prewhere and where lists', () => {
    const r = translator.buildLogPredicates({ ...baseParams, spanId: 's', exclude: { level: ['info'] } });
    expect(r.prewhere).toContain('span_id = {p_span_id:String}');
    expect(r.where).toContain('level NOT IN {p_ex_level:Array(String)}');
    expect(r.queryParams.p_ex_level).toEqual(['info']);
  });
});
