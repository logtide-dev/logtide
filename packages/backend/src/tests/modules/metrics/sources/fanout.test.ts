import { describe, it, expect, vi, beforeEach } from 'vitest';

const ORG = '11111111-1111-4111-8111-111111111111';
const P1 = '33333333-3333-4333-8333-333333333333';

const mocks = vi.hoisted(() => ({
  run: vi.fn(),
  getMetricSources: vi.fn(),
  getMetricNames: vi.fn(),
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
    getMetricNames: mocks.getMetricNames,
    getServiceHealthStats: mocks.getServiceHealthStats,
    getOperationStats: mocks.getOperationStats,
    querySpans: mocks.querySpans,
  },
}));
vi.mock('../../../../database/index.js', () => {
  const chain: any = { select: () => chain, where: () => chain, execute: async () => [] };
  return { db: { selectFrom: () => chain } };
});
vi.mock('../../../../modules/custom-dashboards/service.js', () => ({ customDashboardsService: {} }));

import { mixturePercentile, sliceWindow } from '../../../../modules/metrics/sources/red.js';
import {
  buildCustomizeInput,
  listHosts,
  listServices,
  getServiceDetail,
  sourceMetricNames,
} from '../../../../modules/metrics/sources/service.js';

const to = new Date();
const from = new Date(to.getTime() - 6 * 3_600_000);
const ctx = { organizationId: ORG, projectIds: [P1], from, to };

function metricSource(value: string, co: Record<string, string[]> = {}) {
  return { value, projectIds: [P1], lastSeen: new Date(to.getTime() - 30_000), metricCount: 3, pointCount: 10, co };
}

function op(service: string, count: number, errorCount = 0, p50 = 10, p95 = 100, p99 = 200) {
  return { service, operation: 'GET /x', count, errorCount, avgMs: 20, p50Ms: p50, p95Ms: p95, p99Ms: p99 };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.run.mockResolvedValue({ series: [], interval: '15m', queries: [], warnings: [] });
  mocks.querySpans.mockResolvedValue({ spans: [], total: 0, hasMore: false, limit: 100, offset: 0 });
});

describe('mixturePercentile', () => {
  it('is exact for one operation at its known quantiles', () => {
    expect(mixturePercentile([{ count: 10, p50Ms: 5, p95Ms: 40, p99Ms: 90 }], 0.95)).toBeCloseTo(40, 1);
    expect(mixturePercentile([{ count: 10, p50Ms: 5, p95Ms: 40, p99Ms: 90 }], 0.5)).toBeCloseTo(5, 1);
  });

  it('follows the call weights of a mixture', () => {
    const fast = { count: 990, p50Ms: 5, p95Ms: 10, p99Ms: 12 };
    const slow = { count: 10, p50Ms: 500, p95Ms: 900, p99Ms: 1000 };
    // 1% of the calls are slow: p95 stays fast, p99.9 would not.
    expect(mixturePercentile([fast, slow], 0.95)!).toBeLessThan(15);
    expect(mixturePercentile([slow, { ...slow, count: 1000 }], 0.95)!).toBeGreaterThan(500);
  });

  it('is null without calls', () => {
    expect(mixturePercentile([], 0.95)).toBeNull();
    expect(mixturePercentile([{ count: 0, p50Ms: 1, p95Ms: 2, p99Ms: 3 }], 0.95)).toBeNull();
  });
});

describe('sliceWindow', () => {
  it('splits without overlap and ends at the window end', () => {
    const slices = sliceWindow(0, 24_000, 24);
    expect(slices).toHaveLength(24);
    expect(slices[0].from).toBe(0);
    expect(slices[23].to).toBe(24_000);
    for (let i = 1; i < slices.length; i++) expect(slices[i].from).toBe(slices[i - 1].to + 1);
  });
});

