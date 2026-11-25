// ============================================================================
// Dashboard variables (schema v2): CRUD, validation, YAML, batch endpoint
// ============================================================================

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { db } from '../../../database/index.js';
import { reservoir } from '../../../database/reservoir.js';
import { customDashboardsRoutes } from '../../../modules/custom-dashboards/routes.js';
import { customDashboardsService } from '../../../modules/custom-dashboards/service.js';
import { fetchMetricsPanelData } from '../../../modules/metrics/query/panel.js';
import { listDashboardTemplates, buildTemplateYaml } from '../../../modules/custom-dashboards/templates.js';
import { createTestContext, createTestSession } from '../../helpers/index.js';

vi.mock('../../../modules/metrics/query/panel.js', () => ({ fetchMetricsPanelData: vi.fn() }));

const PREFIX = '/api/v1/custom-dashboards';
const LAYOUT = { x: 0, y: 0, w: 6, h: 4 };

let app: FastifyInstance;
let ctx: Awaited<ReturnType<typeof createTestContext>>;
let token: string;

const hostVar = {
  name: 'host',
  label: 'Host',
  attr: { scope: 'resource', key: 'host.name' },
  metricName: null,
  default: null,
};

function metricsPanel(id: string, value = '$host', projectIds: string[] | null = null) {
  return {
    id,
    layout: LAYOUT,
    config: {
      type: 'metrics',
      title: 'CPU by host',
      source: 'metrics',
      timeRange: '1h',
      query: {
        projectIds,
        queries: [
          {
            id: 'A',
            metricName: 'system.cpu.utilization',
            aggregation: 'avg',
            filters: [{ scope: 'resource', key: 'host.name', op: 'eq', values: [value] }],
            groupBy: [],
          },
        ],
        formulas: [],
        interval: 'auto',
        compareTo: 'none',
        display: 'lines',
      },
    },
  };
}

function tracePanel(id: string, serviceName: string | null) {
  return {
    id,
    layout: LAYOUT,
    config: {
      type: 'trace_volume',
      title: 'Spans',
      source: 'traces',
      projectId: null,
      serviceName,
      timeRange: '24h',
      showErrors: true,
    },
  };
}

