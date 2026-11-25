import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import crypto from 'crypto';
import { db } from '../../../database/index.js';
import { alertsRoutes } from '../../../modules/alerts/index.js';
import { contextPlugin } from '../../../context/index.js';
import { capabilities } from '../../../capabilities/index.js';
import { createTestAlertRule, createTestContext } from '../../helpers/factories.js';

async function createTestSession(userId: string) {
  const token = crypto.randomBytes(32).toString('hex');
  await db
    .insertInto('sessions')
    .values({ user_id: userId, token, expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000) })
    .execute();
  return token;
}

function metricConfig(projectIds: string[] | null = null, o: Record<string, unknown> = {}) {
  return {
    query: {
      projectIds,
      queries: [
        {
          id: 'A',
          metricName: 'system.cpu.utilization',
          aggregation: 'avg',
          filters: [],
          groupBy: [{ scope: 'resource', key: 'host.name' }],
        },
      ],
      formulas: [],
      interval: 'auto',
      compareTo: 'none',
      display: 'lines',
    },
    condition: 'above',
    threshold: 0.9,
    window: '5m',
    forEvaluations: 3,
    severity: 'high',
    ...o,
  };
}

function metricBody(organizationId: string, name: string, config: unknown = metricConfig()) {
  return { organizationId, name, alertType: 'metric', metricConfig: config, channelIds: [] };
}

