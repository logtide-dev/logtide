import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MetricAggregateParams, MetricHistogramValue, MetricLabelParams, MetricTimeBucket } from '@logtide/reservoir';
import { metricAttrLabel, type MetricQuerySpec } from '@logtide/shared';

// Fake engine for the series identity, caps, rollup and formula fold rules:
// project scoping, eq/in filters, groupByAttrs, avg/sum/min/max/last/count
// and hist_last / hist_sum. Each metric has an engine type.
interface RawPoint {
  project: string;
  metric: string;
  t: number;
  v?: number;
  h?: MetricHistogramValue;
  attrs?: Record<string, string>;
  resource?: Record<string, string>;
}
let points: RawPoint[] = [];
const engineTypes = new Map<string, string>();

const STEP: Record<string, number> = { '1m': 60_000, '5m': 300_000, '15m': 900_000, '1h': 3_600_000, '6h': 21_600_000, '1d': 86_400_000 };

const aggregateMetrics = vi.fn(async (p: MetricAggregateParams) => {
  const step = STEP[p.interval];
  const projects = new Set(Array.isArray(p.projectId) ? p.projectId : [p.projectId]);
  const rows = points
    .filter(
      (x) =>
        projects.has(x.project) &&
        x.metric === p.metricName &&
        x.t >= p.from.getTime() &&
        x.t < p.to.getTime() &&
        (p.filters ?? []).every((f) => {
          const map = f.scope === 'resource' ? x.resource ?? {} : x.attrs ?? {};
          if (f.op === 'eq') return map[f.key] === f.values?.[0];
          if (f.op === 'in') return (f.values ?? []).includes(map[f.key]);
          return true;
        }),
    )
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
      const histogram =
        p.aggregation === 'hist_last'
          ? hs[hs.length - 1]
          : {
              bounds: hs[0].bounds,
              counts: hs[0].counts.map((_, i) => hs.reduce((a, h) => a + h.counts[i], 0)),
              sum: hs.reduce((a, h) => a + h.sum, 0),
              count: hs.reduce((a, h) => a + h.count, 0),
            };
      timeseries.push({ ...base, value: histogram.count, histogram });
      continue;
    }
    const vals = g.rows.map((r) => r.v ?? 0);
    let value: number;
    switch (p.aggregation) {
      case 'sum':
        value = vals.reduce((a, b) => a + b, 0);
        break;
      case 'min':
        value = Math.min(...vals);
        break;
      case 'max':
        value = Math.max(...vals);
        break;
      case 'count':
        value = vals.length;
        break;
      case 'last':
        value = vals[vals.length - 1];
        break;
      default:
        value = vals.reduce((a, b) => a + b, 0) / vals.length;
    }
    timeseries.push({ ...base, value });
  }
  return { metricName: p.metricName, metricType: (engineTypes.get(p.metricName) ?? 'gauge') as 'gauge', timeseries };
});

const getMetricLabelKeys = vi.fn(async (p: MetricLabelParams) => {
  const keys = new Set<string>();
  for (const x of points) {
    if (x.metric !== p.metricName) continue;
    if (p.from && x.t < p.from.getTime()) continue;
    if (p.to && x.t > p.to.getTime()) continue;
    for (const k of Object.keys((p.scope === 'resource' ? x.resource : x.attrs) ?? {})) keys.add(k);
  }
  const sorted = [...keys].sort();
  return { keys: p.limit ? sorted.slice(0, p.limit) : sorted };
});

vi.mock('../../../../database/reservoir.js', () => ({
  reservoir: {
    aggregateMetrics: (p: MetricAggregateParams) => aggregateMetrics(p),
    getMetricLabelKeys: (p: MetricLabelParams) => getMetricLabelKeys(p),
  },
}));

type Info = {
  unit: string | null;
  type: string | null;
  temporality?: 'cumulative' | 'delta' | null;
  isMonotonic?: boolean | null;
  projectIds?: string[];
};
const catalog = { available: true, entries: new Map<string, Info>() };
vi.mock('../../../../modules/metrics/query/units.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../modules/metrics/query/units.js')>();
  return { ...actual, loadCatalog: vi.fn(async () => catalog) };
});