function req(method: 'GET' | 'POST' | 'PUT', url: string, payload?: unknown) {
  return app.inject({
    method,
    url: `${PREFIX}${url}`,
    headers: { Authorization: `Bearer ${token}` },
    payload: payload as Record<string, unknown> | undefined,
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
  vi.mocked(fetchMetricsPanelData).mockReset();
  vi.mocked(fetchMetricsPanelData).mockResolvedValue({ series: [], interval: '1m', queries: [], warnings: [] });
});

describe('variables CRUD', () => {
  it('creates with variables and returns them, list and get included', async () => {
    const res = await req('POST', '/', {
      organizationId: ctx.organization.id,
      name: 'Host board',
      panels: [metricsPanel('p1')],
      variables: [hostVar],
    });
    expect(res.statusCode).toBe(201);
    const { dashboard } = JSON.parse(res.payload);
    expect(dashboard.schemaVersion).toBe(2);
    expect(dashboard.variables).toEqual([{ ...hostVar }]);

    const got = await req('GET', `/${dashboard.id}?organizationId=${ctx.organization.id}`);
    expect(JSON.parse(got.payload).dashboard.variables).toHaveLength(1);
    const list = await req('GET', `/?organizationId=${ctx.organization.id}`);
    const found = JSON.parse(list.payload).dashboards.find((d: { id: string }) => d.id === dashboard.id);
    expect(found.variables[0].name).toBe('host');
  });

  it('defaults to no variables', async () => {
    const d = await customDashboardsService.create({ organizationId: ctx.organization.id, name: 'Plain' }, ctx.user.id);
    expect(d.variables).toEqual([]);
    const row = await db.selectFrom('custom_dashboards').select('variables').where('id', '=', d.id).executeTakeFirstOrThrow();
    expect(row.variables).toEqual([]);
  });

  it('updates variables alone and keeps panels', async () => {
    const d = await customDashboardsService.create(
      { organizationId: ctx.organization.id, name: 'U', panels: [tracePanel('t1', null)] as never },
      ctx.user.id
    );
    const res = await req('PUT', `/${d.id}?organizationId=${ctx.organization.id}`, { variables: [hostVar] });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload).dashboard;
    expect(body.variables).toHaveLength(1);
    expect(body.panels).toHaveLength(1);
  });

  it('refuses to remove a variable a panel still references', async () => {
    const d = await customDashboardsService.create(
      { organizationId: ctx.organization.id, name: 'Used', panels: [metricsPanel('p1')] as never, variables: [hostVar as never] },
      ctx.user.id
    );
    const res = await req('PUT', `/${d.id}?organizationId=${ctx.organization.id}`, { variables: [] });
    expect(res.statusCode).toBe(400);
    const still = await customDashboardsService.getById(d.id, ctx.organization.id, ctx.user.id);
    expect(still!.variables).toHaveLength(1);
  });

  it('refuses to save panels that reference an undeclared variable', async () => {
    const d = await customDashboardsService.create({ organizationId: ctx.organization.id, name: 'E' }, ctx.user.id);
    const res = await req('PUT', `/${d.id}?organizationId=${ctx.organization.id}`, { panels: [metricsPanel('p1')] });
    expect(res.statusCode).toBe(400);
    const ok = await req('PUT', `/${d.id}?organizationId=${ctx.organization.id}`, {
      panels: [metricsPanel('p1')],
      variables: [hostVar],
    });
    expect(ok.statusCode).toBe(200);
    // A later panel-only update validates against the stored variables.
    const again = await req('PUT', `/${d.id}?organizationId=${ctx.organization.id}`, { panels: [metricsPanel('p2')] });
    expect(again.statusCode).toBe(200);
  });

  it('rejects invalid variables with 400', async () => {
    const create = (variables: unknown) =>
      req('POST', '/', { organizationId: ctx.organization.id, name: 'Bad', variables });
    expect((await create([{ ...hostVar, name: 'Not Valid' }])).statusCode).toBe(400);
    expect((await create([hostVar, hostVar])).statusCode).toBe(400);
    expect((await create([{ ...hostVar, attr: { scope: 'resource', key: "x'; --" } }])).statusCode).toBe(400);
    // A metric-scope variable must name a metric.
    const metricVar = { ...hostVar, name: 'route', attr: { scope: 'metric', key: 'http.route' } };
    const noMetric = await create([metricVar]);
    expect(noMetric.statusCode).toBe(400);
    expect(noMetric.payload).toContain('must name a metric');
    expect((await create([{ ...metricVar, metricName: '' }])).statusCode).toBe(400);
    expect((await create([{ ...metricVar, metricName: 'http.server.request.duration' }])).statusCode).toBe(201);
    const six = ['a', 'b', 'c', 'd', 'e', 'f'].map((name) => ({ ...hostVar, name }));
    expect((await create(six)).statusCode).toBe(400);
  });

  it('duplicate keeps the variables', async () => {
    const d = await customDashboardsService.create(
      { organizationId: ctx.organization.id, name: 'Dup', panels: [metricsPanel('p1')] as never, variables: [hostVar as never] },
      ctx.user.id
    );
    const copy = await customDashboardsService.duplicate(d.id, ctx.organization.id, ctx.user.id);
    expect(copy.variables).toEqual(d.variables);
    expect(copy.panels).toHaveLength(1);
  });

  it('a row written before 082 (no variables, v1) reads as v2 with none', async () => {
    const d = await customDashboardsService.create({ organizationId: ctx.organization.id, name: 'Old' }, ctx.user.id);
    await db.updateTable('custom_dashboards').set({ schema_version: 1 }).where('id', '=', d.id).execute();
    const read = await customDashboardsService.getById(d.id, ctx.organization.id, ctx.user.id);
    expect(read!.schemaVersion).toBe(2);
    expect(read!.variables).toEqual([]);
  });
});

describe('YAML', () => {
  it('round trips variables', async () => {
    const d = await customDashboardsService.create(
      { organizationId: ctx.organization.id, name: 'Y', panels: [metricsPanel('p1')] as never, variables: [hostVar as never] },
      ctx.user.id
    );
    const text = await customDashboardsService.exportYaml(d.id, ctx.organization.id, ctx.user.id);
    expect(text).toContain('variables:');
    const imported = await customDashboardsService.importYaml(text, ctx.organization.id, ctx.user.id);
    expect(imported.variables).toEqual(d.variables);
  });

  it('rejects an import whose panels reference an undeclared variable', async () => {
    const d = await customDashboardsService.create(
      { organizationId: ctx.organization.id, name: 'Y2', panels: [metricsPanel('p1')] as never, variables: [hostVar as never] },
      ctx.user.id
    );
    const text = (await customDashboardsService.exportYaml(d.id, ctx.organization.id, ctx.user.id)).replace(
      /variables:[\s\S]*$/,
      'variables: []\n'
    );
    await expect(customDashboardsService.importYaml(text, ctx.organization.id, ctx.user.id)).rejects.toBeInstanceOf(ZodError);
  });

  it('rejects an import that queries a project of another organization', async () => {
    const other = await createTestContext();
    const yaml = `
name: Foreign
schema_version: 2
panels:
  - id: p1
    layout: { x: 0, y: 0, w: 4, h: 3 }
    config:
      type: metrics
      title: M
      source: metrics
      timeRange: 1h
      query:
        projectIds: ["${other.project.id}"]
        queries:
          - { id: A, metricName: cpu, aggregation: avg, filters: [], groupBy: [] }
        formulas: []
        interval: auto
        compareTo: none
        display: lines
`;
    await expect(customDashboardsService.importYaml(yaml, ctx.organization.id, ctx.user.id)).rejects.toThrow(
      /does not belong/
    );
    expect(await customDashboardsService.countForOrg(ctx.organization.id)).toBe(0);
  });
});

