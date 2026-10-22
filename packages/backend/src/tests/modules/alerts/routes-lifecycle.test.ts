import { describe, it, expect, beforeEach, afterAll, beforeAll } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import crypto from 'crypto';
import { db } from '../../../database/index.js';
import { alertsRoutes } from '../../../modules/alerts/routes.js';
import { alertsService } from '../../../modules/alerts/service.js';
import { createTestContext, createTestAlertRule } from '../../helpers/factories.js';
import { getRuleRow, setRuleLifecycle } from './lifecycle-test-helpers.js';

async function createTestSession(userId: string) {
  const token = crypto.randomBytes(32).toString('hex');
  await db
    .insertInto('sessions')
    .values({ user_id: userId, token, expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000) })
    .execute();
  return token;
}

const HOUR = 60 * 60 * 1000;

async function insertHistory(ruleId: string, triggeredAt: Date) {
  await db.insertInto('alert_history').values({ rule_id: ruleId, triggered_at: triggeredAt, log_count: 3 }).execute();
}

describe('Alerts routes: lifecycle fields', () => {
  let app: FastifyInstance;
  let token: string;
  let organizationId: string;
  let projectId: string;

  let validRule: Record<string, unknown>;
  let rocRule: Record<string, unknown>;

  beforeAll(async () => {
    app = Fastify();
    await app.register(alertsRoutes, { prefix: '/api/v1/alerts' });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    const ctx = await createTestContext();
    organizationId = ctx.organization.id;
    projectId = ctx.project.id;
    token = await createTestSession(ctx.user.id);
    validRule = {
      organizationId,
      projectId,
      name: 'Lifecycle rule',
      level: ['error'],
      threshold: 5,
      timeWindow: 5,
      emailRecipients: ['ops@example.com'],
    };
    rocRule = {
      ...validRule,
      name: 'Volume spike',
      alertType: 'rate_of_change',
      baselineType: 'rolling_7d_avg',
      deviationMultiplier: 3,
    };
  });

  const post = (payload: Record<string, unknown>) =>
    app.inject({ method: 'POST', url: '/api/v1/alerts', headers: { Authorization: `Bearer ${token}` }, payload });

  const put = (id: string, payload: Record<string, unknown>) =>
    app.inject({
      method: 'PUT',
      url: `/api/v1/alerts/${id}?organizationId=${organizationId}`,
      headers: { Authorization: `Bearer ${token}` },
      payload,
    });

  const get = (url: string) => app.inject({ method: 'GET', url, headers: { Authorization: `Bearer ${token}` } });

  describe('POST /api/v1/alerts', () => {
    it('create accepts a rule with no recipients and no channels', async () => {
      const res = await post({ ...validRule, emailRecipients: [], channelIds: [] });
      expect(res.statusCode).toBe(201);
      expect((await post({ ...validRule, emailRecipients: undefined, channelIds: undefined })).statusCode).toBe(201);
    });

    it('create accepts query and renotifyMinutes and returns lifecycle fields', async () => {
      const res = await post({ ...validRule, query: 'timeout', renotifyMinutes: 30 });
      expect(res.statusCode).toBe(201);
      expect(res.json().alertRule).toMatchObject({
        query: 'timeout',
        renotifyMinutes: 30,
        state: 'ok',
        lastTriggeredAt: null,
        lastEvaluatedAt: null,
        lastNotifiedAt: null,
        snoozedUntil: null,
        triggersLast24h: 0,
      });
      const row = await getRuleRow(res.json().alertRule.id);
      expect(row).toMatchObject({ query: 'timeout', renotify_minutes: 30, state: 'ok' });
    });

    it('create trims the query and stores a blank query as null', async () => {
      const trimmed = await post({ ...validRule, query: '  timeout  ' });
      expect(trimmed.json().alertRule.query).toBe('timeout');
      const blank = await post({ ...validRule, query: '   ' });
      expect(blank.statusCode).toBe(201);
      expect(blank.json().alertRule.query).toBeNull();
    });

    it('create returns 400 with position for an invalid query', async () => {
      const res = await post({ ...validRule, query: 'timeout (a b)' });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: expect.any(String), position: expect.any(Number) });
      const count = await alertsService.countAlertRules(organizationId);
      expect(count).toBe(0);
    });

    it('create accepts a query that contradicts the rule levels (matches nothing, not a save error)', async () => {
      const res = await post({ ...validRule, query: 'level:info' });
      expect(res.statusCode).toBe(201);
      expect(res.json().alertRule.query).toBe('level:info');
    });

    it('create rejects a query on a rate-of-change rule', async () => {
      const res = await post({ ...rocRule, query: 'timeout' });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'Text queries are only supported on threshold rules' });
    });

    it('create rejects renotifyMinutes on a rate-of-change rule', async () => {
      const res = await post({ ...rocRule, renotifyMinutes: 30 });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'Re-notify interval is only supported on threshold rules' });
    });

    it('create accepts a blank query and a null renotifyMinutes on a rate-of-change rule', async () => {
      const res = await post({ ...rocRule, query: '', renotifyMinutes: null });
      expect(res.statusCode).toBe(201);
      expect(res.json().alertRule).toMatchObject({ alertType: 'rate_of_change', query: null, renotifyMinutes: null });
    });

    it('rejects renotifyMinutes outside 5 to 1440', async () => {
      expect((await post({ ...validRule, renotifyMinutes: 4 })).statusCode).toBe(400);
      expect((await post({ ...validRule, renotifyMinutes: 1441 })).statusCode).toBe(400);
      expect((await post({ ...validRule, renotifyMinutes: 5 })).statusCode).toBe(201);
      expect((await post({ ...validRule, renotifyMinutes: 1440 })).statusCode).toBe(201);

      const created = await createTestAlertRule({ organizationId, projectId });
      expect((await put(created.id, { renotifyMinutes: 4 })).statusCode).toBe(400);
      expect((await put(created.id, { renotifyMinutes: 1441 })).statusCode).toBe(400);
    });

    it('rejects a query longer than 2,000 characters', async () => {
      expect((await post({ ...validRule, query: 'a'.repeat(2001) })).statusCode).toBe(400);
    });
  });

  describe('PUT /api/v1/alerts/:id', () => {
    it('update rejects switching a rule with a query to rate-of-change', async () => {
      const created = (await post({ ...validRule, query: 'timeout' })).json().alertRule;
      const res = await put(created.id, {
        alertType: 'rate_of_change',
        baselineType: 'rolling_7d_avg',
        deviationMultiplier: 3,
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'Text queries are only supported on threshold rules' });
      expect(await getRuleRow(created.id)).toMatchObject({ alert_type: 'threshold', query: 'timeout' });

      // clearing the query in the same request makes the switch valid
      const ok = await put(created.id, {
        alertType: 'rate_of_change',
        baselineType: 'rolling_7d_avg',
        deviationMultiplier: 3,
        query: null,
      });
      expect(ok.statusCode).toBe(200);
      expect(ok.json().alertRule).toMatchObject({ alertType: 'rate_of_change', query: null });
    });

    it('update rejects switching a rule with renotifyMinutes to rate-of-change', async () => {
      const created = (await post({ ...validRule, renotifyMinutes: 60 })).json().alertRule;
      const res = await put(created.id, { alertType: 'rate_of_change', baselineType: 'rolling_7d_avg', deviationMultiplier: 3 });
      expect(res.json()).toEqual({ error: 'Re-notify interval is only supported on threshold rules' });
      expect((await getRuleRow(created.id)).renotify_minutes).toBe(60);
    });

    it('update validates the body against the stored criteria', async () => {
      const roc = (await post(rocRule)).json().alertRule;
      expect((await put(roc.id, { query: 'timeout' })).json()).toEqual({
        error: 'Text queries are only supported on threshold rules',
      });
      expect((await put(roc.id, { renotifyMinutes: 30 })).json()).toEqual({
        error: 'Re-notify interval is only supported on threshold rules',
      });

      const threshold = (await post(validRule)).json().alertRule;
      const bad = await put(threshold.id, { query: 'timeout (a b)' });
      expect(bad.statusCode).toBe(400);
      expect(bad.json()).toEqual({ error: expect.any(String), position: expect.any(Number) });
      expect((await getRuleRow(threshold.id)).query).toBeNull();

      // a query contradicting the stored levels merges to "match nothing" (not an error)
      const contradicting = await put(threshold.id, { query: 'level:info' });
      expect(contradicting.statusCode).toBe(200);
      expect(contradicting.json().alertRule.query).toBe('level:info');
    });

    it('update clears the query with an empty string', async () => {
      const created = (await post({ ...validRule, query: 'timeout' })).json().alertRule;
      const res = await put(created.id, { query: '' });
      expect(res.statusCode).toBe(200);
      expect(res.json().alertRule.query).toBeNull();
      expect((await getRuleRow(created.id)).query).toBeNull();
    });

    it('update keeps the stored query when the body omits it', async () => {
      const created = (await post({ ...validRule, query: 'timeout' })).json().alertRule;
      const res = await put(created.id, { name: 'Renamed' });
      expect(res.json().alertRule).toMatchObject({ name: 'Renamed', query: 'timeout' });
    });

    it('update sets and clears renotifyMinutes', async () => {
      const created = (await post(validRule)).json().alertRule;
      expect((await put(created.id, { renotifyMinutes: 15 })).json().alertRule.renotifyMinutes).toBe(15);
      expect((await put(created.id, { renotifyMinutes: null })).json().alertRule.renotifyMinutes).toBeNull();
    });

    it('update returns 404 for a missing rule before validating criteria', async () => {
      const res = await put(crypto.randomUUID(), { query: 'timeout (a b)' });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: 'Alert rule not found' });
    });
  });

  describe('GET /api/v1/alerts', () => {
    it('list returns triggersLast24h counting only the last 24 hours', async () => {
      const busy = await createTestAlertRule({ organizationId, projectId, name: 'Busy' });
      const quiet = await createTestAlertRule({ organizationId, projectId, name: 'Quiet' });
      const now = Date.now();
      await insertHistory(busy.id, new Date(now - 1 * HOUR));
      await insertHistory(busy.id, new Date(now - 2 * HOUR));
      await insertHistory(busy.id, new Date(now - 25 * HOUR));

      const res = await get(`/api/v1/alerts?organizationId=${organizationId}`);
      expect(res.statusCode).toBe(200);
      const byId = new Map(res.json().alertRules.map((r: any) => [r.id, r]));
      expect((byId.get(busy.id) as any).triggersLast24h).toBe(2);
      expect((byId.get(quiet.id) as any).triggersLast24h).toBe(0);

      const one = await get(`/api/v1/alerts/${busy.id}?organizationId=${organizationId}`);
      expect(one.statusCode).toBe(200);
      expect(one.json().alertRule.triggersLast24h).toBe(2);
    });

    it('list returns the stored lifecycle state', async () => {
      const rule = await createTestAlertRule({ organizationId, projectId });
      const firingSince = new Date(Date.now() - 10 * 60 * 1000);
      const snoozedUntil = new Date(Date.now() + HOUR);
      await setRuleLifecycle(rule.id, {
        state: 'firing',
        last_triggered_at: firingSince,
        last_notified_at: firingSince,
        snoozed_until: snoozedUntil,
        renotify_minutes: 30,
        query: 'timeout',
      });

      const res = await get(`/api/v1/alerts?organizationId=${organizationId}`);
      expect(res.json().alertRules[0]).toMatchObject({
        id: rule.id,
        state: 'firing',
        lastTriggeredAt: firingSince.toISOString(),
        lastNotifiedAt: firingSince.toISOString(),
        lastEvaluatedAt: null,
        snoozedUntil: snoozedUntil.toISOString(),
        renotifyMinutes: 30,
        query: 'timeout',
      });
    });
  });

  describe('GET /api/v1/alerts/history', () => {
    it('history entries include query and metadataFilters', async () => {
      const created = (
        await post({
          ...validRule,
          query: 'timeout',
          metadataFilters: [{ key: 'env', op: 'equals', value: 'prod' }],
        })
      ).json().alertRule;
      await insertHistory(created.id, new Date(Date.now() - HOUR));
      const plain = await createTestAlertRule({ organizationId, projectId, name: 'Plain' });
      await insertHistory(plain.id, new Date(Date.now() - 2 * HOUR));

      const res = await get(`/api/v1/alerts/history?organizationId=${organizationId}`);
      expect(res.statusCode).toBe(200);
      const [first, second] = res.json().history;
      expect(first).toMatchObject({
        ruleId: created.id,
        query: 'timeout',
        metadataFilters: [expect.objectContaining({ key: 'env', op: 'equals', value: 'prod' })],
      });
      expect(second).toMatchObject({ ruleId: plain.id, query: null, metadataFilters: [] });
    });
  });

  describe('AlertsService.countTriggersSince', () => {
    it('counts per rule inside one organization only', async () => {
      const mine = await createTestAlertRule({ organizationId, projectId });
      const other = await createTestContext();
      const theirs = await createTestAlertRule({ organizationId: other.organization.id, projectId: other.project.id });
      const now = Date.now();
      await insertHistory(mine.id, new Date(now - HOUR));
      await insertHistory(theirs.id, new Date(now - HOUR));

      const since = new Date(now - 24 * HOUR);
      const counts = await alertsService.countTriggersSince(organizationId, since);
      expect(counts.get(mine.id)).toBe(1);
      expect(counts.has(theirs.id)).toBe(false);
      expect([...counts.keys()]).toEqual([mine.id]);
    });
  });
});