import {
  runMetricQuery,
  MAX_RAW_SERIES,
  MAX_IDENTITY_METRIC_KEYS,
  MAX_INTERNAL_SERIES_LIMIT,
  KEY_DISCOVERY_WINDOW_MS,
  MetricQueryValidationError,
  seriesLimitCap,
  type ResolvedMetricQuery,
} from '../../../../modules/metrics/query/service.js';

const T0 = Date.parse('2026-11-25T00:00:00.000Z');
const MIN = 60_000;
const HOUR = 60 * MIN;
const FAR_FUTURE = new Date('2030-01-01T00:00:00.000Z');
const BOUNDS = [0.1, 0.5, 1];

function base(queries: MetricQuerySpec[], overrides: Partial<ResolvedMetricQuery> = {}): ResolvedMetricQuery {
  return {
    organizationId: 'org-1',
    projectIds: ['p1'],
    from: new Date(T0).toISOString(),
    to: new Date(T0 + 4 * MIN).toISOString(),
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
  metricName: 'requests',
  aggregation: 'rate',
  filters: [],
  groupBy: [],
  ...over,
});

const run = (query: ResolvedMetricQuery) => runMetricQuery(query, FAR_FUTURE);
const values = (s: { points: Array<{ v: number | null }> }) => s.points.map((p) => p.v);
const hostRef = { scope: 'resource' as const, key: 'host.name' };

function counter(project: string, minute: number, v: number, resource: Record<string, string>, attrs: Record<string, string> = {}, metric = 'requests') {
  points.push({ project, metric, t: T0 + minute * MIN, v, resource, attrs });
}

function hist(project: string, minute: number, count: number, resource: Record<string, string>, metric = 'latency') {
  const counts = [count, 0, 0, 0];
  points.push({ project, metric, t: T0 + minute * MIN, h: { bounds: BOUNDS, counts, sum: count * 0.05, count }, resource });
}

beforeEach(() => {
  points = [];
  engineTypes.clear();
  catalog.available = true;
  catalog.entries = new Map();
  aggregateMetrics.mockClear();
  getMetricLabelKeys.mockClear();
});

describe('series identity (item 3)', () => {
  it('reads the projects the catalog lists one by one so equal labels never mix', async () => {
    // Same host name and attributes in two projects, independent counters.
    for (let m = 0; m < 4; m++) {
      counter('p1', m, 100 + m * 60, { 'host.name': 'web' });
      counter('p2', m, 1000 + m * 120, { 'host.name': 'web' });
    }
    catalog.entries.set('requests', { unit: '{request}', type: 'sum', temporality: 'cumulative', projectIds: ['p2', 'p1'] });
    const res = await run(base([q({ spaceAggregation: 'sum' })], { projectIds: ['p1', 'p2'] }));
    // 1/s from p1 plus 2/s from p2; mixing them would give nonsense diffs.
    expect(values(res.series[0])).toEqual([null, 3, 3, 3]);
    const calls = aggregateMetrics.mock.calls.map((c) => c[0].projectId);
    expect(calls).toEqual([['p2'], ['p1']]);
    expect(res.series[0].labels).toEqual({});
  });

  it('reads every project together when the catalog has no row, and the rest in one extra read', async () => {
    counter('p1', 0, 1, { 'host.name': 'a' });
    await run(base([q({ aggregation: 'avg' })], { projectIds: ['p1', 'p2', 'p3'] }));
    expect(aggregateMetrics.mock.calls.map((c) => c[0].projectId)).toEqual([['p1', 'p2', 'p3']]);

    aggregateMetrics.mockClear();
    catalog.entries.set('requests', { unit: null, type: 'gauge', projectIds: ['p1'] });
    await run(base([q({ aggregation: 'avg' })], { projectIds: ['p1', 'p2', 'p3'] }));
    expect(aggregateMetrics.mock.calls.map((c) => c[0].projectId)).toEqual([['p1'], ['p2', 'p3']]);
  });

  it('tells series apart by process, pod and container resource keys', async () => {
    // Two processes on one host, each its own counter.
    for (let m = 0; m < 4; m++) {
      counter('p1', m, m * 60, { 'host.name': 'web', 'process.pid': '10' });
      counter('p1', m, 500 + m * 60, { 'host.name': 'web', 'process.pid': '11' });
    }
    catalog.entries.set('requests', { unit: null, type: 'sum', temporality: 'cumulative' });
    const res = await run(base([q({ groupBy: [hostRef] })]));
    expect(values(res.series[0])).toEqual([null, 2, 2, 2]);
    const refs = aggregateMetrics.mock.calls[0][0].groupByAttrs!.map((r) => `${r.scope}:${r.key}`);
    expect(refs).toEqual(['resource:host.name', 'resource:process.pid']);
  });

  it('uses the first metric keys in byte order and warns when there are more', async () => {
    const attrs: Record<string, string> = {};
    for (let i = 0; i < MAX_IDENTITY_METRIC_KEYS + 2; i++) attrs[`k${String(i).padStart(2, '0')}`] = 'x';
    counter('p1', 0, 1, {}, attrs);
    const res = await run(base([q({ aggregation: 'avg' })]));
    const metricRefs = aggregateMetrics.mock.calls[0][0].groupByAttrs!.filter((r) => r.scope === 'metric').map((r) => r.key);
    expect(metricRefs).toEqual(Object.keys(attrs).sort().slice(0, MAX_IDENTITY_METRIC_KEYS));
    expect(res.warnings.some((w) => w.includes(`more than ${MAX_IDENTITY_METRIC_KEYS} attribute keys`))).toBe(true);
    expect(getMetricLabelKeys.mock.calls.find((c) => c[0].scope === 'metric')![0].limit).toBe(MAX_IDENTITY_METRIC_KEYS + 1);
  });
});

