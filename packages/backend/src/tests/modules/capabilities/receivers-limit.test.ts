import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import crypto from 'crypto';
import { db } from '../../../database/index.js';
import { receiversRoutes } from '../../../modules/receivers/routes.js';
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

async function insertReceiver(projectId: string, n = 1) {
  const tokenHash = crypto
    .createHash('sha256')
    .update(`lr_test_${crypto.randomBytes(16).toString('hex')}`)
    .digest('hex');
  const [receiver] = await db
    .insertInto('receivers')
    .values({ project_id: projectId, name: `Receiver ${n}`, adapter_type: 'generic', token_hash: tokenHash })
    .returningAll()
    .execute();
  return receiver;
}

describe('receivers.max enforcement', () => {
  let app: FastifyInstance;
  let orgId: string;
  let userId: string;
  let projectId: string;
  let token: string;

  beforeAll(async () => {
    app = Fastify();
    await app.register(contextPlugin);
    await app.register(receiversRoutes, { prefix: '/api/v1/projects' });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await db.deleteFrom('organization_entitlements').execute();
    await db.deleteFrom('receiver_events').execute();
    await db.deleteFrom('receivers').execute();
    await db.deleteFrom('api_keys').execute();
    await db.deleteFrom('sessions').execute();
    await db.deleteFrom('organization_members').execute();
    await db.deleteFrom('projects').execute();
    await db.deleteFrom('organizations').execute();
    await db.deleteFrom('users').execute();

    const ctx = await createTestContext();
    orgId = ctx.organization.id;
    userId = ctx.user.id;
    projectId = ctx.project.id;
    token = await createTestSession(userId);
    capabilities.invalidate(orgId);
  });

  // Case 1: org-wide blocking across projects
  it('blocks receiver creation when the org-wide limit is reached (receiver on a different project)', async () => {
    await db
      .insertInto('organization_entitlements')
      .values({ organization_id: orgId, capability: 'receivers.max', enabled: null, limit_value: 1 })
      .execute();
    capabilities.invalidate(orgId);

    const project2 = await db
      .insertInto('projects')
      .values({
        name: 'Project Two',
        slug: `proj2-${Date.now()}`,
        organization_id: orgId,
        user_id: userId,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    await insertReceiver(projectId, 1);

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${project2.id}/receivers`,
      headers: { Authorization: `Bearer ${token}` },
      payload: { name: 'New Receiver', adapterType: 'generic' },
    });

    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body);
    expect(body.statusCode).toBe(403);
    expect(body.code).toBe('capability.receivers.max.limit_reached');
  });

  // Case 2: under limit => passes
  it('allows receiver creation when under the limit', async () => {
    await db
      .insertInto('organization_entitlements')
      .values({ organization_id: orgId, capability: 'receivers.max', enabled: null, limit_value: 2 })
      .execute();
    capabilities.invalidate(orgId);

    await insertReceiver(projectId, 1);

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/receivers`,
      headers: { Authorization: `Bearer ${token}` },
      payload: { name: 'New Receiver', adapterType: 'generic' },
    });

    expect(res.statusCode).toBe(201);
  });

  // Case 3: unlimited default (no entitlement row) => passes
  it('allows receiver creation when no limit is configured (unlimited default)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/receivers`,
      headers: { Authorization: `Bearer ${token}` },
      payload: { name: 'New Receiver', adapterType: 'generic' },
    });

    expect(res.statusCode).toBe(201);
  });

  // Case 5: concurrent creates must not race past a finite limit
  it('serializes concurrent creates so the limit is never exceeded (race)', async () => {
    await db
      .insertInto('organization_entitlements')
      .values({ organization_id: orgId, capability: 'receivers.max', enabled: null, limit_value: 2 })
      .execute();
    capabilities.invalidate(orgId);

    const attempts = 6;
    const results = await Promise.all(
      Array.from({ length: attempts }, (_, i) =>
        app.inject({
          method: 'POST',
          url: `/api/v1/projects/${projectId}/receivers`,
          headers: { Authorization: `Bearer ${token}` },
          payload: { name: `Race Receiver ${i}`, adapterType: 'generic' },
        })
      )
    );

    const created = results.filter((r) => r.statusCode === 201).length;
    const blocked = results.filter((r) => r.statusCode === 403).length;

    expect(created).toBe(2);
    expect(blocked).toBe(attempts - 2);

    // Hard invariant: the org never ends up over its configured limit.
    const total = await db
      .selectFrom('receivers')
      .innerJoin('projects', 'projects.id', 'receivers.project_id')
      .select((eb) => eb.fn.countAll().as('c'))
      .where('projects.organization_id', '=', orgId)
      .executeTakeFirstOrThrow();
    expect(Number(total.c)).toBe(2);
  });

  // Case 4: org isolation => org A at limit does not block org B
  it('does not block org B when org A is at the limit', async () => {
    await db
      .insertInto('organization_entitlements')
      .values({ organization_id: orgId, capability: 'receivers.max', enabled: null, limit_value: 1 })
      .execute();
    capabilities.invalidate(orgId);
    await insertReceiver(projectId, 1);

    const ctxB = await createTestContext();
    const tokenB = await createTestSession(ctxB.user.id);
    capabilities.invalidate(ctxB.organization.id);

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${ctxB.project.id}/receivers`,
      headers: { Authorization: `Bearer ${tokenB}` },
      payload: { name: 'New Receiver', adapterType: 'generic' },
    });

    expect(res.statusCode).toBe(201);
  });
});
