import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MetricAggregateParams, MetricLabelParams, MetricTimeBucket } from '@logtide/reservoir';
import { metricAttrLabel, type MetricAlertConfig } from '@logtide/shared';

// The metric evaluator against the real query service, over a tiny in-memory
// engine (last/avg per bucket, groupByAttrs): checks what the evaluator asks
// the query service for and what it gets back for rates and grouped queries.
interface RawPoint {
  metric: string;
  t: number;
  v: number;
  resource: Record<string, string>;
}
let points: RawPoint[] = [];

const aggregateMetrics = vi.fn(async (p: MetricAggregateParams) => {
  const step = 60_000;
  const rows = points.filter((x) => x.metric === p.metricName && x.t >= p.from.getTime() && x.t < p.to.getTime());
  const groups = new Map<string, { bucket: number; labels: Record<string, string>; values: number[] }>();
  for (const r of rows) {
    const labels: Record<string, string> = {};
    for (const ref of p.groupByAttrs ?? []) labels[metricAttrLabel(ref)] = r.resource[ref.key] ?? '';
    const bucket = Math.floor(r.t / step) * step;
    const key = `${bucket}|${JSON.stringify(labels)}`;
    const g = groups.get(key) ?? { bucket, labels, values: [] };
    g.values.push(r.v);
    groups.set(key, g);
  }
  const timeseries: MetricTimeBucket[] = [...groups.values()].map((g) => ({
    bucket: new Date(g.bucket),
    value: p.aggregation === 'last' ? g.values[g.values.length - 1] : g.values.reduce((a, b) => a + b, 0) / g.values.length,
    ...(p.groupByAttrs?.length ? { labels: g.labels } : {}),
  }));
  return { metricName: p.metricName, metricType: 'gauge' as const, timeseries };
});

const getMetricLabelKeys = vi.fn(async (p: MetricLabelParams) => {
  if (p.scope !== 'resource') return { keys: [] };
  const keys = new Set<string>();
  for (const x of points) if (x.metric === p.metricName) for (const k of Object.keys(x.resource)) keys.add(k);
  return { keys: [...keys].sort() };
});

vi.mock('../../../database/reservoir.js', () => ({
  reservoir: {
    aggregateMetrics: (p: MetricAggregateParams) => aggregateMetrics(p),
    getMetricLabelKeys: (p: MetricLabelParams) => getMetricLabelKeys(p),
  },
}));

const catalog = { available: true, entries: new Map<string, { unit: string | null; type: string | null; temporality?: string | null; isMonotonic?: boolean | null }>() };
vi.mock('../../../modules/metrics/query/units.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../modules/metrics/query/units.js')>();
  return { ...actual, loadCatalog: vi.fn(async () => catalog) };
});

import { computeMetricWindow, selectAlertGroups } from '../../../modules/alerts/metric-evaluator.js';
import { MAX_UNFOLDED_GROUPS, metricQueryService } from '../../../modules/metrics/query/service.js';

// 10:07:30, so the window of a 1m rule is [10:06, 10:07) and the lead step 10:05.
const NOW = new Date('2026-11-25T10:07:30.000Z');
const at = (hh: number, mm: number, ss = 30) => Date.UTC(2026, 10, 25, hh, mm, ss);

function config(o: Partial<MetricAlertConfig> = {}, groupBy = false): MetricAlertConfig {
  return {
    query: {
      projectIds: null,
      queries: [
        {
          id: 'A',
          metricName: 'http.requests',
          aggregation: 'rate',
          filters: [],
          groupBy: groupBy ? [{ scope: 'resource', key: 'host.name' }] : [],
        },
      ],
      formulas: [],
      interval: 'auto',
      compareTo: 'none',
      display: 'lines',
    },
    condition: 'above',
    threshold: 1,
    window: '1m',
    forEvaluations: 1,
    severity: 'high',
    ...o,
  };
}

