import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import crypto from 'crypto';
import { db } from '../../../database/index.js';
import { adminEntitlementsRoutes } from '../../../modules/capabilities/admin-routes.js';
import { capabilities } from '../../../capabilities/index.js';
import { createTestContext, createTestUser } from '../../helpers/factories.js';

async function createTestSession(userId: string) {
  const token = crypto.randomBytes(32).toString('hex');
  await db
    .insertInto('sessions')
    .values({ user_id: userId, token, expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000) })
    .execute();
  return token;
}

async function setAdmin(userId: string) {
  await db.updateTable('users').set({ is_admin: true }).where('id', '=', userId).execute();
}

describe('admin entitlements routes', () => {
  let app: FastifyInstance;
  let orgId: string;
  let adminToken: string;
  let memberToken: string;

  beforeAll(async () => {
    app = Fastify();
    await app.register(adminEntitlementsRoutes, { prefix: '/api/v1/admin' });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await db.deleteFrom('organization_entitlements').execute();
    const ctx = await createTestContext();
    orgId = ctx.organization.id;
    memberToken = await createTestSession(ctx.user.id);

    const admin = await createTestUser({ email: `admin-${Date.now()}@test.com` });
    await setAdmin(admin.id);
    adminToken = await createTestSession(admin.id);
    capabilities.invalidate(orgId);
  });

  it('GET returns the merged entitlement set for an org (admin)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/admin/organizations/${orgId}/entitlements`,
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.entitlements['auth.sso']).toEqual({ kind: 'boolean', enabled: true });
    expect(body.entitlements['alerts.max_rules']).toEqual({ kind: 'limit', limit: null });
  });

  it('PUT upserts a boolean entitlement and invalidates cache', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/admin/organizations/${orgId}/entitlements`,
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: { entitlements: [{ capability: 'auth.sso', enabled: false }] },
    });
    expect(res.statusCode).toBe(200);

    const row = await db
      .selectFrom('organization_entitlements')
      .selectAll()
      .where('organization_id', '=', orgId)
      .where('capability', '=', 'auth.sso')
      .executeTakeFirst();
    expect(row?.enabled).toBe(false);

    // Cache invalidated -> facade reflects the new value
    expect(await capabilities.has(orgId, 'auth.sso')).toBe(false);
  });

  it('PUT upserts a numeric limit', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/admin/organizations/${orgId}/entitlements`,
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: { entitlements: [{ capability: 'alerts.max_rules', limitValue: 10 }] },
    });
    expect(res.statusCode).toBe(200);
    expect(await capabilities.getLimit(orgId, 'alerts.max_rules')).toBe(10);
  });

  it('PUT accepts limitValue: null (unlimited) on a quota capability', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/admin/organizations/${orgId}/entitlements`,
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: { entitlements: [{ capability: 'ingestion.max_bytes_monthly', limitValue: null }] },
    });
    expect(res.statusCode).toBe(200);
    expect(await capabilities.getLimit(orgId, 'ingestion.max_bytes_monthly')).toBeNull();
  });

  it('PUT rejects an unknown capability name with 400', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/admin/organizations/${orgId}/entitlements`,
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: { entitlements: [{ capability: 'not.a.real.cap', enabled: true }] },
    });
    expect(res.statusCode).toBe(400);
  });

  it('PUT rejects a value-shape mismatch (enabled on a limit cap) with 400', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/admin/organizations/${orgId}/entitlements`,
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: { entitlements: [{ capability: 'alerts.max_rules', enabled: true }] },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects a non-admin with 403', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/admin/organizations/${orgId}/entitlements`,
      headers: { Authorization: `Bearer ${memberToken}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it('GET exposes registry defaults and the explicit overrides separately', async () => {
    await db
      .insertInto('organization_entitlements')
      .values({ organization_id: orgId, capability: 'alerts.max_rules', enabled: null, limit_value: 7 })
      .execute();
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/admin/organizations/${orgId}/entitlements`,
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.entitlements['alerts.max_rules']).toEqual({ kind: 'limit', limit: 7 });
    expect(body.defaults['alerts.max_rules']).toEqual({ kind: 'limit', limit: null });
    expect(body.defaults['auth.sso']).toEqual({ kind: 'boolean', enabled: true });
    expect(body.overrides).toEqual({ 'alerts.max_rules': { enabled: null, limitValue: 7 } });
  });

  it('GET rejects a malformed org id with 400', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/admin/organizations/not-a-uuid/entitlements`,
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(400);
  });

  describe('DELETE /organizations/:id/entitlements/:capability', () => {
    it('removes the override so the org falls back to the default', async () => {
      await app.inject({
        method: 'PUT',
        url: `/api/v1/admin/organizations/${orgId}/entitlements`,
        headers: { Authorization: `Bearer ${adminToken}` },
        payload: { entitlements: [{ capability: 'alerts.max_rules', limitValue: 3 }] },
      });
      expect(await capabilities.getLimit(orgId, 'alerts.max_rules')).toBe(3);

      const res = await app.inject({
        method: 'DELETE',
        url: `/api/v1/admin/organizations/${orgId}/entitlements/alerts.max_rules`,
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.payload)).toMatchObject({ removed: true });

      const row = await db
        .selectFrom('organization_entitlements')
        .select('capability')
        .where('organization_id', '=', orgId)
        .where('capability', '=', 'alerts.max_rules')
        .executeTakeFirst();
      expect(row).toBeUndefined();
      expect(await capabilities.getLimit(orgId, 'alerts.max_rules')).toBeNull();

      const audit = await db
        .selectFrom('audit_log')
        .selectAll()
        .where('action', '=', 'org.entitlements_updated')
        .where('organization_id', '=', orgId)
        .orderBy('time', 'desc')
        .executeTakeFirst();
      expect((audit!.metadata as any).reset).toEqual(['alerts.max_rules']);
    });

    it('is idempotent when no override exists', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: `/api/v1/admin/organizations/${orgId}/entitlements/auth.sso`,
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.payload)).toMatchObject({ removed: false });
    });

    it('rejects an unknown capability with 400', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: `/api/v1/admin/organizations/${orgId}/entitlements/nope.nothing`,
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      expect(res.statusCode).toBe(400);
    });

    it('rejects a non-admin with 403', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: `/api/v1/admin/organizations/${orgId}/entitlements/auth.sso`,
        headers: { Authorization: `Bearer ${memberToken}` },
      });
      expect(res.statusCode).toBe(403);
    });
  });
});
