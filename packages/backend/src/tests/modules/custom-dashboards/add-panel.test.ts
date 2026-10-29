// ============================================================================
// POST /:id/panels (append panel, the "Add to dashboard" contract)
// ============================================================================

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { db } from '../../../database/index.js';
import { customDashboardsRoutes } from '../../../modules/custom-dashboards/routes.js';
import { customDashboardsService } from '../../../modules/custom-dashboards/service.js';
import { panelRegistry } from '../../../modules/custom-dashboards/panel-registry.js';
import { createTestContext, createTestSession, createTestUser } from '../../helpers/index.js';

const PREFIX = '/api/v1/custom-dashboards';

let app: FastifyInstance;
let ctx: Awaited<ReturnType<typeof createTestContext>>;
let token: string;

function auth(t: string) {
  return { Authorization: `Bearer ${t}` };
}

function metricChart(overrides: Record<string, unknown> = {}) {
  return {
    type: 'metric_chart',
    title: 'CPU',
    source: 'metrics',
    projectId: null,
    metricName: 'cpu_usage',
    aggregation: 'avg',
    interval: '5m',
    timeRange: '1h',
    serviceName: null,
    ...overrides,
  };
}

function existingPanel(id: string, y: number, h: number) {
  return {
    id,
    layout: { x: 0, y, w: 4, h },
    config: {
      type: 'time_series' as const,
      title: 'Logs',
      source: 'logs' as const,
      projectId: null,
      interval: '24h' as const,
      levels: ['info'] as ['info'],
      service: null,
    },
  };
}

async function makeDashboard(panels: ReturnType<typeof existingPanel>[] = [], extra: { isPersonal?: boolean } = {}) {
  return customDashboardsService.create(
    { organizationId: ctx.organization.id, name: 'Target', panels, ...extra },
    ctx.user.id
  );
}

function post(dashboardId: string, body: unknown, opts: { org?: string; token?: string } = {}) {
  return app.inject({
    method: 'POST',
    url: `${PREFIX}/${dashboardId}/panels?organizationId=${opts.org ?? ctx.organization.id}`,
    headers: auth(opts.token ?? token),
    payload: body as Record<string, unknown>,
  });
}

beforeAll(async () => {
  app = Fastify();
  await app.register(customDashboardsRoutes, { prefix: PREFIX });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  ctx = await createTestContext();
  token = (await createTestSession(ctx.user.id)).token;
});

