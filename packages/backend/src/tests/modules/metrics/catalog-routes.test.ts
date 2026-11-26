import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { build } from '../../../server.js';
import { db } from '../../../database/index.js';
import { reservoir } from '../../../database/reservoir.js';
import { createTestContext, createTestProject, createTestSession } from '../../helpers/index.js';
import { resetMetricCatalogThrottle } from '../../../modules/metrics/catalog/registry.js';

// resolveProjectScope is implemented by the query service task; the routes
// only rely on its contract: null -> every project of the org, explicit ids
// must belong to it (MetricScopeError otherwise).
vi.mock('../../../modules/metrics/query/service.js', async () => {
  const { db: testDb } = await import('../../../database/index.js');
  class MetricScopeError extends Error {}
  return {
    MetricScopeError,
    MetricQueryValidationError: class extends Error {},
    metricQueryService: { run: vi.fn() },
    resolveProjectScope: vi.fn(async (organizationId: string, _userId: string, projectIds: string[] | null) => {
      const rows = await testDb
        .selectFrom('projects')
        .select('id')
        .where('organization_id', '=', organizationId)
        .where('deleted_at', 'is', null)
        .execute();
      const own = rows.map((r) => r.id);
      if (projectIds === null) return own;
      if (!projectIds.every((id) => own.includes(id))) throw new MetricScopeError('Project outside organization');
      return projectIds;
    }),
  };
});

const NOW = new Date();

async function seedCatalog(projectId: string, name: string, extra: Record<string, unknown> = {}) {
  await db
    .insertInto('metric_catalog')
    .values({
      project_id: projectId,
      metric_name: name,
      metric_type: 'gauge',
      unit: 'By',
      description: `${name} desc`,
      is_monotonic: null,
      first_seen_at: new Date(NOW.getTime() - 3600_000),
      last_seen_at: NOW,
      ...extra,
    })
    .execute();
}

