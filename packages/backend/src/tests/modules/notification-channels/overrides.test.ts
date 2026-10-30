import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import crypto from 'crypto';
import { db } from '../../../database/index.js';
import { notificationChannelsRoutes } from '../../../modules/notification-channels/routes.js';
import { notificationChannelsService } from '../../../modules/notification-channels/service.js';
import {
  createTestContext,
  createTestUser,
  createTestOrganization,
  createTestProject,
  createTestAlertRule,
  createTestSigmaRule,
} from '../../helpers/factories.js';

const SLACK_URL = 'https://hooks.slack.com/services/T0001/B0002/abcDEF';

async function addChannel(organizationId: string, name: string, enabled = true, url = SLACK_URL) {
  return db
    .insertInto('notification_channels')
    .values({
      organization_id: organizationId,
      name,
      type: 'webhook',
      enabled,
      config: JSON.stringify({ url }) as any,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}

async function addMonitor(organizationId: string, projectId: string, name: string) {
  return db
    .insertInto('monitors')
    .values({
      organization_id: organizationId,
      project_id: projectId,
      name,
      type: 'http',
      target: 'https://example.com/health',
    })
    .returning('id')
    .executeTakeFirstOrThrow();
}

async function addErrorGroup(organizationId: string, projectId: string) {
  const now = new Date();
  return db
    .insertInto('error_groups')
    .values({
      organization_id: organizationId,
      project_id: projectId,
      fingerprint: `fp-${crypto.randomBytes(4).toString('hex')}`,
      exception_type: 'TypeError',
      exception_message: 'boom',
      language: 'nodejs',
      occurrence_count: 1,
      first_seen: now,
      last_seen: now,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
}

describe('routing overrides', () => {
  let orgId: string;
  let projectId: string;
  let userId: string;

  beforeEach(async () => {
    await db.deleteFrom('organization_default_channels').execute();
    await db.deleteFrom('alert_rule_channels').execute();
    await db.deleteFrom('sigma_rule_channels').execute();
    await db.deleteFrom('monitor_channels').execute();
    await db.deleteFrom('incident_channels').execute();
    await db.deleteFrom('error_group_channels').execute();
    await db.deleteFrom('notification_channels').execute();
    await db.deleteFrom('error_groups').execute();
    await db.deleteFrom('monitors').execute();
    await db.deleteFrom('alert_history').execute();
    await db.deleteFrom('sigma_rules').execute();
    await db.deleteFrom('alert_rules').execute();
    await db.deleteFrom('api_keys').execute();
    await db.deleteFrom('organization_members').execute();
    await db.deleteFrom('projects').execute();
    await db.deleteFrom('organizations').execute();
    await db.deleteFrom('sessions').execute();
    await db.deleteFrom('users').execute();
    const ctx = await createTestContext();
    orgId = ctx.organization.id;
    projectId = ctx.project.id;
    userId = ctx.user.id;
  });

  it('returns all four kinds with the right event type and display type', async () => {
    const ch = await addChannel(orgId, 'Slack ops');
    const alertRule = await createTestAlertRule({ organizationId: orgId, projectId, name: 'API 5xx' });
    const sigmaRule = await createTestSigmaRule({ organizationId: orgId, title: 'Brute force' });
    const monitor = await addMonitor(orgId, projectId, 'Checkout');
    const group = await addErrorGroup(orgId, projectId);

    await db.insertInto('alert_rule_channels').values({ alert_rule_id: alertRule.id, channel_id: ch.id }).execute();
    await db.insertInto('sigma_rule_channels').values({ sigma_rule_id: sigmaRule.id, channel_id: ch.id }).execute();
    await db.insertInto('monitor_channels').values({ monitor_id: monitor.id, channel_id: ch.id }).execute();
    await db.insertInto('error_group_channels').values({ error_group_id: group.id, channel_id: ch.id }).execute();

    const overrides = await notificationChannelsService.getRoutingOverrides(orgId);
    const byKind = Object.fromEntries(overrides.map((o) => [o.kind, o]));

    expect(byKind.alert_rule).toMatchObject({ eventType: 'alert', id: alertRule.id, name: 'API 5xx' });
    expect(byKind.sigma_rule).toMatchObject({ eventType: 'sigma', id: sigmaRule.id, name: 'Brute force' });
    expect(byKind.monitor).toMatchObject({ eventType: 'monitoring', id: monitor.id, name: 'Checkout' });
    expect(byKind.error_group).toMatchObject({ eventType: 'error', id: group.id });
    expect(byKind.alert_rule.channels).toEqual([{ id: ch.id, name: 'Slack ops', type: 'slack' }]);
  });

  it('omits disabled channels', async () => {
    const off = await addChannel(orgId, 'Off', false);
    const rule = await createTestAlertRule({ organizationId: orgId, projectId });
    await db.insertInto('alert_rule_channels').values({ alert_rule_id: rule.id, channel_id: off.id }).execute();
    expect(await notificationChannelsService.getRoutingOverrides(orgId)).toEqual([]);
  });

  it('does not leak rules of another organization', async () => {
    const ownerB = await createTestUser({ email: 'owner-b@test.com' });
    const orgB = await createTestOrganization({ ownerId: ownerB.id });
    const projectB = await createTestProject({ organizationId: orgB.id, userId: ownerB.id });
    const chB = await addChannel(orgB.id, 'B channel');
    const ruleB = await createTestAlertRule({ organizationId: orgB.id, projectId: projectB.id });
    await db.insertInto('alert_rule_channels').values({ alert_rule_id: ruleB.id, channel_id: chB.id }).execute();

    expect(await notificationChannelsService.getRoutingOverrides(orgId)).toEqual([]);
    expect(await notificationChannelsService.getRoutingOverrides(orgB.id)).toHaveLength(1);
  });

  it('ignores a cross-organization link (channel of B attached to a rule of A)', async () => {
    const ownerB = await createTestUser({ email: 'owner-b2@test.com' });
    const orgB = await createTestOrganization({ ownerId: ownerB.id });
    const chB = await addChannel(orgB.id, 'B channel');
    const ruleA = await createTestAlertRule({ organizationId: orgId, projectId });
    await db.insertInto('alert_rule_channels').values({ alert_rule_id: ruleA.id, channel_id: chB.id }).execute();

    expect(await notificationChannelsService.getRoutingOverrides(orgId)).toEqual([]);
    expect(await notificationChannelsService.getRoutingOverrides(orgB.id)).toEqual([]);
  });

  describe('GET /overrides', () => {
    let app: FastifyInstance;

    beforeAll(async () => {
      app = Fastify();
      await app.register(notificationChannelsRoutes, { prefix: '/api/v1/notification-channels' });
      await app.ready();
    });

    afterAll(async () => {
      await app.close();
    });

    async function session(uid: string) {
      const token = crypto.randomBytes(32).toString('hex');
      await db
        .insertInto('sessions')
        .values({ user_id: uid, token, expires_at: new Date(Date.now() + 86400000) })
        .execute();
      return token;
    }

    it('returns overrides to a member and 403 to an outsider', async () => {
      const ch = await addChannel(orgId, 'Slack ops');
      const rule = await createTestAlertRule({ organizationId: orgId, projectId });
      await db.insertInto('alert_rule_channels').values({ alert_rule_id: rule.id, channel_id: ch.id }).execute();

      const ok = await app.inject({
        method: 'GET',
        url: `/api/v1/notification-channels/overrides?organizationId=${orgId}`,
        headers: { Authorization: `Bearer ${await session(userId)}` },
      });
      expect(ok.statusCode).toBe(200);
      expect(ok.json().overrides).toHaveLength(1);

      const outsider = await createTestUser({ email: 'outsider@test.com' });
      const denied = await app.inject({
        method: 'GET',
        url: `/api/v1/notification-channels/overrides?organizationId=${orgId}`,
        headers: { Authorization: `Bearer ${await session(outsider.id)}` },
      });
      expect(denied.statusCode).toBe(403);
    });
  });
});