describe('metric alert rule routes', () => {
  let app: FastifyInstance;
  let orgId: string;
  let projectId: string;
  let token: string;

  beforeAll(async () => {
    app = Fastify();
    await app.register(contextPlugin);
    await app.register(alertsRoutes, { prefix: '/api/v1/alerts' });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await db.deleteFrom('organization_entitlements').execute();
    const ctx = await createTestContext();
    orgId = ctx.organization.id;
    projectId = ctx.project.id;
    token = await createTestSession(ctx.user.id);
    capabilities.invalidate(orgId);
  });

  const post = (payload: unknown, t = token) =>
    app.inject({ method: 'POST', url: '/api/v1/alerts', headers: { Authorization: `Bearer ${t}` }, payload });

  it('creates, reads, updates and deletes a metric rule', async () => {
    const created = await post({ ...metricBody(orgId, 'CPU high', metricConfig([projectId])), renotifyMinutes: 30 });
    expect(created.statusCode).toBe(201);
    const rule = created.json().alertRule;
    expect(rule).toMatchObject({
      alertType: 'metric',
      projectId,
      renotifyMinutes: 30,
      metricConfig: { threshold: 0.9, window: '5m', forEvaluations: 3, severity: 'high' },
      channelIds: [],
      triggersLast24h: 0,
    });

    const got = await app.inject({
      method: 'GET',
      url: `/api/v1/alerts/${rule.id}?organizationId=${orgId}`,
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(got.json().alertRule.metricConfig.query.queries[0].metricName).toBe('system.cpu.utilization');

    const updated = await app.inject({
      method: 'PUT',
      url: `/api/v1/alerts/${rule.id}?organizationId=${orgId}`,
      headers: { Authorization: `Bearer ${token}` },
      payload: { name: 'CPU very high', metricConfig: metricConfig(null, { threshold: 0.95, window: '15m' }) },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().alertRule).toMatchObject({
      name: 'CPU very high',
      projectId: null,
      timeWindow: 15,
      metricConfig: { threshold: 0.95, window: '15m' },
    });

    const list = await app.inject({
      method: 'GET',
      url: `/api/v1/alerts?organizationId=${orgId}`,
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(list.json().alertRules.map((r: { alertType: string }) => r.alertType)).toEqual(['metric']);

    const deleted = await app.inject({
      method: 'DELETE',
      url: `/api/v1/alerts/${rule.id}?organizationId=${orgId}`,
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(deleted.statusCode).toBe(204);
  });

  it('rejects a metric rule without a config, or a config on a log rule', async () => {
    expect((await post({ organizationId: orgId, name: 'x', alertType: 'metric' })).statusCode).toBe(400);
    const logWithConfig = await post({
      organizationId: orgId,
      name: 'x',
      level: ['error'],
      threshold: 5,
      timeWindow: 5,
      metricConfig: metricConfig(),
    });
    expect(logWithConfig.statusCode).toBe(400);
  });

  it('still requires levels, threshold and window on log rules', async () => {
    const res = await post({ organizationId: orgId, name: 'x', emailRecipients: [] });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('Validation error');
  });

  it('rejects two visible series, bad windows and dashboard variables', async () => {
    const two = metricConfig();
    (two.query as { queries: unknown[] }).queries.push({ ...two.query.queries[0], id: 'B' });
    const res = await post(metricBody(orgId, 'x', two));
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/exactly one visible/);

    expect((await post(metricBody(orgId, 'x', metricConfig(null, { window: '2h' })))).statusCode).toBe(400);
    expect((await post(metricBody(orgId, 'x', metricConfig(null, { forEvaluations: 20 })))).statusCode).toBe(400);

    const withVar = metricConfig();
    (withVar.query.queries[0] as { filters: unknown[] }).filters = [
      { scope: 'resource', key: 'host.name', op: 'eq', values: ['$host'] },
    ];
    const varRes = await post(metricBody(orgId, 'x', withVar));
    expect(varRes.statusCode).toBe(400);
    expect(varRes.json().error).toMatch(/variables/);
  });

  it('rejects text queries on metric rules', async () => {
    const res = await post({ ...metricBody(orgId, 'x'), query: 'level:error' });
    expect(res.statusCode).toBe(400);
  });

  it('403 when a query project belongs to another organization', async () => {
    const other = await createTestContext();
    const res = await post(metricBody(orgId, 'x', metricConfig([projectId, other.project.id])));
    expect(res.statusCode).toBe(403);

    const rule = (await post(metricBody(orgId, 'ok'))).json().alertRule;
    const upd = await app.inject({
      method: 'PUT',
      url: `/api/v1/alerts/${rule.id}?organizationId=${orgId}`,
      headers: { Authorization: `Bearer ${token}` },
      payload: { metricConfig: metricConfig([other.project.id]) },
    });
    expect(upd.statusCode).toBe(403);
  });

  it('403 for a user outside the organization', async () => {
    const other = await createTestContext();
    const otherToken = await createTestSession(other.user.id);
    expect((await post(metricBody(orgId, 'x'), otherToken)).statusCode).toBe(403);
  });

  it('a rule cannot switch to or from the metric kind', async () => {
    const logRule = await createTestAlertRule({ organizationId: orgId, projectId });
    const toMetric = await app.inject({
      method: 'PUT',
      url: `/api/v1/alerts/${logRule.id}?organizationId=${orgId}`,
      headers: { Authorization: `Bearer ${token}` },
      payload: { alertType: 'metric', metricConfig: metricConfig() },
    });
    expect(toMetric.statusCode).toBe(400);

    const rule = (await post(metricBody(orgId, 'm'))).json().alertRule;
    const toThreshold = await app.inject({
      method: 'PUT',
      url: `/api/v1/alerts/${rule.id}?organizationId=${orgId}`,
      headers: { Authorization: `Bearer ${token}` },
      payload: { alertType: 'threshold' },
    });
    expect(toThreshold.statusCode).toBe(400);
  });

  describe('alerts.max_rules counts metric rules', () => {
    async function cap(organizationId: string, limit: number) {
      await db
        .insertInto('organization_entitlements')
        .values({ organization_id: organizationId, capability: 'alerts.max_rules', enabled: null, limit_value: limit })
        .execute();
      capabilities.invalidate(organizationId);
    }

    it('at limit: a metric rule is refused when log rules fill the cap', async () => {
      await cap(orgId, 1);
      await createTestAlertRule({ organizationId: orgId, projectId });
      const res = await post(metricBody(orgId, 'over'));
      expect(res.statusCode).toBe(403);
    });

    it('under limit: a metric rule is created, then it counts toward the cap', async () => {
      await cap(orgId, 2);
      await createTestAlertRule({ organizationId: orgId, projectId });
      expect((await post(metricBody(orgId, 'second'))).statusCode).toBe(201);
      expect((await post(metricBody(orgId, 'third'))).statusCode).toBe(403);
    });

    it('unlimited by default', async () => {
      for (let i = 0; i < 3; i++) {
        expect((await post(metricBody(orgId, `m${i}`))).statusCode).toBe(201);
      }
    });

    it('org isolation: another organization rules do not count', async () => {
      await cap(orgId, 1);
      const other = await createTestContext();
      await createTestAlertRule({ organizationId: other.organization.id, projectId: other.project.id });
      await createTestAlertRule({ organizationId: other.organization.id, projectId: other.project.id });
      expect((await post(metricBody(orgId, 'mine'))).statusCode).toBe(201);
    });
  });
});
