import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MetricAggregateParams, MetricLabelParams, MetricTimeBucket, MetricHistogramValue } from '@logtide/reservoir';
import { metricAttrLabel } from '@logtide/shared';

// Fake engine with the 1.8 histogram aggregations: hist_last = histogram of
// the latest point of the bucket per group, hist_sum = element-wise sum
// (points with bounds of another length skipped). Scalar points support
// sum / last for the temporality-aware rate of sums.
interface RawPoint {
  metric: string;
  t: number;
  v?: number;
  h?: MetricHistogramValue;
  attrs?: Record<string, string>;
  resource?: Record<string, string>;
}
let points: RawPoint[] = [];

const STEP: Record<string, number> = { '1m': 60_000, '5m': 300_000, '15m': 900_000, '1h': 3_600_000, '6h': 21_600_000, '1d': 86_400_000 };

const aggregateMetrics = vi.fn(async (p: MetricAggregateParams) => {
  const step = STEP[p.interval];
  const rows = points
    .filter((x) => x.metric === p.metricName && x.t >= p.from.getTime() && x.t < p.to.getTime())
    .sort((a, b) => a.t - b.t);
  const groups = new Map<string, { bucket: number; labels: Record<string, string>; rows: RawPoint[] }>();
  for (const r of rows) {
    const labels: Record<string, string> = {};
    for (const ref of p.groupByAttrs ?? []) {
      const map = ref.scope === 'resource' ? r.resource ?? {} : r.attrs ?? {};
      labels[metricAttrLabel(ref)] = map[ref.key] ?? '';
    }
    const bucket = Math.floor(r.t / step) * step;
    const key = `${bucket}|${JSON.stringify(labels)}`;
    const g = groups.get(key) ?? { bucket, labels, rows: [] };
    g.rows.push(r);
    groups.set(key, g);
  }
  const timeseries: MetricTimeBucket[] = [];
  for (const g of groups.values()) {
    const base = { bucket: new Date(g.bucket), ...(p.groupByAttrs?.length ? { labels: g.labels } : {}) };
    if (p.aggregation === 'hist_last' || p.aggregation === 'hist_sum') {
      const hs = g.rows.map((r) => r.h).filter((h): h is MetricHistogramValue => !!h);
      if (hs.length === 0) continue;
      let histogram: MetricHistogramValue;
      if (p.aggregation === 'hist_last') {
        histogram = hs[hs.length - 1];
      } else {
        const first = hs[0];
        const same = hs.filter((h) => h.grid === first.grid && h.counts.length === first.counts.length);
        histogram = {
          bounds: first.bounds,
          ...(first.grid !== undefined ? { grid: first.grid } : {}),
          counts: first.counts.map((_, i) => same.reduce((a, h) => a + h.counts[i], 0)),
          sum: same.reduce((a, h) => a + h.sum, 0),
          count: same.reduce((a, h) => a + h.count, 0),
        };
      }
      timeseries.push({ ...base, value: histogram.count, histogram });
      continue;
    }
    const vals = g.rows.map((r) => r.v ?? 0);
    const value = p.aggregation === 'sum' ? vals.reduce((a, b) => a + b, 0) : vals[vals.length - 1];
    timeseries.push({ ...base, value });
  }
  return { metricName: p.metricName, metricType: 'histogram' as const, timeseries };
});

const getMetricLabelKeys = vi.fn(async (p: MetricLabelParams) => {
  const keys = new Set<string>();
  for (const x of points) {
    if (x.metric !== p.metricName) continue;
    for (const k of Object.keys((p.scope === 'resource' ? x.resource : x.attrs) ?? {})) keys.add(k);
  }
  return { keys: [...keys].sort() };
});

vi.mock('../../../../database/reservoir.js', () => ({
  reservoir: {
    aggregateMetrics: (p: MetricAggregateParams) => aggregateMetrics(p),
    getMetricLabelKeys: (p: MetricLabelParams) => getMetricLabelKeys(p),
  },
}));