beforeEach(() => {
  points = [];
  catalog.entries = new Map([['http.requests', { unit: null, type: 'sum', temporality: 'cumulative', isMonotonic: true }]]);
  aggregateMetrics.mockClear();
  vi.restoreAllMocks();
});

describe('computeMetricWindow', () => {
  it('a 1 minute window gets a rate of a cumulative counter from the lead step', async () => {
    // Counter: 600 at 10:05:30, 1200 at 10:06:30 -> 600 per minute = 10/s.
    points.push({ metric: 'http.requests', t: at(10, 5), v: 600, resource: { 'host.name': 'a' } });
    points.push({ metric: 'http.requests', t: at(10, 6), v: 1200, resource: { 'host.name': 'a' } });
    const spy = vi.spyOn(metricQueryService, 'run');

    const result = await computeMetricWindow(config(), 'org-1', ['p1'], NOW);
    expect(spy.mock.calls[0][0]).toMatchObject({
      from: '2026-11-25T10:05:00.000Z',
      to: '2026-11-25T10:07:00.000Z',
      interval: '1m',
      internal: { unfoldedGroups: true },
    });
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].value).toBeCloseTo(10);
  });

  it('the lead bucket alone is no data', async () => {
    points.push({ metric: 'http.requests', t: at(10, 4), v: 0, resource: { 'host.name': 'a' } });
    points.push({ metric: 'http.requests', t: at(10, 5), v: 600, resource: { 'host.name': 'a' } });
    const result = await computeMetricWindow(config(), 'org-1', ['p1'], NOW);
    expect(result.groups.every((g) => g.value === null)).toBe(true);
  });

  it('a below rule sees the lowest groups beyond the explorer top N cap', async () => {
    catalog.entries = new Map([['load', { unit: null, type: 'gauge' }]]);
    for (let i = 0; i < 70; i++) {
      points.push({ metric: 'load', t: at(10, 6), v: i, resource: { 'host.name': `h${String(i).padStart(2, '0')}` } });
    }
    const cfg = config({ condition: 'below', threshold: 3 }, true);
    cfg.query.queries[0] = { ...cfg.query.queries[0], metricName: 'load', aggregation: 'avg' };
    const result = await computeMetricWindow(cfg, 'org-1', ['p1'], NOW);
    expect(result.groups).toHaveLength(70);
    expect(result.groups.some((g) => g.labels.__other__ === 'true')).toBe(false);
    const picked = selectAlertGroups(cfg, result.groups, []);
    expect(picked.map((g) => g.value)).toEqual([0, 1, 2]);
  });

  it('above the unfolded group cap, a below rule keeps the lowest groups and knows the result is partial (N4)', async () => {
    catalog.entries = new Map([['load', { unit: null, type: 'gauge' }]]);
    const n = MAX_UNFOLDED_GROUPS + 20;
    // Highest-labelled hosts carry the lowest values: a labels-first cap would drop them.
    for (let i = 0; i < n; i++) {
      points.push({ metric: 'load', t: at(10, 6), v: n - i, resource: { 'host.name': `h${String(i).padStart(4, '0')}` } });
    }
    const cfg = config({ condition: 'below', threshold: 3 }, true);
    cfg.query.queries[0] = { ...cfg.query.queries[0], metricName: 'load', aggregation: 'avg' };
    const result = await computeMetricWindow(cfg, 'org-1', ['p1'], NOW);
    expect(result.groups).toHaveLength(MAX_UNFOLDED_GROUPS);
    expect(result.partial).toBe(true);
    const picked = selectAlertGroups(cfg, result.groups, []);
    expect(picked.map((g) => g.value)).toEqual([1, 2]);
  });

  it('a small grouped query is complete (not partial)', async () => {
    points.push({ metric: 'http.requests', t: at(10, 5), v: 600, resource: { 'host.name': 'a' } });
    points.push({ metric: 'http.requests', t: at(10, 6), v: 1200, resource: { 'host.name': 'a' } });
    const result = await computeMetricWindow(config({}, true), 'org-1', ['p1'], NOW);
    expect(result.partial).toBe(false);
  });
});