describe('rate above the raw series cap (items 2 and 17)', () => {
  it('never diffs values of different series: keeps the busiest series and warns', async () => {
    const n = MAX_RAW_SERIES + 1;
    for (let i = 0; i < n; i++) {
      // Series i counts 1 per second, starting at i (so the last one is the lowest at the end).
      const start = i === n - 1 ? 0 : 1000 + i;
      for (let m = 0; m < 3; m++) counter('p1', m, start + m * 60, { 'service.instance.id': `i${i}` });
    }
    catalog.entries.set('requests', { unit: null, type: 'sum', temporality: 'cumulative' });
    const res = await run(base([q({ spaceAggregation: 'sum' })]));
    // One read only: no grouped re-read with `last`.
    expect(aggregateMetrics).toHaveBeenCalledTimes(1);
    expect(values(res.series[0]).slice(1, 3)).toEqual([MAX_RAW_SERIES, MAX_RAW_SERIES]);
    expect(res.warnings.some((w) => w.includes('highest recent value'))).toBe(true);
  });

  it('caps cumulative histograms by recent count instead of reading them unbounded', async () => {
    const n = MAX_RAW_SERIES + 1;
    for (let i = 0; i < n; i++) {
      const per = i === n - 1 ? 0 : 10;
      for (let m = 0; m < 3; m++) hist('p1', m, per * (m + 1), { 'service.instance.id': `i${i}` });
    }
    catalog.entries.set('latency', { unit: 's', type: 'histogram', temporality: 'cumulative' });
    const res = await run(base([q({ metricName: 'latency', aggregation: 'count' })]));
    expect(aggregateMetrics).toHaveBeenCalledTimes(1);
    expect(aggregateMetrics.mock.calls[0][0].aggregation).toBe('hist_last');
    expect(res.warnings.some((w) => w.includes('highest recent count'))).toBe(true);
    // 500 series, each 10 new observations per minute.
    expect(values(res.series[0]).slice(1, 3)).toEqual([MAX_RAW_SERIES * 10, MAX_RAW_SERIES * 10]);
  });
});

