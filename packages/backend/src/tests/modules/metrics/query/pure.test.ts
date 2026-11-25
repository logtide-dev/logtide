import { describe, it, expect } from 'vitest';
import {
  pickAutoInterval,
  resolveInterval,
  buildGrid,
  QUERY_INTERVAL_MS,
} from '../../../../modules/metrics/query/interval.js';
import {
  applyRate,
  bucketsToSeries,
  computeStats,
  foldTopN,
  spaceAggregate,
  labelKey,
  type GridSeries,
} from '../../../../modules/metrics/query/series-fold.js';
import { resolveFilterVariables, resolveVariableValue } from '../../../../modules/metrics/query/variables.js';
import { compareOffsetMs, shiftWindow } from '../../../../modules/metrics/query/compare.js';
import { resolveUnit } from '../../../../modules/metrics/query/units.js';
import { MetricQueryValidationError } from '../../../../modules/metrics/query/errors.js';
import { metricQueryRequestSchema, metricAttrFilterSchema } from '../../../../modules/metrics/query/schema.js';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe('interval', () => {
  const at = (ms: number) => pickAutoInterval(0, ms);

  it('picks about 60-120 buckets', () => {
    expect(at(HOUR)).toBe('1m');
    expect(at(6 * HOUR)).toBe('5m');
    expect(at(DAY)).toBe('15m');
    expect(at(3 * DAY)).toBe('1h');
    expect(at(30 * DAY)).toBe('6h');
    expect(at(90 * DAY)).toBe('1d');
  });

  it('prefers the closer ratio when no interval fits', () => {
    // 7d: 168 buckets at 1h (x1.4 over) beats 28 at 6h (x2.1 under)
    expect(at(7 * DAY)).toBe('1h');
    expect(at(15 * MIN)).toBe('1m');
    expect(at(365 * DAY)).toBe('1d');
  });

  it('keeps an explicit interval unless it gives too many buckets', () => {
    expect(resolveInterval('5m', 0, DAY)).toEqual({ interval: '5m' });
    const coarse = resolveInterval('1m', 0, 30 * DAY);
    expect(coarse.interval).toBe('6h');
    expect(coarse.warning).toMatch(/too many points/);
    expect(resolveInterval('auto', 0, HOUR)).toEqual({ interval: '1m' });
  });

  it('builds an epoch-aligned grid covering [from, to)', () => {
    const step = QUERY_INTERVAL_MS['5m'];
    const grid = buildGrid(7 * MIN, 21 * MIN, step);
    expect(grid).toEqual([5 * MIN, 10 * MIN, 15 * MIN, 20 * MIN]);
  });
});

describe('series fold', () => {
  const step = MIN;
  const grid = [0, MIN, 2 * MIN, 3 * MIN, 4 * MIN];
  const s = (labels: Record<string, string>, values: Array<number | null>): GridSeries => ({ labels, values });

  it('places engine buckets on the grid per label set, with shift', () => {
    const series = bucketsToSeries(
      [
        { bucket: new Date(0), value: 1, labels: { a: 'x' } },
        { bucket: new Date(MIN), value: 2, labels: { a: 'x' } },
        { bucket: new Date(MIN), value: 5, labels: { a: 'y' } },
        { bucket: new Date(99 * MIN), value: 7, labels: { a: 'y' } },
      ],
      grid,
      step,
    );
    expect(series).toHaveLength(2);
    expect(series.find((x) => x.labels.a === 'x')!.values).toEqual([1, 2, null, null, null]);
    expect(series.find((x) => x.labels.a === 'y')!.values).toEqual([null, 5, null, null, null]);

    const shifted = bucketsToSeries([{ bucket: new Date(-HOUR), value: 3 }], grid, step, HOUR);
    expect(shifted[0].values).toEqual([3, null, null, null, null]);
    expect(shifted[0].labels).toEqual({});
  });

  it('computes per-series rates and handles counter resets', () => {
    const out = applyRate([s({}, [100, 160, null, 40, 100])], grid, step, Infinity);
    // 60/60s = 1; gap then reset: 40 is below 160 -> 40 / 120s; then 60/60
    expect(out[0].values).toEqual([null, 1, null, 40 / 120, 1]);
  });

  it('drops the still-open last bucket of a rate', () => {
    const out = applyRate([s({}, [0, 60, 120, 180, 240])], grid, step, 4 * MIN + 30_000);
    expect(out[0].values).toEqual([null, 1, 1, 1, null]);
  });

  it('space-aggregates series in the same group', () => {
    const series = [
      s({ host: 'a', cpu: '0' }, [1, 2, null, 4, null]),
      s({ host: 'a', cpu: '1' }, [3, null, null, 6, null]),
      s({ host: 'b', cpu: '0' }, [10, 10, 10, 10, 10]),
    ];
    const sum = spaceAggregate(series, ['host'], 'sum', 5);
    expect(sum.find((g) => g.labels.host === 'a')!.values).toEqual([4, 2, null, 10, null]);
    expect(sum.find((g) => g.labels.host === 'a')!.labels).toEqual({ host: 'a' });
    const avg = spaceAggregate(series, [], 'avg', 5);
    expect(avg).toHaveLength(1);
    expect(avg[0].labels).toEqual({});
    expect(avg[0].values[0]).toBeCloseTo(14 / 3);
    expect(spaceAggregate(series, ['host'], 'max', 5).find((g) => g.labels.host === 'a')!.values[0]).toBe(3);
    expect(spaceAggregate(series, ['missing'], 'min', 5)[0].labels).toEqual({ missing: '' });
  });

  it('keeps the top N by mean and folds the rest into __other__', () => {
    const groups = [
      s({ h: 'a' }, [1, 1, 1, 1, 1]),
      s({ h: 'b' }, [5, 5, null, 5, 5]),
      s({ h: 'c' }, [3, 3, 3, 3, 3]),
      s({ h: 'd' }, [2, null, 2, 2, 2]),
      s({ h: 'e' }, [null, null, null, null, null]),
    ];
    const r = foldTopN(groups, 2, 'sum', 5);
    expect(r.seriesTotal).toBe(5);
    expect(r.seriesShown).toBe(2);
    expect(r.series.map((x) => x.labels)).toEqual([{ h: 'b' }, { h: 'c' }, { __other__: 'true' }]);
    expect(r.series[2].values).toEqual([3, 1, 3, 3, 3]);

    const small = foldTopN(groups.slice(0, 2), 10, 'sum', 5);
    expect(small.series).toHaveLength(2);
    expect(small.seriesShown).toBe(2);
  });

  it('computes stats over non-null points', () => {
    expect(computeStats([null, 3, 1, null, 2, null])).toEqual({ min: 1, avg: 2, max: 3, last: 2 });
    expect(computeStats([null, null])).toEqual({ min: null, avg: null, max: null, last: null });
  });

  it('builds stable label keys', () => {
    expect(labelKey({ b: '2', a: '1' })).toBe('a=1,b=2');
    expect(labelKey({})).toBe('');
  });
});

