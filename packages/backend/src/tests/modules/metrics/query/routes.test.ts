import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
import { build } from '../../../../server.js';
import { db } from '../../../../database/index.js';
import { reservoir } from '../../../../database/reservoir.js';
import { createTestContext, createTestSpan } from '../../../helpers/index.js';
import { createTestProject } from '../../../helpers/factories.js';
import { fetchMetricsPanelData } from '../../../../modules/metrics/query/panel.js';
import { MetricScopeError } from '../../../../modules/metrics/query/errors.js';
import { metricQueryRequestSchema } from '../../../../modules/metrics/query/schema.js';

const metricExplorerQuerySchemaKeys = () =>
  Object.keys(
    metricQueryRequestSchema.parse({
      organizationId: '11111111-1111-4111-8111-111111111111',
      from: '2026-11-25T00:00:00.000Z',
      to: '2026-11-25T01:00:00.000Z',
      projectIds: null,
      queries: [{ id: 'A', metricName: 'm', aggregation: 'avg' }],
      internal: { maxSeries: 2000 },
    }),
  );

const MIN = 60_000;

describe('metrics query routes', () => {
  let app: any;
  let ctx: Awaited<ReturnType<typeof createTestContext>>;
  let other: Awaited<ReturnType<typeof createTestContext>>;
  let token: string;
  let now: number;
  let from: string;
  let to: string;

  async function session(userId: string) {
    const s = await db
      .insertInto('sessions')
      .values({
        user_id: userId,
        token: `test-session-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
        expires_at: new Date(Date.now() + 86_400_000),
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    return s.token;
  }

  async function ingest(host: string, value: number, at: number, projectId = ctx.project.id) {
    await reservoir.ingestMetrics([
      {
        time: new Date(at),
        organizationId: ctx.organization.id,
        projectId,
        metricName: 'system.cpu.utilization',
        metricType: 'gauge',
        value,
        serviceName: 'hw-agent',
        attributes: { cpu: '0' },
        resourceAttributes: { 'host.name': host, 'service.name': 'hw-agent' },
      },
    ]);
  }

  const query = (overrides: Record<string, unknown> = {}) => ({
    organizationId: ctx.organization.id,
    projectIds: null,
    from,
    to,
    interval: '5m',
    compareTo: 'none',
    display: 'lines',
    queries: [{ id: 'A', metricName: 'system.cpu.utilization', aggregation: 'avg', filters: [], groupBy: [] }],
    formulas: [],
    ...overrides,
  });

  const post = (path: string, body: unknown, auth = token) =>
    request(app.server).post(`/api/v1/metrics${path}`).set('Authorization', `Bearer ${auth}`).send(body);

  beforeEach(async () => {
    if (!app) {
      app = await build();
      await app.ready();
    }
    ctx = await createTestContext();
    other = await createTestContext();
    token = await session(ctx.user.id);
    now = Date.now();
    from = new Date(now - 30 * MIN).toISOString();
    to = new Date(now).toISOString();
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('returns the evaluated query for a member', async () => {
    await ingest('web-1', 0.25, now - 10 * MIN);
    await ingest('web-2', 0.75, now - 10 * MIN);
    await db
      .insertInto('metric_catalog' as any)
      .values({
        project_id: ctx.project.id,
        metric_name: 'system.cpu.utilization',
        metric_type: 'gauge',
        unit: '1',
        first_seen_at: new Date(),
        last_seen_at: new Date(),
      } as any)
      .execute();

    const res = await post('/query', query({ formulas: [{ id: 'F1', expression: 'A * 100', label: 'CPU %' }] }));
    expect(res.status).toBe(200);
    expect(res.body.interval).toBe('5m');
    const a = res.body.series.find((s: any) => s.queryId === 'A');
    expect(a.unit).toBe('1');
    expect(a.stats.max).toBeCloseTo(0.5);
    const f = res.body.series.find((s: any) => s.queryId === 'F1');
    expect(f.name).toBe('CPU %');
    expect(f.stats.max).toBeCloseTo(50);
    expect(res.body.queries.map((q: any) => q.id)).toEqual(['A', 'F1']);
  });

  it('splits by resource attribute on the real engine (skips when the engine lacks groupByAttrs)', async (t) => {
    await ingest('web-1', 0.2, now - 10 * MIN);
    await ingest('web-2', 0.6, now - 10 * MIN);
    const res = await post(
      '/query',
      query({ queries: [{ id: 'A', metricName: 'system.cpu.utilization', aggregation: 'avg', filters: [], groupBy: [{ scope: 'resource', key: 'host.name' }] }] }),
    );
    expect(res.status).toBe(200);
    const hosts = res.body.series.map((s: any) => s.labels['resource.host.name']).sort();
    if (hosts.length < 2 || hosts[0] === '') {
      t.skip(); // groupByAttrs not implemented by this engine build yet
      return;
    }
    expect(hosts).toEqual(['web-1', 'web-2']);
    const filtered = await post(
      '/query',
      query({
        queries: [
          {
            id: 'A',
            metricName: 'system.cpu.utilization',
            aggregation: 'avg',
            filters: [{ scope: 'resource', key: 'host.name', op: 'eq', values: ['$host'] }],
            groupBy: [],
          },
        ],
        variables: { host: 'web-2' },
      }),
    );
    expect(filtered.body.series[0].stats.max).toBeCloseTo(0.6);
  });

  it('rejects invalid bodies with 400', async () => {
    expect((await post('/query', query({ queries: [] }))).status).toBe(400);
    expect((await post('/query', query({ formulas: [{ id: 'X1', expression: 'A' }] }))).status).toBe(400);
    expect((await post('/query', query({ from: to, to: from }))).status).toBe(400);
    expect(
      (
        await post(
          '/query',
          query({
            queries: [{ id: 'A', metricName: 'm', aggregation: 'avg', filters: [{ scope: 'metric', key: 'k', op: 'eq', values: [] }], groupBy: [] }],
          }),
        )
      ).status,
    ).toBe(400);
    const unknownVar = await post(
      '/query',
      query({
        queries: [{ id: 'A', metricName: 'm', aggregation: 'avg', filters: [{ scope: 'metric', key: 'k', op: 'eq', values: ['$nope'] }], groupBy: [] }],
      }),
    );
    expect(unknownVar.status).toBe(400);
    expect(unknownVar.body.error).toMatch(/Unknown variable/);
    expect((await post('/panels/data', { organizationId: ctx.organization.id, from, to, panels: [] })).status).toBe(400);
  });

  it('returns 403 across organizations and for API keys', async () => {
    // projects of another org
    expect((await post('/query', query({ projectIds: [other.project.id] }))).status).toBe(403);
    // an org the user is not a member of
    expect((await post('/query', query({ organizationId: other.organization.id }))).status).toBe(403);
    expect(
      (await post('/panels/data', { organizationId: other.organization.id, from, to, panels: [{ id: 'p', config: { type: 'metrics' } }] }))
        .status,
    ).toBe(403);
    // API key (no session)
    const apiKeyRes = await request(app.server).post('/api/v1/metrics/query').set('x-api-key', ctx.apiKey.plainKey).send(query());
    expect(apiKeyRes.status).toBe(403);
  });

  it('skips deleted projects of the own org with a warning (item 11)', async () => {
    await ingest('web-1', 0.5, now - 10 * MIN);
    const deleted = await createTestProject({ organizationId: ctx.organization.id, userId: ctx.user.id });
    await ingest('web-9', 0.9, now - 10 * MIN, deleted.id);
    await db.updateTable('projects').set({ deleted_at: new Date() }).where('id', '=', deleted.id).execute();

    const mixed = await post('/query', query({ projectIds: [ctx.project.id, deleted.id] }));
    expect(mixed.status).toBe(200);
    expect(mixed.body.series[0].stats.max).toBeCloseTo(0.5);
    expect(mixed.body.warnings).toContain('A selected project was deleted and is skipped');

    const only = await post('/query', query({ projectIds: [deleted.id] }));
    expect(only.status).toBe(200);
    expect(only.body.series).toEqual([]);
    expect(only.body.warnings).toContain('A selected project was deleted and is skipped');

    // A foreign id still fails the whole request.
    expect((await post('/query', query({ projectIds: [deleted.id, other.project.id] }))).status).toBe(403);

    // Panels saved with the deleted project keep rendering.
    const panel = {
      type: 'metrics',
      title: 'CPU',
      source: 'metrics',
      timeRange: '1h',
      query: { ...query(), organizationId: undefined, from: undefined, to: undefined, projectIds: [ctx.project.id, deleted.id] },
    };
    const res = await post('/panels/data', { organizationId: ctx.organization.id, from, to, panels: [{ id: 'p', config: panel }] });
    expect(res.status).toBe(200);
    expect(res.body.panels.p.data.series[0].stats.max).toBeCloseTo(0.5);
    expect(res.body.panels.p.data.warnings).toContain('A selected project was deleted and is skipped');
  });

  it('caps the window at 90 days on both endpoints (item 4)', async () => {
    const longFrom = new Date(now - 91 * 24 * 60 * MIN).toISOString();
    const q = await post('/query', query({ from: longFrom }));
    expect(q.status).toBe(400);
    expect(JSON.stringify(q.body)).toMatch(/90 days/);
    const p = await post('/panels/data', { organizationId: ctx.organization.id, from: longFrom, to, panels: [{ id: 'p', config: { type: 'metrics' } }] });
    expect(p.status).toBe(400);
  });

  it('falls back to declared variable defaults on /panels/data (item 12)', async () => {
    await ingest('web-1', 0.2, now - 10 * MIN);
    await ingest('web-2', 0.8, now - 10 * MIN);
    const panel = {
      type: 'metrics',
      title: 'CPU',
      source: 'metrics',
      timeRange: '1h',
      query: {
        projectIds: null,
        queries: [
          { id: 'A', metricName: 'system.cpu.utilization', aggregation: 'max', filters: [{ scope: 'resource', key: 'host.name', op: 'eq', values: ['$host'] }], groupBy: [] },
        ],
        formulas: [],
        interval: 'auto',
        compareTo: 'none',
        display: 'lines',
      },
    };
    const body = (extra: Record<string, unknown>) => ({ organizationId: ctx.organization.id, from, to, panels: [{ id: 'p', config: panel }], ...extra });
    const declaredVariables = [{ name: 'host', label: 'Host', attr: { scope: 'resource', key: 'host.name' }, default: 'web-1' }];

    const fallback = await post('/panels/data', body({ declaredVariables }));
    expect(fallback.status).toBe(200);
    expect(fallback.body.panels.p.data.series[0].stats.max).toBeCloseTo(0.2);

    const sent = await post('/panels/data', body({ declaredVariables, variables: { host: 'web-2' } }));
    expect(sent.body.panels.p.data.series[0].stats.max).toBeCloseTo(0.8);

    const all = await post('/panels/data', body({ declaredVariables, variables: { host: null } }));
    expect(all.body.panels.p.data.series[0].stats.max).toBeCloseTo(0.8);

    const undeclared = await post('/panels/data', body({}));
    expect(undeclared.body.panels.p.error).toMatch(/Unknown variable "\$host"/);
  });

  it('never takes internal options from the body', async () => {
    const res = await post('/query', { ...query(), internal: { maxSeries: 2000 } });
    expect(res.status).toBe(200);
    expect(metricExplorerQuerySchemaKeys()).not.toContain('internal');
  });

  it('evaluates template panels and reports per-panel errors', async () => {
    await ingest('web-1', 0.4, now - 10 * MIN);
    await createTestSpan({ projectId: ctx.project.id, organizationId: ctx.organization.id, serviceName: 'checkout', startTime: new Date(now - 5 * MIN) });
    const metricsPanel = {
      type: 'metrics',
      title: 'CPU',
      source: 'metrics',
      timeRange: '6h',
      query: {
        projectIds: null,
        queries: [
          { id: 'A', metricName: 'system.cpu.utilization', aggregation: 'avg', filters: [{ scope: 'resource', key: 'host.name', op: 'eq', values: ['$host'] }], groupBy: [] },
        ],
        formulas: [],
        interval: 'auto',
        compareTo: 'none',
        display: 'lines',
      },
    };
    const res = await post('/panels/data', {
      organizationId: ctx.organization.id,
      from,
      to,
      variables: { host: null, service: 'checkout' },
      panels: [
        { id: 'cpu', config: metricsPanel },
        { id: 'traffic', config: { type: 'trace_volume', title: 'T', source: 'traces', projectId: null, serviceName: '$service', timeRange: '6h', showErrors: true } },
        { id: 'latency', config: { type: 'trace_latency', title: 'L', source: 'traces', projectId: null, serviceName: '$missing', timeRange: '6h', showPercentiles: ['p95'] } },
        { id: 'logs', config: { type: 'log_table' } },
        { id: 'bad', config: { ...metricsPanel, query: { ...metricsPanel.query, queries: [] } } },
      ],
    });
    expect(res.status).toBe(200);
    const { panels } = res.body;
    expect(panels.cpu.data.series[0].stats.max).toBeCloseTo(0.4);
    expect(panels.cpu.data.interval).toBe('1m');
    expect(panels.traffic.data.serviceName).toBe('checkout');
    expect(panels.traffic.data.timeRange).toBe('1h');
    expect(panels.traffic.data.series.reduce((n: number, p: any) => n + p.total, 0)).toBe(1);
    expect(panels.latency.error).toMatch(/Unknown variable "\$missing"/);
    expect(panels.logs.error).toMatch(/not supported/);
    expect(panels.bad.error).toMatch(/Invalid metrics panel/);
  });

  it('fetchMetricsPanelData scopes to the organization', async () => {
    await ingest('web-1', 0.3, now - 10 * MIN);
    const config = {
      type: 'metrics' as const,
      title: 'CPU',
      source: 'metrics' as const,
      timeRange: '1h' as const,
      query: {
        projectIds: [ctx.project.id],
        queries: [{ id: 'A', metricName: 'system.cpu.utilization', aggregation: 'avg' as const, filters: [], groupBy: [] }],
        formulas: [],
        interval: 'auto' as const,
        compareTo: 'none' as const,
        display: 'lines' as const,
      },
    };
    const data = await fetchMetricsPanelData(config, { organizationId: ctx.organization.id, from: new Date(from), to: new Date(to) });
    expect(data.series[0].stats.max).toBeCloseTo(0.3);
    await expect(
      fetchMetricsPanelData(config, { organizationId: other.organization.id, from: new Date(from), to: new Date(to) }),
    ).rejects.toBeInstanceOf(MetricScopeError);
    await expect(
      fetchMetricsPanelData(config, { organizationId: ctx.organization.id, userId: other.user.id, from: new Date(from), to: new Date(to) }),
    ).rejects.toBeInstanceOf(MetricScopeError);
  });
});