describe('Metric catalog routes', () => {
  let app: any;
  let a: Awaited<ReturnType<typeof createTestContext>>;
  let b: Awaited<ReturnType<typeof createTestContext>>;
  let tokenA: string;
  let tokenB: string;

  beforeAll(async () => {
    app = await build();
    await app.ready();
  });

  beforeEach(async () => {
    resetMetricCatalogThrottle();
    a = await createTestContext();
    b = await createTestContext();
    tokenA = (await createTestSession(a.user.id)).token;
    tokenB = (await createTestSession(b.user.id)).token;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const get = (path: string, token: string, query: Record<string, unknown>) =>
    request(app.server).get(`/api/v1/metrics${path}`).set('Authorization', `Bearer ${token}`).query(query as never);

  describe('GET /catalog', () => {
    it('lists the metrics of the organization with search and prefix filters', async () => {
      await seedCatalog(a.project.id, 'system.cpu.utilization', { unit: '1' });
      await seedCatalog(a.project.id, 'system.memory.usage');
      await seedCatalog(a.project.id, 'http.server.duration', { unit: 'ms' });

      const all = await get('/catalog', tokenA, { organizationId: a.organization.id });
      expect(all.status).toBe(200);
      expect(all.body.metrics.map((m: any) => m.name)).toEqual([
        'http.server.duration',
        'system.cpu.utilization',
        'system.memory.usage',
      ]);
      expect(all.body.metrics[0]).toMatchObject({ type: 'gauge', unit: 'ms', projectIds: [a.project.id] });

      const search = await get('/catalog', tokenA, { organizationId: a.organization.id, search: 'MEMORY' });
      expect(search.body.metrics.map((m: any) => m.name)).toEqual(['system.memory.usage']);

      const prefix = await get('/catalog', tokenA, { organizationId: a.organization.id, prefix: 'system.' });
      expect(prefix.body.metrics).toHaveLength(2);

      // LIKE wildcards are literal
      const wild = await get('/catalog', tokenA, { organizationId: a.organization.id, search: '%' });
      expect(wild.body.metrics).toHaveLength(0);
    });

    it('filters by source: only the metrics a host or service sent', async () => {
      await seedCatalog(a.project.id, 'system.cpu.utilization', { unit: '1' });
      await seedCatalog(a.project.id, 'system.memory.usage');
      await seedCatalog(a.project.id, 'http.server.duration', { unit: 'ms' });
      const names = vi.spyOn(reservoir, 'getMetricNames').mockResolvedValue({
        names: [
          { name: 'system.memory.usage', type: 'gauge' },
          { name: 'system.cpu.utilization', type: 'gauge' },
        ],
      } as never);

      const host = await get('/catalog', tokenA, { organizationId: a.organization.id, source: 'host:vps-app' });
      expect(host.status).toBe(200);
      expect(host.body.metrics.map((m: any) => m.name)).toEqual(['system.cpu.utilization', 'system.memory.usage']);
      expect(names.mock.calls[0][0]).toMatchObject({
        projectId: [a.project.id],
        filters: [{ scope: 'resource', key: 'host.name', op: 'eq', values: ['vps-app'] }],
      });

      // combines with search; a name with a colon keeps it
      const svc = await get('/catalog', tokenA, { organizationId: a.organization.id, source: 'service:api:v2', search: 'memory' });
      expect(svc.body.metrics.map((m: any) => m.name)).toEqual(['system.memory.usage']);
      expect(names.mock.calls[1][0].filters).toEqual([{ scope: 'resource', key: 'service.name', op: 'eq', values: ['api:v2'] }]);

      names.mockResolvedValue({ names: [] } as never);
      const none = await get('/catalog', tokenA, { organizationId: a.organization.id, source: 'host:ghost' });
      expect(none.body.metrics).toEqual([]);

      const bad = await get('/catalog', tokenA, { organizationId: a.organization.id, source: 'pod:x' });
      expect(bad.status).toBe(400);
    });

    it('reports temporality, first non-null across projects', async () => {
      const second = (await createTestProject({ organizationId: a.organization.id, userId: a.user.id })).id;
      await seedCatalog(a.project.id, 'http.server.request.duration', {
        metric_type: 'histogram',
        temporality: null,
        last_seen_at: NOW,
      });
      await seedCatalog(second, 'http.server.request.duration', {
        metric_type: 'histogram',
        temporality: 'delta',
        last_seen_at: new Date(NOW.getTime() - 60_000),
      });
      await seedCatalog(a.project.id, 'plain.gauge');
      const res = await get('/catalog', tokenA, { organizationId: a.organization.id });
      const byName = Object.fromEntries(res.body.metrics.map((m: any) => [m.name, m]));
      expect(byName['http.server.request.duration']).toMatchObject({ type: 'histogram', temporality: 'delta' });
      expect(byName['plain.gauge'].temporality).toBeNull();
    });

    it('merges projects and honors projectIds as comma list or repeated', async () => {
      const second = (await createTestProject({ organizationId: a.organization.id, userId: a.user.id })).id;
      await seedCatalog(a.project.id, 'shared.metric');
      await seedCatalog(second, 'shared.metric');
      await seedCatalog(second, 'only.second');

      const merged = await get('/catalog', tokenA, { organizationId: a.organization.id });
      const shared = merged.body.metrics.find((m: any) => m.name === 'shared.metric');
      expect(shared.projectIds.sort()).toEqual([a.project.id, second].sort());

      const one = await get('/catalog', tokenA, { organizationId: a.organization.id, projectIds: second });
      expect(one.body.metrics.map((m: any) => m.name)).toEqual(['only.second', 'shared.metric']);

      const comma = await get('/catalog', tokenA, {
        organizationId: a.organization.id,
        projectIds: `${a.project.id},${second}`,
      });
      expect(comma.body.metrics).toHaveLength(2);
      const repeated = await get('/catalog', tokenA, {
        organizationId: a.organization.id,
        projectIds: [a.project.id, second],
      });
      expect(repeated.body.metrics).toHaveLength(2);
    });

    it('rejects bad input', async () => {
      expect((await get('/catalog', tokenA, {})).status).toBe(400);
      expect((await get('/catalog', tokenA, { organizationId: a.organization.id, projectIds: 'nope' })).status).toBe(400);
    });

    it('requires a session', async () => {
      const res = await request(app.server).get('/api/v1/metrics/catalog').query({ organizationId: a.organization.id });
      expect([401, 403]).toContain(res.status);
      const apiKey = await request(app.server)
        .get('/api/v1/metrics/catalog')
        .set('x-api-key', a.apiKey.plainKey)
        .query({ organizationId: a.organization.id });
      expect([401, 403]).toContain(apiKey.status);
    });
  });

  describe('org isolation', () => {
    it('a user of org A cannot read the catalog of org B', async () => {
      await seedCatalog(b.project.id, 'secret.metric');

      const direct = await get('/catalog', tokenA, { organizationId: b.organization.id });
      expect(direct.status).toBe(403);

      const viaProject = await get('/catalog', tokenA, {
        organizationId: a.organization.id,
        projectIds: b.project.id,
      });
      expect(viaProject.status).toBe(403);

      const own = await get('/catalog', tokenA, { organizationId: a.organization.id });
      expect(own.body.metrics).toHaveLength(0);

      for (const [path, extra] of [
        ['/catalog/entry', { name: 'secret.metric' }],
        ['/attributes', { metricName: 'secret.metric' }],
        ['/attribute-values', { metricName: 'secret.metric', key: 'k' }],
      ] as const) {
        const res = await get(path, tokenA, { organizationId: b.organization.id, ...extra });
        expect(res.status).toBe(403);
      }

      const entryOwnOrg = await get('/catalog/entry', tokenA, { organizationId: a.organization.id, name: 'secret.metric' });
      expect(entryOwnOrg.status).toBe(404);

      const owner = await get('/catalog', tokenB, { organizationId: b.organization.id });
      expect(owner.body.metrics.map((m: any) => m.name)).toEqual(['secret.metric']);
    });

    it('does not report dashboards of another organization', async () => {
      await seedCatalog(a.project.id, 'shared.name');
      await db
        .insertInto('custom_dashboards')
        .values({
          organization_id: b.organization.id,
          project_id: null,
          created_by: b.user.id,
          name: 'B board',
          panels: JSON.stringify([metricsPanel('shared.name')]),
        } as never)
        .execute();
      vi.spyOn(reservoir, 'getMetricLabelKeys').mockResolvedValue({ keys: [] });
      const res = await get('/catalog/entry', tokenA, { organizationId: a.organization.id, name: 'shared.name' });
      expect(res.status).toBe(200);
      expect(res.body.usedIn.dashboards).toEqual([]);
    });
  });

  describe('GET /catalog/entry', () => {
    it('returns attributes, sources and dashboards', async () => {
      await seedCatalog(a.project.id, 'http.server.duration', { unit: 'ms' });
      const dash = await db
        .insertInto('custom_dashboards')
        .values({
          organization_id: a.organization.id,
          project_id: null,
          created_by: a.user.id,
          name: 'API board',
          panels: JSON.stringify([metricsPanel('http.server.duration'), metricsPanel('other.metric')]),
        } as never)
        .returning('id')
        .executeTakeFirstOrThrow();
      await db
        .insertInto('custom_dashboards')
        .values({
          organization_id: a.organization.id,
          project_id: null,
          created_by: a.user.id,
          name: 'Unrelated',
          panels: JSON.stringify([metricsPanel('other.metric')]),
        } as never)
        .execute();
      // personal dashboard of someone else must stay hidden
      const other = await createTestContext();
      await db
        .insertInto('custom_dashboards')
        .values({
          organization_id: a.organization.id,
          project_id: null,
          created_by: other.user.id,
          is_personal: true,
          name: 'Not mine',
          panels: JSON.stringify([metricsPanel('http.server.duration')]),
        } as never)
        .execute();

      const keys = vi.spyOn(reservoir, 'getMetricLabelKeys').mockImplementation(async (p: any) => ({
        keys: p.scope === 'resource' ? ['host.name', 'service.name'] : Array.from({ length: 40 }, (_, i) => `k${i}`),
      }));
      const values = vi.spyOn(reservoir, 'getMetricLabelValues').mockImplementation(async (p: any, key: string) => ({
        values: key === 'host.name' ? ['h1', 'h2'] : key === 'service.name' ? ['svc'] : ['v1', 'v2'],
      }));

      const res = await get('/catalog/entry', tokenA, { organizationId: a.organization.id, name: 'http.server.duration' });
      expect(res.status).toBe(200);
      expect(res.body.entry).toMatchObject({ name: 'http.server.duration', unit: 'ms', type: 'gauge' });
      expect(res.body.attributes.metric).toHaveLength(20);
      expect(res.body.attributes.metric[0]).toEqual({ key: 'k0', values: ['v1', 'v2'] });
      expect(res.body.attributes.resource.map((x: any) => x.key)).toEqual(['host.name', 'service.name']);
      expect(res.body.sources).toEqual({ hosts: ['h1', 'h2'], services: ['svc'] });
      expect(res.body.usedIn.dashboards).toEqual([{ id: dash.id, name: 'API board' }]);

      const metricKeysCall = keys.mock.calls.find((c) => (c[0] as any).scope === 'metric')![0] as any;
      expect(metricKeysCall).toMatchObject({
        organizationId: a.organization.id,
        projectId: [a.project.id],
        metricName: 'http.server.duration',
      });
      expect(values).toHaveBeenCalled();
    });

    it('bounds the reservoir fan-out and reuses host/service values', async () => {
      await seedCatalog(a.project.id, 'fan.out');
      let inFlight = 0;
      let peak = 0;
      const keys = vi.spyOn(reservoir, 'getMetricLabelKeys').mockImplementation(async (p: any) => ({
        keys: p.scope === 'resource'
          ? ['host.name', 'service.name', ...Array.from({ length: 60 }, (_, i) => `r${i}`)]
          : Array.from({ length: 60 }, (_, i) => `k${i}`),
      }));
      const values = vi.spyOn(reservoir, 'getMetricLabelValues').mockImplementation(async (_p: any, key: string) => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight--;
        return { values: key === 'host.name' ? ['h1'] : key === 'service.name' ? ['s1'] : ['v'] };
      });
      const res = await get('/catalog/entry', tokenA, { organizationId: a.organization.id, name: 'fan.out' });
      expect(res.status).toBe(200);
      expect(keys).toHaveBeenCalledTimes(2);
      // 2 source calls + 20 metric keys + 18 other resource keys (host/service reused)
      expect(values.mock.calls.length).toBe(2 + 20 + 18);
      expect(values.mock.calls.length).toBeLessThanOrEqual(44);
      expect(peak).toBeLessThanOrEqual(4);
      expect(res.body.attributes.resource[0]).toEqual({ key: 'host.name', values: ['h1'] });
      expect(res.body.sources).toEqual({ hosts: ['h1'], services: ['s1'] });
    });

    it('is 404 for an unknown metric and 400 without a name', async () => {
      expect((await get('/catalog/entry', tokenA, { organizationId: a.organization.id, name: 'nope' })).status).toBe(404);
      expect((await get('/catalog/entry', tokenA, { organizationId: a.organization.id })).status).toBe(400);
    });
  });

  describe('GET /attributes and /attribute-values', () => {
    it('passes scope and window to the reservoir', async () => {
      const keys = vi.spyOn(reservoir, 'getMetricLabelKeys').mockResolvedValue({ keys: ['host.name'] });
      const from = '2026-11-01T00:00:00.000Z';
      const to = '2026-11-02T00:00:00.000Z';
      const res = await get('/attributes', tokenA, {
        organizationId: a.organization.id,
        scope: 'resource',
        from,
        to,
      });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ keys: ['host.name'] });
      expect(keys.mock.calls[0][0]).toMatchObject({
        organizationId: a.organization.id,
        projectId: [a.project.id],
        metricName: '',
        scope: 'resource',
        from: new Date(from),
        to: new Date(to),
      });

      // metricName absent or '' means every metric for the metric scope too
      const metricScope = await get('/attributes', tokenA, { organizationId: a.organization.id });
      expect(metricScope.status).toBe(200);
      const empty = await get('/attributes', tokenA, { organizationId: a.organization.id, metricName: '' });
      expect(empty.status).toBe(200);
      expect((keys.mock.calls.at(-1)![0] as any).metricName).toBe('');
    });

    it('validates and caps the window', async () => {
      const keys = vi.spyOn(reservoir, 'getMetricLabelKeys').mockResolvedValue({ keys: [] });
      const q = { organizationId: a.organization.id, scope: 'resource' };
      const bad = [
        { from: '2026-11-02T00:00:00.000Z', to: '2026-11-01T00:00:00.000Z' },
        { from: '2026-11-01T00:00:00.000Z', to: '2026-11-01T00:00:00.000Z' },
        { from: '2026-09-01T00:00:00.000Z', to: '2026-11-01T00:00:00.000Z' },
        { from: new Date(Date.now() + 3600_000).toISOString() },
      ];
      for (const w of bad) {
        expect((await get('/attributes', tokenA, { ...q, ...w })).status).toBe(400);
        expect((await get('/attribute-values', tokenA, { ...q, key: 'host.name', ...w })).status).toBe(400);
      }
      expect(keys).not.toHaveBeenCalled();
      const ok = await get('/attributes', tokenA, {
        ...q,
        from: '2026-10-02T00:00:00.000Z',
        to: '2026-11-02T00:00:00.000Z',
      });
      expect(ok.status).toBe(200);
      // default window is 24h ending now
      await get('/attributes', tokenA, q);
      const call = keys.mock.calls.at(-1)![0] as any;
      expect(call.to.getTime() - call.from.getTime()).toBe(24 * 3600_000);
    });

    it('returns attribute values', async () => {
      const values = vi.spyOn(reservoir, 'getMetricLabelValues').mockResolvedValue({ values: ['x', 'y'] });
      const res = await get('/attribute-values', tokenA, {
        organizationId: a.organization.id,
        metricName: 'm',
        key: 'http.method',
      });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ values: ['x', 'y'] });
      expect(values.mock.calls[0][1]).toBe('http.method');
      expect((values.mock.calls[0][0] as any).scope).toBe('metric');

      expect((await get('/attribute-values', tokenA, { organizationId: a.organization.id, metricName: 'm' })).status).toBe(400);

      await get('/attribute-values', tokenA, { organizationId: a.organization.id, key: 'http.method' });
      expect(values.mock.calls.at(-1)![0]).toMatchObject({ metricName: '', scope: 'metric' });
    });
  });

  describe('ingest hook', () => {
    it('records type, unit and description from an OTLP push', async () => {
      const res = await request(app.server)
        .post('/v1/otlp/metrics')
        .set('x-api-key', a.apiKey.plainKey)
        .set('Content-Type', 'application/json')
        .send({
          resourceMetrics: [
            {
              resource: { attributes: [{ key: 'service.name', value: { stringValue: 'svc' } }] },
              scopeMetrics: [
                {
                  metrics: [
                    {
                      name: 'queue.depth',
                      unit: '{message}',
                      description: 'Messages waiting',
                      gauge: { dataPoints: [{ timeUnixNano: String(Date.now() * 1_000_000), asDouble: 3 }] },
                    },
                  ],
                },
              ],
            },
          ],
        });
      expect(res.status).toBeLessThan(300);

      let row: any;
      for (let i = 0; i < 50 && !row; i++) {
        row = await db
          .selectFrom('metric_catalog')
          .selectAll()
          .where('project_id', '=', a.project.id)
          .where('metric_name', '=', 'queue.depth')
          .executeTakeFirst();
        if (!row) await new Promise((r) => setTimeout(r, 50));
      }
      expect(row).toMatchObject({ metric_type: 'gauge', unit: '{message}', description: 'Messages waiting' });
    });

    it('records the temporality of a histogram from an OTLP push', async () => {
      const res = await request(app.server)
        .post('/v1/otlp/metrics')
        .set('x-api-key', a.apiKey.plainKey)
        .set('Content-Type', 'application/json')
        .send({
          resourceMetrics: [
            {
              resource: { attributes: [{ key: 'service.name', value: { stringValue: 'svc' } }] },
              scopeMetrics: [
                {
                  metrics: [
                    {
                      name: 'rpc.duration',
                      unit: 'ms',
                      histogram: {
                        aggregationTemporality: 1,
                        dataPoints: [
                          {
                            timeUnixNano: String(Date.now() * 1_000_000),
                            count: '2',
                            sum: 30,
                            bucketCounts: ['1', '1', '0'],
                            explicitBounds: [10, 100],
                          },
                        ],
                      },
                    },
                  ],
                },
              ],
            },
          ],
        });
      expect(res.status).toBeLessThan(300);

      let row: any;
      for (let i = 0; i < 50 && !row; i++) {
        row = await db
          .selectFrom('metric_catalog')
          .selectAll()
          .where('project_id', '=', a.project.id)
          .where('metric_name', '=', 'rpc.duration')
          .executeTakeFirst();
        if (!row) await new Promise((r) => setTimeout(r, 50));
      }
      expect(row).toMatchObject({ metric_type: 'histogram', unit: 'ms', temporality: 'delta' });
    });
  });
});

function metricsPanel(metricName: string) {
  return {
    id: crypto.randomUUID(),
    layout: { x: 0, y: 0, w: 6, h: 4 },
    config: {
      type: 'metrics',
      title: 'p',
      source: 'metrics',
      timeRange: '1h',
      query: {
        projectIds: null,
        queries: [{ id: 'A', metricName, aggregation: 'avg', filters: [], groupBy: [] }],
        formulas: [],
        interval: 'auto',
        compareTo: 'none',
        display: 'lines',
      },
    },
  };
}
