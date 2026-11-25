import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MetricAggregateParams, MetricLabelParams, MetricTimeBucket } from '@logtide/reservoir';
import { metricAttrLabel } from '@logtide/shared';

// A tiny in-memory engine: enough of aggregateMetrics/getMetricLabelKeys
// (groupByAttrs, eq filters, avg/sum/min/max/last/count) to drive the service.
interface RawPoint {
  metric: string;
  t: number;
  v: number;
  attrs?: Record<string, string>;
  resource?: Record<string, string>;
}
let points: RawPoint[] = [];
const failing = new Set<string>();

const aggregateMetrics = vi.fn(async (p: MetricAggregateParams) => {
  if (failing.has(p.metricName)) throw new Error(`engine exploded on ${p.metricName}`);
  const step = { '1m': 60_000, '5m': 300_000, '15m': 900_000, '1h': 3_600_000, '6h': 21_600_000, '1d': 86_400_000, '1w': 604_800_000 }[p.interval];
  const rows = points.filter(
    (x) =>
      x.metric === p.metricName &&
      x.t >= p.from.getTime() &&
      x.t < p.to.getTime() &&
      (p.filters ?? []).every((f) => {
        const map = f.scope === 'resource' ? x.resource ?? {} : x.attrs ?? {};
        return f.op === 'eq' ? map[f.key] === f.values?.[0] : true;
      }),
  );
  const groups = new Map<string, { bucket: number; labels: Record<string, string>; values: number[] }>();
  for (const r of rows) {
    const labels: Record<string, string> = {};
    for (const ref of p.groupByAttrs ?? []) {
      const map = ref.scope === 'resource' ? r.resource ?? {} : r.attrs ?? {};
      labels[metricAttrLabel(ref)] = map[ref.key] ?? '';
    }
    const bucket = Math.floor(r.t / step) * step;
    const key = `${bucket}|${JSON.stringify(labels)}`;
    const g = groups.get(key) ?? { bucket, labels, values: [] };
    g.values.push(r.v);
    groups.set(key, g);
  }
  const fn = (vals: number[]) => {
    switch (p.aggregation) {
      case 'sum':
        return vals.reduce((a, b) => a + b, 0);
      case 'min':
        return Math.min(...vals);
      case 'max':
        return Math.max(...vals);
      case 'count':
        return vals.length;
      case 'last':
        return vals[vals.length - 1];
      default:
        return vals.reduce((a, b) => a + b, 0) / vals.length;
    }
  };
  const timeseries: MetricTimeBucket[] = [...groups.values()].map((g) => ({
    bucket: new Date(g.bucket),
    value: fn(g.values),
    ...(p.groupByAttrs?.length ? { labels: g.labels } : {}),
  }));
  return { metricName: p.metricName, metricType: 'gauge' as const, timeseries };
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

const catalog = { available: true, entries: new Map<string, { unit: string | null; type: string | null }>() };
vi.mock('../../../../modules/metrics/query/units.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../modules/metrics/query/units.js')>();
  return { ...actual, loadCatalog: vi.fn(async () => catalog) };
});

import { runMetricQuery, metricQueryService, MetricQueryValidationError, type ResolvedMetricQuery } from '../../../../modules/metrics/query/service.js';

const T0 = Date.parse('2026-11-25T00:00:00.000Z');
const MIN = 60_000;
const FAR_FUTURE = new Date('2030-01-01T00:00:00.000Z');

function base(overrides: Partial<ResolvedMetricQuery> = {}): ResolvedMetricQuery {
  return {
    organizationId: 'org-1',
    projectIds: ['p1'],
    from: new Date(T0).toISOString(),
    to: new Date(T0 + 10 * MIN).toISOString(),
    queries: [],
    formulas: [],
    interval: '1m',
    compareTo: 'none',
    display: 'lines',
    ...overrides,
  };
}

const run = (q: ResolvedMetricQuery) => runMetricQuery(q, FAR_FUTURE);
const valuesOf = (s: { points: Array<{ v: number | null }> }) => s.points.map((p) => p.v);

function cpu(host: string, core: string, minute: number, v: number) {
  points.push({ metric: 'system.cpu.utilization', t: T0 + minute * MIN, v, attrs: { cpu: core }, resource: { 'host.name': host } });
}

beforeEach(() => {
  points = [];
  failing.clear();
  catalog.available = true;
  catalog.entries = new Map();
  aggregateMetrics.mockClear();
  getMetricLabelKeys.mockClear();
});

