import { describe, it, expect, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';

const ORG = '11111111-1111-4111-8111-111111111111';
const OTHER_ORG = '22222222-2222-4222-8222-222222222222';
const P1 = '33333333-3333-4333-8333-333333333333';

const mocks = vi.hoisted(() => ({
  run: vi.fn(),
  resolveProjectScope: vi.fn(),
  getMetricSources: vi.fn(),
  getMetricNames: vi.fn(),
  getServiceHealthStats: vi.fn(),
  getOperationStats: vi.fn(),
  querySpans: vi.fn(),
  create: vi.fn(),
  assertWithinLimit: vi.fn(),
  hardwareRows: [] as any[],
  FakeScopeError: class FakeScopeError extends Error {},
}));
const FakeScopeError = mocks.FakeScopeError;

vi.mock('../../../../modules/auth/middleware.js', () => ({
  authenticate: async (request: any) => {
    request.user = { id: 'user-1' };
  },
}));
vi.mock('../../../../modules/organizations/service.js', () => ({
  OrganizationsService: class {
    async getUserOrganizations() {
      return [{ id: ORG }];
    }
  },
}));
vi.mock('../../../../modules/metrics/query/service.js', () => ({
  MetricScopeError: mocks.FakeScopeError,
  resolveProjectScope: mocks.resolveProjectScope,
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
  const chain: any = {
    select: () => chain,
    where: () => chain,
    execute: async () => mocks.hardwareRows,
  };
  return { db: { selectFrom: () => chain } };
});
vi.mock('../../../../modules/custom-dashboards/service.js', () => ({
  customDashboardsService: { create: mocks.create, countForOrg: async () => 0 },
}));
vi.mock('../../../../modules/audit-log/service.js', () => ({ auditLogService: { record: async () => {} } }));
vi.mock('../../../../capabilities/index.js', () => ({
  assertWithinLimit: mocks.assertWithinLimit,
  withLimitLock: async (_o: string, _k: string, fn: () => Promise<unknown>) => fn(),
}));
vi.mock('@logtide/shared/context', () => ({
  context: {
    runAsSystem: async (_r: string, fn: () => Promise<unknown>) => fn(),
    with: async (_c: unknown, fn: () => Promise<unknown>) => fn(),
  },
}));

import { sourcesRoutes } from '../../../../modules/metrics/sources/routes.js';

const seen = new Date(Date.now() - 60_000);

function source(value: string, co: Record<string, string[]> = {}) {
  return { value, projectIds: [P1], lastSeen: seen, metricCount: 3, pointCount: 10, co };
}

function seriesFor(metric: string, host: string, values: Array<number | null>) {
  return {
    id: `A|${host}`,
    queryId: 'A',
    labels: { 'resource.host.name': host },
    name: host,
    unit: null,
    comparison: false,
    points: values.map((v, i) => ({ t: new Date(i * 1000).toISOString(), v })),
    stats: { min: null, avg: null, max: null, last: values[values.length - 1] },
    metric,
  };
}

async function app() {
  const f = Fastify();
  await f.register(sourcesRoutes, { prefix: '/sources' });
  await f.ready();
  return f;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.hardwareRows = [];
  mocks.resolveProjectScope.mockResolvedValue([P1]);
  mocks.getMetricSources.mockImplementation(async (p: any) => {
    if (p.key === 'host.name') {
      return { sources: [source('web-1', { 'service.name': ['api', 'agent'] }), source('db-1')] };
    }
    // service.name
    return { sources: [source('api', { 'host.name': ['web-1'] })] };
  });
  mocks.run.mockImplementation(async (q: any) => {
    const m = q.queries[0].metricName as string;
    if (m === 'system.filesystem.utilization') {
      return { series: [seriesFor(m, 'web-1', [50, 93]), seriesFor(m, 'db-1', [10, null])], interval: '15m', queries: [], warnings: [] };
    }
    if (m === 'system.cpu.utilization.total') {
      return { series: [seriesFor(m, 'web-1', [10, 20, null])], interval: '15m', queries: [], warnings: [] };
    }
    return { series: [], interval: '15m', queries: [], warnings: [] };
  });
  mocks.getServiceHealthStats.mockResolvedValue([
    { serviceName: 'api', totalCalls: 600, totalErrors: 60, avgLatencyMs: 10, p95LatencyMs: 120 },
    { serviceName: 'batch', totalCalls: 100, totalErrors: 0, avgLatencyMs: 10, p95LatencyMs: 40 },
  ]);
  // Entry spans: api has 3 operations, batch is not reported (falls back to health stats).
  mocks.getOperationStats.mockResolvedValue([
    { service: 'api', operation: 'GET /a', count: 400, errorCount: 40, avgMs: 20, p50Ms: 10, p95Ms: 100, p99Ms: 150 },
    { service: 'api', operation: 'GET /b', count: 200, errorCount: 20, avgMs: 20, p50Ms: 10, p95Ms: 100, p99Ms: 150 },
  ]);
  mocks.querySpans.mockImplementation(async (p: any) => ({
    spans: (p.serviceName as string[]).map((serviceName, i) => ({
      serviceName,
      endTime: new Date(seen.getTime() - i * 1000),
    })),
    total: 0,
    hasMore: false,
    limit: 100,
    offset: 0,
  }));
  mocks.getMetricNames.mockResolvedValue({
    names: [
      { name: 'system.cpu.utilization', type: 'gauge' },
      { name: 'system.cpu.utilization.total', type: 'gauge' },
      { name: 'v8js.memory.heap.used', type: 'gauge' },
    ],
  });
  mocks.create.mockResolvedValue({ id: 'dash-1', name: 'x' });
});

const q = (extra = '') => `?organizationId=${ORG}${extra}`;

describe('GET /sources', () => {
  it('lists hosts with signals and status, services with RED', async () => {
    const f = await app();
    const res = await f.inject({ method: 'GET', url: `/sources${q()}` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const web = body.hosts.find((h: any) => h.name === 'web-1');
    expect(web.disk.value).toBe(93);
    expect(web.disk.unit).toBe('%');
    expect(web.cpu.value).toBe(20);
    expect(web.cpu.spark).toEqual([10, 20, null]);
    expect(web.status).toBe('critical');
    expect(web.statusReason).toBe('Disk at 93%');
    // "agent" is not a real service
    expect(web.services).toEqual(['api']);
    const db = body.hosts.find((h: any) => h.name === 'db-1');
    expect(db.status).toBe('ok');
    expect(db.memory.value).toBeNull();

    const api = body.services.find((s: any) => s.name === 'api');
    expect(api.hasTraces).toBe(true);
    expect(api.errorRate.value).toBeCloseTo(10);
    expect(api.status).toBe('critical');
    expect(api.p95.value).toBeCloseTo(100, 1);
    expect(api.hosts).toEqual(['web-1']);
    // Span-only service is included
    const batch = body.services.find((s: any) => s.name === 'batch');
    expect(batch.metricCount).toBe(0);
    expect(batch.hasTraces).toBe(true);
  });

  it('excludes agent services via excludeMetricPrefixes and passes the project scope', async () => {
    const f = await app();
    await f.inject({ method: 'GET', url: `/sources${q()}` });
    const serviceCalls = mocks.getMetricSources.mock.calls.filter((c) => c[0].key === 'service.name');
    expect(serviceCalls.length).toBeGreaterThan(0);
    for (const c of serviceCalls) expect(c[0].excludeMetricPrefixes).toEqual(['system.', 'hw.']);
    expect(mocks.resolveProjectScope).toHaveBeenCalledWith(ORG, 'user-1', null);
    expect(mocks.getMetricSources.mock.calls[0][0].projectId).toEqual([P1]);
  });

  it('joins hardware rows: worst wins, hardware critical surfaces', async () => {
    mocks.hardwareRows = [
      { id: 'hw-1', project_id: P1, host_name: 'db-1', status: 'critical', is_virtual: false, info: { kernel: '6.1.0' }, findings: [{ severity: 'critical', message: 'disk failing' }] },
    ];
    const f = await app();
    const body = (await f.inject({ method: 'GET', url: `/sources${q()}` })).json();
    const dbHost = body.hosts.find((h: any) => h.name === 'db-1');
    expect(dbHost.hardwareStatus).toBe('critical');
    expect(dbHost.hardwareHosts).toEqual([{ projectId: P1, id: 'hw-1', isVirtual: false }]);
    expect(dbHost.status).toBe('critical');
    expect(dbHost.statusReason).toBe('Hardware: disk failing');
    expect(dbHost.os).toBe('6.1.0');
  });

  it('is stale when the host sent nothing recently', async () => {
    mocks.getMetricSources.mockImplementation(async (p: any) =>
      p.key === 'host.name'
        ? { sources: [{ ...source('old'), lastSeen: new Date(Date.now() - 20 * 60_000) }] }
        : { sources: [] },
    );
    mocks.getServiceHealthStats.mockResolvedValue([]);
    const f = await app();
    const body = (await f.inject({ method: 'GET', url: `/sources${q()}` })).json();
    expect(body.hosts[0].status).toBe('stale');
    expect(body.hosts[0].statusReason).toMatch(/^No data for 2\d min$/);
  });

  it('parses explicit projectIds', async () => {
    const f = await app();
    await f.inject({ method: 'GET', url: `/sources${q(`&projectIds=${P1}`)}` });
    expect(mocks.resolveProjectScope).toHaveBeenCalledWith(ORG, 'user-1', [P1]);
  });

  it('403 for an organization the user is not a member of', async () => {
    const f = await app();
    const res = await f.inject({ method: 'GET', url: `/sources?organizationId=${OTHER_ORG}` });
    expect(res.statusCode).toBe(403);
    expect(mocks.getMetricSources).not.toHaveBeenCalled();
  });

  it('403 when the project scope is rejected', async () => {
    mocks.resolveProjectScope.mockRejectedValue(new FakeScopeError('Project does not belong to the organization'));
    const f = await app();
    const res = await f.inject({ method: 'GET', url: `/sources${q(`&projectIds=${P1}`)}` });
    expect(res.statusCode).toBe(403);
  });

  it('400 for a bad organizationId, bad project ids or reversed window', async () => {
    const f = await app();
    expect((await f.inject({ method: 'GET', url: '/sources?organizationId=nope' })).statusCode).toBe(400);
    expect((await f.inject({ method: 'GET', url: `/sources${q('&projectIds=zzz')}` })).statusCode).toBe(400);
    expect(
      (await f.inject({ method: 'GET', url: `/sources${q('&from=2026-01-02T00:00:00Z&to=2026-01-01T00:00:00Z')}` })).statusCode,
    ).toBe(400);
  });

  it('empty scope returns empty lists without touching the reservoir', async () => {
    mocks.resolveProjectScope.mockResolvedValue([]);
    mocks.getServiceHealthStats.mockResolvedValue([]);
    const f = await app();
    const body = (await f.inject({ method: 'GET', url: `/sources${q()}` })).json();
    expect(body).toEqual({ hosts: [], services: [] });
    expect(mocks.getMetricSources).not.toHaveBeenCalled();
  });
});

describe('detail endpoints', () => {
  it('host detail: info and metric names (one filtered reservoir call)', async () => {
    mocks.hardwareRows = [
      { id: 'hw-1', project_id: P1, host_name: 'web-1', status: 'ok', is_virtual: true, info: { kernel: '6.1', vendor: 'Dell', model: 'R1', agentVersion: '1.1.0' }, findings: [] },
    ];
    mocks.run.mockImplementation(async (q: any) => {
      if (q.queries[0].metricName === 'hw.memory.size') {
        return {
          series: [
            { queryId: 'A', comparison: false, labels: {}, points: [], stats: { last: 8e9 } },
            { queryId: 'B', comparison: false, labels: {}, points: [], stats: { last: 3600 } },
          ],
          interval: '15m', queries: [], warnings: [],
        };
      }
      return { series: [], interval: '15m', queries: [], warnings: [] };
    });
    // The reservoir filters names by the host's resource attribute.
    mocks.getMetricNames.mockResolvedValue({ names: [{ name: 'system.cpu.utilization.total', type: 'gauge' }] });
    mocks.getMetricSources.mockResolvedValue({ sources: [source('web-1')] });
    const f = await app();
    const res = await f.inject({ method: 'GET', url: `/sources/host/web-1${q()}` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.info).toMatchObject({ kernel: '6.1', vendor: 'Dell', model: 'R1', agentVersion: '1.1.0', virtual: true, memoryBytes: 8e9, uptimeSeconds: 3600 });
    expect(body.metricNames).toEqual(['system.cpu.utilization.total']);
    expect(mocks.getMetricNames.mock.calls[0][0].filters).toEqual([{ scope: 'resource', key: 'host.name', op: 'eq', values: ['web-1'] }]);
  });

  it('host detail 404 when unknown', async () => {
    const f = await app();
    const res = await f.inject({ method: 'GET', url: `/sources/host/ghost${q()}` });
    expect(res.statusCode).toBe(404);
  });

  it('service detail and 404', async () => {
    const f = await app();
    const ok = await f.inject({ method: 'GET', url: `/sources/service/api${q()}` });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().name).toBe('api');
    expect(Array.isArray(ok.json().metricNames)).toBe(true);
    const missing = await f.inject({ method: 'GET', url: `/sources/service/ghost${q()}` });
    expect(missing.statusCode).toBe(404);
  });

  it('detail is org isolated', async () => {
    const f = await app();
    const res = await f.inject({ method: 'GET', url: `/sources/host/web-1?organizationId=${OTHER_ORG}` });
    expect(res.statusCode).toBe(403);
  });
});

describe('POST /sources/:kind/:name/customize', () => {
  beforeEach(() => {
    mocks.getMetricSources.mockImplementation(async () => ({ sources: [source('web-1')] }));
  });

  it('creates a dashboard from the template with the variable defaulting to the source', async () => {
    const f = await app();
    const res = await f.inject({
      method: 'POST',
      url: '/sources/host/web-1/customize',
      payload: { organizationId: ORG, projectIds: [P1] },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ dashboardId: 'dash-1' });
    const input = mocks.create.mock.calls[0][0];
    expect(input.name).toBe('web-1 resources');
    expect(input.variables).toEqual([
      { name: 'host', label: 'Host', attr: { scope: 'resource', key: 'host.name' }, metricName: null, default: 'web-1' },
    ]);
    expect(input.panels.length).toBeGreaterThan(0);
    for (const p of input.panels) expect(p.config.query.projectIds).toEqual([P1]);
    expect(mocks.create.mock.calls[0][1]).toBe('user-1');
  });

  it('service template keeps trace panels and null projects means all', async () => {
    const f = await app();
    const res = await f.inject({
      method: 'POST',
      url: '/sources/service/api/customize',
      payload: { organizationId: ORG },
    });
    expect(res.statusCode).toBe(201);
    const input = mocks.create.mock.calls[0][0];
    expect(input.name).toBe('api overview');
    expect(input.panels.some((p: any) => p.config.type === 'trace_volume' && p.config.projectId === null)).toBe(true);
  });

  it('propagates a capability error', async () => {
    mocks.assertWithinLimit.mockRejectedValue(Object.assign(new Error('limit'), { name: 'CapabilityError' }));
    const f = await app();
    const res = await f.inject({
      method: 'POST',
      url: '/sources/host/web-1/customize',
      payload: { organizationId: ORG },
    });
    expect(res.statusCode).toBe(500);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('403 for another organization and for a rejected scope, 400 for a bad kind', async () => {
    const f = await app();
    expect(
      (await f.inject({ method: 'POST', url: '/sources/host/web-1/customize', payload: { organizationId: OTHER_ORG } })).statusCode,
    ).toBe(403);
    mocks.resolveProjectScope.mockRejectedValue(new FakeScopeError('nope'));
    expect(
      (await f.inject({ method: 'POST', url: '/sources/host/web-1/customize', payload: { organizationId: ORG, projectIds: [P1] } })).statusCode,
    ).toBe(403);
    expect(
      (await f.inject({ method: 'POST', url: '/sources/pod/web-1/customize', payload: { organizationId: ORG } })).statusCode,
    ).toBe(400);
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