type Info = { unit: string | null; type: string | null; temporality?: 'cumulative' | 'delta' | null; isMonotonic?: boolean | null };
const catalog = { available: true, entries: new Map<string, Info>() };
vi.mock('../../../../modules/metrics/query/units.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../modules/metrics/query/units.js')>();
  return { ...actual, loadCatalog: vi.fn(async () => catalog) };
});

import { runMetricQuery, type ResolvedMetricQuery, clearLabelKeysCache } from '../../../../modules/metrics/query/service.js';
import { EXP_CANONICAL_BOUNDS, EXP_GRID_ID, EXP_GRID_MIN_INDEX } from '../../../../modules/otlp/exp-histogram-grid.js';
import type { MetricQuerySpec } from '@logtide/shared';

const T0 = Date.parse('2026-11-25T00:00:00.000Z');
const MIN = 60_000;
const FAR_FUTURE = new Date('2030-01-01T00:00:00.000Z');
const BOUNDS = [0.1, 0.5, 1];
const DUR = 'http.server.request.duration';

function base(queries: MetricQuerySpec[], overrides: Partial<ResolvedMetricQuery> = {}): ResolvedMetricQuery {
  return {
    organizationId: 'org-1',
    projectIds: ['p1'],
    from: new Date(T0).toISOString(),
    to: new Date(T0 + 5 * MIN).toISOString(),
    queries,
    formulas: [],
    interval: '1m',
    compareTo: 'none',
    display: 'lines',
    ...overrides,
  };
}

const q = (over: Partial<MetricQuerySpec>): MetricQuerySpec => ({
  id: 'A',
  metricName: DUR,
  aggregation: 'p95',
  filters: [],
  groupBy: [],
  ...over,
});

const run = (r: ResolvedMetricQuery, now = FAR_FUTURE) => runMetricQuery(r, now);
const values = (s: { points: Array<{ v: number | null }> }) => s.points.map((p) => p.v);

function hist(counts: number[], sum: number, bounds = BOUNDS): MetricHistogramValue {
  return { bounds, counts, sum, count: counts.reduce((a, b) => a + b, 0) };
}

function push(minute: number, h: MetricHistogramValue, host = 'a', route = '/x', metric = DUR) {
  points.push({ metric, t: T0 + minute * MIN + 30_000, h, attrs: { 'http.route': route }, resource: { 'host.name': host } });
}

beforeEach(() => {
  clearLabelKeysCache();
  points = [];
  catalog.available = true;
  catalog.entries = new Map();
  aggregateMetrics.mockClear();
  getMetricLabelKeys.mockClear();
});

