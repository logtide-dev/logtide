import { describe, it, expect, vi, beforeEach, afterAll, beforeAll } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { db } from '../../../database/index.js';
import { webhookDeliveriesRoutes } from '../../../modules/webhooks/routes.js';
import { webhookDeliveryService } from '../../../modules/webhooks/service.js';
import { createTestContext, createTestUser } from '../../helpers/factories.js';
import crypto from 'crypto';

// Mock the dispatcher so enqueueExisting does not need a live Redis/BullMQ queue.
vi.mock('../../../modules/webhooks/dispatcher.js', () => ({
  webhookDispatcher: {
    enqueueExisting: vi.fn().mockResolvedValue(undefined),
  },
}));

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

describe('Webhook Deliveries Routes', () => {
  let app: FastifyInstance;
  let authToken: string;
  let testUser: any;
  let testOrganization: any;

  beforeAll(async () => {
    app = Fastify();
    await app.register(webhookDeliveriesRoutes, { prefix: '/api/v1/webhooks' });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    // Clean up in dependency order
    await db.deleteFrom('webhook_delivery_attempts').execute();
    await db.deleteFrom('webhook_deliveries').execute();
    await db.deleteFrom('organization_members').execute();
    await db.deleteFrom('api_keys').execute();
    await db.deleteFrom('projects').execute();
    await db.deleteFrom('organizations').execute();
    await db.deleteFrom('sessions').execute();
    await db.deleteFrom('users').execute();

    const context = await createTestContext();
    testUser = context.user;
    testOrganization = context.organization;

    const session = await createTestSession(testUser.id);
    authToken = session.token;
  });

  describe('GET /api/v1/webhooks/deliveries', () => {
    it('should return 200 with deliveries for the org', async () => {
      await webhookDeliveryService.createDelivery({
        organizationId: testOrganization.id,
        eventType: 'alert',
        eventId: 'evt-1',
        url: 'https://example.com/hook',
        maxAttempts: 3,
      });

      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/webhooks/deliveries?organizationId=${testOrganization.id}`,
        headers: { Authorization: `Bearer ${authToken}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.deliveries).toHaveLength(1);
      expect(body.deliveries[0].organization_id).toBe(testOrganization.id);
    });

    it('should filter deliveries by status', async () => {
      await webhookDeliveryService.createDelivery({
        organizationId: testOrganization.id,
        eventType: 'alert',
        eventId: 'evt-pending',
        url: 'https://example.com/hook',
        maxAttempts: 3,
      });
      const dead = await webhookDeliveryService.createDelivery({
        organizationId: testOrganization.id,
        eventType: 'alert',
        eventId: 'evt-dead',
        url: 'https://example.com/hook',
        maxAttempts: 3,
      });
      await webhookDeliveryService.markDead(dead.id, 3, 'too many failures');

      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/webhooks/deliveries?organizationId=${testOrganization.id}&status=dead`,
        headers: { Authorization: `Bearer ${authToken}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.deliveries).toHaveLength(1);
      expect(body.deliveries[0].status).toBe('dead');
    });

    it('should return 400 when organizationId is missing', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/webhooks/deliveries',
        headers: { Authorization: `Bearer ${authToken}` },
      });

      expect(response.statusCode).toBe(400);
    });

    it('should return 400 when organizationId is not a uuid', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/webhooks/deliveries?organizationId=not-a-uuid',
        headers: { Authorization: `Bearer ${authToken}` },
      });

      expect(response.statusCode).toBe(400);
    });

    it('should return 401 without auth token', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/webhooks/deliveries?organizationId=${testOrganization.id}`,
      });

      expect(response.statusCode).toBe(401);
    });

    it('should return 403 for non-member', async () => {
      const otherUser = await createTestUser({ email: 'other@test.com' });
      const otherSession = await createTestSession(otherUser.id);

      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/webhooks/deliveries?organizationId=${testOrganization.id}`,
        headers: { Authorization: `Bearer ${otherSession.token}` },
      });

      expect(response.statusCode).toBe(403);
    });
  });

  describe('GET /api/v1/webhooks/deliveries/:id', () => {
    it('should return 200 with delivery and attempts', async () => {
      const delivery = await webhookDeliveryService.createDelivery({
        organizationId: testOrganization.id,
        eventType: 'alert',
        eventId: 'evt-2',
        url: 'https://example.com/hook',
        maxAttempts: 3,
      });

      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/webhooks/deliveries/${delivery.id}`,
        headers: { Authorization: `Bearer ${authToken}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.delivery.id).toBe(delivery.id);
      expect(Array.isArray(body.attempts)).toBe(true);
    });

    it('should return 404 for non-existent delivery', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/webhooks/deliveries/00000000-0000-0000-0000-000000000000',
        headers: { Authorization: `Bearer ${authToken}` },
      });

      expect(response.statusCode).toBe(404);
    });

    it('should return 403 for a delivery belonging to another org', async () => {
      // Create delivery for a different org that this user is not a member of
      const otherUser = await createTestUser({ email: 'other2@test.com' });
      const otherOrg = await db
        .insertInto('organizations')
        .values({ name: 'Other Org', slug: `other-org-${Date.now()}`, owner_id: otherUser.id })
        .returningAll()
        .executeTakeFirstOrThrow();
      await db
        .insertInto('organization_members')
        .values({ user_id: otherUser.id, organization_id: otherOrg.id, role: 'owner' })
        .execute();

      const delivery = await webhookDeliveryService.createDelivery({
        organizationId: otherOrg.id,
        eventType: 'alert',
        eventId: 'evt-other',
        url: 'https://example.com/hook',
        maxAttempts: 3,
      });

      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/webhooks/deliveries/${delivery.id}`,
        headers: { Authorization: `Bearer ${authToken}` },
      });

      expect(response.statusCode).toBe(403);
    });
  });

  describe('webhook URL redaction for members', () => {
    const SLACK = 'https://hooks.slack.com/services/T1/B2/secret';

    async function memberToken() {
      const memberUser = await createTestUser({ email: 'member-url@test.com' });
      await db
        .insertInto('organization_members')
        .values({ user_id: memberUser.id, organization_id: testOrganization.id, role: 'member' })
        .execute();
      return (await createTestSession(memberUser.id)).token;
    }

    async function makeDelivery() {
      return webhookDeliveryService.createDelivery({
        organizationId: testOrganization.id,
        eventType: 'alert',
        eventId: 'evt-url',
        url: SLACK,
        maxAttempts: 3,
      });
    }

    it('hides the path token from members on list and detail', async () => {
      const delivery = await makeDelivery();
      const token = await memberToken();
      const list = await app.inject({
        method: 'GET',
        url: `/api/v1/webhooks/deliveries?organizationId=${testOrganization.id}`,
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(list.payload).not.toContain('secret');
      expect(JSON.parse(list.payload).deliveries[0].url).toBe('https://hooks.slack.com/...');
      const detail = await app.inject({
        method: 'GET',
        url: `/api/v1/webhooks/deliveries/${delivery.id}`,
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(detail.payload).not.toContain('secret');
      expect(JSON.parse(detail.payload).delivery.url).toBe('https://hooks.slack.com/...');
    });

    it('gives admins the full URL', async () => {
      const delivery = await makeDelivery();
      const detail = await app.inject({
        method: 'GET',
        url: `/api/v1/webhooks/deliveries/${delivery.id}`,
        headers: { Authorization: `Bearer ${authToken}` },
      });
      expect(JSON.parse(detail.payload).delivery.url).toBe(SLACK);
    });

    it('does not leak the URL in the replay response for admins either', async () => {
      const delivery = await makeDelivery();
      await webhookDeliveryService.markDead(delivery.id, 3, 'x');
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/webhooks/deliveries/${delivery.id}/replay`,
        headers: { Authorization: `Bearer ${authToken}` },
      });
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.payload).delivery.url).toBe(SLACK);
    });
  });

  describe('POST /api/v1/webhooks/deliveries/:id/replay', () => {
    it('should replay a dead delivery', async () => {
      const delivery = await webhookDeliveryService.createDelivery({
        organizationId: testOrganization.id,
        eventType: 'alert',
        eventId: 'evt-replay',
        url: 'https://example.com/hook',
        maxAttempts: 3,
      });
      await webhookDeliveryService.markDead(delivery.id, 3, 'test error');

      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/webhooks/deliveries/${delivery.id}/replay`,
        headers: { Authorization: `Bearer ${authToken}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.delivery.status).toBe('pending');
    });

    it('should return 409 when replaying a still-retrying (failed) delivery', async () => {
      // A 'failed'/retrying delivery still has a delayed retry job enqueued, so
      // replaying it would double-deliver. Only terminal 'dead' deliveries replay.
      const delivery = await webhookDeliveryService.createDelivery({
        organizationId: testOrganization.id,
        eventType: 'alert',
        eventId: 'evt-replay-failed',
        url: 'https://example.com/hook',
        maxAttempts: 3,
      });
      await webhookDeliveryService.markRetrying(delivery.id, 1, new Date(Date.now() + 60000), 'transient error');

      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/webhooks/deliveries/${delivery.id}/replay`,
        headers: { Authorization: `Bearer ${authToken}` },
      });

      expect(response.statusCode).toBe(409);
    });

    it('should return 409 when delivery is already delivered', async () => {
      const delivery = await webhookDeliveryService.createDelivery({
        organizationId: testOrganization.id,
        eventType: 'alert',
        eventId: 'evt-delivered',
        url: 'https://example.com/hook',
        maxAttempts: 3,
      });
      await webhookDeliveryService.markDelivered(delivery.id);

      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/webhooks/deliveries/${delivery.id}/replay`,
        headers: { Authorization: `Bearer ${authToken}` },
      });

      expect(response.statusCode).toBe(409);
    });

    it('should return 409 when delivery is still pending', async () => {
      const delivery = await webhookDeliveryService.createDelivery({
        organizationId: testOrganization.id,
        eventType: 'alert',
        eventId: 'evt-pending-replay',
        url: 'https://example.com/hook',
        maxAttempts: 3,
      });

      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/webhooks/deliveries/${delivery.id}/replay`,
        headers: { Authorization: `Bearer ${authToken}` },
      });

      expect(response.statusCode).toBe(409);
    });

    it('should return 404 for non-existent delivery', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/webhooks/deliveries/00000000-0000-0000-0000-000000000000/replay',
        headers: { Authorization: `Bearer ${authToken}` },
      });

      expect(response.statusCode).toBe(404);
    });

    it('should return 403 for non-admin member', async () => {
      const delivery = await webhookDeliveryService.createDelivery({
        organizationId: testOrganization.id,
        eventType: 'alert',
        eventId: 'evt-member-replay',
        url: 'https://example.com/hook',
        maxAttempts: 3,
      });
      await webhookDeliveryService.markDead(delivery.id, 3, 'test error');

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
        url: `/api/v1/webhooks/deliveries/${delivery.id}/replay`,
        headers: { Authorization: `Bearer ${memberSession.token}` },
      });

      expect(response.statusCode).toBe(403);
    });
  });
});