describe('sourceMetricNames', () => {
  it('asks the reservoir once, filtered on the resource attribute, with a generous limit', async () => {
    mocks.getMetricNames.mockResolvedValue({
      names: [
        { name: 'system.cpu.utilization.total', type: 'gauge' },
        { name: 'system.cpu.utilization.total', type: 'sum' },
        { name: 'a.metric', type: 'gauge' },
      ],
    });
    const names = await sourceMetricNames(ctx, 'host.name', 'web-1');
    expect(names).toEqual(['a.metric', 'system.cpu.utilization.total']);
    expect(mocks.getMetricNames).toHaveBeenCalledTimes(1);
    const params = mocks.getMetricNames.mock.calls[0][0];
    expect(params.filters).toEqual([{ scope: 'resource', key: 'host.name', op: 'eq', values: ['web-1'] }]);
    expect(params.limit).toBeGreaterThan(1000);
    expect(mocks.getMetricSources).not.toHaveBeenCalled();
  });
});

describe('hosts fan-out', () => {
  it('runs one grouped query per signal whatever the number of hosts', async () => {
    const count = (n: number) => Array.from({ length: n }, (_, i) => metricSource(`host-${i}`));
    mocks.getMetricSources.mockResolvedValue({ sources: count(3) });
    await listHosts(ctx);
    const small = mocks.run.mock.calls.length;

    mocks.run.mockClear();
    mocks.getMetricSources.mockResolvedValue({ sources: count(180) });
    await listHosts(ctx);
    expect(mocks.run.mock.calls.length).toBe(small);
    expect(small).toBe(5);
    for (const [q] of mocks.run.mock.calls) {
      expect(q.queries).toHaveLength(1);
      expect(q.queries[0].groupBy).toEqual([{ scope: 'resource', key: 'host.name' }]);
      expect(q.queries[0].limit).toBe(180);
      expect(q.queries[0].filters.some((f: any) => f.op === 'in')).toBe(false);
    }
  });
});