describe('POST /:id/panels', () => {
  it('appends a metric_chart and returns the new panel with generated id', async () => {
    const d = await makeDashboard();
    const res = await post(d.id, { config: metricChart() });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.payload);
    expect(body.panel.id).toMatch(/^panel-/);
    expect(body.panel.config.type).toBe('metric_chart');
    expect(body.dashboard.id).toBe(d.id);
    expect(body.dashboard.panels).toHaveLength(1);
    expect(body.dashboard.panels[0].id).toBe(body.panel.id);

    const stored = await customDashboardsService.getById(d.id, ctx.organization.id, ctx.user.id);
    expect(stored!.panels).toHaveLength(1);
  });

  it('places the new panel below the lowest existing panel', async () => {
    const d = await makeDashboard([existingPanel('a', 0, 3), existingPanel('b', 3, 4)]);
    const res = await post(d.id, { config: metricChart() });
    const { panel, dashboard } = JSON.parse(res.payload);
    expect(panel.layout.x).toBe(0);
    expect(panel.layout.y).toBe(7);
    expect(dashboard.panels.map((p: { id: string }) => p.id).slice(0, 2)).toEqual(['a', 'b']);
  });

  it('uses registry default layout when layout omitted', async () => {
    const d = await makeDashboard();
    const { panel } = JSON.parse((await post(d.id, { config: metricChart() })).payload);
    expect(panel.layout.w).toBe(panelRegistry.metric_chart.defaultLayout.w);
    expect(panel.layout.h).toBe(panelRegistry.metric_chart.defaultLayout.h);
  });

  it('honours layout w/h override', async () => {
    const d = await makeDashboard();
    const { panel } = JSON.parse(
      (await post(d.id, { config: metricChart(), layout: { w: 12, h: 5 } })).payload
    );
    expect(panel.layout.w).toBe(12);
    expect(panel.layout.h).toBe(5);

    const partial = JSON.parse(
      (await post(d.id, { config: metricChart(), layout: { w: 4 } })).payload
    );
    expect(partial.panel.layout.w).toBe(4);
    expect(partial.panel.layout.h).toBe(panelRegistry.metric_chart.defaultLayout.h);
  });

  it('accepts groupBy on a metric_chart and stores it', async () => {
    const d = await makeDashboard();
    const res = await post(d.id, { config: metricChart({ groupBy: ['host', 'http.method'] }) });
    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.payload).panel.config.groupBy).toEqual(['host', 'http.method']);
  });

  it('rejects invalid config with 400', async () => {
    const d = await makeDashboard();
    const bad = await post(d.id, { config: metricChart({ aggregation: 'nope' }) });
    expect(bad.statusCode).toBe(400);
    expect(JSON.parse(bad.payload).error).toBe('Validation error');

    const noConfig = await post(d.id, {});
    expect(noConfig.statusCode).toBe(400);

    const badLayout = await post(d.id, { config: metricChart(), layout: { w: 99 } });
    expect(badLayout.statusCode).toBe(400);

    const stored = await customDashboardsService.getById(d.id, ctx.organization.id, ctx.user.id);
    expect(stored!.panels).toHaveLength(0);
  });

  it('rejects a project of another organization with 400', async () => {
    const other = await createTestContext();
    const d = await makeDashboard();
    const res = await post(d.id, { config: metricChart({ projectId: other.project.id }) });
    expect(res.statusCode).toBe(400);
    const stored = await customDashboardsService.getById(d.id, ctx.organization.id, ctx.user.id);
    expect(stored!.panels).toHaveLength(0);
  });

  it('accepts a project of the organization', async () => {
    const d = await makeDashboard();
    const res = await post(d.id, { config: metricChart({ projectId: ctx.project.id }) });
    expect(res.statusCode).toBe(201);
  });

  it('two concurrent adds keep both panels', async () => {
    const d = await makeDashboard([existingPanel('a', 0, 3)]);
    const [r1, r2] = await Promise.all([
      post(d.id, { config: metricChart({ title: 'One' }) }),
      post(d.id, { config: metricChart({ title: 'Two' }) }),
    ]);
    expect(r1.statusCode).toBe(201);
    expect(r2.statusCode).toBe(201);

    const stored = await customDashboardsService.getById(d.id, ctx.organization.id, ctx.user.id);
    expect(stored!.panels).toHaveLength(3);
    expect(stored!.panels.map((p) => p.config.title).sort()).toEqual(['Logs', 'One', 'Two']);
    const ys = stored!.panels.map((p) => p.layout.y);
    expect(new Set(ys).size).toBe(ys.length);
  });

  it("returns 404 for another user's personal dashboard", async () => {
    const d = await makeDashboard([], { isPersonal: true });
    const member = await createTestUser();
    await db
      .insertInto('organization_members')
      .values({ organization_id: ctx.organization.id, user_id: member.id, role: 'member' })
      .execute();
    const memberToken = (await createTestSession(member.id)).token;

    const res = await post(d.id, { config: metricChart() }, { token: memberToken });
    expect(res.statusCode).toBe(404);
    const stored = await customDashboardsService.getById(d.id, ctx.organization.id, ctx.user.id);
    expect(stored!.panels).toHaveLength(0);
  });

  it('returns 404 for a dashboard of another org', async () => {
    const other = await createTestContext();
    const theirs = await customDashboardsService.create(
      { organizationId: other.organization.id, name: 'Theirs' },
      other.user.id
    );
    const res = await post(theirs.id, { config: metricChart() });
    expect(res.statusCode).toBe(404);
    const stored = await customDashboardsService.getById(theirs.id, other.organization.id, other.user.id);
    expect(stored!.panels).toHaveLength(0);
  });

  it('returns 404 for an unknown id', async () => {
    const res = await post('00000000-0000-0000-0000-000000000000', { config: metricChart() });
    expect(res.statusCode).toBe(404);
  });

  it('returns 403 for a non-member', async () => {
    const d = await makeDashboard();
    const stranger = await createTestUser();
    const strangerToken = (await createTestSession(stranger.id)).token;
    const res = await post(d.id, { config: metricChart() }, { token: strangerToken });
    expect(res.statusCode).toBe(403);
  });

  it('returns 400 without organizationId', async () => {
    const d = await makeDashboard();
    const res = await app.inject({
      method: 'POST',
      url: `${PREFIX}/${d.id}/panels`,
      headers: auth(token),
      payload: { config: metricChart() },
    });
    expect(res.statusCode).toBe(400);
  });

  it('records a dashboard.updated audit entry with addedPanelType', async () => {
    const d = await makeDashboard();
    await post(d.id, { config: metricChart() });
    const row = await db
      .selectFrom('audit_log')
      .selectAll()
      .where('resource_id', '=', d.id)
      .where('action', '=', 'dashboard.updated')
      .executeTakeFirstOrThrow();
    expect((row.metadata as { addedPanelType: string }).addedPanelType).toBe('metric_chart');
  });
});
