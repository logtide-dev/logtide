import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from 'vitest';
import request from 'supertest';
import type { FastifyInstance } from 'fastify';
import { build } from '../../../server.js';
import { db } from '../../../database/index.js';
import { truncateAllTables, createTestAlertRule, createTestLog } from '../../helpers/index.js';
import { createTestSession } from '../../helpers/auth.js';
import { createIsolatedTenants, type IsolatedTenants } from '../../isolation/helpers.js';
import { alertsService } from '../../../modules/alerts/service.js';
import { incidentsService } from '../../../modules/incidents/service.js';
import { getRuleRow, setRuleLifecycle } from './lifecycle-test-helpers.js';

async function sessionHeader(userId: string) {
  const session = await createTestSession(userId);
  return { Authorization: `Bearer ${session.token}` };
}

const minus = (t: Date, minutes: number) => new Date(t.getTime() - minutes * 60_000);
const plus = (t: Date, minutes: number) => new Date(t.getTime() + minutes * 60_000);

async function errorLogs(projectId: string, count: number, time: Date, metadata?: Record<string, unknown>) {
  for (let i = 0; i < count; i++) {
    await createTestLog({ projectId, level: 'error', message: 'Request failed', time, metadata });
  }
}

async function insertHistory(ruleId: string, count: number, triggeredAt: Date) {
  for (let i = 0; i < count; i++) {
    await db.insertInto('alert_history').values({ rule_id: ruleId, triggered_at: triggeredAt, log_count: 3 }).execute();
  }
}