describe('services fan-out and RED', () => {
  function setup(serviceCount: number) {
    const names = Array.from({ length: serviceCount }, (_, i) => `svc-${i}`);
    mocks.getMetricSources.mockResolvedValue({ sources: names.map((n) => metricSource(n)) });
    mocks.getServiceHealthStats.mockResolvedValue(
      names.map((n) => ({ serviceName: n, totalCalls: 10, totalErrors: 0, avgLatencyMs: 1, p95LatencyMs: 5 })),
    );
    mocks.getOperationStats.mockImplementation(async () => names.map((n) => op(n, 100, 0)));
    mocks.querySpans.mockImplementation(async (p: any) => ({
      spans: (p.serviceName as string[]).map((serviceName, i) => ({
        serviceName,
        endTime: new Date(to.getTime() - 5 * 60_000 - i * 1000),
      })),
      total: 0,
      hasMore: false,
      limit: 100,
      offset: 0,
    }));
  }

  it('keeps the number of reservoir and query calls independent of the service count', async () => {
    setup(2);
    await listServices(ctx);
    const small = [
      mocks.getServiceHealthStats.mock.calls.length,
      mocks.getOperationStats.mock.calls.length,
      mocks.querySpans.mock.calls.length,
      mocks.run.mock.calls.length,
    ];
    vi.clearAllMocks();
    setup(150);
    await listServices(ctx);
    const big = [
      mocks.getServiceHealthStats.mock.calls.length,
      mocks.getOperationStats.mock.calls.length,
      mocks.querySpans.mock.calls.length,
      mocks.run.mock.calls.length,
    ];
    expect(big).toEqual(small);
  });

  it('headline is the window rate of entry spans and the spark comes from entry spans too', async () => {
    mocks.getMetricSources.mockResolvedValue({ sources: [] });
    mocks.getServiceHealthStats.mockResolvedValue([
      { serviceName: 'api', totalCalls: 99999, totalErrors: 99999, avgLatencyMs: 1, p95LatencyMs: 1 },
    ]);
    // 36 entry calls in 6 h: 0.0016 req/s, not 0, and every slice reports 1.5 calls.
    mocks.getOperationStats.mockImplementation(async (p: any) => {
      const span = p.to.getTime() - p.from.getTime();
      return [op('api', span > 3_600_000 * 5 ? 36 : 1, 0)];
    });
    const [api] = await listServices(ctx);
    expect(api.requestRate.value).toBeCloseTo(36 / (6 * 3600), 6);
    expect(api.requestRate.value).toBeGreaterThan(0);
    expect(api.requestRate.spark).toHaveLength(24);
    expect(api.requestRate.spark.every((v) => v !== null && v > 0)).toBe(true);
    // 1 entry call in a quarter of an hour slice
    expect(api.requestRate.spark[0]).toBeCloseTo(1 / (6 * 3600 / 24), 4);
    expect(api.errorRate.value).toBe(0);
  });

  it('lastSeen is the newest span time, not a bucket end', async () => {
    setup(1);
    const newest = new Date(to.getTime() - 4 * 60_000 - 17_000);
    mocks.getMetricSources.mockResolvedValue({ sources: [] });
    mocks.querySpans.mockResolvedValue({
      spans: [{ serviceName: 'svc-0', endTime: newest }, { serviceName: 'svc-0', endTime: new Date(newest.getTime() - 1000) }],
      total: 2,
      hasMore: false,
      limit: 100,
      offset: 0,
    });
    const [svc] = await listServices(ctx);
    expect(svc.lastSeen).toBe(newest.toISOString());
    expect(svc.status).toBe('ok');
    const call = mocks.querySpans.mock.calls[0][0];
    expect(call).toMatchObject({ sortBy: 'end_time', sortOrder: 'desc', projectId: P1 });
  });

  it('a service missing from the newest spans is looked up again, bounded rounds', async () => {
    setup(3);
    mocks.getMetricSources.mockResolvedValue({ sources: [] });
    const t = (min: number) => new Date(to.getTime() - min * 60_000);
    // Round 1 only shows svc-0; round 2 shows svc-1; svc-2 never shows up.
    mocks.querySpans.mockImplementation(async (p: any) => {
      const wanted: string[] = p.serviceName;
      const first = wanted.includes('svc-0') ? 'svc-0' : wanted.includes('svc-1') ? 'svc-1' : null;
      return {
        spans: first ? [{ serviceName: first, endTime: t(first === 'svc-0' ? 1 : 20) }] : [],
        total: 0,
        hasMore: false,
        limit: 100,
        offset: 0,
      };
    });
    const list = await listServices(ctx);
    const by = Object.fromEntries(list.map((s) => [s.name, s]));
    expect(by['svc-0'].lastSeen).toBe(t(1).toISOString());
    expect(by['svc-1'].lastSeen).toBe(t(20).toISOString());
    expect(mocks.querySpans.mock.calls.length).toBeLessThanOrEqual(5);
    // svc-2 is reported no fresher than its newest active slice start
    expect(new Date(by['svc-2'].lastSeen).getTime()).toBeLessThanOrEqual(to.getTime());
  });

  it('one HTTP metrics query per semconv variant for all services without spans', async () => {
    const names = Array.from({ length: 120 }, (_, i) => `http-${i}`);
    mocks.getMetricSources.mockResolvedValue({ sources: names.map((n) => metricSource(n)) });
    mocks.getServiceHealthStats.mockResolvedValue([]);
    await listServices(ctx);
    // new and legacy semconv name, nothing per chunk
    expect(mocks.run).toHaveBeenCalledTimes(2);
    expect(mocks.run.mock.calls[0][0].queries[0].filters[0].values).toHaveLength(120);
    expect(mocks.run.mock.calls[0][0].queries[0].limit).toBe(120);
  });
});

