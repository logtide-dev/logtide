import { describe, it, expect, beforeEach, afterEach, afterAll, beforeAll, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import crypto from 'crypto';
import { db } from '../../../database/index.js';
import { alertsRoutes } from '../../../modules/alerts/routes.js';
import { alertsService } from '../../../modules/alerts/service.js';
import { auditLogService } from '../../../modules/audit-log/index.js';
import { incidentsService } from '../../../modules/incidents/service.js';
import {
  createTestAlertRule,
  createTestContext,
  createTestOrganization,
  createTestUser,
} from '../../helpers/factories.js';
import { getRuleRow, setRuleLifecycle } from './lifecycle-test-helpers.js';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

async function createTestSession(userId: string) {
  const token = crypto.randomBytes(32).toString('hex');
  await db
    .insertInto('sessions')
    .values({ user_id: userId, token, expires_at: new Date(Date.now() + DAY) })
    .execute();
  return token;
}

describe('Alert rule snooze, disable and delete', () => {
  let app: FastifyInstance;
  let token: string;
  let organizationId: string;
  let projectId: string;
  let ruleId: string;

  beforeAll(async () => {
    app = Fastify();
    await app.register(alertsRoutes, { prefix: '/api/v1/alerts' });
    await app.ready();
    auditLogService.start();
  });

  afterAll(async () => {
    await auditLogService.shutdown();
    await app.close();
  });

  beforeEach(async () => {
    const ctx = await createTestContext();
    organizationId = ctx.organization.id;
    projectId = ctx.project.id;
    token = await createTestSession(ctx.user.id);
    const rule = await createTestAlertRule({ organizationId, projectId, name: 'Snoozable', threshold: 5 });
    ruleId = rule.id;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const snooze = (id: string, payload: Record<string, unknown>, org = organizationId, auth = token) =>
    app.inject({
      method: 'POST',
      url: `/api/v1/alerts/${id}/snooze?organizationId=${org}`,
      headers: { Authorization: `Bearer ${auth}` },
      payload,
    });

  const unsnooze = (id: string, org = organizationId, auth = token) =>
    app.inject({
      method: 'DELETE',
      url: `/api/v1/alerts/${id}/snooze?organizationId=${org}`,
      headers: { Authorization: `Bearer ${auth}` },
    });

  describe('POST /:id/snooze', () => {
    it('POST snooze sets snoozedUntil', async () => {
      const until = new Date(Date.now() + HOUR).toISOString();
      const res = await snooze(ruleId, { until });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.alertRule).toMatchObject({ id: ruleId, snoozedUntil: until, channelIds: [], triggersLast24h: 0 });
      expect((await getRuleRow(ruleId)).snoozed_until).toEqual(new Date(until));
    });

    it('accepts an offset timestamp', async () => {
      const target = new Date(Date.now() + 2 * HOUR);
      target.setUTCMilliseconds(0);
      // Same instant expressed in +02:00
      const local = new Date(target.getTime() + 2 * HOUR).toISOString().replace('.000Z', '+02:00');
      const res = await snooze(ruleId, { until: local });

      expect(res.statusCode).toBe(200);
      expect(res.json().alertRule.snoozedUntil).toBe(target.toISOString());
    });

    it('rejects a snooze end in the past', async () => {
      const res = await snooze(ruleId, { until: new Date(Date.now() - 1000).toISOString() });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'Snooze end must be in the future' });
      expect((await getRuleRow(ruleId)).snoozed_until).toBeNull();
    });

    it('rejects a snooze end beyond 365 days', async () => {
      const res = await snooze(ruleId, { until: new Date(Date.now() + 366 * DAY).toISOString() });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'Snooze end must be within 365 days' });
    });

    it('rejects a missing or malformed until', async () => {
      expect((await snooze(ruleId, {})).statusCode).toBe(400);
      expect((await snooze(ruleId, { until: 'tomorrow' })).statusCode).toBe(400);
    });

    it('rejects an invalid rule id', async () => {
      const res = await snooze('not-a-uuid', { until: new Date(Date.now() + HOUR).toISOString() });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'Invalid alert rule ID format' });
    });

    it('snooze returns 404 for a rule of another org', async () => {
      const otherOrg = await createTestOrganization();
      const foreign = await createTestAlertRule({ organizationId: otherOrg.id });

      const res = await snooze(foreign.id, { until: new Date(Date.now() + HOUR).toISOString() });
      expect(res.statusCode).toBe(404);
      expect((await getRuleRow(foreign.id)).snoozed_until).toBeNull();
    });

    it('snooze returns 403 for a non-member org', async () => {
      const outsider = await createTestUser({ email: `outsider-${Date.now()}@example.com` });
      const outsiderToken = await createTestSession(outsider.id);

      const res = await snooze(ruleId, { until: new Date(Date.now() + HOUR).toISOString() }, organizationId, outsiderToken);
      expect(res.statusCode).toBe(403);
      expect((await getRuleRow(ruleId)).snoozed_until).toBeNull();
    });

    it('snooze records a rule.updated audit entry', async () => {
      await db.deleteFrom('audit_log').execute();
      const until = new Date(Date.now() + HOUR).toISOString();
      expect((await snooze(ruleId, { until })).statusCode).toBe(200);
      expect((await unsnooze(ruleId)).statusCode).toBe(200);

      // Wait for the audit log buffer to flush (interval: 1000ms)
      await new Promise((r) => setTimeout(r, 1500));

      const entries = await db
        .selectFrom('audit_log')
        .selectAll()
        .where('organization_id', '=', organizationId)
        .where('action', '=', 'rule.updated')
        .orderBy('time', 'asc')
        .execute();
      expect(entries).toHaveLength(2);
      expect(entries.map((e) => e.resource_id)).toEqual([ruleId, ruleId]);
      expect(entries.map((e) => e.metadata)).toEqual([
        { updatedFields: ['snoozedUntil'], snoozedUntil: until },
        { updatedFields: ['snoozedUntil'], snoozedUntil: null },
      ]);
    });

    it('snooze does not change the rule state', async () => {
      const firedAt = new Date(Date.now() - 10 * 60_000);
      await setRuleLifecycle(ruleId, { state: 'firing', last_triggered_at: firedAt, last_notified_at: firedAt });

      const res = await snooze(ruleId, { until: new Date(Date.now() + HOUR).toISOString() });
      expect(res.statusCode).toBe(200);
      expect(res.json().alertRule).toMatchObject({ state: 'firing', lastTriggeredAt: firedAt.toISOString() });
      expect(await getRuleRow(ruleId)).toMatchObject({ state: 'firing', last_triggered_at: firedAt, last_notified_at: firedAt });
    });
  });

  describe('DELETE /:id/snooze', () => {
    it('DELETE snooze clears it', async () => {
      await setRuleLifecycle(ruleId, { snoozed_until: new Date(Date.now() + HOUR) });

      const res = await unsnooze(ruleId);
      expect(res.statusCode).toBe(200);
      expect(res.json().alertRule).toMatchObject({ id: ruleId, snoozedUntil: null, triggersLast24h: 0 });
      expect((await getRuleRow(ruleId)).snoozed_until).toBeNull();
    });

    it('returns 404 for a rule of another org and 403 for a non-member', async () => {
      const otherOrg = await createTestOrganization();
      const foreign = await createTestAlertRule({ organizationId: otherOrg.id });
      const until = new Date(Date.now() + HOUR);
      await setRuleLifecycle(foreign.id, { snoozed_until: until });

      expect((await unsnooze(foreign.id)).statusCode).toBe(404);
      expect((await unsnooze(foreign.id, otherOrg.id)).statusCode).toBe(403);
      expect((await getRuleRow(foreign.id)).snoozed_until).toEqual(until);
    });
  });

  describe('service.snoozeAlertRule', () => {
    it('is scoped by organization', async () => {
      const otherOrg = await createTestOrganization();
      expect(await alertsService.snoozeAlertRule(ruleId, otherOrg.id, new Date(Date.now() + HOUR))).toBeNull();
      expect((await getRuleRow(ruleId)).snoozed_until).toBeNull();
    });
  });

  describe('disable and delete while firing', () => {
    const put = (id: string, payload: Record<string, unknown>) =>
      app.inject({
        method: 'PUT',
        url: `/api/v1/alerts/${id}?organizationId=${organizationId}`,
        headers: { Authorization: `Bearer ${token}` },
        payload,
      });
    const del = (id: string) =>
      app.inject({
        method: 'DELETE',
        url: `/api/v1/alerts/${id}?organizationId=${organizationId}`,
        headers: { Authorization: `Bearer ${token}` },
      });

    async function openRealIncident(): Promise<string> {
      const firedAt = new Date(Date.now() - 10 * 60_000);
      await setRuleLifecycle(ruleId, { state: 'firing', last_triggered_at: firedAt, last_notified_at: firedAt });
      const { incident } = await incidentsService.openOrUpdateFromSource({
        organizationId,
        projectId,
        source: 'alert',
        sourceId: ruleId,
        title: 'Snoozable',
        severity: 'high',
        occurredAt: firedAt,
      });
      return incident.id;
    }

    async function incidentRow(id: string) {
      return db
        .selectFrom('incidents')
        .selectAll()
        .where('id', '=', id)
        .where('organization_id', '=', organizationId)
        .executeTakeFirstOrThrow();
    }

    it('disabling a firing rule resets state and resolves its incident', async () => {
      const incidentId = await openRealIncident();
      const spy = vi.spyOn(incidentsService, 'resolveFromSource');

      const res = await put(ruleId, { enabled: false });
      expect(res.statusCode).toBe(200);
      expect(res.json().alertRule).toMatchObject({ enabled: false, state: 'ok' });
      expect((await getRuleRow(ruleId)).state).toBe('ok');

      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId, source: 'alert', sourceId: ruleId, reason: 'manual' })
      );
      expect(await incidentRow(incidentId)).toMatchObject({ status: 'resolved', alert_rule_id: ruleId });
    });

    it('disabling an ok rule does not call F4', async () => {
      const spy = vi.spyOn(incidentsService, 'resolveFromSource');

      const res = await put(ruleId, { enabled: false });
      expect(res.statusCode).toBe(200);
      expect(res.json().alertRule).toMatchObject({ enabled: false, state: 'ok' });
      expect(spy).not.toHaveBeenCalled();
    });

    it('other updates keep the firing state', async () => {
      await openRealIncident();
      const spy = vi.spyOn(incidentsService, 'resolveFromSource');

      const res = await put(ruleId, { threshold: 50, enabled: true });
      expect(res.statusCode).toBe(200);
      expect(res.json().alertRule).toMatchObject({ threshold: 50, state: 'firing' });
      expect(spy).not.toHaveBeenCalled();
    });

    it('deleting a firing rule resolves its incident', async () => {
      const incidentId = await openRealIncident();
      const spy = vi.spyOn(incidentsService, 'resolveFromSource');

      const res = await del(ruleId);
      expect(res.statusCode).toBe(204);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId, source: 'alert', sourceId: ruleId, reason: 'manual' })
      );

      // Resolved before the delete: the incident keeps its row and loses the rule id.
      expect(await incidentRow(incidentId)).toMatchObject({ status: 'resolved', alert_rule_id: null });
      expect(
        await db.selectFrom('alert_rules').select('id').where('id', '=', ruleId).where('organization_id', '=', organizationId).executeTakeFirst()
      ).toBeUndefined();
    });

    it('deleting an ok rule does not call F4', async () => {
      const spy = vi.spyOn(incidentsService, 'resolveFromSource');

      expect((await del(ruleId)).statusCode).toBe(204);
      expect(spy).not.toHaveBeenCalled();
    });

    it('deleting a rule of another org returns 404 and resolves nothing', async () => {
      const otherOrg = await createTestOrganization();
      const foreign = await createTestAlertRule({ organizationId: otherOrg.id });
      await setRuleLifecycle(foreign.id, { state: 'firing', last_triggered_at: new Date(), last_notified_at: new Date() });
      const spy = vi.spyOn(incidentsService, 'resolveFromSource');

      expect((await del(foreign.id)).statusCode).toBe(404);
      expect(spy).not.toHaveBeenCalled();
      expect((await getRuleRow(foreign.id)).state).toBe('firing');
    });
  });
});
