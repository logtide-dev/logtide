// ============================================================================
// GET /options (picker suggestions for the dashboard panel forms)
// ============================================================================

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { reservoir } from '../../../database/reservoir.js';
import { customDashboardsRoutes } from '../../../modules/custom-dashboards/routes.js';
import {
  createTestContext,
  createTestProject,
  createTestSession,
  createTestLog,
  createTestTrace,
} from '../../helpers/index.js';

const PREFIX = '/api/v1/custom-dashboards';

let app: FastifyInstance;
let ctx: Awaited<ReturnType<typeof createTestContext>>;
let token: string;
let projectB: string;

function metric(projectId: string, organizationId: string, name: string) {
  return {
    time: new Date(Date.now() - 60_000),
    organizationId,
    projectId,
    metricName: name,
    metricType: 'gauge' as const,
    value: 1,
    serviceName: 'svc',
  };
}

function get(query: Record<string, string | undefined>, t: string = token) {
  const qs = Object.entries(query)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${encodeURIComponent(v as string)}`)
    .join('&');
  return app.inject({
    method: 'GET',
    url: `${PREFIX}/options?${qs}`,
    headers: { Authorization: `Bearer ${t}` },
  });
}

async function options(query: Record<string, string | undefined>): Promise<string[]> {
  const res = await get(query);
  expect(res.statusCode).toBe(200);
  return JSON.parse(res.payload).options;
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
  projectB = (
    await createTestProject({ organizationId: ctx.organization.id, userId: ctx.user.id })
  ).id;
});

describe('GET /options', () => {
  it('metric-names returns names for one project', async () => {
    await reservoir.ingestMetrics([
      metric(ctx.project.id, ctx.organization.id, 'cpu_a'),
      metric(projectB, ctx.organization.id, 'mem_b'),
    ]);
    const names = await options({
      organizationId: ctx.organization.id,
      kind: 'metric-names',
      projectId: ctx.project.id,
    });
    expect(names).toEqual(['cpu_a']);
  });

  it('metric-names org-wide unions names across org projects only', async () => {
    await reservoir.ingestMetrics([
      metric(ctx.project.id, ctx.organization.id, 'cpu_a'),
      metric(projectB, ctx.organization.id, 'mem_b'),
      metric(projectB, ctx.organization.id, 'cpu_a'),
    ]);
    const names = await options({ organizationId: ctx.organization.id, kind: 'metric-names' });
    expect(names).toEqual(['cpu_a', 'mem_b']);
  });

  it('services logs returns distinct services', async () => {
    await createTestLog({ projectId: ctx.project.id, service: 'web' });
    await createTestLog({ projectId: ctx.project.id, service: 'web' });
    await createTestLog({ projectId: projectB, service: 'api' });
    const all = await options({ organizationId: ctx.organization.id, kind: 'services', source: 'logs' });
    expect(all).toEqual(['api', 'web']);
    const one = await options({
      organizationId: ctx.organization.id,
      kind: 'services',
      source: 'logs',
      projectId: ctx.project.id,
    });
    expect(one).toEqual(['web']);
  });

  it('services traces returns trace services', async () => {
    await createTestTrace({ projectId: ctx.project.id, organizationId: ctx.organization.id, serviceName: 'trace-svc' });
    await createTestLog({ projectId: ctx.project.id, service: 'log-only' });
    const names = await options({
      organizationId: ctx.organization.id,
      kind: 'services',
      source: 'traces',
    });
    expect(names).toEqual(['trace-svc']);
  });

  it('services metrics falls back to the union of log and trace services', async () => {
    await createTestTrace({ projectId: ctx.project.id, organizationId: ctx.organization.id, serviceName: 'trace-svc' });
    await createTestLog({ projectId: ctx.project.id, service: 'log-svc' });
    const names = await options({
      organizationId: ctx.organization.id,
      kind: 'services',
      source: 'metrics',
    });
    expect(names).toEqual(['log-svc', 'trace-svc']);
  });

  it('foreign projectId returns 400', async () => {
    const other = await createTestContext();
    const res = await get({
      organizationId: ctx.organization.id,
      kind: 'metric-names',
      projectId: other.project.id,
    });
    expect(res.statusCode).toBe(400);
  });

  it("org isolation: another org's metric names never appear", async () => {
    const other = await createTestContext();
    await reservoir.ingestMetrics([
      metric(other.project.id, other.organization.id, 'secret_metric'),
      metric(ctx.project.id, ctx.organization.id, 'mine'),
    ]);
    await createTestLog({ projectId: other.project.id, service: 'secret-svc' });
    const names = await options({ organizationId: ctx.organization.id, kind: 'metric-names' });
    expect(names).toEqual(['mine']);
    const services = await options({ organizationId: ctx.organization.id, kind: 'services' });
    expect(services).not.toContain('secret-svc');
  });

  it('unknown kind returns 400', async () => {
    const res = await get({ organizationId: ctx.organization.id, kind: 'bogus' });
    expect(res.statusCode).toBe(400);
  });

  it('unknown source returns 400', async () => {
    const res = await get({ organizationId: ctx.organization.id, kind: 'services', source: 'nope' });
    expect(res.statusCode).toBe(400);
  });

  it('non-member gets 403', async () => {
    const other = await createTestContext();
    const res = await get({ organizationId: other.organization.id, kind: 'metric-names' });
    expect(res.statusCode).toBe(403);
  });

  it('result is capped at 500', async () => {
    const records = Array.from({ length: 520 }, (_, i) =>
      metric(ctx.project.id, ctx.organization.id, `m_${String(i).padStart(4, '0')}`)
    );
    await reservoir.ingestMetrics(records);
    const names = await options({ organizationId: ctx.organization.id, kind: 'metric-names' });
    expect(names).toHaveLength(500);
    expect(names[0]).toBe('m_0000');
  });
});
