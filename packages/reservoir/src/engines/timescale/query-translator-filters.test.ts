import { describe, it, expect } from 'vitest';
import { TimescaleQueryTranslator } from './query-translator.js';
import type { CountParams, QueryParams } from '../../core/types.js';

const translator = new TimescaleQueryTranslator('public', 'logs');

const baseParams = {
  projectId: '00000000-0000-0000-0000-000000000001',
  from: new Date('2026-01-01T00:00:00Z'),
  to: new Date('2026-01-02T00:00:00Z'),
};

function whereOf(sql: string, until?: string): string {
  const start = sql.indexOf(' WHERE ') + ' WHERE '.length;
  const end = until ? sql.indexOf(until, start) : sql.length;
  return sql.slice(start, end);
}

describe('TimescaleQueryTranslator log filters', () => {
  it('count applies sessionId', () => {
    const r = translator.translateCount({ ...baseParams, sessionId: 'sess-1' });
    expect(r.query).toMatch(/session_id = \$\d+/);
    expect(r.parameters).toContain('sess-1');
  });

  it('count estimate applies sessionId', () => {
    const r = translator.translateCountEstimate({ ...baseParams, sessionId: 'sess-1' });
    expect(r.query).toMatch(/session_id = \$\d+/);
    expect(r.parameters).toContain('sess-1');
  });

  it('spanId filters query, count and estimate', () => {
    const params = { ...baseParams, spanId: 'span-9' };
    for (const r of [translator.translateQuery(params), translator.translateCount(params), translator.translateCountEstimate(params)]) {
      expect(r.query).toMatch(/span_id = \$\d+/);
      expect(r.parameters).toContain('span-9');
    }
  });

  it('exclude.service and exclude.level use <> ALL', () => {
    const r = translator.translateQuery({ ...baseParams, exclude: { service: ['worker'], level: ['debug'] } });
    expect(r.query).toMatch(/service <> ALL\(\$\d+\)/);
    expect(r.query).toMatch(/level <> ALL\(\$\d+\)/);
    expect(r.parameters).toContainEqual(['worker']);
    expect(r.parameters).toContainEqual(['debug']);
  });

  it('exclude.hostname keeps logs without hostname', () => {
    const r = translator.translateQuery({ ...baseParams, exclude: { hostname: ['web-1', 'web-2'] } });
    expect(r.query).toContain("(metadata->>'hostname' IS NULL OR metadata->>'hostname' <> ALL($");
    expect(r.parameters).toContainEqual(['web-1', 'web-2']);
  });

  it('empty exclude arrays add nothing', () => {
    const plain = translator.translateQuery(baseParams);
    const empty = translator.translateQuery({ ...baseParams, exclude: { service: [], level: [], hostname: [] } });
    expect(empty.query).toBe(plain.query);
    expect(empty.parameters).toEqual(plain.parameters);
  });

  it('exclude values are bound parameters, never inlined', () => {
    const r = translator.translateCount({ ...baseParams, exclude: { service: ["x' OR 1=1 --"] } });
    expect(r.query).not.toContain('OR 1=1');
    expect(r.parameters).toContainEqual(["x' OR 1=1 --"]);
  });

  it('query, count and estimate share one WHERE', () => {
    const params: QueryParams & CountParams = {
      ...baseParams,
      service: ['api', 'auth'],
      level: 'error',
      hostname: 'web-1',
      traceId: 'trace-1',
      sessionId: 'sess-1',
      spanId: 'span-1',
      metadataFilters: [{ key: 'env', op: 'equals', value: 'prod', include_missing: false }],
      exclude: { service: ['worker'], level: ['debug'], hostname: ['web-9'] },
    };
    const query = translator.translateQuery(params);
    const count = translator.translateCount(params);
    const estimate = translator.translateCountEstimate(params);
    const where = whereOf(query.query as string, ' ORDER BY ');
    expect(whereOf(count.query as string)).toBe(where);
    expect(whereOf(estimate.query as string)).toBe(where);
    // Same parameters up to the query's own LIMIT.
    expect(count.parameters).toEqual(query.parameters!.slice(0, count.parameters!.length));
    expect(estimate.parameters).toEqual(count.parameters);
  });

  it('builds conditions in a fixed order starting at the given index', () => {
    const r = translator.buildLogConditions(
      {
        ...baseParams,
        service: 'api',
        level: ['error'],
        hostname: ['web-1'],
        traceId: 't',
        sessionId: 's',
        spanId: 'p',
        exclude: { service: ['worker'] },
      },
      3,
    );
    expect(r.conditions).toEqual([
      'project_id = $3',
      'service = $4',
      'level = ANY($5)',
      "metadata->>'hostname' = ANY($6)",
      'trace_id = $7',
      'session_id = $8',
      'span_id = $9',
      'time >= $10',
      'time <= $11',
      'service <> ALL($12)',
    ]);
    expect(r.values).toEqual([baseParams.projectId, 'api', ['error'], ['web-1'], 't', 's', 'p', baseParams.from, baseParams.to, ['worker']]);
    expect(r.nextIdx).toBe(13);
  });

  it('skips the project predicate only for GLOBAL_SCOPE', () => {
    const r = translator.buildLogConditions({ ...baseParams, projectId: '__ALL_PROJECTS__' }, 1);
    expect(r.conditions[0]).toBe('time >= $1');
  });

  it('keeps the hostname expression of the expression index', () => {
    const r = translator.translateCount({ ...baseParams, hostname: 'web-1' });
    expect(r.query).toContain("metadata->>'hostname' = $");
  });
});