describe('Tenant isolation - alert lifecycle', () => {
  let app: FastifyInstance;
  let t: IsolatedTenants;
  let NOW: Date;

  beforeAll(async () => {
    app = await build();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateAllTables();
    t = await createIsolatedTenants();
    const d = new Date();
    d.setMilliseconds(0);
    NOW = d;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('snooze', () => {
    it('org B cannot snooze or unsnooze an org A rule', async () => {
      const ruleA = await createTestAlertRule({ organizationId: t.orgA.id, projectId: t.orgA.projects[0].id });
      const stored = plus(NOW, 120);
      await setRuleLifecycle(ruleA.id, { snoozed_until: stored });
      const headersB = await sessionHeader(t.orgB.ownerUserId);
      const until = plus(new Date(), 60).toISOString();

      for (const organizationId of [t.orgB.id, t.orgA.id]) {
        const post = await request(app.server)
          .post(`/api/v1/alerts/${ruleA.id}/snooze`)
          .query({ organizationId })
          .set(headersB)
          .send({ until });
        expect([403, 404]).toContain(post.status);

        const del = await request(app.server)
          .delete(`/api/v1/alerts/${ruleA.id}/snooze`)
          .query({ organizationId })
          .set(headersB);
        expect([403, 404]).toContain(del.status);
      }

      // own org id -> 404 (the rule is not in org B); foreign org id -> 403 (not a member)
      const own = await request(app.server)
        .post(`/api/v1/alerts/${ruleA.id}/snooze`)
        .query({ organizationId: t.orgB.id })
        .set(headersB)
        .send({ until });
      expect(own.status).toBe(404);

      expect((await getRuleRow(ruleA.id)).snoozed_until).toEqual(stored);
      // Wait for the audit log buffer to flush (interval: 1000ms)
      await new Promise((r) => setTimeout(r, 1500));
      const audit = await db
        .selectFrom('audit_log')
        .select('id')
        .where('organization_id', 'in', [t.orgA.id, t.orgB.id])
        .where('action', '=', 'rule.updated')
        .execute();
      expect(audit).toHaveLength(0);
    });

    it('the org A owner can snooze the org A rule', async () => {
      const ruleA = await createTestAlertRule({ organizationId: t.orgA.id, projectId: t.orgA.projects[0].id });
      const until = plus(new Date(), 60);
      until.setMilliseconds(0);

      const res = await request(app.server)
        .post(`/api/v1/alerts/${ruleA.id}/snooze`)
        .query({ organizationId: t.orgA.id })
        .set(await sessionHeader(t.orgA.ownerUserId))
        .send({ until: until.toISOString() });

      expect(res.status).toBe(200);
      expect((await getRuleRow(ruleA.id)).snoozed_until).toEqual(until);
    });
  });

  describe('disable and delete', () => {
    it('org B cannot disable or delete a firing org A rule, and its incident stays open', async () => {
      const ruleA = await createTestAlertRule({ organizationId: t.orgA.id, projectId: t.orgA.projects[0].id });
      await setRuleLifecycle(ruleA.id, { state: 'firing', last_triggered_at: minus(NOW, 2), last_notified_at: minus(NOW, 2) });
      const resolveSpy = vi.spyOn(incidentsService, 'resolveFromSource');
      const headersB = await sessionHeader(t.orgB.ownerUserId);

      for (const organizationId of [t.orgB.id, t.orgA.id]) {
        const put = await request(app.server)
          .put(`/api/v1/alerts/${ruleA.id}`)
          .query({ organizationId })
          .set(headersB)
          .send({ enabled: false });
        expect([403, 404]).toContain(put.status);

        const del = await request(app.server)
          .delete(`/api/v1/alerts/${ruleA.id}`)
          .query({ organizationId })
          .set(headersB);
        expect([403, 404]).toContain(del.status);
      }

      expect(resolveSpy).not.toHaveBeenCalled();
      expect(await getRuleRow(ruleA.id)).toMatchObject({ enabled: true, state: 'firing' });
    });
  });

  describe('triggersLast24h', () => {
    it('triggersLast24h never counts another org history', async () => {
      const ruleA = await createTestAlertRule({ organizationId: t.orgA.id, projectId: t.orgA.projects[0].id, name: 'A rule' });
      const ruleB = await createTestAlertRule({ organizationId: t.orgB.id, projectId: t.orgB.projects[0].id, name: 'B rule' });
      await insertHistory(ruleA.id, 1, minus(new Date(), 30));
      await insertHistory(ruleB.id, 4, minus(new Date(), 30));

      const listA = await request(app.server)
        .get('/api/v1/alerts')
        .query({ organizationId: t.orgA.id })
        .set(await sessionHeader(t.orgA.ownerUserId));
      expect(listA.status).toBe(200);
      expect(listA.body.alertRules.map((r: { id: string }) => r.id)).toEqual([ruleA.id]);
      expect(listA.body.alertRules[0].triggersLast24h).toBe(1);

      const one = await request(app.server)
        .get(`/api/v1/alerts/${ruleA.id}`)
        .query({ organizationId: t.orgA.id })
        .set(await sessionHeader(t.orgA.ownerUserId));
      expect(one.status).toBe(200);
      expect(one.body.alertRule.triggersLast24h).toBe(1);

      // org B asking with its own id never sees the org A rule or its count
      const listB = await request(app.server)
        .get('/api/v1/alerts')
        .query({ organizationId: t.orgB.id })
        .set(await sessionHeader(t.orgB.ownerUserId));
      expect(listB.body.alertRules.map((r: { id: string }) => r.id)).toEqual([ruleB.id]);
      expect(listB.body.alertRules[0].triggersLast24h).toBe(4);
    });
  });

  describe('evaluation', () => {
    async function createRule(body: Record<string, unknown>) {
      const res = await request(app.server)
        .post('/api/v1/alerts')
        .set(await sessionHeader(t.orgA.ownerUserId))
        .send({
          organizationId: t.orgA.id,
          name: 'Prod errors',
          level: ['error'],
          threshold: 1,
          timeWindow: 5,
          emailRecipients: [],
          ...body,
        });
      expect(res.status).toBe(201);
      return res.body.alertRule as { id: string };
    }

    it('evaluation with a metadata query never counts another org logs', async () => {
      vi.spyOn(incidentsService, 'openOrUpdateFromSource').mockResolvedValue({ incident: { id: crypto.randomUUID() } as never, created: true });
      const orgWide = await createRule({ projectId: null, query: 'env:prod' });
      const scoped = await createRule({ projectId: t.orgA.projects[0].id, query: 'env:prod', name: 'Scoped' });
      await errorLogs(t.orgB.projects[0].id, 5, minus(NOW, 1), { env: 'prod' });

      const results = await alertsService.checkAlertRules({ now: NOW });

      expect(results.filter((r) => r.rule_id === orgWide.id || r.rule_id === scoped.id)).toEqual([]);
      expect((await getRuleRow(orgWide.id)).state).toBe('ok');
      expect((await getRuleRow(scoped.id)).state).toBe('ok');
    });

    it('an org-wide query rule counts only its own org logs', async () => {
      vi.spyOn(incidentsService, 'openOrUpdateFromSource').mockResolvedValue({ incident: { id: crypto.randomUUID() } as never, created: true });
      const orgWide = await createRule({ projectId: null, query: 'env:prod', threshold: 2 });
      await errorLogs(t.orgA.projects[0].id, 1, minus(NOW, 1), { env: 'prod' });
      await errorLogs(t.orgA.projects[1].id, 1, minus(NOW, 1), { env: 'prod' });
      await errorLogs(t.orgA.projects[1].id, 3, minus(NOW, 1), { env: 'dev' });
      await errorLogs(t.orgB.projects[0].id, 9, minus(NOW, 1), { env: 'prod' });

      const results = await alertsService.checkAlertRules({ now: NOW });

      expect(results).toEqual([
        expect.objectContaining({ kind: 'triggered', rule_id: orgWide.id, organization_id: t.orgA.id, log_count: 2 }),
      ]);
    });

    it('incidents for an org A rule carry the org A id', async () => {
      const openSpy = vi.spyOn(incidentsService, 'openOrUpdateFromSource');
      const ruleA = await createRule({ projectId: t.orgA.projects[0].id, query: 'env:prod' });
      const ruleB = await createTestAlertRule({ organizationId: t.orgB.id, projectId: t.orgB.projects[0].id, threshold: 1, timeWindow: 5 });
      await errorLogs(t.orgA.projects[0].id, 2, minus(NOW, 1), { env: 'prod' });
      await errorLogs(t.orgB.projects[0].id, 2, minus(NOW, 1), { env: 'prod' });

      const results = await alertsService.checkAlertRules({ now: NOW });
      expect(results).toHaveLength(2);

      const callA = openSpy.mock.calls.find(([input]) => input.sourceId === ruleA.id)?.[0];
      const callB = openSpy.mock.calls.find(([input]) => input.sourceId === ruleB.id)?.[0];
      expect(callA).toMatchObject({ organizationId: t.orgA.id, projectId: t.orgA.projects[0].id, source: 'alert' });
      expect(callB).toMatchObject({ organizationId: t.orgB.id, projectId: t.orgB.projects[0].id, source: 'alert' });

      // the real F4 rows live in the rule's own organization
      const incidents = await db
        .selectFrom('incidents')
        .select(['organization_id', 'alert_rule_id', 'project_id'])
        .where('organization_id', 'in', [t.orgA.id, t.orgB.id])
        .where('source', '=', 'alert')
        .execute();
      expect(incidents).toHaveLength(2);
      expect(incidents.find((i) => i.alert_rule_id === ruleA.id)).toMatchObject({ organization_id: t.orgA.id, project_id: t.orgA.projects[0].id });
      expect(incidents.find((i) => i.alert_rule_id === ruleB.id)).toMatchObject({ organization_id: t.orgB.id, project_id: t.orgB.projects[0].id });

      // results carry the incident of their own rule
      const resultA = results.find((r) => r.rule_id === ruleA.id);
      const incidentA = await db
        .selectFrom('incidents')
        .select('id')
        .where('organization_id', '=', t.orgA.id)
        .where('alert_rule_id', '=', ruleA.id)
        .executeTakeFirstOrThrow();
      expect(resultA?.incident_id).toBe(incidentA.id);
    });
  });

  describe('query validation through the real error handler', () => {
    it('an invalid query returns { error, position } through the real error handler', async () => {
      const headersA = await sessionHeader(t.orgA.ownerUserId);
      const base = {
        organizationId: t.orgA.id,
        projectId: t.orgA.projects[0].id,
        name: 'Broken query',
        level: ['error'],
        threshold: 1,
        timeWindow: 5,
        emailRecipients: [],
      };

      const create = await request(app.server).post('/api/v1/alerts').set(headersA).send({ ...base, query: 'timeout (' });
      expect(create.status).toBe(400);
      expect(typeof create.body.error).toBe('string');
      expect(typeof create.body.position).toBe('number');

      const ruleA = await createTestAlertRule({ organizationId: t.orgA.id, projectId: t.orgA.projects[0].id });
      const update = await request(app.server)
        .put(`/api/v1/alerts/${ruleA.id}`)
        .query({ organizationId: t.orgA.id })
        .set(headersA)
        .send({ query: 'timeout (' });
      expect(update.status).toBe(400);
      expect(typeof update.body.position).toBe('number');

      const preview = await request(app.server)
        .post('/api/v1/alerts/preview')
        .set(headersA)
        .send({ ...base, previewRange: '1d', query: 'timeout (' });
      expect(preview.status).toBe(400);
      expect(typeof preview.body.error).toBe('string');
      expect(typeof preview.body.position).toBe('number');

      // lifecycle validation without a parser position
      const roc = await request(app.server)
        .post('/api/v1/alerts')
        .set(headersA)
        .send({ ...base, alertType: 'rate_of_change', baselineType: 'rolling_7d_avg', deviationMultiplier: 3, query: 'timeout' });
      expect(roc.status).toBe(400);
      expect(roc.body).toEqual({ error: expect.any(String) });
    });

    it('a preview with a query cannot read another org project', async () => {
      const res = await request(app.server)
        .post('/api/v1/alerts/preview')
        .set(await sessionHeader(t.orgB.ownerUserId))
        .send({
          organizationId: t.orgB.id,
          projectId: t.orgA.projects[0].id,
          level: ['error'],
          threshold: 1,
          timeWindow: 5,
          previewRange: '1d',
          query: 'timeout',
        });
      expect(res.status).toBe(403);
    });
  });
});
