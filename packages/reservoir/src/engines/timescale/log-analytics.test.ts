import { describe, it, expect } from 'vitest';
import { histogramRowsToResult } from './log-analytics.js';
import { TimescaleQueryTranslator } from './query-translator.js';
import type { LogHistogramParams } from '../../core/types.js';

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