describe('single-level reads and key discovery (item 4)', () => {
  it('aggregates exact compositions in one engine read without identity (rollup eligible)', async () => {
    counter('p1', 0, 2, { 'host.name': 'a' }, {}, 'bytes');
    counter('p1', 0, 3, { 'host.name': 'b' }, {}, 'bytes');
    for (const [aggregation, spaceAggregation, expected] of [
      ['sum', 'sum', 5],
      ['count', 'sum', 2],
      ['min', 'min', 2],
      ['max', 'max', 3],
    ] as const) {
      aggregateMetrics.mockClear();
      getMetricLabelKeys.mockClear();
      const res = await run(base([q({ metricName: 'bytes', aggregation, spaceAggregation })]));
      expect(values(res.series[0])[0]).toBe(expected);
      expect(getMetricLabelKeys).not.toHaveBeenCalled();
      expect(aggregateMetrics).toHaveBeenCalledTimes(1);
      const call = aggregateMetrics.mock.calls[0][0];
      expect(call.groupByAttrs).toBeUndefined();
      expect(call.filters).toBeUndefined();
    }
  });

  it('keeps the per-series path where it changes the result (avg of series, rates)', async () => {
    counter('p1', 0, 2, { 'host.name': 'a' }, {}, 'bytes');
    counter('p1', 0, 4, { 'host.name': 'a' }, {}, 'bytes');
    counter('p1', 0, 9, { 'host.name': 'b' }, {}, 'bytes');
    const res = await run(base([q({ metricName: 'bytes', aggregation: 'avg', spaceAggregation: 'avg' })]));
    // avg(avg(a)=3, avg(b)=9) = 6, not the point average 5.
    expect(values(res.series[0])[0]).toBe(6);
    expect(getMetricLabelKeys).toHaveBeenCalled();
  });

  it('discovers identity keys over the recent part of the window, the whole window as fallback', async () => {
    const from = T0;
    const to = T0 + 24 * HOUR;
    points.push({ project: 'p1', metric: 'g', t: to - HOUR, v: 1, resource: { 'host.name': 'a' } });
    await run(base([q({ metricName: 'g', aggregation: 'avg' })], { from: new Date(from).toISOString(), to: new Date(to).toISOString(), interval: 'auto' }));
    for (const c of getMetricLabelKeys.mock.calls) expect(c[0].from!.getTime()).toBe(to - KEY_DISCOVERY_WINDOW_MS);

    getMetricLabelKeys.mockClear();
    points = [{ project: 'p1', metric: 'g', t: from + HOUR, v: 1, resource: { 'host.name': 'a' } }];
    const res = await run(base([q({ metricName: 'g', aggregation: 'avg' })], { from: new Date(from).toISOString(), to: new Date(to).toISOString(), interval: 'auto' }));
    const starts = getMetricLabelKeys.mock.calls.map((c) => c[0].from!.getTime());
    expect(starts).toContain(to - KEY_DISCOVERY_WINDOW_MS);
    expect(starts).toContain(from);
    expect(aggregateMetrics.mock.calls[0][0].groupByAttrs).toEqual([{ scope: 'resource', key: 'host.name' }]);
    expect(res.series).toHaveLength(1);
  });

  it('refuses windows longer than 90 days', async () => {
    await expect(
      run(base([q({ aggregation: 'avg' })], { from: new Date(T0 - 91 * 24 * HOUR).toISOString(), to: new Date(T0).toISOString() })),
    ).rejects.toBeInstanceOf(MetricQueryValidationError);
  });
});

describe('types without a catalog row (items 13 and 14)', () => {
  it('detects a histogram from the engine type and uses histogram math', async () => {
    engineTypes.set('latency', 'histogram');
    for (let m = 0; m < 3; m++) hist('p1', m, 10 * (m + 1), { 'host.name': 'a' });
    const res = await run(base([q({ metricName: 'latency', aggregation: 'count' })]));
    expect(aggregateMetrics.mock.calls.some((c) => c[0].aggregation === 'hist_last')).toBe(true);
    // Cumulative snapshots diffed: 10 new observations per minute after the first snapshot.
    expect(values(res.series[0]).slice(0, 3)).toEqual([null, 10, 10]);
    expect(res.queries[0].metricType).toBe('histogram');
  });

  it('treats a sum without temporality as cumulative even when not monotonic', async () => {
    for (let m = 0; m < 3; m++) counter('p1', m, 100 + m * 60, { 'host.name': 'a' });
    catalog.entries.set('requests', { unit: null, type: 'sum', temporality: null, isMonotonic: false });
    const res = await run(base([q({})]));
    expect(aggregateMetrics.mock.calls[0][0].aggregation).toBe('last');
    expect(values(res.series[0]).slice(1, 3)).toEqual([1, 1]);

    aggregateMetrics.mockClear();
    catalog.entries.set('requests', { unit: null, type: 'sum', temporality: 'delta', isMonotonic: true });
    await run(base([q({})]));
    expect(aggregateMetrics.mock.calls[0][0].aggregation).toBe('sum');
  });
});

