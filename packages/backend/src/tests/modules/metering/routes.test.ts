import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import crypto from 'crypto';
import { db } from '../../../database/index.js';
import { usageRoutes } from '../../../modules/metering/routes.js';
import { createTestContext } from '../../helpers/factories.js';

async function createTestSession(userId: string) {
  const token = crypto.randomBytes(32).toString('hex');
  await db
    .insertInto('sessions')
    .values({ user_id: userId, token, expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000) })
    .execute();
  return token;
}

describe('GET /api/v1/usage', () => {
  let app: FastifyInstance;
  let orgId: string;
  let projectId: string;
  let token: string;

  beforeAll(async () => {
    app = Fastify();
    await app.register(usageRoutes, { prefix: '/api/v1/usage' });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await db.deleteFrom('metering_events').execute();
    const ctx = await createTestContext();
    orgId = ctx.organization.id;
    projectId = ctx.project.id;
    token = await createTestSession(ctx.user.id);

    await db.insertInto('metering_events').values([
      { time: new Date('2026-06-01T01:00:00Z'), organization_id: orgId, project_id: projectId, type: 'logs.ingested.events', quantity: 10, metadata: null },
      { time: new Date('2026-06-01T02:00:00Z'), organization_id: orgId, project_id: projectId, type: 'logs.ingested.bytes', quantity: 2048, metadata: null },
    ]).execute();
  });

  it('returns aggregated usage grouped by type', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/usage?organizationId=${orgId}&from=2026-06-01T00:00:00Z&to=2026-06-02T00:00:00Z&groupBy=type`,
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    const byType = Object.fromEntries(body.usage.map((r: any) => [r.type, r.quantity]));
    expect(byType['logs.ingested.events']).toBe(10);
    expect(byType['logs.ingested.bytes']).toBe(2048);
  });

  it('rejects a non-member with 403', async () => {
    const other = await createTestContext();
    const otherToken = await createTestSession(other.user.id);

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/usage?organizationId=${orgId}&from=2026-06-01T00:00:00Z&to=2026-06-02T00:00:00Z&groupBy=type`,
      headers: { Authorization: `Bearer ${otherToken}` },
    });

    expect(res.statusCode).toBe(403);
  });

  it('allows a platform admin to read another org usage', async () => {
    // Admin belongs to a different org and is NOT a member of `orgId`.
    const adminCtx = await createTestContext();
    await db
      .updateTable('users')
      .set({ is_admin: true })
      .where('id', '=', adminCtx.user.id)
      .execute();
    const adminToken = await createTestSession(adminCtx.user.id);

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/usage?organizationId=${orgId}&from=2026-06-01T00:00:00Z&to=2026-06-02T00:00:00Z&groupBy=type`,
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    const byType = Object.fromEntries(body.usage.map((r: any) => [r.type, r.quantity]));
    expect(byType['logs.ingested.events']).toBe(10);
  });

  it('returns 400 on a missing required param', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/usage?organizationId=${orgId}&groupBy=type`,
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(400);
  });
});
