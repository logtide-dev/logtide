import { describe, it, expect, beforeEach, afterAll, beforeAll } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import crypto from 'crypto';
import { db } from '../../../database/index.js';
import { digestsRoutes } from '../../../modules/digests/routes.js';
import { digestsPublicRoutes } from '../../../modules/digests/public-routes.js';
import { createTestContext, createTestUser } from '../../helpers/factories.js';

async function createTestSession(userId: string) {
  const token = crypto.randomBytes(32).toString('hex');
  await db
    .insertInto('sessions')
    .values({ user_id: userId, token, expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000) })
    .execute();
  return token;
}

describe('Digests Routes', () => {
  let app: FastifyInstance;
  let authToken: string;
  let testUser: any;
  let testOrganization: any;

  beforeAll(async () => {
    app = Fastify();
    await app.register(digestsRoutes, { prefix: '/api/v1/digests' });
    await app.register(digestsPublicRoutes, { prefix: '/api/v1/digests' });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await db.deleteFrom('digest_recipients').execute();
    await db.deleteFrom('digest_configs').execute();
    await db.deleteFrom('organization_members').execute();
    await db.deleteFrom('projects').execute();
    await db.deleteFrom('organizations').execute();
    await db.deleteFrom('sessions').execute();
    await db.deleteFrom('users').execute();

    const context = await createTestContext();
    testUser = context.user;
    testOrganization = context.organization;

    authToken = await createTestSession(testUser.id);
  });

  async function insertConfig(organizationId: string, overrides: Record<string, unknown> = {}) {
    return db
      .insertInto('digest_configs')
      .values({
        organization_id: organizationId,
        frequency: 'daily',
        delivery_hour: 8,
        ...overrides,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async function insertRecipient(
    organizationId: string,
    configId: string,
    email = 'someone@example.com'
  ) {
    return db
      .insertInto('digest_recipients')
      .values({
        organization_id: organizationId,
        digest_config_id: configId,
        email,
        unsubscribe_token: crypto.randomBytes(32).toString('base64url'),
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  describe('GET /api/v1/digests/config', () => {
    it('returns null config when the org has none', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/digests/config?organizationId=${testOrganization.id}`,
        headers: { Authorization: `Bearer ${authToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.config).toBeNull();
      expect(body.recipients).toEqual([]);
    });

    it('returns the config with its recipients', async () => {
      const config = await insertConfig(testOrganization.id);
      await insertRecipient(testOrganization.id, config.id);

      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/digests/config?organizationId=${testOrganization.id}`,
        headers: { Authorization: `Bearer ${authToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.config.frequency).toBe('daily');
      expect(body.config.delivery_hour).toBe(8);
      expect(body.recipients).toHaveLength(1);
      expect(body.recipients[0].email).toBe('someone@example.com');
      // The unsubscribe token must never leak through the management API
      expect(body.recipients[0].unsubscribe_token).toBeUndefined();
    });

    it('returns merged defaults for a config saved without sections', async () => {
      await insertConfig(testOrganization.id);

      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/digests/config?organizationId=${testOrganization.id}`,
        headers: { Authorization: `Bearer ${authToken}` },
      });

      expect(res.statusCode).toBe(200);
      const { sections } = JSON.parse(res.body).config;
      expect(sections.logVolume).toBe(true);
      expect(sections.uptime).toBe(true);
      expect(sections.traces).toBe(false);
      expect(sections.teamActivity).toBe(false);
    });

    it('rejects non-members', async () => {
      const outsider = await createTestUser({ email: 'outsider@example.com' });
      const outsiderToken = await createTestSession(outsider.id);

      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/digests/config?organizationId=${testOrganization.id}`,
        headers: { Authorization: `Bearer ${outsiderToken}` },
      });

      expect(res.statusCode).toBe(403);
    });

    it('rejects unauthenticated requests', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/digests/config?organizationId=${testOrganization.id}`,
      });

      expect(res.statusCode).toBe(401);
    });
  });

  describe('PUT /api/v1/digests/config', () => {
    it('creates the config on first save', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: `/api/v1/digests/config?organizationId=${testOrganization.id}`,
        headers: { Authorization: `Bearer ${authToken}` },
        payload: { frequency: 'daily', deliveryHour: 9, enabled: true },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.config.frequency).toBe('daily');
      expect(body.config.delivery_hour).toBe(9);
      expect(body.config.enabled).toBe(true);
    });

    it('updates the existing config (upsert)', async () => {
      await insertConfig(testOrganization.id, { delivery_hour: 8 });

      const res = await app.inject({
        method: 'PUT',
        url: `/api/v1/digests/config?organizationId=${testOrganization.id}`,
        headers: { Authorization: `Bearer ${authToken}` },
        payload: { frequency: 'weekly', deliveryHour: 18, deliveryDayOfWeek: 1, enabled: false },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.config.frequency).toBe('weekly');
      expect(body.config.delivery_hour).toBe(18);
      expect(body.config.delivery_day_of_week).toBe(1);
      expect(body.config.enabled).toBe(false);

      const rows = await db.selectFrom('digest_configs').selectAll().execute();
      expect(rows).toHaveLength(1);
    });

    it('rejects weekly frequency without a day of week', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: `/api/v1/digests/config?organizationId=${testOrganization.id}`,
        headers: { Authorization: `Bearer ${authToken}` },
        payload: { frequency: 'weekly', deliveryHour: 8, enabled: true },
      });

      expect(res.statusCode).toBe(400);
    });

    it('rejects an out-of-range delivery hour', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: `/api/v1/digests/config?organizationId=${testOrganization.id}`,
        headers: { Authorization: `Bearer ${authToken}` },
        payload: { frequency: 'daily', deliveryHour: 24, enabled: true },
      });

      expect(res.statusCode).toBe(400);
    });

    it('accepts a partial sections object and returns the merged record', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: `/api/v1/digests/config?organizationId=${testOrganization.id}`,
        headers: { Authorization: `Bearer ${authToken}` },
        payload: { frequency: 'daily', deliveryHour: 8, enabled: true, sections: { traces: true } },
      });

      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).config.sections.traces).toBe(true);

      const getRes = await app.inject({
        method: 'GET',
        url: `/api/v1/digests/config?organizationId=${testOrganization.id}`,
        headers: { Authorization: `Bearer ${authToken}` },
      });
      const cfg = JSON.parse(getRes.body).config;
      expect(cfg.sections.traces).toBe(true);
      expect(cfg.sections.logVolume).toBe(true);
      expect(cfg.sections.teamActivity).toBe(false);

      // only the partial is persisted, defaults stay code-side
      const row = await db
        .selectFrom('digest_configs')
        .select(['sections'])
        .where('organization_id', '=', testOrganization.id)
        .executeTakeFirstOrThrow();
      expect(row.sections).toEqual({ traces: true });
    });

    it('keeps stored sections when a later save omits them', async () => {
      await insertConfig(testOrganization.id, { sections: { traces: true } });

      const res = await app.inject({
        method: 'PUT',
        url: `/api/v1/digests/config?organizationId=${testOrganization.id}`,
        headers: { Authorization: `Bearer ${authToken}` },
        payload: { frequency: 'daily', deliveryHour: 10, enabled: true },
      });

      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).config.sections.traces).toBe(true);
    });

    it('resets to defaults when sections is explicitly null', async () => {
      await insertConfig(testOrganization.id, { sections: { traces: true } });

      const res = await app.inject({
        method: 'PUT',
        url: `/api/v1/digests/config?organizationId=${testOrganization.id}`,
        headers: { Authorization: `Bearer ${authToken}` },
        payload: { frequency: 'daily', deliveryHour: 10, enabled: true, sections: null },
      });

      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).config.sections.traces).toBe(false);
    });

    it('rejects unknown section keys', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: `/api/v1/digests/config?organizationId=${testOrganization.id}`,
        headers: { Authorization: `Bearer ${authToken}` },
        payload: { frequency: 'daily', deliveryHour: 8, enabled: true, sections: { bogus: true } },
      });

      expect(res.statusCode).toBe(400);
    });

    it('rejects non-boolean section values', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: `/api/v1/digests/config?organizationId=${testOrganization.id}`,
        headers: { Authorization: `Bearer ${authToken}` },
        payload: { frequency: 'daily', deliveryHour: 8, enabled: true, sections: { traces: 'yes' } },
      });

      expect(res.statusCode).toBe(400);
    });

    it('rejects members without admin role', async () => {
      const member = await createTestUser({ email: 'member@example.com' });
      await db
        .insertInto('organization_members')
        .values({ organization_id: testOrganization.id, user_id: member.id, role: 'member' })
        .execute();
      const memberToken = await createTestSession(member.id);

      const res = await app.inject({
        method: 'PUT',
        url: `/api/v1/digests/config?organizationId=${testOrganization.id}`,
        headers: { Authorization: `Bearer ${memberToken}` },
        payload: { frequency: 'daily', deliveryHour: 8, enabled: true },
      });

      expect(res.statusCode).toBe(403);
    });
  });

  describe('DELETE /api/v1/digests/config', () => {
    it('deletes the config and cascades to recipients', async () => {
      const config = await insertConfig(testOrganization.id);
      await insertRecipient(testOrganization.id, config.id);

      const res = await app.inject({
        method: 'DELETE',
        url: `/api/v1/digests/config?organizationId=${testOrganization.id}`,
        headers: { Authorization: `Bearer ${authToken}` },
      });

      expect(res.statusCode).toBe(204);
      const recipients = await db.selectFrom('digest_recipients').selectAll().execute();
      expect(recipients).toHaveLength(0);
    });

    it('returns 404 when there is no config', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: `/api/v1/digests/config?organizationId=${testOrganization.id}`,
        headers: { Authorization: `Bearer ${authToken}` },
      });

      expect(res.statusCode).toBe(404);
    });
  });

  describe('POST /api/v1/digests/recipients', () => {
    it('adds a recipient with a generated unsubscribe token', async () => {
      await insertConfig(testOrganization.id);

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/digests/recipients?organizationId=${testOrganization.id}`,
        headers: { Authorization: `Bearer ${authToken}` },
        payload: { email: 'new@example.com' },
      });

      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.body);
      expect(body.recipient.email).toBe('new@example.com');
      expect(body.recipient.subscribed).toBe(true);
      expect(body.recipient.unsubscribe_token).toBeUndefined();

      const row = await db
        .selectFrom('digest_recipients')
        .selectAll()
        .where('email', '=', 'new@example.com')
        .executeTakeFirstOrThrow();
      expect(row.unsubscribe_token.length).toBeGreaterThanOrEqual(40);
    });

    it('rejects adding a recipient before the digest is configured', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/digests/recipients?organizationId=${testOrganization.id}`,
        headers: { Authorization: `Bearer ${authToken}` },
        payload: { email: 'new@example.com' },
      });

      expect(res.statusCode).toBe(409);
    });

    it('rejects duplicate emails', async () => {
      const config = await insertConfig(testOrganization.id);
      await insertRecipient(testOrganization.id, config.id, 'dup@example.com');

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/digests/recipients?organizationId=${testOrganization.id}`,
        headers: { Authorization: `Bearer ${authToken}` },
        payload: { email: 'dup@example.com' },
      });

      expect(res.statusCode).toBe(409);
    });

    it('rejects invalid emails', async () => {
      await insertConfig(testOrganization.id);

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/digests/recipients?organizationId=${testOrganization.id}`,
        headers: { Authorization: `Bearer ${authToken}` },
        payload: { email: 'not-an-email' },
      });

      expect(res.statusCode).toBe(400);
    });
  });

  describe('DELETE /api/v1/digests/recipients/:id', () => {
    it('removes a recipient', async () => {
      const config = await insertConfig(testOrganization.id);
      const recipient = await insertRecipient(testOrganization.id, config.id);

      const res = await app.inject({
        method: 'DELETE',
        url: `/api/v1/digests/recipients/${recipient.id}?organizationId=${testOrganization.id}`,
        headers: { Authorization: `Bearer ${authToken}` },
      });

      expect(res.statusCode).toBe(204);
    });

    it('cannot remove a recipient of another organization', async () => {
      // org B with its own digest + recipient
      const ctxB = await createTestContext();
      const configB = await insertConfig(ctxB.organization.id);
      const recipientB = await insertRecipient(ctxB.organization.id, configB.id, 'orgb@example.com');

      // org A admin tries to delete org B's recipient through their own org scope
      const res = await app.inject({
        method: 'DELETE',
        url: `/api/v1/digests/recipients/${recipientB.id}?organizationId=${testOrganization.id}`,
        headers: { Authorization: `Bearer ${authToken}` },
      });

      expect(res.statusCode).toBe(404);
      const stillThere = await db
        .selectFrom('digest_recipients')
        .selectAll()
        .where('id', '=', recipientB.id)
        .executeTakeFirst();
      expect(stillThere).toBeDefined();
    });
  });

  describe('POST /api/v1/digests/recipients/:id/resubscribe', () => {
    it('resubscribes and rotates the unsubscribe token', async () => {
      const config = await insertConfig(testOrganization.id);
      const recipient = await insertRecipient(testOrganization.id, config.id);
      await db
        .updateTable('digest_recipients')
        .set({ subscribed: false })
        .where('id', '=', recipient.id)
        .execute();

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/digests/recipients/${recipient.id}/resubscribe?organizationId=${testOrganization.id}`,
        headers: { Authorization: `Bearer ${authToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.recipient.subscribed).toBe(true);

      const row = await db
        .selectFrom('digest_recipients')
        .selectAll()
        .where('id', '=', recipient.id)
        .executeTakeFirstOrThrow();
      expect(row.subscribed).toBe(true);
      expect(row.unsubscribe_token).not.toBe(recipient.unsubscribe_token);
    });

    it('returns 404 for unknown recipients', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/digests/recipients/${crypto.randomUUID()}/resubscribe?organizationId=${testOrganization.id}`,
        headers: { Authorization: `Bearer ${authToken}` },
      });

      expect(res.statusCode).toBe(404);
    });
  });

  describe('POST /api/v1/digests/unsubscribe (public)', () => {
    it('unsubscribes by token without authentication', async () => {
      const config = await insertConfig(testOrganization.id);
      const recipient = await insertRecipient(testOrganization.id, config.id, 'giuseppe@example.com');

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/digests/unsubscribe',
        payload: { token: recipient.unsubscribe_token },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(true);
      expect(body.email).toBe('g***@example.com');

      const row = await db
        .selectFrom('digest_recipients')
        .selectAll()
        .where('id', '=', recipient.id)
        .executeTakeFirstOrThrow();
      expect(row.subscribed).toBe(false);
    });

    it('is idempotent', async () => {
      const config = await insertConfig(testOrganization.id);
      const recipient = await insertRecipient(testOrganization.id, config.id);

      const first = await app.inject({
        method: 'POST',
        url: '/api/v1/digests/unsubscribe',
        payload: { token: recipient.unsubscribe_token },
      });
      const second = await app.inject({
        method: 'POST',
        url: '/api/v1/digests/unsubscribe',
        payload: { token: recipient.unsubscribe_token },
      });

      expect(first.statusCode).toBe(200);
      expect(second.statusCode).toBe(200);
    });

    it('returns 404 for unknown tokens', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/digests/unsubscribe',
        payload: { token: 'nope' },
      });

      expect(res.statusCode).toBe(404);
    });

    it('rejects requests without a token', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/digests/unsubscribe',
        payload: {},
      });

      expect(res.statusCode).toBe(400);
    });
  });
});