describe('formula fold (item 21)', () => {
  it('folds after evaluating: Other is the formula of each operand fold', async () => {
    // errors and requests per host, three hosts, limit 1.
    const hosts = [
      ['a', 50, 100],
      ['b', 1, 100],
      ['c', 9, 300],
    ] as const;
    for (const [host, errors, total] of hosts) {
      points.push({ project: 'p1', metric: 'errors', t: T0, v: errors, resource: { 'host.name': host } });
      points.push({ project: 'p1', metric: 'total', t: T0, v: total, resource: { 'host.name': host } });
    }
    const res = await run(
      base(
        [
          q({ id: 'A', metricName: 'errors', aggregation: 'sum', groupBy: [hostRef], limit: 1, hidden: true }),
          q({ id: 'B', metricName: 'total', aggregation: 'sum', groupBy: [hostRef], limit: 1, hidden: true }),
        ],
        { formulas: [{ id: 'F1', expression: 'A / B * 100' }] },
      ),
    );
    const f = res.series.filter((s) => s.queryId === 'F1');
    // Top by mean is host a (50%); Other = (1 + 9) / (100 + 300) * 100 = 2.5%.
    expect(f.map((s) => s.labels)).toEqual([{ 'resource.host.name': 'a' }, { __other__: 'true' }]);
    expect(values(f[0])[0]).toBeCloseTo(50);
    expect(values(f[1])[0]).toBeCloseTo(2.5);
    const info = res.queries.find((x) => x.id === 'F1')!;
    expect(info.seriesTotal).toBe(3);
    expect(info.seriesShown).toBe(1);
  });

  it('folds a histogram operand by merging its rest', async () => {
    engineTypes.set('latency', 'histogram');
    catalog.entries.set('latency', { unit: 's', type: 'histogram', temporality: 'delta' });
    for (const [host, count] of [['a', 30], ['b', 5], ['c', 7]] as const) hist('p1', 0, count, { 'host.name': host });
    const res = await run(
      base([q({ metricName: 'latency', aggregation: 'count', groupBy: [hostRef], limit: 1, hidden: true })], {
        formulas: [{ id: 'F1', expression: 'A * 2' }],
      }),
    );
    const f = res.series.filter((s) => s.queryId === 'F1');
    expect(values(f[0])[0]).toBe(60);
    expect(f[1].labels).toEqual({ __other__: 'true' });
    expect(values(f[1])[0]).toBe(24);
  });
});

describe('internal series cap', () => {
  it('raises the series limit cap for internal callers only, up to the internal max', async () => {
    for (let i = 0; i < 60; i++) points.push({ project: 'p1', metric: 'g', t: T0, v: i, resource: { 'host.name': `h${String(i).padStart(2, '0')}` } });
    const spec = q({ metricName: 'g', aggregation: 'max', spaceAggregation: 'max', groupBy: [hostRef], limit: 60 });
    const capped = await run(base([spec]));
    expect(capped.queries[0].seriesShown).toBe(50);
    expect(capped.series.some((s) => s.labels.__other__ === 'true')).toBe(true);

    const internal = await run(base([spec], { internal: { maxSeries: 60 } }));
    expect(internal.queries[0].seriesShown).toBe(60);
    expect(internal.series.some((s) => s.labels.__other__ === 'true')).toBe(false);

    expect(seriesLimitCap(undefined)).toBe(50);
    expect(seriesLimitCap({ maxSeries: 10 })).toBe(50);
    expect(seriesLimitCap({ maxSeries: 1e9 })).toBe(MAX_INTERNAL_SERIES_LIMIT);
    expect(seriesLimitCap({ maxSeries: Number.NaN })).toBe(50);
  });
});