describe('histogram queries', () => {
  it('cumulative: hist_last per series, snapshot diffs, reset detection, percentile', async () => {
    catalog.entries.set(DUR, { unit: 's', type: 'histogram', temporality: 'cumulative' });
    push(0, hist([10, 0, 0, 0], 0.5));
    push(1, hist([20, 0, 0, 0], 1)); // +10 fast
    push(2, hist([20, 0, 10, 0], 8.5)); // +10 slow in (0.5, 1]
    push(3, hist([0, 0, 2, 0], 1.6)); // reset: count went down, new snapshot is the delta
    push(4, hist([0, 0, 2, 2], 5)); // +2 in +Inf

    const res = await run(base([q({ aggregation: 'p95' })]));
    expect(aggregateMetrics.mock.calls[0][0].aggregation).toBe('hist_last');
    expect(aggregateMetrics.mock.calls[0][0].groupByAttrs).toEqual([
      { scope: 'metric', key: 'http.route' },
      { scope: 'resource', key: 'host.name' },
    ]);
    const v = values(res.series[0]);
    expect(v[0]).toBeNull(); // first snapshot has nothing to diff against
    expect(v[1]).toBeCloseTo(0.095); // 10 values <= 0.1: 0 + 0.1 * 9.5/10
    expect(v[2]).toBeCloseTo(0.5 + 0.5 * (9.5 / 10));
    expect(v[3]).toBeCloseTo(0.5 + 0.5 * (1.9 / 2));
    expect(v[4]).toBe(1); // rank in the +Inf bucket: last finite bound
    expect(res.series[0].unit).toBe('s');
    expect(res.queries[0]).toMatchObject({ unit: 's', metricType: 'histogram', seriesTotal: 1 });
  });

  it('cumulative: avg, count, sum and rate from the deltas', async () => {
    catalog.entries.set(DUR, { unit: 's', type: 'histogram', temporality: 'cumulative' });
    push(0, hist([6, 0, 0, 0], 0.3));
    push(1, hist([12, 0, 6, 0], 5.1));
    push(3, hist([12, 0, 18, 0], 14.7)); // gap at minute 2: delta covers 120 s

    const res = await run(
      base(
        [
          q({ id: 'avg', aggregation: 'avg' }),
          q({ id: 'count', aggregation: 'count' }),
          q({ id: 'sum', aggregation: 'sum' }),
          q({ id: 'rate', aggregation: 'rate' }),
          q({ id: 'max', aggregation: 'max' }),
        ],
        { to: new Date(T0 + 4 * MIN).toISOString() },
      ),
    );
    const byId = Object.fromEntries(res.series.map((s) => [s.queryId, values(s)]));
    expect(byId.avg[1]).toBeCloseTo(4.8 / 12);
    expect(byId.avg[3]).toBeCloseTo(9.6 / 12);
    expect(byId.count).toEqual([null, 12, null, 12]);
    expect(byId.sum[1]).toBeCloseTo(4.8);
    expect(byId.rate[1]).toBeCloseTo(12 / 60);
    expect(byId.rate[3]).toBeCloseTo(12 / 120);
    expect(byId.max[1]).toBeCloseTo(4.8 / 12); // falls back to avg
    const units = Object.fromEntries(res.queries.map((i) => [i.id, i.unit]));
    expect(units).toEqual({ avg: 's', count: null, sum: 's', rate: '{count}/s', max: 's' });
  });

  it('delta: hist_sum, no diffing, merges series across hosts', async () => {
    catalog.entries.set(DUR, { unit: 'ms', type: 'histogram', temporality: 'delta' });
    push(0, hist([10, 0, 0, 0], 0.5), 'a');
    push(0, hist([0, 0, 10, 0], 8), 'b');
    push(1, hist([4, 0, 0, 0], 0.2), 'a');

    const res = await run(base([q({ aggregation: 'p50' }), q({ id: 'B', aggregation: 'count' })]));
    expect(aggregateMetrics.mock.calls[0][0].aggregation).toBe('hist_sum');
    const p50 = values(res.series.find((s) => s.queryId === 'A')!);
    // merged minute 0: 20 values, rank 10 ends the first bucket
    expect(p50[0]).toBeCloseTo(0.1);
    expect(p50[1]).toBeCloseTo(0.05);
    expect(values(res.series.find((s) => s.queryId === 'B')!)).toEqual([20, 4, null, null, null]);
    expect(res.series[0].unit).toBe('ms');
  });

  it('unknown temporality on a histogram is read as cumulative', async () => {
    catalog.entries.set(DUR, { unit: 's', type: 'histogram', temporality: null });
    push(0, hist([1, 0, 0, 0], 0.05));
    push(1, hist([3, 0, 0, 0], 0.15));
    const res = await run(base([q({ aggregation: 'count' })]));
    expect(aggregateMetrics.mock.calls[0][0].aggregation).toBe('hist_last');
    expect(values(res.series[0])).toEqual([null, 2, null, null, null]);
  });

  it('exp_histogram takes the histogram path', async () => {
    catalog.entries.set('rpc.latency', { unit: 'ms', type: 'exp_histogram', temporality: 'delta' });
    push(0, hist([0, 4, 0], 12, [2, 4]), 'a', '/x', 'rpc.latency');
    const res = await run(base([q({ metricName: 'rpc.latency', aggregation: 'p50' })]));
    expect(aggregateMetrics.mock.calls[0][0].aggregation).toBe('hist_sum');
    expect(values(res.series[0])[0]).toBeCloseTo(3);
  });

  it('grid points (exp histograms) are expanded, and continue a series stored with explicit bounds', async () => {
    catalog.entries.set('rpc.grid', { unit: 's', type: 'exp_histogram', temporality: 'cumulative' });
    // Canonical slot of bucket index i, i.e. (2^(i/4), 2^((i+1)/4)].
    const slot = (i: number) => 2 + i - EXP_GRID_MIN_INDEX;
    const counts = (entries: Record<number, number>) => {
      const out = new Array<number>(EXP_CANONICAL_BOUNDS.length + 1).fill(0);
      for (const [k, v] of Object.entries(entries)) out[slot(Number(k))] = v;
      return out;
    };
    const total = (c: number[]) => c.reduce((a, b) => a + b, 0);
    const grid = (c: number[], sum: number): MetricHistogramValue => ({ bounds: [], grid: EXP_GRID_ID, counts: c, sum, count: total(c) });
    // Minute 0 was stored before 1.8 fix wave 2: explicit bounds, same grid.
    push(0, hist(counts({ 0: 10 }), 11, [...EXP_CANONICAL_BOUNDS]), 'a', '/x', 'rpc.grid');
    push(1, grid(counts({ 0: 10, 4: 10 }), 33), 'a', '/x', 'rpc.grid');
    push(2, grid(counts({ 0: 14, 4: 10 }), 37.4), 'a', '/x', 'rpc.grid');

    const res = await run(base([q({ metricName: 'rpc.grid', aggregation: 'p50' }), q({ id: 'B', metricName: 'rpc.grid', aggregation: 'count' })]));
    expect(aggregateMetrics.mock.calls[0][0].aggregation).toBe('hist_last');
    const p50 = values(res.series.find((s) => s.queryId === 'A')!);
    expect(p50[0]).toBeNull();
    // Not a reset across the explicit -> grid change: the delta is the 10 new values in (2, 2^1.25].
    expect(p50[1]).toBeCloseTo(2 + (2 ** 1.25 - 2) * 0.5, 9);
    expect(p50[2]).toBeCloseTo(1 + (2 ** 0.25 - 1) * 0.5, 9);
    expect(values(res.series.find((s) => s.queryId === 'B')!)).toEqual([null, 10, 4, null, null]);
  });

  it('delta grid points merge with explicit-bounds points of other series', async () => {
    catalog.entries.set('rpc.grid', { unit: 's', type: 'exp_histogram', temporality: 'delta' });
    const c = new Array<number>(EXP_CANONICAL_BOUNDS.length + 1).fill(0);
    c[2 + 0 - EXP_GRID_MIN_INDEX] = 10; // (1, 2^0.25]
    push(0, { bounds: [], grid: EXP_GRID_ID, counts: c, sum: 11, count: 10 }, 'a', '/x', 'rpc.grid');
    push(0, hist([10, 0], 5, [0.5]), 'b', '/x', 'rpc.grid');
    // An unknown grid id is dropped, never read as bounds [].
    push(0, { bounds: [], grid: 'exp2-s9-v9', counts: [1, 2, 3], sum: 1, count: 6 }, 'c', '/x', 'rpc.grid');
    const res = await run(base([q({ metricName: 'rpc.grid', aggregation: 'count' }), q({ id: 'B', metricName: 'rpc.grid', aggregation: 'p50' })]));
    expect(values(res.series.find((s) => s.queryId === 'A')!)[0]).toBe(20);
    // union: 10 values <= 0.5 then 10 in (1, 2^0.25]: rank 10 ends the 0.5 bucket
    expect(values(res.series.find((s) => s.queryId === 'B')!)[0]).toBeCloseTo(0.5, 9);
  });

  it('merges histograms with different bounds into the union', async () => {
    catalog.entries.set(DUR, { unit: 's', type: 'histogram', temporality: 'delta' });
    push(0, hist([10, 0], 0.5, [0.1]), 'a');
    push(0, hist([0, 10, 0], 3, [0.1, 0.5]), 'b');
    const res = await run(base([q({ aggregation: 'p95' })]));
    // union [0.1, 0.5]: counts [10, 10, 0]; rank 19 -> 0.1 + 0.4 * 9/10
    expect(values(res.series[0])[0]).toBeCloseTo(0.46);
  });

  it('groups by route, keeps the top N and merges the rest before the percentile', async () => {
    catalog.entries.set(DUR, { unit: 's', type: 'histogram', temporality: 'delta' });
    push(0, hist([10, 0, 0, 0], 0.5), 'a', '/fast');
    push(0, hist([0, 10, 0, 0], 3), 'a', '/mid');
    push(0, hist([0, 0, 10, 0], 8), 'a', '/slow');
    push(0, hist([0, 0, 10, 0], 8), 'b', '/slow');
    const res = await run(
      base([q({ aggregation: 'p50', groupBy: [{ scope: 'metric', key: 'http.route' }], limit: 1 })]),
    );
    expect(res.series.map((s) => s.name)).toEqual(['/slow', 'Other']);
    expect(values(res.series[0])[0]).toBeCloseTo(0.75); // both hosts merged: 20 values in (0.5, 1]
    // Other = /fast + /mid merged: 20 values, rank 10 ends the first bucket
    expect(values(res.series[1])[0]).toBeCloseTo(0.1);
    expect(res.queries[0]).toMatchObject({ seriesTotal: 3, seriesShown: 1 });
  });

  it('rate is summed across series and drops the open bucket', async () => {
    catalog.entries.set(DUR, { unit: 's', type: 'histogram', temporality: 'delta' });
    push(0, hist([60, 0, 0, 0], 1), 'a');
    push(0, hist([120, 0, 0, 0], 1), 'b');
    push(4, hist([60, 0, 0, 0], 1), 'a');
    const res = await run(base([q({ aggregation: 'rate' })]), new Date(T0 + 4 * MIN + 45_000));
    expect(values(res.series[0])).toEqual([3, null, null, null, null]);
  });

  it('delta histograms above 500 series are summed by the engine per group', async () => {
    catalog.entries.set(DUR, { unit: 's', type: 'histogram', temporality: 'delta' });
    for (let i = 0; i < 501; i++) push(0, hist([1, 0, 0, 0], 0.05), i % 2 ? 'a' : 'b', `/r${i}`);
    const res = await run(base([q({ aggregation: 'count', groupBy: [{ scope: 'resource', key: 'host.name' }] })]));
    expect(aggregateMetrics).toHaveBeenCalledTimes(2);
    expect(aggregateMetrics.mock.calls[1][0].groupByAttrs).toEqual([{ scope: 'resource', key: 'host.name' }]);
    expect(res.warnings.some((w) => w.includes('more than 500 series'))).toBe(true);
    expect(Object.fromEntries(res.series.map((s) => [s.name, s.points[0].v]))).toEqual({ a: 250, b: 251 });
  });

  it('works in formulas and with compareTo', async () => {
    catalog.entries.set(DUR, { unit: 's', type: 'histogram', temporality: 'delta' });
    push(0, hist([10, 0, 0, 0], 0.5));
    points.push({ metric: DUR, t: T0 - 60 * MIN + 30_000, h: hist([0, 4, 0, 0], 1), attrs: { 'http.route': '/x' }, resource: { 'host.name': 'a' } });
    const res = await run({
      ...base([q({ aggregation: 'count', hidden: true }), q({ id: 'B', aggregation: 'sum', hidden: true })]),
      formulas: [{ id: 'F', expression: 'B / A' }],
      compareTo: '1h',
    });
    const f = res.series.filter((s) => s.queryId === 'F');
    expect(values(f.find((s) => !s.comparison)!)[0]).toBeCloseTo(0.05);
    expect(values(f.find((s) => s.comparison)!)[0]).toBeCloseTo(0.25);
  });
});

