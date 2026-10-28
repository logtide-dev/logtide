import { describe, it, expect, beforeEach, afterAll, beforeAll } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { db } from '../../../database/index.js';
import { notificationChannelsRoutes } from '../../../modules/notification-channels/routes.js';
import { createTestContext, createTestUser, createTestOrganization, createTestAlertRule, createTestSigmaRule } from '../../helpers/factories.js';
import crypto from 'crypto';

// Helper to create a session for a user
async function createTestSession(userId: string) {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

  await db
    .insertInto('sessions')
    .values({
      user_id: userId,
      token,
      expires_at: expiresAt,
    })
    .execute();

  return { token, expiresAt };
}

describe('Notification Channels Routes', () => {
  let app: FastifyInstance;
  let authToken: string;
  let testUser: any;
  let testOrganization: any;
  let testProject: any;

  beforeAll(async () => {
    app = Fastify();
    await app.register(notificationChannelsRoutes, { prefix: '/api/v1/notification-channels' });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    // Clean up tables in correct order
    await db.deleteFrom('organization_default_channels').execute();
    await db.deleteFrom('alert_rule_channels').execute();
    await db.deleteFrom('sigma_rule_channels').execute();
    await db.deleteFrom('incident_channels').execute();
    await db.deleteFrom('error_group_channels').execute();
    await db.deleteFrom('notification_channels').execute();
    await db.deleteFrom('alert_history').execute();
    await db.deleteFrom('sigma_rules').execute();
    await db.deleteFrom('alert_rules').execute();
    await db.deleteFrom('api_keys').execute();
    await db.deleteFrom('notifications').execute();
    await db.deleteFrom('organization_members').execute();
    await db.deleteFrom('projects').execute();
    await db.deleteFrom('organizations').execute();
    await db.deleteFrom('sessions').execute();
    await db.deleteFrom('users').execute();

    // Create test context
    const context = await createTestContext();
    testUser = context.user;
    testOrganization = context.organization;
    testProject = context.project;

    // Create session for auth
    const session = await createTestSession(testUser.id);
    authToken = session.token;
  });

  describe('GET /api/v1/notification-channels', () => {
    it('should list channels for organization', async () => {
      // Create a channel directly in DB
      await db
        .insertInto('notification_channels')
        .values({
          organization_id: testOrganization.id,
          name: 'Test Channel',
          type: 'email',
          config: { recipients: ['test@example.com'] },
        })
        .execute();

      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/notification-channels?organizationId=${testOrganization.id}`,
        headers: { Authorization: `Bearer ${authToken}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.channels).toHaveLength(1);
      expect(body.channels[0].name).toBe('Test Channel');
    });

    it('should return 400 without organizationId', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/notification-channels',
        headers: { Authorization: `Bearer ${authToken}` },
      });

      expect(response.statusCode).toBe(400);
    });

    it('should return 401 without auth', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/notification-channels?organizationId=${testOrganization.id}`,
      });

      expect(response.statusCode).toBe(401);
    });

    it('should return 403 for non-member', async () => {
      const otherUser = await createTestUser({ email: 'other@test.com' });
      const otherSession = await createTestSession(otherUser.id);

      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/notification-channels?organizationId=${testOrganization.id}`,
        headers: { Authorization: `Bearer ${otherSession.token}` },
      });

      expect(response.statusCode).toBe(403);
    });

    it('should filter by enabled status', async () => {
      await db
        .insertInto('notification_channels')
        .values([
          {
            organization_id: testOrganization.id,
            name: 'Enabled Channel',
            type: 'email',
            config: { recipients: ['test1@example.com'] },
            enabled: true,
          },
          {
            organization_id: testOrganization.id,
            name: 'Disabled Channel',
            type: 'email',
            config: { recipients: ['test2@example.com'] },
            enabled: false,
          },
        ])
        .execute();

      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/notification-channels?organizationId=${testOrganization.id}&enabled=true`,
        headers: { Authorization: `Bearer ${authToken}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.channels).toHaveLength(1);
      expect(body.channels[0].name).toBe('Enabled Channel');
    });

    it('should filter by type', async () => {
      await db
        .insertInto('notification_channels')
        .values([
          {
            organization_id: testOrganization.id,
            name: 'Email Channel',
            type: 'email',
            config: { recipients: ['test@example.com'] },
          },
          {
            organization_id: testOrganization.id,
            name: 'Webhook Channel',
            type: 'webhook',
            config: { url: 'https://example.com/hook' },
          },
        ])
        .execute();

      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/notification-channels?organizationId=${testOrganization.id}&type=email`,
        headers: { Authorization: `Bearer ${authToken}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.channels).toHaveLength(1);
      expect(body.channels[0].type).toBe('email');
    });
  });

  describe('GET /api/v1/notification-channels/:id', () => {
    it('should get a single channel', async () => {
      const [channel] = await db
        .insertInto('notification_channels')
        .values({
          organization_id: testOrganization.id,
          name: 'Test Channel',
          type: 'email',
          config: { recipients: ['test@example.com'] },
        })
        .returningAll()
        .execute();

      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/notification-channels/${channel.id}?organizationId=${testOrganization.id}`,
        headers: { Authorization: `Bearer ${authToken}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.channel.name).toBe('Test Channel');
    });

    it('should return 404 for non-existent channel', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/notification-channels/00000000-0000-0000-0000-000000000000?organizationId=${testOrganization.id}`,
        headers: { Authorization: `Bearer ${authToken}` },
      });

      expect(response.statusCode).toBe(404);
    });

    it('should return 400 for invalid UUID', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/notification-channels/invalid-id?organizationId=${testOrganization.id}`,
        headers: { Authorization: `Bearer ${authToken}` },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('POST /api/v1/notification-channels', () => {
    it('should create an email channel', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/notification-channels?organizationId=${testOrganization.id}`,
        headers: { Authorization: `Bearer ${authToken}` },
        payload: {
          name: 'New Email Channel',
          type: 'email',
          config: { recipients: ['new@example.com'] },
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.payload);
      expect(body.channel.name).toBe('New Email Channel');
      expect(body.channel.type).toBe('email');
    });

    it('should create a webhook channel', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/notification-channels?organizationId=${testOrganization.id}`,
        headers: { Authorization: `Bearer ${authToken}` },
        payload: {
          name: 'New Webhook Channel',
          type: 'webhook',
          config: { url: 'https://example.com/webhook' },
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.payload);
      expect(body.channel.type).toBe('webhook');
    });

    it('should return 400 for invalid email config', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/notification-channels?organizationId=${testOrganization.id}`,
        headers: { Authorization: `Bearer ${authToken}` },
        payload: {
          name: 'Invalid Channel',
          type: 'email',
          config: { recipients: ['not-an-email'] },
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('should return 400 for invalid webhook url', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/notification-channels?organizationId=${testOrganization.id}`,
        headers: { Authorization: `Bearer ${authToken}` },
        payload: {
          name: 'Invalid Webhook',
          type: 'webhook',
          config: { url: 'not-a-url' },
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('should return 403 for non-admin member', async () => {
      // Create a member (not admin)
      const memberUser = await createTestUser({ email: 'member@test.com' });
      await db
        .insertInto('organization_members')
        .values({
          user_id: memberUser.id,
          organization_id: testOrganization.id,
          role: 'member',
        })
        .execute();
      const memberSession = await createTestSession(memberUser.id);

      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/notification-channels?organizationId=${testOrganization.id}`,
        headers: { Authorization: `Bearer ${memberSession.token}` },
        payload: {
          name: 'Channel',
          type: 'email',
          config: { recipients: ['test@example.com'] },
        },
      });

      expect(response.statusCode).toBe(403);
    });
  });

  describe('PUT /api/v1/notification-channels/:id', () => {
    it('should update a channel', async () => {
      const [channel] = await db
        .insertInto('notification_channels')
        .values({
          organization_id: testOrganization.id,
          name: 'Original Name',
          type: 'email',
          config: { recipients: ['test@example.com'] },
        })
        .returningAll()
        .execute();

      const response = await app.inject({
        method: 'PUT',
        url: `/api/v1/notification-channels/${channel.id}?organizationId=${testOrganization.id}`,
        headers: { Authorization: `Bearer ${authToken}` },
        payload: {
          name: 'Updated Name',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.channel.name).toBe('Updated Name');
    });

    it('should update channel enabled status', async () => {
      const [channel] = await db
        .insertInto('notification_channels')
        .values({
          organization_id: testOrganization.id,
          name: 'Channel',
          type: 'email',
          config: { recipients: ['test@example.com'] },
          enabled: true,
        })
        .returningAll()
        .execute();

      const response = await app.inject({
        method: 'PUT',
        url: `/api/v1/notification-channels/${channel.id}?organizationId=${testOrganization.id}`,
        headers: { Authorization: `Bearer ${authToken}` },
        payload: {
          enabled: false,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.channel.enabled).toBe(false);
    });

    it('should return 404 for non-existent channel', async () => {
      const response = await app.inject({
        method: 'PUT',
        url: `/api/v1/notification-channels/00000000-0000-0000-0000-000000000000?organizationId=${testOrganization.id}`,
        headers: { Authorization: `Bearer ${authToken}` },
        payload: {
          // Need to include config to trigger "Channel not found" check in service
          config: { recipients: ['test@example.com'] },
        },
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('DELETE /api/v1/notification-channels/:id', () => {
    it('should delete a channel', async () => {
      const [channel] = await db
        .insertInto('notification_channels')
        .values({
          organization_id: testOrganization.id,
          name: 'To Delete',
          type: 'email',
          config: { recipients: ['test@example.com'] },
        })
        .returningAll()
        .execute();

      const response = await app.inject({
        method: 'DELETE',
        url: `/api/v1/notification-channels/${channel.id}?organizationId=${testOrganization.id}`,
        headers: { Authorization: `Bearer ${authToken}` },
      });

      expect(response.statusCode).toBe(204);

      // Verify deleted
      const deleted = await db
        .selectFrom('notification_channels')
        .where('id', '=', channel.id)
        .executeTakeFirst();
      expect(deleted).toBeUndefined();
    });

    it('should return 404 for non-existent channel', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: `/api/v1/notification-channels/00000000-0000-0000-0000-000000000000?organizationId=${testOrganization.id}`,
        headers: { Authorization: `Bearer ${authToken}` },
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('GET /api/v1/notification-channels/defaults', () => {
    it('should get all organization defaults', async () => {
      const [channel] = await db
        .insertInto('notification_channels')
        .values({
          organization_id: testOrganization.id,
          name: 'Default Channel',
          type: 'email',
          config: { recipients: ['test@example.com'] },
        })
        .returningAll()
        .execute();

      await db
        .insertInto('organization_default_channels')
        .values({
          organization_id: testOrganization.id,
          event_type: 'alert',
          channel_id: channel.id,
        })
        .execute();

      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/notification-channels/defaults?organizationId=${testOrganization.id}`,
        headers: { Authorization: `Bearer ${authToken}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.defaults.alert).toHaveLength(1);
      expect(body.defaults.sigma).toHaveLength(0);
      expect(body.defaults.incident).toHaveLength(0);
      expect(body.defaults.error).toHaveLength(0);
    });
  });

  describe('GET /api/v1/notification-channels/defaults/:eventType', () => {
    it('should get defaults for specific event type', async () => {
      const [channel] = await db
        .insertInto('notification_channels')
        .values({
          organization_id: testOrganization.id,
          name: 'Alert Channel',
          type: 'email',
          config: { recipients: ['test@example.com'] },
        })
        .returningAll()
        .execute();

      await db
        .insertInto('organization_default_channels')
        .values({
          organization_id: testOrganization.id,
          event_type: 'alert',
          channel_id: channel.id,
        })
        .execute();

      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/notification-channels/defaults/alert?organizationId=${testOrganization.id}`,
        headers: { Authorization: `Bearer ${authToken}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.channels).toHaveLength(1);
    });

    it('supports the project_health event type (GET and PUT)', async () => {
      const [channel] = await db
        .insertInto('notification_channels')
        .values({
          organization_id: testOrganization.id,
          name: 'Health Channel',
          type: 'email',
          config: { recipients: ['test@example.com'] },
        })
        .returningAll()
        .execute();

      const put = await app.inject({
        method: 'PUT',
        url: `/api/v1/notification-channels/defaults/project_health?organizationId=${testOrganization.id}`,
        headers: { Authorization: `Bearer ${authToken}` },
        payload: { channelIds: [channel.id] },
      });
      expect(put.statusCode).toBe(204);

      const get = await app.inject({
        method: 'GET',
        url: `/api/v1/notification-channels/defaults/project_health?organizationId=${testOrganization.id}`,
        headers: { Authorization: `Bearer ${authToken}` },
      });
      expect(get.statusCode).toBe(200);
      expect(JSON.parse(get.payload).channels).toHaveLength(1);
    });

    it('should return 400 for invalid event type', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/notification-channels/defaults/invalid?organizationId=${testOrganization.id}`,
        headers: { Authorization: `Bearer ${authToken}` },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('PUT /api/v1/notification-channels/defaults/:eventType', () => {
    it('should set defaults for event type', async () => {
      const [channel] = await db
        .insertInto('notification_channels')
        .values({
          organization_id: testOrganization.id,
          name: 'Channel',
          type: 'email',
          config: { recipients: ['test@example.com'] },
        })
        .returningAll()
        .execute();

      const response = await app.inject({
        method: 'PUT',
        url: `/api/v1/notification-channels/defaults/alert?organizationId=${testOrganization.id}`,
        headers: { Authorization: `Bearer ${authToken}` },
        payload: {
          channelIds: [channel.id],
        },
      });

      expect(response.statusCode).toBe(204);

      // Verify default was set
      const defaults = await db
        .selectFrom('organization_default_channels')
        .where('organization_id', '=', testOrganization.id)
        .where('event_type', '=', 'alert')
        .execute();
      expect(defaults).toHaveLength(1);
    });

    it('should set defaults for monitoring event type', async () => {
      const [channel] = await db
        .insertInto('notification_channels')
        .values({
          organization_id: testOrganization.id,
          name: 'Monitoring Channel',
          type: 'email',
          config: { recipients: ['ops@example.com'] },
        })
        .returningAll()
        .execute();

      const response = await app.inject({
        method: 'PUT',
        url: `/api/v1/notification-channels/defaults/monitoring?organizationId=${testOrganization.id}`,
        headers: { Authorization: `Bearer ${authToken}` },
        payload: {
          channelIds: [channel.id],
        },
      });

      expect(response.statusCode).toBe(204);

      const defaults = await db
        .selectFrom('organization_default_channels')
        .where('organization_id', '=', testOrganization.id)
        .where('event_type', '=', 'monitoring')
        .execute();
      expect(defaults).toHaveLength(1);
    });
  });

  describe('GET /api/v1/notification-channels/alert-rules/:alertRuleId', () => {
    it('should get channels for alert rule', async () => {
      const alertRule = await createTestAlertRule({ organizationId: testOrganization.id });
      const [channel] = await db
        .insertInto('notification_channels')
        .values({
          organization_id: testOrganization.id,
          name: 'Alert Channel',
          type: 'email',
          config: { recipients: ['test@example.com'] },
        })
        .returningAll()
        .execute();

      await db
        .insertInto('alert_rule_channels')
        .values({
          alert_rule_id: alertRule.id,
          channel_id: channel.id,
        })
        .execute();

      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/notification-channels/alert-rules/${alertRule.id}`,
        headers: { Authorization: `Bearer ${authToken}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.channels).toHaveLength(1);
    });

    it('should not leak channels of an alert rule in another organization', async () => {
      const otherOrg = await createTestOrganization();
      const alertRule = await createTestAlertRule({ organizationId: otherOrg.id });
      const [channel] = await db
        .insertInto('notification_channels')
        .values({
          organization_id: otherOrg.id,
          name: 'Other Org Channel',
          type: 'webhook',
          config: { url: 'https://evil.example.com/hook', auth: { token: 'secret' } },
        })
        .returningAll()
        .execute();
      await db
        .insertInto('alert_rule_channels')
        .values({ alert_rule_id: alertRule.id, channel_id: channel.id })
        .execute();

      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/notification-channels/alert-rules/${alertRule.id}`,
        headers: { Authorization: `Bearer ${authToken}` },
      });

      expect(response.statusCode).toBe(403);
      expect(response.payload).not.toContain('secret');
    });
  });

  describe('GET /api/v1/notification-channels/sigma-rules/:sigmaRuleId', () => {
    it('should get channels for sigma rule', async () => {
      const sigmaRule = await createTestSigmaRule({ organizationId: testOrganization.id });
      const [channel] = await db
        .insertInto('notification_channels')
        .values({
          organization_id: testOrganization.id,
          name: 'Sigma Channel',
          type: 'webhook',
          config: { url: 'https://example.com/hook' },
        })
        .returningAll()
        .execute();

      await db
        .insertInto('sigma_rule_channels')
        .values({
          sigma_rule_id: sigmaRule.id,
          channel_id: channel.id,
        })
        .execute();

      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/notification-channels/sigma-rules/${sigmaRule.id}`,
        headers: { Authorization: `Bearer ${authToken}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.channels).toHaveLength(1);
    });

    it('should not leak channels of a sigma rule in another organization', async () => {
      const otherOrg = await createTestOrganization();
      const sigmaRule = await createTestSigmaRule({ organizationId: otherOrg.id });
      const [channel] = await db
        .insertInto('notification_channels')
        .values({
          organization_id: otherOrg.id,
          name: 'Other Org Sigma Channel',
          type: 'webhook',
          config: { url: 'https://evil.example.com/hook', auth: { token: 'secret' } },
        })
        .returningAll()
        .execute();
      await db
        .insertInto('sigma_rule_channels')
        .values({ sigma_rule_id: sigmaRule.id, channel_id: channel.id })
        .execute();

      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/notification-channels/sigma-rules/${sigmaRule.id}`,
        headers: { Authorization: `Bearer ${authToken}` },
      });

      expect(response.statusCode).toBe(403);
      expect(response.payload).not.toContain('secret');
    });
  });

  describe('POST /api/v1/notification-channels/:id/test', () => {
    it('should test a channel', async () => {
      const [channel] = await db
        .insertInto('notification_channels')
        .values({
          organization_id: testOrganization.id,
          name: 'Test Channel',
          type: 'webhook',
          config: { url: 'https://httpbin.org/post' },
        })
        .returningAll()
        .execute();

      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/notification-channels/${channel.id}/test?organizationId=${testOrganization.id}`,
        headers: { Authorization: `Bearer ${authToken}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.result).toBeDefined();
    });

    it('should return 400 without organizationId', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/notification-channels/00000000-0000-0000-0000-000000000000/test`,
        headers: { Authorization: `Bearer ${authToken}` },
      });

      expect(response.statusCode).toBe(400);
    });

    it('should return 403 for non-member', async () => {
      const otherUser = await createTestUser({ email: 'other-test@test.com' });
      const otherSession = await createTestSession(otherUser.id);

      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/notification-channels/00000000-0000-0000-0000-000000000000/test?organizationId=${testOrganization.id}`,
        headers: { Authorization: `Bearer ${otherSession.token}` },
      });

      expect(response.statusCode).toBe(403);
    });

    it('should return 403 for non-admin', async () => {
      const memberUser = await createTestUser({ email: 'member-test@test.com' });
      await db
        .insertInto('organization_members')
        .values({
          user_id: memberUser.id,
          organization_id: testOrganization.id,
          role: 'member',
        })
        .execute();
      const memberSession = await createTestSession(memberUser.id);

      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/notification-channels/00000000-0000-0000-0000-000000000000/test?organizationId=${testOrganization.id}`,
        headers: { Authorization: `Bearer ${memberSession.token}` },
      });

      expect(response.statusCode).toBe(403);
    });

    it('should return 404 for non-existent channel', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/notification-channels/00000000-0000-0000-0000-000000000000/test?organizationId=${testOrganization.id}`,
        headers: { Authorization: `Bearer ${authToken}` },
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('Additional edge cases', () => {
    it('GET /:id should return 400 without organizationId', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/notification-channels/00000000-0000-0000-0000-000000000000`,
        headers: { Authorization: `Bearer ${authToken}` },
      });

      expect(response.statusCode).toBe(400);
    });

    it('GET /:id should return 403 for non-member', async () => {
      const otherUser = await createTestUser({ email: 'other2@test.com' });
      const otherSession = await createTestSession(otherUser.id);

      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/notification-channels/00000000-0000-0000-0000-000000000000?organizationId=${testOrganization.id}`,
        headers: { Authorization: `Bearer ${otherSession.token}` },
      });

      expect(response.statusCode).toBe(403);
    });

    it('POST / should return 400 without organizationId', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/notification-channels`,
        headers: { Authorization: `Bearer ${authToken}` },
        payload: {
          name: 'Test',
          type: 'email',
          config: { recipients: ['test@example.com'] },
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('POST / should return 403 for non-member', async () => {
      const otherUser = await createTestUser({ email: 'other3@test.com' });
      const otherSession = await createTestSession(otherUser.id);

      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/notification-channels?organizationId=${testOrganization.id}`,
        headers: { Authorization: `Bearer ${otherSession.token}` },
        payload: {
          name: 'Test',
          type: 'email',
          config: { recipients: ['test@example.com'] },
        },
      });

      expect(response.statusCode).toBe(403);
    });

    it('PUT /:id should return 400 without organizationId', async () => {
      const response = await app.inject({
        method: 'PUT',
        url: `/api/v1/notification-channels/00000000-0000-0000-0000-000000000000`,
        headers: { Authorization: `Bearer ${authToken}` },
        payload: { name: 'Updated' },
      });

      expect(response.statusCode).toBe(400);
    });

    it('PUT /:id should return 403 for non-member', async () => {
      const otherUser = await createTestUser({ email: 'other4@test.com' });
      const otherSession = await createTestSession(otherUser.id);

      const response = await app.inject({
        method: 'PUT',
        url: `/api/v1/notification-channels/00000000-0000-0000-0000-000000000000?organizationId=${testOrganization.id}`,
        headers: { Authorization: `Bearer ${otherSession.token}` },
        payload: { name: 'Updated' },
      });

      expect(response.statusCode).toBe(403);
    });

    it('PUT /:id should return 403 for non-admin', async () => {
      const memberUser = await createTestUser({ email: 'member2@test.com' });
      await db
        .insertInto('organization_members')
        .values({
          user_id: memberUser.id,
          organization_id: testOrganization.id,
          role: 'member',
        })
        .execute();
      const memberSession = await createTestSession(memberUser.id);

      const response = await app.inject({
        method: 'PUT',
        url: `/api/v1/notification-channels/00000000-0000-0000-0000-000000000000?organizationId=${testOrganization.id}`,
        headers: { Authorization: `Bearer ${memberSession.token}` },
        payload: { name: 'Updated' },
      });

      expect(response.statusCode).toBe(403);
    });

    it('DELETE /:id should return 400 without organizationId', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: `/api/v1/notification-channels/00000000-0000-0000-0000-000000000000`,
        headers: { Authorization: `Bearer ${authToken}` },
      });

      expect(response.statusCode).toBe(400);
    });

    it('DELETE /:id should return 403 for non-member', async () => {
      const otherUser = await createTestUser({ email: 'other5@test.com' });
      const otherSession = await createTestSession(otherUser.id);

      const response = await app.inject({
        method: 'DELETE',
        url: `/api/v1/notification-channels/00000000-0000-0000-0000-000000000000?organizationId=${testOrganization.id}`,
        headers: { Authorization: `Bearer ${otherSession.token}` },
      });

      expect(response.statusCode).toBe(403);
    });

    it('DELETE /:id should return 403 for non-admin', async () => {
      const memberUser = await createTestUser({ email: 'member3@test.com' });
      await db
        .insertInto('organization_members')
        .values({
          user_id: memberUser.id,
          organization_id: testOrganization.id,
          role: 'member',
        })
        .execute();
      const memberSession = await createTestSession(memberUser.id);

      const response = await app.inject({
        method: 'DELETE',
        url: `/api/v1/notification-channels/00000000-0000-0000-0000-000000000000?organizationId=${testOrganization.id}`,
        headers: { Authorization: `Bearer ${memberSession.token}` },
      });

      expect(response.statusCode).toBe(403);
    });

    it('GET /defaults should return 400 without organizationId', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/notification-channels/defaults`,
        headers: { Authorization: `Bearer ${authToken}` },
      });

      expect(response.statusCode).toBe(400);
    });

    it('GET /defaults should return 403 for non-member', async () => {
      const otherUser = await createTestUser({ email: 'other6@test.com' });
      const otherSession = await createTestSession(otherUser.id);

      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/notification-channels/defaults?organizationId=${testOrganization.id}`,
        headers: { Authorization: `Bearer ${otherSession.token}` },
      });

      expect(response.statusCode).toBe(403);
    });

    it('GET /defaults/:eventType should return 400 without organizationId', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/notification-channels/defaults/alert`,
        headers: { Authorization: `Bearer ${authToken}` },
      });

      expect(response.statusCode).toBe(400);
    });

    it('GET /defaults/:eventType should return 403 for non-member', async () => {
      const otherUser = await createTestUser({ email: 'other7@test.com' });
      const otherSession = await createTestSession(otherUser.id);

      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/notification-channels/defaults/alert?organizationId=${testOrganization.id}`,
        headers: { Authorization: `Bearer ${otherSession.token}` },
      });

      expect(response.statusCode).toBe(403);
    });

    it('PUT /defaults/:eventType should return 400 without organizationId', async () => {
      const response = await app.inject({
        method: 'PUT',
        url: `/api/v1/notification-channels/defaults/alert`,
        headers: { Authorization: `Bearer ${authToken}` },
        payload: { channelIds: [] },
      });

      expect(response.statusCode).toBe(400);
    });

    it('PUT /defaults/:eventType should return 403 for non-member', async () => {
      const otherUser = await createTestUser({ email: 'other8@test.com' });
      const otherSession = await createTestSession(otherUser.id);

      const response = await app.inject({
        method: 'PUT',
        url: `/api/v1/notification-channels/defaults/alert?organizationId=${testOrganization.id}`,
        headers: { Authorization: `Bearer ${otherSession.token}` },
        payload: { channelIds: [] },
      });

      expect(response.statusCode).toBe(403);
    });

    it('PUT /defaults/:eventType should return 403 for non-admin', async () => {
      const memberUser = await createTestUser({ email: 'member4@test.com' });
      await db
        .insertInto('organization_members')
        .values({
          user_id: memberUser.id,
          organization_id: testOrganization.id,
          role: 'member',
        })
        .execute();
      const memberSession = await createTestSession(memberUser.id);

      const response = await app.inject({
        method: 'PUT',
        url: `/api/v1/notification-channels/defaults/alert?organizationId=${testOrganization.id}`,
        headers: { Authorization: `Bearer ${memberSession.token}` },
        payload: { channelIds: [] },
      });

      expect(response.statusCode).toBe(403);
    });

    it('PUT /defaults/:eventType should return 400 for invalid event type', async () => {
      const response = await app.inject({
        method: 'PUT',
        url: `/api/v1/notification-channels/defaults/invalid?organizationId=${testOrganization.id}`,
        headers: { Authorization: `Bearer ${authToken}` },
        payload: { channelIds: [] },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('secret masking and secret-preserving update', () => {
    const PD_KEY = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6';

    async function insertBearerChannel(orgId: string) {
      return db
        .insertInto('notification_channels')
        .values({
          organization_id: orgId,
          name: 'Bearer hook',
          type: 'webhook',
          config: JSON.stringify({
            url: 'https://hooks.slack.com/services/T1/B2/slacktoken',
            auth: { type: 'bearer', token: 'raw-bearer-token' },
          }) as any,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
    }

    async function memberSession() {
      const memberUser = await createTestUser({ email: 'masking-member@test.com' });
      await db
        .insertInto('organization_members')
        .values({ user_id: memberUser.id, organization_id: testOrganization.id, role: 'member' })
        .execute();
      return createTestSession(memberUser.id);
    }

    it('GET / as admin never contains the raw bearer token', async () => {
      await insertBearerChannel(testOrganization.id);
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/notification-channels?organizationId=${testOrganization.id}`,
        headers: { Authorization: `Bearer ${authToken}` },
      });
      expect(response.statusCode).toBe(200);
      expect(response.body).not.toContain('raw-bearer-token');
      expect(response.json().channels[0].config.auth.hasSecret).toBe(true);
    });

    it('GET / as plain member reduces the webhook url to host only', async () => {
      await insertBearerChannel(testOrganization.id);
      const session = await memberSession();
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/notification-channels?organizationId=${testOrganization.id}`,
        headers: { Authorization: `Bearer ${session.token}` },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().channels[0].config.url).toBe('https://hooks.slack.com/...');
      expect(response.body).not.toContain('slacktoken');
      expect(response.body).not.toContain('raw-bearer-token');
    });

    it('defaults endpoints are masked too', async () => {
      const row = await insertBearerChannel(testOrganization.id);
      await db
        .insertInto('organization_default_channels')
        .values({ organization_id: testOrganization.id, event_type: 'alert', channel_id: row.id })
        .execute();
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/notification-channels/defaults?organizationId=${testOrganization.id}`,
        headers: { Authorization: `Bearer ${authToken}` },
      });
      expect(response.statusCode).toBe(200);
      expect(response.body).toContain('hasSecret');
      expect(response.body).not.toContain('raw-bearer-token');
      const single = await app.inject({
        method: 'GET',
        url: `/api/v1/notification-channels/defaults/alert?organizationId=${testOrganization.id}`,
        headers: { Authorization: `Bearer ${authToken}` },
      });
      expect(single.body).not.toContain('raw-bearer-token');
    });

    it('PUT /:id without auth.token keeps the stored token', async () => {
      const row = await insertBearerChannel(testOrganization.id);
      const response = await app.inject({
        method: 'PUT',
        url: `/api/v1/notification-channels/${row.id}?organizationId=${testOrganization.id}`,
        headers: { Authorization: `Bearer ${authToken}` },
        payload: {
          config: {
            url: 'https://hooks.slack.com/services/T1/B2/other',
            auth: { type: 'bearer' },
          },
        },
      });
      expect(response.statusCode).toBe(200);
      expect(response.body).not.toContain('raw-bearer-token');

      const stored = await db
        .selectFrom('notification_channels')
        .select('config')
        .where('id', '=', row.id)
        .executeTakeFirstOrThrow();
      const config = stored.config as any;
      expect(config.url).toBe('https://hooks.slack.com/services/T1/B2/other');
      expect(config.auth.token).toBe('raw-bearer-token');
    });

    it('POST / pagerduty returns 201 with a masked routing key', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/notification-channels?organizationId=${testOrganization.id}`,
        headers: { Authorization: `Bearer ${authToken}` },
        payload: { name: 'On call', type: 'pagerduty', config: { routingKey: PD_KEY } },
      });
      expect(response.statusCode).toBe(201);
      expect(response.json().channel.config.routingKey).toBe('********');
      expect(response.body).not.toContain(PD_KEY);

      const stored = await db
        .selectFrom('notification_channels')
        .select('config')
        .where('type', '=', 'pagerduty')
        .executeTakeFirstOrThrow();
      expect((stored.config as any).routingKey).toBe(PD_KEY);
    });

    it('PUT /:id pagerduty with a masked routing key keeps the stored one', async () => {
      const created = await app.inject({
        method: 'POST',
        url: `/api/v1/notification-channels?organizationId=${testOrganization.id}`,
        headers: { Authorization: `Bearer ${authToken}` },
        payload: { name: 'On call', type: 'pagerduty', config: { routingKey: PD_KEY } },
      });
      const id = created.json().channel.id;
      const response = await app.inject({
        method: 'PUT',
        url: `/api/v1/notification-channels/${id}?organizationId=${testOrganization.id}`,
        headers: { Authorization: `Bearer ${authToken}` },
        payload: { config: { routingKey: '********' } },
      });
      expect(response.statusCode).toBe(200);
      const stored = await db
        .selectFrom('notification_channels')
        .select('config')
        .where('id', '=', id)
        .executeTakeFirstOrThrow();
      expect((stored.config as any).routingKey).toBe(PD_KEY);
    });

    it('POST / pagerduty with a url body returns 400', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/notification-channels?organizationId=${testOrganization.id}`,
        headers: { Authorization: `Bearer ${authToken}` },
        payload: { name: 'Bad', type: 'pagerduty', config: { url: 'https://example.com/x' } },
      });
      expect(response.statusCode).toBe(400);
    });

    it('POST / pagerduty with a malformed routing key returns 400', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/notification-channels?organizationId=${testOrganization.id}`,
        headers: { Authorization: `Bearer ${authToken}` },
        payload: { name: 'Bad', type: 'pagerduty', config: { routingKey: 'short' } },
      });
      expect(response.statusCode).toBe(400);
    });

    it('a user of another organization gets 403 reading these channels', async () => {
      await insertBearerChannel(testOrganization.id);
      const otherUser = await createTestUser({ email: 'orgb@test.com' });
      await createTestOrganization({ ownerId: otherUser.id });
      const other = await createTestSession(otherUser.id);
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/notification-channels?organizationId=${testOrganization.id}`,
        headers: { Authorization: `Bearer ${other.token}` },
      });
      expect(response.statusCode).toBe(403);
    });
  });
});
