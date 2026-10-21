import { describe, it, expect } from 'vitest';
import { assembleFacets, histogramRowsToResult } from './log-analytics.js';
import { TimescaleQueryTranslator } from './query-translator.js';
import type { LogFacetField, LogFacetsParams, LogHistogramParams } from '../../core/types.js';

const at = (hhmmss: string) => new Date(`2026-01-05T${hhmmss}.000Z`);

describe('histogramRowsToResult', () => {
  it('zero-fills missing buckets and keeps only non-zero levels', () => {
    const result = histogramRowsToResult(
      { from: at('10:00:00'), to: at('10:15:00'), bucketSeconds: 300 },
      [
        { bucket_s: at('10:00:00').getTime() / 1000, level: 'info', n: 2 },
        { bucket_s: at('10:00:00').getTime() / 1000, level: 'error', n: 1 },
        { bucket_s: at('10:10:00').getTime() / 1000, level: 'warn', n: 4 },
      ],
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
    const result = histogramRowsToResult({ from: at('10:07:30'), to: at('10:12:00'), bucketSeconds: 300 }, []);
    expect(result.buckets[0].time.toISOString()).toBe('2026-01-05T10:05:00.000Z');
  });

  it('drops the bucket at an aligned exclusive end', () => {
    const result = histogramRowsToResult({ from: at('10:00:00'), to: at('10:15:00'), toExclusive: true, bucketSeconds: 300 }, []);
    expect(result.buckets.map((b) => b.time.toISOString()).at(-1)).toBe('2026-01-05T10:10:00.000Z');
  });

  it('reads pg bigint bucket starts given as strings', () => {
    const result = histogramRowsToResult(
      { from: at('10:00:00'), to: at('10:05:00'), bucketSeconds: 300 },
      [{ bucket_s: String(at('10:05:00').getTime() / 1000), level: 'debug', n: 7 }],
    );
    expect(result.buckets[1]).toMatchObject({ total: 7, byLevel: { debug: 7 } });
  });

  it('rejects a bucket size that is not a positive integer', () => {
    for (const bucketSeconds of [0, 1.5, -60]) {
      expect(() => histogramRowsToResult({ from: at('10:00:00'), to: at('10:05:00'), bucketSeconds }, [])).toThrow(RangeError);
    }
  });
});

describe('translateHistogram', () => {
  const translator = new TimescaleQueryTranslator('public', 'logs');
  const params: LogHistogramParams = {
    projectId: 'proj-1',
    from: at('10:00:00'),
    to: at('10:30:00'),
    bucketSeconds: 600,
    textQuery: { all: [{ kind: 'word', value: 'timeout' }], anyOf: [], none: [] },
    exclude: { service: ['worker'] },
    metadataFilters: [{ key: 'env', op: 'equals', value: 'prod', include_missing: false }],
  };

  it('buckets on epoch seconds and groups by bucket and level', () => {
    const r = translator.translateHistogram(params);
    expect(r.query).toMatch(
      /^SELECT \(floor\(extract\(epoch FROM time\) \/ \$1\) \* \$1\)::bigint AS bucket_s, level, COUNT\(\*\)::int AS n FROM public\.logs WHERE /,
    );
    expect(r.query).toMatch(/ GROUP BY 1, 2$/);
    expect(r.parameters?.[0]).toBe(600);
  });

  it('histogram reuses the log filter', () => {
    const r = translator.translateHistogram(params);
    const sql = r.query as string;
    const where = sql.slice(sql.indexOf(' WHERE ') + 7, sql.indexOf(' GROUP BY '));
    const shared = translator.buildLogConditions(params, 2);
    expect(where).toBe(shared.conditions.join(' AND '));
    expect(r.parameters).toEqual([600, ...shared.values]);
    expect(where).toContain('project_id = $2');
    expect(where).toContain('plainto_tsquery');
    expect(where).toContain('<> ALL(');
  });
});

describe('assembleFacets', () => {
  it('otherCount is the field total minus returned counts', () => {
    const result = assembleFacets(
      [{ builtin: 'service' }],
      [
        { f: 0, v: 'api', cnt: 4, total: 10 },
        { f: 0, v: 'auth', cnt: 3, total: 10 },
      ],
      2,
    );
    expect(result.facets).toEqual([
      { field: 'service', values: [{ value: 'api', count: 4 }, { value: 'auth', count: 3 }], otherCount: 3 },
    ]);
  });

  it('keeps request order and labels', () => {
    const fields: LogFacetField[] = [{ builtin: 'service' }, { metadata: 'region' }, { builtin: 'level' }];
    const result = assembleFacets(
      fields,
      [
        { f: 2, v: 'info', cnt: 1, total: 1 },
        { f: 1, v: 'eu', cnt: 2, total: 2 },
        { f: 0, v: 'api', cnt: 1, total: 1 },
      ],
      10,
    );
    expect(result.facets.map((f) => f.field)).toEqual(['service', 'metadata.region', 'level']);
    expect(result.facets[1].values).toEqual([{ value: 'eu', count: 2 }]);
  });

  it('a field without values returns an empty list', () => {
    const result = assembleFacets([{ metadata: 'missing' }], [], 10);
    expect(result.facets).toEqual([{ field: 'metadata.missing', values: [], otherCount: 0 }]);
  });

  it('reads pg bigint counts given as strings and breaks ties in byte order', () => {
    const result = assembleFacets(
      [{ builtin: 'hostname' }],
      [
        { f: 0, v: 'b', cnt: '2', total: '5' },
        { f: 0, v: 'B', cnt: '2', total: '5' },
        { f: 0, v: 'a', cnt: '1', total: '5' },
      ],
      10,
    );
    expect(result.facets[0]).toEqual({
      field: 'hostname',
      values: [{ value: 'B', count: 2 }, { value: 'b', count: 2 }, { value: 'a', count: 1 }],
      otherCount: 0,
    });
  });
});

describe('translateFacets', () => {
  const translator = new TimescaleQueryTranslator('public', 'logs');
  const base: LogFacetsParams = {
    projectId: 'proj-1',
    from: at('10:00:00'),
    to: at('10:30:00'),
    fields: [{ builtin: 'level' }, { builtin: 'hostname' }, { metadata: 'http.method' }, { metadata: 'region' }],
    exclude: { service: ['worker'] },
  };

  it('counts every field in one pass over the shared log filter', () => {
    const r = translator.translateFacets(base, 10);
    const sql = r.query as string;
    const shared = translator.buildLogConditions(base, 1);
    expect(sql).toContain(`WITH base AS (SELECT level, service, metadata FROM public.logs WHERE ${shared.conditions.join(' AND ')})`);
    expect(sql.match(/FROM public\.logs/g)).toHaveLength(1);
    expect(sql).toContain('CROSS JOIN LATERAL (VALUES (0, level), (1, metadata->>\'hostname\'), (2, ');
    expect(r.parameters?.slice(0, shared.values.length)).toEqual(shared.values);
  });

  it('binds metadata keys and dotted paths, never interpolates them', () => {
    const r = translator.translateFacets(base, 10);
    const sql = r.query as string;
    const n = translator.buildLogConditions(base, 1).values.length;
    expect(r.parameters?.slice(n)).toEqual(['http.method', ['http', 'method'], 'region', 10]);
    expect(sql).not.toContain('http.method');
    expect(sql).not.toContain("'region'");
    expect(sql).toContain(`metadata ? $${n + 1}`);
    expect(sql).toContain(`#> $${n + 2}::text[]`);
    expect(sql).toContain(`jsonb_typeof(`);
    expect(sql).toContain(`rn <= $${n + 4}`);
  });

  it('skips empty and missing values and ties break in byte order', () => {
    const sql = translator.translateFacets(base, 10).query as string;
    expect(sql).toContain("kv.v IS NOT NULL AND kv.v <> ''");
    expect(sql).toContain('ORDER BY COUNT(*) DESC, kv.v COLLATE "C" ASC');
  });

  it('a limit is bound as the last parameter', () => {
    const r = translator.translateFacets({ ...base, fields: [{ builtin: 'service' }] }, 3);
    expect(r.parameters?.at(-1)).toBe(3);
  });

  it('rejects an unknown builtin field instead of interpolating it', () => {
    const bad = { ...base, fields: [{ builtin: 'message' }] } as unknown as LogFacetsParams;
    expect(() => translator.translateFacets(bad, 10)).toThrow(/Unknown facet field/);
  });
});

describe('translateDiscoverKeys', () => {
  const translator = new TimescaleQueryTranslator('public', 'logs');
  const params = { projectId: ['p1', 'p2'], from: at('10:00:00'), to: at('11:00:00'), sampleSize: 250 };

  it('samples the newest logs of each project, then the newest of all', () => {
    // Per project the composite (project_id, time, id) index yields the
    // order, so a sparse project never walks other tenants' rows.
    const r = translator.translateDiscoverKeys(params);
    const sql = r.query as string;
    expect(sql).toContain(
      'FROM unnest($1::text[]) AS p(pid) CROSS JOIN LATERAL (' +
        'SELECT l.metadata, l.time, l.id FROM public.logs l WHERE l.project_id = p.pid AND l.time >= $2 AND l.time <= $3 ' +
        'ORDER BY l.time DESC, l.id DESC LIMIT $4) x ORDER BY x.time DESC, x.id DESC LIMIT $4',
    );
    expect(r.parameters).toEqual([['p1', 'p2'], params.from, params.to, 250]);
  });

  it('a single project is bound as a list', () => {
    const r = translator.translateDiscoverKeys({ ...params, projectId: 'p1' });
    expect(r.parameters?.[0]).toEqual(['p1']);
  });

  it('a repeated project is sampled once', () => {
    const r = translator.translateDiscoverKeys({ ...params, projectId: ['p1', 'p2', 'p1'] });
    expect(r.parameters?.[0]).toEqual(['p1', 'p2']);
  });

  it('casts the project list to the project id column type', () => {
    const uuidTranslator = new TimescaleQueryTranslator('public', 'logs', 'uuid');
    expect(uuidTranslator.translateDiscoverKeys(params).query).toContain('unnest($1::uuid[])');
  });

  it('expands one nested level, guards jsonb_each and orders in byte order', () => {
    const sql = translator.translateDiscoverKeys(params).query as string;
    expect(sql).toContain(`jsonb_each(CASE WHEN jsonb_typeof(r.metadata) = 'object' THEN r.metadata ELSE '{}'::jsonb END)`);
    expect(sql).toContain(`jsonb_each(CASE WHEN jsonb_typeof(t.value) = 'object' THEN t.value ELSE '{}'::jsonb END)`);
    expect(sql).toContain(`WHERE jsonb_typeof(t.value) <> 'object'`);
    expect(sql).toContain('COUNT(DISTINCT r.rid)');
    expect(sql).toContain('ORDER BY occurrences DESC, k.key COLLATE "C" ASC LIMIT 500');
  });
});

describe('translateListSessions', () => {
  const translator = new TimescaleQueryTranslator('public', 'logs');
  const params = { projectId: 'p1', from: at('10:00:00'), to: at('11:00:00'), limit: 10 };

  it('empty session ids are excluded and the project is always scoped', () => {
    const r = translator.translateListSessions(params, 10, null);
    const sql = r.query as string;
    expect(sql).toContain("FROM public.logs WHERE project_id = $1 AND time >= $2 AND time <= $3 AND session_id IS NOT NULL AND session_id <> ''");
    expect(sql).toContain('GROUP BY session_id');
    expect(sql).not.toContain('HAVING');
    expect(r.parameters).toEqual(['p1', params.from, params.to, 11]);
  });

  it('fetches one extra row to know whether more pages exist', () => {
    expect(translator.translateListSessions(params, 200, null).parameters?.at(-1)).toBe(201);
  });

  it('filters the service before grouping and keeps the byte-order smallest service', () => {
    const r = translator.translateListSessions({ ...params, service: 'api' }, 10, null);
    const sql = r.query as string;
    expect(sql).toContain("session_id <> '' AND service = $4 GROUP BY");
    expect(sql).toContain('MIN(service COLLATE "C") AS service');
    expect(sql).toContain("COUNT(*) FILTER (WHERE level IN ('error', 'critical'))");
    expect(r.parameters).toEqual(['p1', params.from, params.to, 'api', 11]);
  });

  it('orders and continues at millisecond precision, ties by session id in byte order', () => {
    const cursor = { lastEvent: at('10:05:00'), sessionId: 's-1' };
    const r = translator.translateListSessions(params, 10, cursor);
    const sql = r.query as string;
    expect(sql).toContain(
      `HAVING date_trunc('milliseconds', MAX(time)) < $4 OR (date_trunc('milliseconds', MAX(time)) = $4 AND session_id COLLATE "C" > $5)`,
    );
    expect(sql).toContain(`ORDER BY date_trunc('milliseconds', MAX(time)) DESC, session_id COLLATE "C" ASC LIMIT $6`);
    expect(r.parameters).toEqual(['p1', params.from, params.to, cursor.lastEvent, 's-1', 11]);
  });
});

describe('translateHasSessions', () => {
  it('is a LIMIT 1 probe without grouping', () => {
    const translator = new TimescaleQueryTranslator('public', 'logs');
    const r = translator.translateHasSessions({ projectId: 'p1', from: at('10:00:00'), to: at('11:00:00') });
    expect(r.query).toBe(
      "SELECT 1 FROM public.logs WHERE project_id = $1 AND time >= $2 AND time <= $3 AND session_id IS NOT NULL AND session_id <> '' LIMIT 1",
    );
    expect(r.parameters).toEqual(['p1', at('10:00:00'), at('11:00:00')]);
  });
});