describe('variables', () => {
  const host = { scope: 'resource' as const, key: 'host.name', op: 'eq' as const, values: ['$host'] };

  it('replaces variable values', () => {
    expect(resolveFilterVariables([host], { host: 'web-1' })).toEqual([{ ...host, values: ['web-1'] }]);
  });

  it('drops a filter whose variable is unset', () => {
    expect(resolveFilterVariables([host], { host: null })).toEqual([]);
    expect(resolveFilterVariables([host], { host: '' })).toEqual([]);
  });

  it('rejects unknown variables', () => {
    expect(() => resolveFilterVariables([host], {})).toThrow(MetricQueryValidationError);
    expect(() => resolveFilterVariables([host], undefined)).toThrow(/Unknown variable "\$host"/);
  });

  it('keeps literals and value-less filters', () => {
    const exists = { scope: 'metric' as const, key: 'k', op: 'exists' as const };
    const literal = { scope: 'metric' as const, key: 'k', op: 'in' as const, values: ['a', '$5', 'b'] };
    expect(resolveFilterVariables([exists, literal], undefined)).toEqual([exists, literal]);
    expect(resolveVariableValue('plain', undefined)).toBe('plain');
  });
});

describe('compare', () => {
  it('shifts the window back by the offset', () => {
    expect(compareOffsetMs('none')).toBe(0);
    expect(compareOffsetMs(undefined)).toBe(0);
    expect(compareOffsetMs('1h')).toBe(HOUR);
    expect(compareOffsetMs('1d')).toBe(DAY);
    expect(compareOffsetMs('1w')).toBe(7 * DAY);
    const w = shiftWindow(new Date(10 * DAY), new Date(11 * DAY), DAY);
    expect(w.from.getTime()).toBe(9 * DAY);
    expect(w.to.getTime()).toBe(10 * DAY);
  });
});

describe('units', () => {
  it('prefers the override, then the catalog', () => {
    expect(resolveUnit('ms', 's')).toBe('ms');
    expect(resolveUnit(null, 's')).toBe('s');
    expect(resolveUnit(undefined, null)).toBeNull();
    expect(resolveUnit('', '1')).toBe('1');
  });
});

describe('schema', () => {
  const base = {
    organizationId: '00000000-0000-4000-8000-000000000001',
    from: '2026-11-25T00:00:00.000Z',
    to: '2026-11-25T06:00:00.000Z',
    projectIds: null,
    queries: [{ id: 'A', metricName: 'cpu', aggregation: 'avg', filters: [], groupBy: [] }],
    formulas: [],
    interval: 'auto',
    compareTo: 'none',
    display: 'lines',
  };

  it('accepts a valid request and fills defaults', () => {
    const parsed = metricQueryRequestSchema.parse({ ...base, formulas: undefined, compareTo: undefined });
    expect(parsed.formulas).toEqual([]);
    expect(parsed.compareTo).toBe('none');
  });

  it('rejects bad requests', () => {
    const bad = [
      { ...base, queries: [] },
      { ...base, queries: [{ ...base.queries[0], id: 'G' }] },
      { ...base, queries: [base.queries[0], base.queries[0]] },
      { ...base, queries: [{ ...base.queries[0], aggregation: 'median' }] },
      { ...base, queries: [{ ...base.queries[0], limit: 51 }] },
      { ...base, formulas: [{ id: 'F5', expression: 'A' }] },
      { ...base, from: base.to, to: base.from },
      { ...base, projectIds: ['not-a-uuid'] },
      { ...base, projectIds: [] },
      { ...base, organizationId: 'x' },
      { ...base, variables: { 'Bad-Name': 'x' } },
    ];
    for (const b of bad) expect(metricQueryRequestSchema.safeParse(b).success).toBe(false);
  });

  it('checks filter op/value shapes', () => {
    const f = (op: string, values?: string[]) =>
      metricAttrFilterSchema.safeParse({ scope: 'metric', key: 'k', op, values }).success;
    expect(f('eq', ['a'])).toBe(true);
    expect(f('eq', ['a', 'b'])).toBe(false);
    expect(f('in', [])).toBe(false);
    expect(f('nin', ['a', 'b'])).toBe(true);
    expect(f('exists')).toBe(true);
    expect(f('notExists', ['a'])).toBe(false);
    expect(f('gte', ['1.5'])).toBe(true);
    expect(f('lt', ['abc'])).toBe(false);
    expect(f('lt', ['$threshold'])).toBe(true);
    expect(f('like', ['a'])).toBe(false);
  });
});