describe('org isolation of metrics panel projectIds', () => {
  it('create and update refuse foreign project ids, accept own', async () => {
    const other = await createTestContext();
    const bad = await req('POST', '/', {
      organizationId: ctx.organization.id,
      name: 'Bad',
      panels: [metricsPanel('p1', 'x', [other.project.id])],
    });
    expect(bad.statusCode).toBe(400);

    const good = await req('POST', '/', {
      organizationId: ctx.organization.id,
      name: 'Good',
      panels: [metricsPanel('p1', 'x', [ctx.project.id])],
    });
    expect(good.statusCode).toBe(201);
    const id = JSON.parse(good.payload).dashboard.id;
    const upd = await req('PUT', `/${id}?organizationId=${ctx.organization.id}`, {
      panels: [metricsPanel('p1', 'x', [other.project.id])],
    });
    expect(upd.statusCode).toBe(400);
  });
});

describe('batch panel data with variables', () => {
  it('passes declared variables to the metrics fetcher and substitutes the trace service', async () => {
    const spy = vi.spyOn(reservoir, 'getSpanTimeseries').mockResolvedValue([]);
    const d = await customDashboardsService.create(
      {
        organizationId: ctx.organization.id,
        name: 'Batch',
        panels: [
          metricsPanel('m1'),
          tracePanel('t1', '$service'),
        ] as never,
        variables: [
          hostVar as never,
          { name: 'service', label: 'Service', attr: { scope: 'resource', key: 'service.name' }, default: null } as never,
        ],
      },
      ctx.user.id
    );
    const res = await req('POST', `/${d.id}/panels/data`, {
      organizationId: ctx.organization.id,
      variables: { host: 'web-1', service: 'api', ghost: 'ignored' },
    });
    expect(res.statusCode).toBe(200);
    const panels = JSON.parse(res.payload).panels;
    expect(panels.m1.error).toBeUndefined();
    expect(panels.t1.error).toBeUndefined();

    const mctx = vi.mocked(fetchMetricsPanelData).mock.calls[0][1];
    expect(mctx.variables).toEqual({ host: 'web-1', service: 'api' });
    expect(spy.mock.calls[0][0].serviceName).toBe('api');

    // null = All
    await req('POST', `/${d.id}/panels/data`, {
      organizationId: ctx.organization.id,
      variables: { host: null, service: null },
    });
    expect(vi.mocked(fetchMetricsPanelData).mock.calls[1][1].variables).toEqual({ host: null, service: null });
    expect(spy.mock.calls[1][0].serviceName).toBeUndefined();
    spy.mockRestore();
  });

  it('rejects a malformed variables body', async () => {
    const d = await customDashboardsService.create({ organizationId: ctx.organization.id, name: 'B2' }, ctx.user.id);
    const res = await req('POST', `/${d.id}/panels/data`, {
      organizationId: ctx.organization.id,
      variables: { host: 42 },
    });
    expect(res.statusCode).toBe(400);
  });

  it('reports a per-panel error when the stored project no longer belongs to the org', async () => {
    const other = await createTestContext();
    const d = await customDashboardsService.create({ organizationId: ctx.organization.id, name: 'Iso' }, ctx.user.id);
    // Bypass save validation: simulate a stale or tampered row.
    await db
      .updateTable('custom_dashboards')
      .set({
        panels: JSON.stringify([metricsPanel('m1', 'x', [other.project.id])]),
        variables: JSON.stringify([]),
      })
      .where('id', '=', d.id)
      .execute();
    const res = await req('POST', `/${d.id}/panels/data`, { organizationId: ctx.organization.id });
    const panels = JSON.parse(res.payload).panels;
    expect(panels.m1.error).toMatch(/does not belong/);
    expect(fetchMetricsPanelData).not.toHaveBeenCalled();
  });
});

describe('templates', () => {
  it('no built-in template carries v1 metric panels and all instantiate as v2', async () => {
    for (const t of listDashboardTemplates()) {
      const text = buildTemplateYaml(t.id, {})!;
      expect(text).not.toMatch(/metric_chart|metric_stat/);
      const d = await customDashboardsService.createFromTemplate(t.id, ctx.organization.id, ctx.user.id);
      expect(d.schemaVersion).toBe(2);
      expect(d.variables).toEqual([]);
    }
  });
});
