import { describe, it, expect, beforeEach, afterAll, beforeAll, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import crypto from 'crypto';

const { deliverOnceMock } = vi.hoisted(() => ({ deliverOnceMock: vi.fn() }));

vi.mock('../../../modules/webhooks/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../modules/webhooks/index.js')>();
  return { ...actual, deliverOnce: deliverOnceMock };
});

import { db } from '../../../database/index.js';
import { notificationChannelsRoutes } from '../../../modules/notification-channels/routes.js';
import { PAGERDUTY_EVENTS_URL } from '../../../modules/notification-channels/providers/pagerduty-event.js';
import { createTestContext, createTestUser, createTestOrganization } from '../../helpers/factories.js';

async function createTestSession(userId: string) {
  const token = crypto.randomBytes(32).toString('hex');
  await db
    .insertInto('sessions')
    .values({ user_id: userId, token, expires_at: new Date(Date.now() + 86400000) })
    .execute();
  return { token };
}

const PD_KEY = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6';

describe('POST /api/v1/notification-channels/test', () => {
  let app: FastifyInstance;
  let authToken: string;
  let testUser: any;
  let testOrganization: any;

  beforeAll(async () => {
    app = Fastify();
    await app.register(notificationChannelsRoutes, { prefix: '/api/v1/notification-channels' });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    deliverOnceMock.mockReset();
    deliverOnceMock.mockResolvedValue({ success: true, statusCode: 200, durationMs: 1, retryable: false });

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

    const context = await createTestContext();
    testUser = context.user;
    testOrganization = context.organization;
    authToken = (await createTestSession(testUser.id)).token;
  });

  async function post(payload: unknown, token = authToken) {
    return app.inject({
      method: 'POST',
      url: '/api/v1/notification-channels/test',
      headers: { Authorization: `Bearer ${token}` },
      payload: payload as any,
    });
  }

  async function channelCount() {
    const row = await db
      .selectFrom('notification_channels')
      .select((eb) => eb.fn.countAll().as('n'))
      .executeTakeFirstOrThrow();
    return Number(row.n);
  }

  it('sends a typed webhook config as admin and persists nothing', async () => {
    const res = await post({
      organizationId: testOrganization.id,
      type: 'webhook',
      config: { url: 'https://example.com/typed-hook' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().result.success).toBe(true);
    expect(deliverOnceMock).toHaveBeenCalledTimes(1);
    expect(deliverOnceMock.mock.calls[0][0].url).toBe('https://example.com/typed-hook');
    expect(await channelCount()).toBe(0);
  });

  it('rejects an invalid config with 400 and no delivery', async () => {
    const res = await post({
      organizationId: testOrganization.id,
      type: 'webhook',
      config: { url: 'ftp://x' },
    });
    expect(res.statusCode).toBe(400);
    expect(deliverOnceMock).not.toHaveBeenCalled();
  });

  it('returns 403 for a plain member', async () => {
    const memberUser = await createTestUser({ email: 'member-test@test.com' });
    await db
      .insertInto('organization_members')
      .values({ user_id: memberUser.id, organization_id: testOrganization.id, role: 'member' })
      .execute();
    const { token } = await createTestSession(memberUser.id);
    const res = await post(
      { organizationId: testOrganization.id, type: 'webhook', config: { url: 'https://example.com/h' } },
      token
    );
    expect(res.statusCode).toBe(403);
    expect(deliverOnceMock).not.toHaveBeenCalled();
  });

  it('returns 403 for a user outside the organization', async () => {
    const outsider = await createTestUser({ email: 'outsider@test.com' });
    await createTestOrganization({ ownerId: outsider.id });
    const { token } = await createTestSession(outsider.id);
    const res = await post(
      { organizationId: testOrganization.id, type: 'webhook', config: { url: 'https://example.com/h' } },
      token
    );
    expect(res.statusCode).toBe(403);
    expect(deliverOnceMock).not.toHaveBeenCalled();
  });

  it('returns 404 for a channelId of another organization', async () => {
    const outsider = await createTestUser({ email: 'owner-b@test.com' });
    const orgB = await createTestOrganization({ ownerId: outsider.id });
    const foreign = await db
      .insertInto('notification_channels')
      .values({
        organization_id: orgB.id,
        name: 'Foreign',
        type: 'webhook',
        config: JSON.stringify({ url: 'https://example.com/foreign', auth: { type: 'bearer', token: 'foreign-token' } }) as any,
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    const res = await post({
      organizationId: testOrganization.id,
      channelId: foreign.id,
      type: 'webhook',
      config: { url: 'https://example.com/h', auth: { type: 'bearer' } },
    });
    expect(res.statusCode).toBe(404);
    expect(deliverOnceMock).not.toHaveBeenCalled();
  });

  it('edit mode without auth.token sends the stored bearer header', async () => {
    const stored = await db
      .insertInto('notification_channels')
      .values({
        organization_id: testOrganization.id,
        name: 'Stored',
        type: 'webhook',
        config: JSON.stringify({ url: 'https://example.com/h', auth: { type: 'bearer', token: 'stored-token' } }) as any,
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    const res = await post({
      organizationId: testOrganization.id,
      channelId: stored.id,
      type: 'webhook',
      config: { url: 'https://example.com/h', auth: { type: 'bearer' } },
    });
    expect(res.statusCode).toBe(200);
    expect(deliverOnceMock.mock.calls[0][0].headers.Authorization).toBe('Bearer stored-token');
    expect(JSON.stringify(res.json())).not.toContain('stored-token');
  });

  it('pagerduty test triggers then resolves with the same dedup key', async () => {
    const res = await post({
      organizationId: testOrganization.id,
      type: 'pagerduty',
      config: { routingKey: PD_KEY },
    });
    expect(res.statusCode).toBe(200);
    expect(deliverOnceMock).toHaveBeenCalledTimes(2);
    const [trigger, resolve] = deliverOnceMock.mock.calls.map((c) => c[0]);
    expect(trigger.url).toBe(PAGERDUTY_EVENTS_URL);
    expect(trigger.body.event_action).toBe('trigger');
    expect(resolve.body.event_action).toBe('resolve');
    expect(resolve.body.dedup_key).toBe(trigger.body.dedup_key);
  });

  it('pagerduty edit mode with a blank key uses the stored key', async () => {
    const stored = await db
      .insertInto('notification_channels')
      .values({
        organization_id: testOrganization.id,
        name: 'PD',
        type: 'pagerduty',
        config: JSON.stringify({ routingKey: PD_KEY }) as any,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const res = await post({
      organizationId: testOrganization.id,
      channelId: stored.id,
      type: 'pagerduty',
      config: {},
    });
    expect(res.statusCode).toBe(200);
    expect(deliverOnceMock.mock.calls[0][0].body.routing_key).toBe(PD_KEY);
  });
});

describe('POST /api/v1/notification-channels/test (real app)', () => {
  it('returns 401 without credentials', async () => {
    const { build } = await import('../../../server.js');
    const real = await build();
    try {
      const res = await real.inject({
        method: 'POST',
        url: '/api/v1/notification-channels/test',
        payload: {
          organizationId: '00000000-0000-4000-8000-000000000000',
          type: 'webhook',
          config: { url: 'https://example.com/h' },
        },
      });
      expect(res.statusCode).toBe(401);
    } finally {
      await real.close();
    }
  });
});
