import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import crypto from 'crypto';
import { db } from '../../../database/index.js';
import { customDashboardsRoutes } from '../../../modules/custom-dashboards/routes.js';
import { contextPlugin } from '../../../context/index.js';
import { capabilities } from '../../../capabilities/index.js';
import { createTestContext } from '../../helpers/factories.js';

async function createTestSession(userId: string) {
  const token = crypto.randomBytes(32).toString('hex');
  await db
    .insertInto('sessions')
    .values({ user_id: userId, token, expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000) })
    .execute();
  return token;
}

async function insertDashboard(organizationId: string, userId: string, n = 1, isPersonal = false) {
  const [dashboard] = await db
    .insertInto('custom_dashboards')
    .values({
      organization_id: organizationId,
      project_id: null,
      created_by: userId,
      name: `Dashboard ${n}`,
      description: null,
      is_default: false,
      is_personal: isPersonal,
      schema_version: 1,
      panels: JSON.stringify([]) as unknown as never,
    })
    .returningAll()
    .execute();
  return dashboard;
}

describe('dashboards.max_custom enforcement', () => {
  let app: FastifyInstance;
  let orgId: string;
  let userId: string;
  let token: string;

  beforeAll(async () => {
    app = Fastify();
    await app.register(contextPlugin);
    await app.register(customDashboardsRoutes, { prefix: '/api/v1/dashboards' });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await db.deleteFrom('organization_entitlements').execute();
    await db.deleteFrom('custom_dashboards').execute();
    await db.deleteFrom('sessions').execute();
    await db.deleteFrom('organization_members').execute();
    await db.deleteFrom('projects').execute();
    await db.deleteFrom('organizations').execute();
    await db.deleteFrom('users').execute();

    const ctx = await createTestContext();
    orgId = ctx.organization.id;
    userId = ctx.user.id;
    token = await createTestSession(userId);
    capabilities.invalidate(orgId);
  });

  // Case 1: at limit => blocked (personal dashboard counts too)
  it('blocks dashboard creation when at the limit', async () => {
    await db
      .insertInto('organization_entitlements')
      .values({ organization_id: orgId, capability: 'dashboards.max_custom', enabled: null, limit_value: 1 })
      .execute();
    capabilities.invalidate(orgId);

    // Insert one personal dashboard - it should count toward the limit
    await insertDashboard(orgId, userId, 1, true);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/dashboards',
      headers: { Authorization: `Bearer ${token}` },
      payload: { organizationId: orgId, name: 'New Dashboard' },
    });

    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body);
    expect(body.statusCode).toBe(403);
    expect(body.code).toBe('capability.dashboards.max_custom.limit_reached');
  });

  // Case 2: under limit => passes
  it('allows dashboard creation when under the limit', async () => {
    await db
      .insertInto('organization_entitlements')
      .values({ organization_id: orgId, capability: 'dashboards.max_custom', enabled: null, limit_value: 2 })
      .execute();
    capabilities.invalidate(orgId);

    await insertDashboard(orgId, userId, 1);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/dashboards',
      headers: { Authorization: `Bearer ${token}` },
      payload: { organizationId: orgId, name: 'New Dashboard' },
    });

    expect(res.statusCode).toBe(201);
  });

  // Case 3: unlimited default (no entitlement row) => passes
  it('allows dashboard creation when no limit is configured (unlimited default)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/dashboards',
      headers: { Authorization: `Bearer ${token}` },
      payload: { organizationId: orgId, name: 'New Dashboard' },
    });

    expect(res.statusCode).toBe(201);
  });

  // Case 3b: import-yaml also blocked at limit
  it('blocks dashboard import-yaml when at the limit', async () => {
    await db
      .insertInto('organization_entitlements')
      .values({ organization_id: orgId, capability: 'dashboards.max_custom', enabled: null, limit_value: 1 })
      .execute();
    capabilities.invalidate(orgId);

    await insertDashboard(orgId, userId, 1);

    const yaml = `
name: YAML Import
schema_version: 1
panels: []
`;

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/dashboards/import-yaml',
      headers: { Authorization: `Bearer ${token}` },
      payload: { organizationId: orgId, yaml },
    });

    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body);
    expect(body.statusCode).toBe(403);
    expect(body.code).toBe('capability.dashboards.max_custom.limit_reached');
  });

  // Case 4: org isolation => org A at limit does not block org B
  it('does not block org B when org A is at the limit', async () => {
    await db
      .insertInto('organization_entitlements')
      .values({ organization_id: orgId, capability: 'dashboards.max_custom', enabled: null, limit_value: 1 })
      .execute();
    capabilities.invalidate(orgId);
    await insertDashboard(orgId, userId, 1);

    const ctxB = await createTestContext();
    const tokenB = await createTestSession(ctxB.user.id);
    capabilities.invalidate(ctxB.organization.id);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/dashboards',
      headers: { Authorization: `Bearer ${tokenB}` },
      payload: { organizationId: ctxB.organization.id, name: 'New Dashboard' },
    });

    expect(res.statusCode).toBe(201);
  });

  // ─── POST /:id/duplicate ───────────────────────────────────────────────
  describe('POST /:id/duplicate', () => {
    const dup = (id: string, org: string, tok: string) =>
      app.inject({
        method: 'POST',
        url: `/api/v1/dashboards/${id}/duplicate?organizationId=${org}`,
        headers: { Authorization: `Bearer ${tok}` },
        payload: {},
      });
    const setLimit = async (org: string, limit: number) => {
      await db
        .insertInto('organization_entitlements')
        .values({ organization_id: org, capability: 'dashboards.max_custom', enabled: null, limit_value: limit })
        .execute();
      capabilities.invalidate(org);
    };

    it('blocks duplicate when at the limit and creates no row', async () => {
      const src = await insertDashboard(orgId, userId, 1);
      await setLimit(orgId, 1);

      const res = await dup(src.id, orgId, token);
      expect(res.statusCode).toBe(403);
      expect(JSON.parse(res.body).code).toBe('capability.dashboards.max_custom.limit_reached');

      const rows = await db.selectFrom('custom_dashboards').select('id').where('organization_id', '=', orgId).execute();
      expect(rows).toHaveLength(1);
    });

    it('allows duplicate when under the limit', async () => {
      const src = await insertDashboard(orgId, userId, 1);
      await setLimit(orgId, 2);
      const res = await dup(src.id, orgId, token);
      expect(res.statusCode).toBe(201);
    });

    it('allows duplicate when unlimited', async () => {
      const src = await insertDashboard(orgId, userId, 1);
      const res = await dup(src.id, orgId, token);
      expect(res.statusCode).toBe(201);
    });

    it('does not block org B when org A is at the limit', async () => {
      const srcA = await insertDashboard(orgId, userId, 1);
      await setLimit(orgId, 1);
      expect((await dup(srcA.id, orgId, token)).statusCode).toBe(403);

      const ctxB = await createTestContext();
      const tokenB = await createTestSession(ctxB.user.id);
      capabilities.invalidate(ctxB.organization.id);
      const srcB = await insertDashboard(ctxB.organization.id, ctxB.user.id, 1);
      expect((await dup(srcB.id, ctxB.organization.id, tokenB)).statusCode).toBe(201);
    });
  });

  // ─── POST /from-template ───────────────────────────────────────────────
  describe('POST /from-template', () => {
    const fromTemplate = (org: string, tok: string) =>
      app.inject({
        method: 'POST',
        url: '/api/v1/dashboards/from-template',
        headers: { Authorization: `Bearer ${tok}` },
        payload: { organizationId: org, templateId: 'errors-overview' },
      });
    const setLimit = async (org: string, limit: number) => {
      await db
        .insertInto('organization_entitlements')
        .values({ organization_id: org, capability: 'dashboards.max_custom', enabled: null, limit_value: limit })
        .execute();
      capabilities.invalidate(org);
    };

    it('blocks from-template when at the limit and creates no row', async () => {
      await insertDashboard(orgId, userId, 1);
      await setLimit(orgId, 1);

      const res = await fromTemplate(orgId, token);
      expect(res.statusCode).toBe(403);
      expect(JSON.parse(res.body).code).toBe('capability.dashboards.max_custom.limit_reached');

      const rows = await db.selectFrom('custom_dashboards').select('id').where('organization_id', '=', orgId).execute();
      expect(rows).toHaveLength(1);
    });

    it('allows from-template when under the limit', async () => {
      await insertDashboard(orgId, userId, 1);
      await setLimit(orgId, 2);
      expect((await fromTemplate(orgId, token)).statusCode).toBe(201);
    });

    it('allows from-template when unlimited', async () => {
      expect((await fromTemplate(orgId, token)).statusCode).toBe(201);
    });

    it('does not block org B when org A is at the limit', async () => {
      await insertDashboard(orgId, userId, 1);
      await setLimit(orgId, 1);
      expect((await fromTemplate(orgId, token)).statusCode).toBe(403);

      const ctxB = await createTestContext();
      const tokenB = await createTestSession(ctxB.user.id);
      capabilities.invalidate(ctxB.organization.id);
      expect((await fromTemplate(ctxB.organization.id, tokenB)).statusCode).toBe(201);
    });
  });

  // ─── POST /from-template ───────────────────────────────────────────────
  describe('POST /from-template', () => {
    const fromTemplate = (org: string, tok: string) =>
      app.inject({
        method: 'POST',
        url: '/api/v1/dashboards/from-template',
        headers: { Authorization: `Bearer ${tok}` },
        payload: { organizationId: org, templateId: 'errors-overview' },
      });
    const setLimit = async (org: string, limit: number) => {
      await db
        .insertInto('organization_entitlements')
        .values({ organization_id: org, capability: 'dashboards.max_custom', enabled: null, limit_value: limit })
        .execute();
      capabilities.invalidate(org);
    };

    it('blocks from-template when at the limit and creates no row', async () => {
      await insertDashboard(orgId, userId, 1);
      await setLimit(orgId, 1);

      const res = await fromTemplate(orgId, token);
      expect(res.statusCode).toBe(403);
      expect(JSON.parse(res.body).code).toBe('capability.dashboards.max_custom.limit_reached');

      const rows = await db.selectFrom('custom_dashboards').select('id').where('organization_id', '=', orgId).execute();
      expect(rows).toHaveLength(1);
    });

    it('allows from-template when under the limit', async () => {
      await insertDashboard(orgId, userId, 1);
      await setLimit(orgId, 2);
      expect((await fromTemplate(orgId, token)).statusCode).toBe(201);
    });

    it('allows from-template when unlimited', async () => {
      expect((await fromTemplate(orgId, token)).statusCode).toBe(201);
    });

    it('does not block org B when org A is at the limit', async () => {
      await insertDashboard(orgId, userId, 1);
      await setLimit(orgId, 1);
      expect((await fromTemplate(orgId, token)).statusCode).toBe(403);

      const ctxB = await createTestContext();
      const tokenB = await createTestSession(ctxB.user.id);
      capabilities.invalidate(ctxB.organization.id);
      expect((await fromTemplate(ctxB.organization.id, tokenB)).statusCode).toBe(201);
    });
  });
});
