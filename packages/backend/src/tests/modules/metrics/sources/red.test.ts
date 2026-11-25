import { describe, it, expect, vi, beforeEach } from 'vitest';

const ORG = '11111111-1111-4111-8111-111111111111';
const P1 = '33333333-3333-4333-8333-333333333333';

const mocks = vi.hoisted(() => ({
  run: vi.fn(),
  getMetricSources: vi.fn(),
  getServiceHealthStats: vi.fn(),
  getOperationStats: vi.fn(),
  querySpans: vi.fn(),
}));

vi.mock('../../../../modules/metrics/query/service.js', () => ({
  metricQueryService: { run: mocks.run },
}));
vi.mock('../../../../database/reservoir.js', () => ({
  reservoir: {
    getMetricSources: mocks.getMetricSources,
    getServiceHealthStats: mocks.getServiceHealthStats,
    getOperationStats: mocks.getOperationStats,
    querySpans: mocks.querySpans,
  },
}));
vi.mock('../../../../database/index.js', () => ({ db: {} }));
vi.mock('../../../../modules/custom-dashboards/service.js', () => ({ customDashboardsService: {} }));

import { histogramPercentile, mixturePercentile, msFactor, redFromSeries, sliceWindow } from '../../../../modules/metrics/sources/red.js';
import { listServices } from '../../../../modules/metrics/sources/service.js';

const from = new Date(Date.now() - 3_600_000);
const to = new Date();
const ctx = { organizationId: ORG, projectIds: [P1], from, to };
const seen = new Date(Date.now() - 60_000);

function src(value: string, metricCount = 3) {
  return { value, projectIds: [P1], lastSeen: seen, metricCount, pointCount: 10, co: { 'host.name': ['h1'] } };
}

function series(queryId: string, service: string, values: Array<number | null>, unit: string | null = null) {
  const nums = values.filter((v): v is number => v !== null);
  return {
    id: `${queryId}|${service}`,
    queryId,
    labels: { 'resource.service.name': service },
    name: service,
    unit,
    comparison: false,
    points: values.map((v, i) => ({ t: new Date(i * 60_000).toISOString(), v })),
    stats: {
      min: nums.length ? Math.min(...nums) : null,
      avg: nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null,
      max: nums.length ? Math.max(...nums) : null,
      last: values[values.length - 1] ?? null,
    },
  };
}

describe('histogramPercentile', () => {
  it('interpolates inside the bucket holding the rank', () => {
    // 100 spans: 50 in (0,10], 50 in (10,20]; p95 -> rank 95 -> 10 + (45/50)*10 = 19
    expect(histogramPercentile([10, 20], [50, 50, 0], 0.95)).toBeCloseTo(19);
  });
  it('reports the last finite bound for the +Inf bucket and null when empty', () => {
    expect(histogramPercentile([10, 20], [0, 0, 5], 0.95)).toBe(20);
    expect(histogramPercentile([10, 20], [0, 0, 0], 0.95)).toBeNull();
  });
});

describe('msFactor', () => {
  it('converts by unit with a per-metric fallback', () => {
    expect(msFactor('s', 'ms')).toBe(1000);
    expect(msFactor('ms', 's')).toBe(1);
    expect(msFactor(null, 's')).toBe(1000);
    expect(msFactor(null, 'ms')).toBe(1);
  });
});

describe('redFromSeries', () => {
  it('derives rate, error percent and p95 in ms', () => {
    const all = [
      series('A', 'api', [10, 20]),
      series('B', 'api', [1, 4]),
      series('C', 'api', [0.1, 0.3], 's'),
    ];
    const red = redFromSeries(all, 'api', 's');
    expect(red?.requestRate.value).toBe(15);
    expect(red?.errorRate.value).toBeCloseTo((2.5 / 15) * 100);
    expect(red?.errorRate.spark).toEqual([10, 20]);
    expect(red?.p95.value).toBeCloseTo(200);
    expect(red?.p95.spark[0]).toBeCloseTo(100);
  });

  it('error percent is null with zero traffic and zero without 5xx series', () => {
    expect(redFromSeries([series('A', 'api', [0, 0])], 'api', 's')?.errorRate.value).toBeNull();
    expect(redFromSeries([series('A', 'api', [5, 5])], 'api', 's')?.errorRate.value).toBe(0);
  });

  it('is null when the service has no total series', () => {
    expect(redFromSeries([series('A', 'other', [1])], 'api', 's')).toBeNull();
  });
});