describe('temporality-aware rate of sums', () => {
  const add = (minute: number, v: number, host = 'a') =>
    points.push({ metric: 'reqs', t: T0 + minute * MIN + 30_000, v, attrs: {}, resource: { 'host.name': host } });

  it('delta sums: engine sum per bucket / seconds, summed across series', async () => {
    catalog.entries.set('reqs', { unit: '{request}', type: 'sum', temporality: 'delta', isMonotonic: true });
    add(0, 30);
    add(0, 30); // two exports in the bucket
    add(0, 60, 'b');
    add(1, 6);
    const res = await run(base([{ id: 'A', metricName: 'reqs', aggregation: 'rate', filters: [], groupBy: [] }]));
    expect(aggregateMetrics.mock.calls[0][0].aggregation).toBe('sum');
    expect(values(res.series[0])).toEqual([2, 0.1, null, null, null]);
  });

  it('cumulative sums keep the diff logic', async () => {
    catalog.entries.set('reqs', { unit: '{request}', type: 'sum', temporality: 'cumulative', isMonotonic: true });
    add(0, 100);
    add(1, 160);
    const res = await run(base([{ id: 'A', metricName: 'reqs', aggregation: 'rate', filters: [], groupBy: [] }]));
    expect(aggregateMetrics.mock.calls[0][0].aggregation).toBe('last');
    expect(values(res.series[0]).slice(0, 2)).toEqual([null, 1]);
  });

  it('unknown temporality: cumulative, monotonic or not', async () => {
    catalog.entries.set('reqs', { unit: null, type: 'sum', temporality: null, isMonotonic: true });
    add(0, 1);
    await run(base([{ id: 'A', metricName: 'reqs', aggregation: 'rate', filters: [], groupBy: [] }]));
    expect(aggregateMetrics.mock.calls[0][0].aggregation).toBe('last');

    aggregateMetrics.mockClear();
    catalog.entries.set('reqs', { unit: null, type: 'sum', temporality: null, isMonotonic: false });
    await run(base([{ id: 'A', metricName: 'reqs', aggregation: 'rate', filters: [], groupBy: [] }]));
    expect(aggregateMetrics.mock.calls[0][0].aggregation).toBe('last');
  });

  it('delta sums above 500 series rate the engine group sums', async () => {
    catalog.entries.set('reqs', { unit: null, type: 'sum', temporality: 'delta', isMonotonic: true });
    for (let i = 0; i < 501; i++) {
      points.push({ metric: 'reqs', t: T0 + 30_000, v: 60, attrs: { id: String(i) }, resource: { 'host.name': i % 2 ? 'a' : 'b' } });
    }
    const res = await run(
      base([{ id: 'A', metricName: 'reqs', aggregation: 'rate', filters: [], groupBy: [{ scope: 'resource', key: 'host.name' }] }]),
    );
    expect(aggregateMetrics.mock.calls[1][0].aggregation).toBe('sum');
    expect(Object.fromEntries(res.series.map((s) => [s.name, s.points[0].v]))).toEqual({ a: 250, b: 251 });
  });

  it('gauges keep the existing behavior', async () => {
    catalog.entries.set('reqs', { unit: null, type: 'gauge' });
    add(0, 5);
    await run(base([{ id: 'A', metricName: 'reqs', aggregation: 'rate', filters: [], groupBy: [] }]));
    expect(aggregateMetrics.mock.calls[0][0].aggregation).toBe('last');
  });
});