describe('large fleets (N1)', () => {
  const hostsOf = (n: number) => Array.from({ length: n }, (_, i) => `host-${i}`);

  it('200 hosts x 10 mountpoints: raw series cap raised, every host gets every signal', async () => {
    const hosts = hostsOf(200);
    mocks.getMetricSources.mockResolvedValue({ sources: hosts.map((h) => metricSource(h)) });
    // The query service returns one series per host (the space aggregation already folded the 10 mounts).
    mocks.run.mockImplementation(async (q: any) => ({
      series: hosts.map((h, i) => ({
        queryId: 'A',
        labels: { 'resource.host.name': h },
        points: [{ t: 1, v: i }, { t: 2, v: i + 1 }],
        stats: {},
      })),
      interval: '15m',
      queries: [],
      warnings: [],
    }));
    const list = await listHosts(ctx);
    expect(list).toHaveLength(200);
    expect(mocks.run).toHaveBeenCalledTimes(5);
    for (const [q] of mocks.run.mock.calls) {
      expect(q.internal.maxSeries).toBe(200);
      expect(q.internal.maxRawSeries).toBeGreaterThanOrEqual(2000);
      expect(q.queries[0].limit).toBe(200);
    }
    for (const [i, h] of list.entries()) {
      expect(h.cpu.value).toBe(i + 1);
      expect(h.disk.value).toBe(i + 1);
      expect(h.network.value).toBe(i + 1);
    }
  });

  it('chunks hosts above the per query series limit and merges the results', async () => {
    const hosts = hostsOf(1200);
    mocks.getMetricSources.mockResolvedValue({ sources: hosts.map((h) => metricSource(h)) });
    mocks.run.mockImplementation(async (q: any) => {
      const filter = q.queries[0].filters.find((f: any) => f.op === 'in' && f.key === 'host.name');
      return {
        series: (filter.values as string[]).map((h) => ({
          queryId: 'A',
          labels: { 'resource.host.name': h },
          points: [{ t: 1, v: 7 }],
          stats: {},
        })),
        interval: '15m',
        queries: [],
        warnings: [],
      };
    });
    const list = await listHosts(ctx);
    expect(mocks.run).toHaveBeenCalledTimes(15);
    for (const [q] of mocks.run.mock.calls) expect(q.internal.maxSeries).toBeLessThanOrEqual(500);
    expect(list.every((h) => h.cpu.value === 7)).toBe(true);
  });

  it('service metric RED asks for the raw series cap too', async () => {
    const names = Array.from({ length: 80 }, (_, i) => `http-${i}`);
    mocks.getMetricSources.mockResolvedValue({ sources: names.map((n) => metricSource(n)) });
    mocks.getServiceHealthStats.mockResolvedValue([]);
    await listServices(ctx);
    for (const [q] of mocks.run.mock.calls) {
      expect(q.internal.maxSeries).toBe(80);
      expect(q.internal.maxRawSeries).toBeGreaterThanOrEqual(2000);
    }
  });
});

describe('entry span stats per service (N3)', () => {
  it('a service without entry spans in a project that has some gets its own call', async () => {
    mocks.getMetricSources.mockResolvedValue({ sources: [] });
    mocks.getServiceHealthStats.mockResolvedValue([
      { serviceName: 'api', totalCalls: 100, totalErrors: 0, avgLatencyMs: 1, p95LatencyMs: 5 },
      { serviceName: 'worker', totalCalls: 50, totalErrors: 5, avgLatencyMs: 1, p95LatencyMs: 5 },
    ]);
    mocks.getOperationStats.mockImplementation(async (p: any) => {
      if (p.service === 'worker') return [op('worker', 50, 5)];
      return [op('api', 100, 0)];
    });
    const list = await listServices(ctx);
    const worker = list.find((s) => s.name === 'worker')!;
    expect(worker.requestRate.value).toBeCloseTo(50 / (6 * 3600), 6);
    expect(worker.requestRate.spark).toHaveLength(24);
    expect(worker.requestRate.spark.some((v) => v !== null && v > 0)).toBe(true);
    expect(worker.errorRate.value).toBeCloseTo(10, 5);
    const perService = mocks.getOperationStats.mock.calls.filter(([p]) => p.service === 'worker');
    expect(perService.length).toBe(1 + 24);
    // list and detail share the computation
    const [detail] = [await getServiceDetail(ctx, 'worker')];
    expect(detail!.requestRate.value).toBe(worker.requestRate.value);
  });

  it('a project that hits the operation limit is computed per service', async () => {
    mocks.getMetricSources.mockResolvedValue({ sources: [] });
    mocks.getServiceHealthStats.mockResolvedValue([
      { serviceName: 'a', totalCalls: 10, totalErrors: 0, avgLatencyMs: 1, p95LatencyMs: 5 },
      { serviceName: 'b', totalCalls: 10, totalErrors: 0, avgLatencyMs: 1, p95LatencyMs: 5 },
    ]);
    mocks.getOperationStats.mockImplementation(async (p: any) => {
      if (p.service) return [op(p.service, 77, 0)];
      return Array.from({ length: 500 }, () => op('a', 1, 0));
    });
    const list = await listServices(ctx);
    const calls = (n: string) => list.find((s) => s.name === n)!.requestRate.value! * 6 * 3600;
    expect(calls('a')).toBeCloseTo(77, 3);
    expect(calls('b')).toBeCloseTo(77, 3);
  });
});

