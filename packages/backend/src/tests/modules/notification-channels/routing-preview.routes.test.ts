import { describe, it, expect, beforeEach, afterAll, beforeAll } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import crypto from 'crypto';
import { db } from '../../../database/index.js';
import { notificationRoutingRoutes } from '../../../modules/notification-channels/routing-preview.routes.js';
import { build } from '../../../server.js';
import {
  createTestContext,
  createTestUser,
  createTestOrganization,
  createTestProject,
} from '../../helpers/factories.js';

async function createTestSession(userId: string) {
  const token = crypto.randomBytes(32).toString('hex');
  await db
    .insertInto('sessions')
    .values({ user_id: userId, token, expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000) })
    .execute();
  return token;
}

async function addChannel(organizationId: string, name: string, enabled = true) {
  return db
    .insertInto('notification_channels')
    .values({
      organization_id: organizationId,
      name,
      type: 'email',
      enabled,
      config: { recipients: ['ops@example.com'] },
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}

async function cleanDb() {
  await db.deleteFrom('organization_default_channels').execute();
  await db.deleteFrom('notification_channels').execute();
  await db.deleteFrom('api_keys').execute();
  await db.deleteFrom('organization_members').execute();
  await db.deleteFrom('projects').execute();
  await db.deleteFrom('organizations').execute();
  await db.deleteFrom('sessions').execute();
  await db.deleteFrom('users').execute();
}

describe('GET /api/v1/notification-routing/preview', () => {
  let app: FastifyInstance;
  let token: string;
  let orgId: string;
  let projectId: string;

  beforeAll(async () => {
    app = Fastify();
    await app.register(notificationRoutingRoutes, { prefix: '/api/v1/notification-routing' });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await cleanDb();
    const ctx = await createTestContext();
    orgId = ctx.organization.id;
    projectId = ctx.project.id;
    token = await createTestSession(ctx.user.id);
  });

  const get = (query: string, authToken: string | null = token, instance: FastifyInstance = app) =>
    instance.inject({
      method: 'GET',
      url: `/api/v1/notification-routing/preview?${query}`,
      headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
    });

  it('returns destinations and fallback for a member', async () => {
    const ch = await addChannel(orgId, 'Ops');
    const res = await get(`organizationId=${orgId}&eventType=alert&channelIds=${ch.id}`);

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(Object.keys(body)).toEqual(['destinations', 'fallback']);
    expect(body.destinations).toEqual([{ id: ch.id, name: 'Ops', type: 'email' }]);
  });

  it('a plain member (non admin) can preview', async () => {
    const member = await createTestUser({ email: 'member@test.com' });
    await db
      .insertInto('organization_members')
      .values({ user_id: member.id, organization_id: orgId, role: 'member' })
      .execute();
    const memberToken = await createTestSession(member.id);

    const res = await get(`organizationId=${orgId}&eventType=incident`, memberToken);
    expect(res.statusCode).toBe(200);
  });

  it('returns 401 without auth', async () => {
    const res = await get(`organizationId=${orgId}&eventType=alert`, null);
    expect(res.statusCode).toBe(401);
  });

  it('returns 403 for a non-member', async () => {
    const other = await createTestUser({ email: 'outsider@test.com' });
    const otherToken = await createTestSession(other.id);
    const res = await get(`organizationId=${orgId}&eventType=alert`, otherToken);
    expect(res.statusCode).toBe(403);
  });

  it('returns 400 when organizationId is missing', async () => {
    const res = await get('eventType=alert');
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when eventType is not one of the five', async () => {
    const res = await get(`organizationId=${orgId}&eventType=bogus`);
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when channelIds has an invalid uuid', async () => {
    const res = await get(`organizationId=${orgId}&eventType=alert&channelIds=not-a-uuid`);
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when channelIds has 51 entries', async () => {
    const ids = Array.from({ length: 51 }, () => crypto.randomUUID()).join(',');
    const res = await get(`organizationId=${orgId}&eventType=alert&channelIds=${ids}`);
    expect(res.statusCode).toBe(400);
  });

  it('accepts 50 channelIds', async () => {
    const ids = Array.from({ length: 50 }, () => crypto.randomUUID()).join(',');
    const res = await get(`organizationId=${orgId}&eventType=alert&channelIds=${ids}`);
    expect(res.statusCode).toBe(200);
  });

  it('accepts an empty channelIds value', async () => {
    const res = await get(`organizationId=${orgId}&eventType=alert&channelIds=`);
    expect(res.statusCode).toBe(200);
  });

  it('accepts a projectId of the organization', async () => {
    const res = await get(`organizationId=${orgId}&eventType=alert&projectId=${projectId}`);
    expect(res.statusCode).toBe(200);
  });

  it('returns 404 when projectId belongs to another organization', async () => {
    const otherUser = await createTestUser({ email: 'owner2@test.com' });
    const otherOrg = await createTestOrganization({
      ownerId: otherUser.id,
      name: 'Other',
      slug: `other-${Date.now()}`,
    });
    const otherProject = await createTestProject({
      organizationId: otherOrg.id,
      userId: otherUser.id,
    });

    const res = await get(`organizationId=${orgId}&eventType=alert&projectId=${otherProject.id}`);
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.payload)).toEqual({ error: 'Project not found' });
  });

  it('ignores channels of another organization', async () => {
    const otherUser = await createTestUser({ email: 'owner3@test.com' });
    const otherOrg = await createTestOrganization({
      ownerId: otherUser.id,
      name: 'OtherOrgSecretName',
      slug: `other-${Date.now()}`,
    });
    const foreign = await addChannel(otherOrg.id, 'ForeignChannelName');

    const res = await get(`organizationId=${orgId}&eventType=alert&channelIds=${foreign.id}`);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload).destinations).toEqual([]);
    expect(res.payload).not.toContain('ForeignChannelName');
    expect(res.payload).not.toContain('OtherOrgSecretName');
  });

  it("does not leak another organization's defaults", async () => {
    const otherUser = await createTestUser({ email: 'owner4@test.com' });
    const otherOrg = await createTestOrganization({
      ownerId: otherUser.id,
      name: 'Other',
      slug: `other-${Date.now()}`,
    });
    const foreign = await addChannel(otherOrg.id, 'ForeignDefaultName');
    await db
      .insertInto('organization_default_channels')
      .values({ organization_id: otherOrg.id, channel_id: foreign.id, event_type: 'alert' })
      .execute();

    const res = await get(`organizationId=${orgId}&eventType=alert`);
    expect(res.statusCode).toBe(200);
    expect(res.payload).not.toContain('ForeignDefaultName');
  });

  describe('real app', () => {
    let realApp: any;

    beforeAll(async () => {
      realApp = await build();
      await realApp.ready();
    });

    afterAll(async () => {
      if (realApp) await realApp.close();
    });

    it('real app: GET /api/v1/notification-routing/preview is registered', async () => {
      const unauth = await get(`organizationId=${orgId}&eventType=alert`, null, realApp);
      expect(unauth.statusCode).toBe(401);

      const ok = await get(`organizationId=${orgId}&eventType=alert`, token, realApp);
      expect(ok.statusCode).toBe(200);
      expect(Object.keys(JSON.parse(ok.payload))).toEqual(['destinations', 'fallback']);
    });
  });
});