describe('listServices RED source', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getMetricSources.mockResolvedValue({ sources: [src('traced'), src('http-new'), src('http-old'), src('plain')] });
    mocks.getServiceHealthStats.mockResolvedValue([
      { serviceName: 'traced', totalCalls: 1000, totalErrors: 500, avgLatencyMs: 1, p95LatencyMs: 999 },
    ]);
    mocks.getOperationStats.mockResolvedValue([
      { service: 'traced', operation: 'GET /a', count: 300, errorCount: 3, avgMs: 1, p50Ms: 5, p95Ms: 20, p99Ms: 30 },
      { service: 'traced', operation: 'POST /b', count: 300, errorCount: 3, avgMs: 1, p50Ms: 5, p95Ms: 20, p99Ms: 30 },
    ]);
    mocks.querySpans.mockResolvedValue({ spans: [], total: 0, hasMore: false, limit: 100, offset: 0 });
    mocks.run.mockImplementation(async (q: any) => {
      const metric = q.queries[0].metricName as string;
      if (metric === 'http.server.request.duration') {
        return {
          series: [series('A', 'http-new', [2, 2]), series('B', 'http-new', [1, 1]), series('C', 'http-new', [0.05, 0.05], 's')],
          interval: '5m',
          queries: [],
          warnings: [],
        };
      }
      return {
        series: [series('A', 'http-old', [10, 10]), series('C', 'http-old', [80, 120], 'ms')],
        interval: '5m',
        queries: [],
        warnings: [],
      };
    });
  });

  it('uses entry spans for traced services and metrics for the others', async () => {
    const list = await listServices(ctx);
    const by = Object.fromEntries(list.map((s) => [s.name, s]));

    expect(by.traced.redSource).toBe('traces');
    expect(by.traced.hasTraces).toBe(true);
    // entry spans only: 600 calls, 6 errors (not the 1000/500 of every span)
    expect(by.traced.errorRate.value).toBeCloseTo(1);
    expect(by.traced.requestRate.value).toBeCloseTo(600 / 3600, 3);
    expect(by.traced.p95.value).toBeCloseTo(20);

    expect(by['http-new'].redSource).toBe('metrics');
    expect(by['http-new'].hasTraces).toBe(false);
    expect(by['http-new'].requestRate.value).toBe(2);
    expect(by['http-new'].errorRate.value).toBeCloseTo(50);
    expect(by['http-new'].p95.value).toBeCloseTo(50);

    expect(by['http-old'].redSource).toBe('metrics');
    expect(by['http-old'].errorRate.value).toBe(0);
    expect(by['http-old'].p95.value).toBeCloseTo(100);

    expect(by.plain.redSource).toBeNull();
    expect(by.plain.requestRate.value).toBeNull();
  });

  it('does not query metrics for traced services and tries the legacy name only for the rest', async () => {
    await listServices(ctx);
    const calls = mocks.run.mock.calls.map((c) => c[0]);
    const first = calls.find((q) => q.queries[0].metricName === 'http.server.request.duration');
    expect(first.queries[0].filters[0].values).not.toContain('traced');
    const legacy = calls.find((q) => q.queries[0].metricName === 'http.server.duration');
    expect(legacy.queries[0].filters[0].values.sort()).toEqual(['http-old', 'plain']);
    expect(legacy.queries[1].filters[1]).toMatchObject({ key: 'http.status_code', op: 'gte', values: ['500'] });
    expect(first.queries[1].filters[1]).toMatchObject({ key: 'http.response.status_code', op: 'gte', values: ['500'] });
  });

  it('falls back to every span when entry span stats are unavailable', async () => {
    mocks.getOperationStats.mockRejectedValue(new Error('not implemented'));
    const traced = (await listServices(ctx, 'traced'))[0];
    expect(traced.redSource).toBe('traces');
    expect(traced.errorRate.value).toBeCloseTo(50);
    expect(traced.p95.value).toBe(999);
  });

  it('survives a failing metric query', async () => {
    mocks.run.mockRejectedValue(new Error('boom'));
    const list = await listServices(ctx);
    expect(list.find((s) => s.name === 'http-new')?.redSource).toBeNull();
  });
});