describe('lastSeen without a newest-span hit (N9)', () => {
  it('resolves an unresolved service with its own bounded query on end_time', async () => {
    mocks.getMetricSources.mockResolvedValue({ sources: [] });
    const names = Array.from({ length: 8 }, (_, i) => `svc-${i}`);
    mocks.getServiceHealthStats.mockResolvedValue(
      names.map((n) => ({ serviceName: n, totalCalls: 10, totalErrors: 0, avgLatencyMs: 1, p95LatencyMs: 5 })),
    );
    mocks.getOperationStats.mockResolvedValue(names.map((n) => op(n, 10)));
    const quietEnd = new Date(to.getTime() - 3 * 3_600_000);
    mocks.querySpans.mockImplementation(async (p: any) => {
      const wanted: string[] = p.serviceName;
      if (p.limit === 1) {
        return { spans: [{ serviceName: wanted[0], endTime: quietEnd }], total: 1, hasMore: false, limit: 1, offset: 0 };
      }
      // each batched round only shows the first still wanted service
      return {
        spans: [{ serviceName: wanted[0], endTime: new Date(to.getTime() - 1000) }],
        total: 1,
        hasMore: false,
        limit: 100,
        offset: 0,
      };
    });
    const list = await listServices(ctx);
    // 5 rounds resolve svc-0..4, the other three are looked up one by one
    for (const n of ['svc-5', 'svc-6', 'svc-7']) {
      expect(list.find((s) => s.name === n)!.lastSeen).toBe(quietEnd.toISOString());
    }
    const singles = mocks.querySpans.mock.calls.filter(([p]) => p.limit === 1);
    expect(singles).toHaveLength(3);
    expect(singles[0][0]).toMatchObject({ sortBy: 'end_time', sortOrder: 'desc' });
  });
});

describe('mixturePercentile missing quantiles (N11)', () => {
  it('never returns NaN when an engine omits p99 or p50', () => {
    const noP99 = { count: 10, p50Ms: 5, p95Ms: 40 } as any;
    const noP50 = { count: 10, p95Ms: 40, p99Ms: 80 } as any;
    const nan = { count: 10, p50Ms: NaN, p95Ms: 40, p99Ms: NaN };
    for (const o of [[noP99], [noP50], [nan], [noP99, noP50, nan]]) {
      for (const q of [0.5, 0.95, 0.99]) {
        const v = mixturePercentile(o, q);
        expect(v).not.toBeNull();
        expect(Number.isFinite(v!)).toBe(true);
      }
    }
    expect(mixturePercentile([noP99], 0.95)).toBe(40);
  });

  it('ignores operations with no usable quantile or count', () => {
    expect(mixturePercentile([{ count: 5 } as any], 0.95)).toBeNull();
    expect(mixturePercentile([{ count: NaN, p95Ms: 3 } as any], 0.95)).toBeNull();
    expect(mixturePercentile([{ count: 5 } as any, { count: 5, p50Ms: 1, p95Ms: 2, p99Ms: 3 }], 0.95)).toBe(2);
  });
});

describe('buildCustomizeInput', () => {
  it('keeps $ patterns of the source name literal', () => {
    const input = buildCustomizeInput('host', "a$&b$'c$1", ORG, [], null);
    expect(input.name).toBe("a$&b$'c$1 resources");
    expect(input.variables?.[0].default).toBe("a$&b$'c$1");
  });

  it('keeps the dashboard name within the 200 character cap', () => {
    const input = buildCustomizeInput('service', 'x'.repeat(500), ORG, [], null);
    expect(input.name.length).toBeLessThanOrEqual(200);
    expect(input.name.endsWith(' overview')).toBe(true);
  });
});
