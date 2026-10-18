import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import crypto from 'crypto';
import { db } from '../../../database/index.js';
import { projectsRoutes } from '../../../modules/projects/routes.js';
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

async function insertProject(orgId: string, userId: string, name: string, deleted = false) {
  return db
    .insertInto('projects')
    .values({
      name,
      slug: `${name.toLowerCase().replace(/\s+/g, '-')}-${crypto.randomBytes(3).toString('hex')}`,
      organization_id: orgId,
      user_id: userId,
      deleted_at: deleted ? new Date() : null,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}

async function setLimit(orgId: string, limit: number) {
  await db
    .insertInto('organization_entitlements')
    .values({ organization_id: orgId, capability: 'projects.max', enabled: null, limit_value: limit })
    .execute();
  capabilities.invalidate(orgId);
}

describe('projects.max enforcement', () => {
  let app: FastifyInstance;
  let orgId: string;
  let userId: string;
  let token: string;

  beforeAll(async () => {
    app = Fastify();
    await app.register(contextPlugin);
    await app.register(projectsRoutes, { prefix: '/api/v1/projects' });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await db.deleteFrom('organization_entitlements').execute();
    await db.deleteFrom('api_keys').execute();
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

  const create = (organizationId: string, name: string, bearer = token) =>
    app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: { Authorization: `Bearer ${bearer}` },
      payload: { organizationId, name },
    });

  // createTestContext already created 1 active project.
  it('blocks creation when the limit is reached', async () => {
    await setLimit(orgId, 1);

    const res = await create(orgId, 'Over Limit');
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).code).toBe('capability.projects.max.limit_reached');
  });

  it('allows creation when under the limit', async () => {
    await setLimit(orgId, 2);

    const res = await create(orgId, 'Under Limit');
    expect(res.statusCode).toBe(201);
  });

  it('allows creation when no limit is configured (unlimited default)', async () => {
    const res = await create(orgId, 'Unlimited');
    expect(res.statusCode).toBe(201);
  });

  it('ignores soft-deleted projects and other organizations', async () => {
    await setLimit(orgId, 2);
    await insertProject(orgId, userId, 'Gone', true);

    // Another org with several projects must not count against this one.
    const ctxB = await createTestContext();
    await insertProject(ctxB.organization.id, ctxB.user.id, 'B Extra 1');
    await insertProject(ctxB.organization.id, ctxB.user.id, 'B Extra 2');

    const res = await create(orgId, 'Still Fits');
    expect(res.statusCode).toBe(201);

    // Org A being at its limit does not block org B.
    const tokenB = await createTestSession(ctxB.user.id);
    capabilities.invalidate(ctxB.organization.id);
    const resB = await create(ctxB.organization.id, 'B New', tokenB);
    expect(resB.statusCode).toBe(201);

    const blocked = await create(orgId, 'Now Full');
    expect(blocked.statusCode).toBe(403);
  });
  const restore = (projectId: string, bearer = token) =>
    app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/restore`,
      headers: { Authorization: `Bearer ${bearer}` },
    });

  it('blocks restoring a soft-deleted project when the limit is reached', async () => {
    // 1 active project from createTestContext + 1 soft-deleted.
    const gone = await insertProject(orgId, userId, 'Gone Restore', true);
    await setLimit(orgId, 1);

    const res = await restore(gone.id);
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).code).toBe('capability.projects.max.limit_reached');

    const row = await db.selectFrom('projects').select('deleted_at').where('id', '=', gone.id).executeTakeFirstOrThrow();
    expect(row.deleted_at).not.toBeNull();
  });

  it('allows restoring a soft-deleted project when under the limit', async () => {
    const gone = await insertProject(orgId, userId, 'Gone Restore Ok', true);
    await setLimit(orgId, 2);

    const res = await restore(gone.id);
    expect(res.statusCode).toBe(200);
    const row = await db.selectFrom('projects').select('deleted_at').where('id', '=', gone.id).executeTakeFirstOrThrow();
    expect(row.deleted_at).toBeNull();
  });

  it('allows restoring when no limit is configured', async () => {
    const gone = await insertProject(orgId, userId, 'Gone Restore Unlimited', true);
    const res = await restore(gone.id);
    expect(res.statusCode).toBe(200);
  });
});