describe('metricQueryService.run', () => {
  it('aggregates per series in time, then across series in space', async () => {
    // host a: two cores, host b: one core
    cpu('a', '0', 0, 0.2);
    cpu('a', '0', 0, 0.4); // two samples in the bucket: time avg 0.3
    cpu('a', '1', 0, 0.9);
    cpu('b', '0', 0, 0.5);
    catalog.entries.set('system.cpu.utilization', { unit: '1', type: 'gauge' });

    const byHost = await run(
      base({
        queries: [{ id: 'A', metricName: 'system.cpu.utilization', aggregation: 'avg', spaceAggregation: 'max', filters: [], groupBy: [{ scope: 'resource', key: 'host.name' }] }],
      }),
    );
    expect(byHost.interval).toBe('1m');
    const a = byHost.series.find((s) => s.labels['resource.host.name'] === 'a')!;
    expect(a.points[0].v).toBeCloseTo(0.9);
    expect(a.points).toHaveLength(10);
    expect(a.unit).toBe('1');
    expect(a.name).toBe('a');
    expect(a.id).toBe('A|resource.host.name=a');
    expect(a.stats.last).toBeCloseTo(0.9);
    expect(byHost.queries[0]).toMatchObject({ id: 'A', seriesTotal: 2, seriesShown: 2, metricType: 'gauge', unit: '1' });

    // The engine was asked for per-series identity: groupBy + metric keys + host.name
    const call = aggregateMetrics.mock.calls[0][0];
    expect(call.groupByAttrs).toEqual([
      { scope: 'resource', key: 'host.name' },
      { scope: 'metric', key: 'cpu' },
    ]);
    expect(call.projectId).toEqual(['p1']);
    expect(call.organizationId).toBe('org-1');

    const ungrouped = await run(
      base({ queries: [{ id: 'A', metricName: 'system.cpu.utilization', aggregation: 'avg', filters: [], groupBy: [], label: 'CPU' }] }),
    );
    expect(ungrouped.series).toHaveLength(1);
    // space avg of per-series time avgs: (0.3 + 0.9 + 0.5) / 3
    expect(ungrouped.series[0].points[0].v).toBeCloseTo(1.7 / 3);
    expect(ungrouped.series[0].labels).toEqual({});
    expect(ungrouped.series[0].name).toBe('CPU');
  });

  it('computes rates per series with counter resets, then sums them', async () => {
    const add = (iface: string, minute: number, v: number) =>
      points.push({ metric: 'net.bytes', t: T0 + minute * MIN + 30_000, v, attrs: { iface }, resource: { 'host.name': 'a' } });
    [0, 60, 120, 180].forEach((v, i) => add('eth0', i, v));
    [1000, 1600, 100, 700].forEach((v, i) => add('eth1', i, v)); // reset at minute 2

    const res = await run(base({ queries: [{ id: 'A', metricName: 'net.bytes', aggregation: 'rate', filters: [], groupBy: [] }] }));
    expect(aggregateMetrics.mock.calls[0][0].aggregation).toBe('last');
    // minute1: 1 + 10; minute2: 1 + 100/60 (reset); minute3: 1 + 10
    const v = valuesOf(res.series[0]);
    expect(v[0]).toBeNull();
    expect(v[1]).toBeCloseTo(11);
    expect(v[2]).toBeCloseTo(1 + 100 / 60);
    expect(v[3]).toBeCloseTo(11);
    expect(v[4]).toBeNull();
  });

  it('keeps the top N groups and folds the rest', async () => {
    ['a', 'b', 'c', 'd'].forEach((h, i) => cpu(h, '0', 0, i + 1));
    const res = await run(
      base({
        queries: [{ id: 'A', metricName: 'system.cpu.utilization', aggregation: 'avg', spaceAggregation: 'sum', filters: [], groupBy: [{ scope: 'resource', key: 'host.name' }], limit: 2 }],
      }),
    );
    expect(res.series.map((s) => s.name)).toEqual(['d', 'c', 'Other']);
    expect(res.series[2].labels).toEqual({ __other__: 'true' });
    expect(res.series[2].points[0].v).toBe(3); // 1 + 2
    expect(res.queries[0]).toMatchObject({ seriesTotal: 4, seriesShown: 2 });
  });

  it('applies filters and resolves variables', async () => {
    cpu('a', '0', 0, 1);
    cpu('b', '0', 0, 5);
    const q = {
      id: 'A' as const,
      metricName: 'system.cpu.utilization',
      aggregation: 'avg' as const,
      filters: [{ scope: 'resource' as const, key: 'host.name', op: 'eq' as const, values: ['$host'] }],
      groupBy: [],
    };
    const one = await run(base({ queries: [q], variables: { host: 'b' } }));
    expect(one.series[0].points[0].v).toBe(5);
    expect(aggregateMetrics.mock.calls[0][0].filters).toEqual([{ scope: 'resource', key: 'host.name', op: 'eq', values: ['b'] }]);

    const all = await run(base({ queries: [q], variables: { host: null } }));
    expect(all.series[0].points[0].v).toBe(3);

    await expect(run(base({ queries: [q], variables: {} }))).rejects.toBeInstanceOf(MetricQueryValidationError);
  });

  it('evaluates formulas, hides hidden items, and reports formula errors per formula', async () => {
    points.push({ metric: 'used', t: T0, v: 30, resource: { 'host.name': 'a' } });
    points.push({ metric: 'total', t: T0, v: 120, resource: { 'host.name': 'a' } });
    catalog.entries.set('used', { unit: 'By', type: 'gauge' });
    catalog.entries.set('total', { unit: 'By', type: 'gauge' });
    const res = await run(
      base({
        queries: [
          { id: 'A', metricName: 'used', aggregation: 'avg', filters: [], groupBy: [], hidden: true },
          { id: 'B', metricName: 'total', aggregation: 'avg', filters: [], groupBy: [], hidden: true },
        ],
        formulas: [
          { id: 'F1', expression: 'A / B * 100', label: 'Used %' },
          { id: 'F2', expression: 'A / (B' },
          { id: 'F3', expression: 'A + C' },
          { id: 'F4', expression: 'A + B', hidden: true },
        ],
      }),
    );
    expect(res.series.map((s) => s.queryId)).toEqual(['F1']);
    expect(res.series[0].points[0].v).toBe(25);
    expect(res.series[0].name).toBe('Used %');
    expect(res.series[0].unit).toBe('By');
    const info = Object.fromEntries(res.queries.map((q) => [q.id, q]));
    expect(info.A.error).toBeUndefined();
    expect(info.F2.error).toMatch(/Missing "\)"/);
    expect(info.F3.error).toMatch(/Unknown query C/);
    expect(info.F4.error).toBeUndefined();
  });

  it('applies the unit override to every series', async () => {
    cpu('a', '0', 0, 1);
    catalog.entries.set('system.cpu.utilization', { unit: '1', type: 'gauge' });
    const res = await run(
      base({
        unitOverride: '%',
        queries: [{ id: 'A', metricName: 'system.cpu.utilization', aggregation: 'avg', filters: [], groupBy: [] }],
        formulas: [{ id: 'F1', expression: 'A * 100' }],
      }),
    );
    expect(res.series.map((s) => s.unit)).toEqual(['%', '%']);
    expect(res.queries.map((q) => q.unit)).toEqual(['%', '%']);
  });

  it('adds compareTo copies shifted onto the current window', async () => {
    cpu('a', '0', 0, 1); // current window, minute 0
    cpu('a', '0', -60 + 3, 7); // one hour earlier, minute 3
    const res = await run(
      base({
        compareTo: '1h',
        queries: [
          { id: 'A', metricName: 'system.cpu.utilization', aggregation: 'avg', filters: [], groupBy: [] },
          { id: 'B', metricName: 'system.cpu.utilization', aggregation: 'max', filters: [], groupBy: [], hidden: true },
        ],
        formulas: [{ id: 'F1', expression: 'B * 2' }],
      }),
    );
    const cmp = res.series.filter((s) => s.comparison);
    expect(cmp.map((s) => s.id)).toEqual(['A||cmp', 'F1||cmp']);
    expect(cmp[0].points[3]).toEqual({ t: new Date(T0 + 3 * MIN).toISOString(), v: 7 });
    expect(cmp[1].points[3].v).toBe(14);
    expect(res.series.find((s) => s.id === 'A|')!.points[0].v).toBe(1);
    // the hidden query B ran in the earlier window for F1 only
    const windows = aggregateMetrics.mock.calls.map((c) => c[0].from.getTime());
    expect(windows).toContain(T0 - 60 * MIN);
  });

  it('reports per-query errors and unknown metrics without failing the others', async () => {
    cpu('a', '0', 0, 1);
    failing.add('broken');
    const res = await run(
      base({
        queries: [
          { id: 'A', metricName: 'system.cpu.utilization', aggregation: 'avg', filters: [], groupBy: [] },
          { id: 'B', metricName: 'broken', aggregation: 'avg', filters: [], groupBy: [] },
          { id: 'C', metricName: 'nope', aggregation: 'avg', filters: [], groupBy: [] },
        ],
        formulas: [{ id: 'F1', expression: 'A + B' }],
      }),
    );
    const info = Object.fromEntries(res.queries.map((q) => [q.id, q]));
    expect(info.A.error).toBeUndefined();
    expect(info.B.error).toMatch(/engine exploded/);
    expect(info.C.error).toBe('Unknown metric "nope"');
    expect(info.F1.error).toBe('Query B failed');
    expect(res.series.map((s) => s.queryId)).toEqual(['A']);

    // no catalog table: no unknown-metric guess
    catalog.available = false;
    const res2 = await run(base({ queries: [{ id: 'C', metricName: 'nope', aggregation: 'avg', filters: [], groupBy: [] }] }));
    expect(res2.queries[0].error).toBeUndefined();
  });

  it('falls back to single-level aggregation above 500 raw series', async () => {
    for (let i = 0; i < 501; i++) {
      points.push({ metric: 'wide', t: T0, v: i % 2 ? 1 : 3, attrs: { id: String(i) }, resource: { 'host.name': i % 2 ? 'a' : 'b' } });
    }
    const res = await run(
      base({ queries: [{ id: 'A', metricName: 'wide', aggregation: 'avg', spaceAggregation: 'max', filters: [], groupBy: [{ scope: 'resource', key: 'host.name' }] }] }),
    );
    expect(res.warnings.some((w) => w.includes('more than 500 series'))).toBe(true);
    expect(aggregateMetrics).toHaveBeenCalledTimes(2);
    expect(aggregateMetrics.mock.calls[1][0].groupByAttrs).toEqual([{ scope: 'resource', key: 'host.name' }]);
    const avgs = Object.fromEntries(res.series.map((s) => [s.name, s.points[0].v]));
    expect(avgs).toEqual({ a: 1, b: 3 });
  });

  it('sums of many series are exact in one engine read', async () => {
    for (let i = 0; i < 501; i++) {
      points.push({ metric: 'wide', t: T0, v: 1, attrs: { id: String(i) }, resource: { 'host.name': i % 2 ? 'a' : 'b' } });
    }
    const res = await run(
      base({ queries: [{ id: 'A', metricName: 'wide', aggregation: 'sum', filters: [], groupBy: [{ scope: 'resource', key: 'host.name' }] }] }),
    );
    expect(res.warnings).toEqual([]);
    expect(aggregateMetrics).toHaveBeenCalledTimes(1);
    expect(aggregateMetrics.mock.calls[0][0].groupByAttrs).toEqual([{ scope: 'resource', key: 'host.name' }]);
    const sums = Object.fromEntries(res.series.map((s) => [s.name, s.points[0].v]));
    expect(sums).toEqual({ a: 250, b: 251 });
  });

  it('resolves the auto interval, warns on oversized intervals, and handles empty scopes', async () => {
    const res = await run(
      base({
        interval: '1m',
        to: new Date(T0 + 30 * 24 * 60 * MIN).toISOString(),
        queries: [{ id: 'A', metricName: 'x', aggregation: 'avg', filters: [], groupBy: [] }],
      }),
    );
    expect(res.interval).toBe('6h');
    expect(res.warnings[0]).toMatch(/too many points/);

    const empty = await metricQueryService.run(
      base({ projectIds: [], queries: [{ id: 'A', metricName: 'x', aggregation: 'avg', filters: [], groupBy: [] }], formulas: [{ id: 'F1', expression: 'A' }] }),
    );
    expect(empty.series).toEqual([]);
    expect(empty.queries.map((q) => q.id)).toEqual(['A', 'F1']);
    expect(aggregateMetrics).toHaveBeenCalledTimes(1);

    await expect(run(base({ from: new Date(T0).toISOString(), to: new Date(T0).toISOString() }))).rejects.toBeInstanceOf(
      MetricQueryValidationError,
    );
  });
});
