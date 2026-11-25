import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';

const { add } = vi.hoisted(() => ({ add: vi.fn() }));
vi.mock('../../../queue/connection.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../queue/connection.js')>();
  return { ...actual, createQueue: vi.fn(() => ({ add })) };
});

import type { FastifyInstance } from 'fastify';
import type { IncidentDetailResponse, MetricAlertConfig, MetricQueryResponse } from '@logtide/shared';
import { build } from '../../../server.js';
import { alertsService } from '../../../modules/alerts/service.js';
import { metricQueryService } from '../../../modules/metrics/query/service.js';
import { createTestAlertRule, createTestContext } from '../../helpers/factories.js';
import { createTestSession } from '../../helpers/auth.js';
import { insertIncident } from '../incidents/fixtures.js';

// Incident detail payload of a metric alert incident (S6): the rule, its
// threshold and the groups that fired, organization scoped.

let values: Record<string, number | null> = {};

function response(req: { from: string; to: string }): MetricQueryResponse {
  const from = Date.parse(req.from);
  const to = Date.parse(req.to);
  return {
    interval: '1m',
    warnings: [],
    queries: [{ id: 'A', seriesTotal: 1, seriesShown: 1, metricType: 'gauge', unit: '1' }],
    series: Object.entries(values).map(([host, v]) => {
      const points = [];
      for (let t = from; t < to; t += 60_000) points.push({ t: new Date(t).toISOString(), v });
      return {
        id: `A|${host}`,
        queryId: 'A',
        labels: { 'host.name': host },
        name: host,
        unit: '1',
        comparison: false,
        points,
        stats: { min: v, avg: v, max: v, last: v },
      };
    }),
  };
}

const config: MetricAlertConfig = {
  query: {
    projectIds: null,
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
  forEvaluations: 1,
  severity: 'high',
  unit: '1',
};

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

describe('incident detail: metric alerts', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await build({ logger: false });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    values = {};
    add.mockReset().mockResolvedValue(undefined);
    vi.spyOn(metricQueryService, 'run').mockImplementation(async (req) => response(req));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function detail(id: string, organizationId: string, token: string) {
    return app.inject({
      method: 'GET',
      url: `/api/v1/incidents/${id}?organizationId=${organizationId}`,
      headers: auth(token),
    });
  }

  it('exposes the rule, threshold and the firing and resolved groups', async () => {
    const ctx = await createTestContext();
    const session = await createTestSession(ctx.user.id);
    const rule = await alertsService.createAlertRule({
      organizationId: ctx.organization.id,
      name: 'CPU high',
      level: [],
      threshold: 0,
      timeWindow: 0,
      alertType: 'metric',
      emailRecipients: [],
      metricConfig: config,
    });

    const now = new Date();
    now.setSeconds(30, 0);
    values = { 'web-1': 0.95, 'web-2': 0.97 };
    const fired = await alertsService.checkAlertRules({ now });
    const incidentId = fired[0].incident_id as string;
    expect(incidentId).toBeTruthy();

    // web-1 recovers, web-2 keeps firing with a new value.
    values = { 'web-1': 0.1, 'web-2': 0.99 };
    await alertsService.checkAlertRules({ now: new Date(now.getTime() + 60_000) });

    const res = await detail(incidentId, ctx.organization.id, session.token);
    expect(res.statusCode).toBe(200);
    const body = res.json() as IncidentDetailResponse;
    expect(body.metricAlert).toMatchObject({
      ruleId: rule.id,
      ruleName: 'CPU high',
      queryId: 'A',
      source: 'system.cpu.utilization',
      condition: 'above',
      threshold: 0.9,
      unit: '1',
      window: '5m',
      config: { threshold: 0.9 },
    });
    expect(body.metricAlert!.groups).toEqual([
      {
        groupKey: 'host.name=web-2',
        labels: { 'host.name': 'web-2' },
        value: 0.99,
        state: 'firing',
        firingSince: now.toISOString(),
      },
      {
        groupKey: 'host.name=web-1',
        labels: { 'host.name': 'web-1' },
        value: 0.95,
        state: 'resolved',
        firingSince: now.toISOString(),
      },
    ]);

    // Another organization cannot read it.
    const other = await createTestContext();
    const otherSession = await createTestSession(other.user.id);
    expect((await detail(incidentId, other.organization.id, otherSession.token)).statusCode).toBe(404);

    // Disabled: the incident is resolved, every group reads as resolved.
    await alertsService.updateAlertRule(rule.id, ctx.organization.id, { enabled: false });
    const after = (await detail(incidentId, ctx.organization.id, session.token)).json() as IncidentDetailResponse;
    expect(after.incident.status).toBe('resolved');
    expect(after.metricAlert!.groups.map((g) => [g.groupKey, g.state])).toEqual([
      ['host.name=web-2', 'resolved'],
      ['host.name=web-1', 'resolved'],
    ]);

    // Deleted: still described from the incident's own events, without a config.
    await alertsService.deleteAlertRule(rule.id, ctx.organization.id);
    const gone = (await detail(incidentId, ctx.organization.id, session.token)).json() as IncidentDetailResponse;
    expect(gone.metricAlert).toMatchObject({ ruleId: null, config: null, threshold: 0.9, unit: '1', source: 'system.cpu.utilization' });
    expect(gone.metricAlert!.groups).toHaveLength(2);
  });

  it('has no metric view for a log alert incident', async () => {
    const ctx = await createTestContext();
    const session = await createTestSession(ctx.user.id);
    const rule = await createTestAlertRule({ organizationId: ctx.organization.id, projectId: ctx.project.id, name: 'Errors' });
    const incident = await insertIncident({
      organizationId: ctx.organization.id,
      projectId: ctx.project.id,
      source: 'alert',
      alertRuleId: rule.id,
      title: 'Errors',
    });
    const body = (await detail(incident.id, ctx.organization.id, session.token)).json() as IncidentDetailResponse;
    expect(body.metricAlert).toBeUndefined();
  });
});
