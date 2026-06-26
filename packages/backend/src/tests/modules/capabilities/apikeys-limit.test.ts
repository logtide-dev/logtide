import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import crypto from 'crypto';
import { db } from '../../../database/index.js';
import { apiKeysRoutes } from '../../../modules/api-keys/routes.js';
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

async function insertApiKey(projectId: string, n = 1) {
  const key = `lp_test_${crypto.randomBytes(16).toString('hex')}`;
  const keyHash = crypto.createHash('sha256').update(key).digest('hex');
  const [apiKey] = await db
    .insertInto('api_keys')
    .values({
      project_id: projectId,
      name: `Key ${n}`,
      key_hash: keyHash,
      type: 'write',
      allowed_origins: null,
    })
    .returningAll()
    .execute();
  return apiKey;
}

describe('apikeys.max enforcement', () => {
  let app: FastifyInstance;
  let orgId: string;
  let userId: string;
  let projectId: string;
  let token: string;

  beforeAll(async () => {
    app = Fastify();
    await app.register(contextPlugin);
    await app.register(apiKeysRoutes, { prefix: '/api/v1/projects' });
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
    projectId = ctx.project.id;
    token = await createTestSession(userId);
    capabilities.invalidate(orgId);
  });

  // Case 1: org-wide blocking across projects
  it('blocks key creation when the org-wide limit is reached (key on a different project)', async () => {
    await db
      .insertInto('organization_entitlements')
      .values({ organization_id: orgId, capability: 'apikeys.max', enabled: null, limit_value: 1 })
      .execute();
    capabilities.invalidate(orgId);

    // Create a second project in the same org
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

    // Insert one key on project1 (the ctx project)
    await insertApiKey(projectId, 1);

    // Attempt to create a key on project2 => should be blocked
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${project2.id}/api-keys`,
      headers: { Authorization: `Bearer ${token}` },
      payload: { name: 'New Key' },
    });

    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body);
    expect(body.statusCode).toBe(403);
    expect(body.code).toBe('capability.apikeys.max.limit_reached');
  });

  // Case 2: under limit => passes
  // createTestContext already inserts 1 api key; limit=2 means count(1)+1 <= 2 => allowed
  it('allows key creation when under the limit', async () => {
    await db
      .insertInto('organization_entitlements')
      .values({ organization_id: orgId, capability: 'apikeys.max', enabled: null, limit_value: 2 })
      .execute();
    capabilities.invalidate(orgId);

    // 1 key already exists from createTestContext; creating one more is within limit
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/api-keys`,
      headers: { Authorization: `Bearer ${token}` },
      payload: { name: 'New Key' },
    });

    expect(res.statusCode).toBe(201);
  });

  // Case 3: unlimited default (no entitlement row) => passes
  it('allows key creation when no limit is configured (unlimited default)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/api-keys`,
      headers: { Authorization: `Bearer ${token}` },
      payload: { name: 'New Key' },
    });

    expect(res.statusCode).toBe(201);
  });

  // Case 5: concurrent creates must not race past a finite limit
  it('serializes concurrent creates so the limit is never exceeded (race)', async () => {
    // createTestContext already inserted 1 key; limit 2 leaves room for exactly 1 more.
    await db
      .insertInto('organization_entitlements')
      .values({ organization_id: orgId, capability: 'apikeys.max', enabled: null, limit_value: 2 })
      .execute();
    capabilities.invalidate(orgId);

    const attempts = 6;
    const results = await Promise.all(
      Array.from({ length: attempts }, (_, i) =>
        app.inject({
          method: 'POST',
          url: `/api/v1/projects/${projectId}/api-keys`,
          headers: { Authorization: `Bearer ${token}` },
          payload: { name: `Race Key ${i}` },
        })
      )
    );

    const created = results.filter((r) => r.statusCode === 201).length;
    const blocked = results.filter((r) => r.statusCode === 403).length;

    expect(created).toBe(1);
    expect(blocked).toBe(attempts - 1);

    // Hard invariant: the org never ends up over its configured limit.
    const total = await db
      .selectFrom('api_keys')
      .innerJoin('projects', 'projects.id', 'api_keys.project_id')
      .select((eb) => eb.fn.countAll().as('c'))
      .where('projects.organization_id', '=', orgId)
      .executeTakeFirstOrThrow();
    expect(Number(total.c)).toBe(2);
  });

  // Case 4: org isolation => org A at limit does not block org B
  it('does not block org B when org A is at the limit', async () => {
    await db
      .insertInto('organization_entitlements')
      .values({ organization_id: orgId, capability: 'apikeys.max', enabled: null, limit_value: 1 })
      .execute();
    capabilities.invalidate(orgId);
    await insertApiKey(projectId, 1);

    const ctxB = await createTestContext();
    const tokenB = await createTestSession(ctxB.user.id);
    capabilities.invalidate(ctxB.organization.id);

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${ctxB.project.id}/api-keys`,
      headers: { Authorization: `Bearer ${tokenB}` },
      payload: { name: 'New Key' },
    });

    expect(res.statusCode).toBe(201);
  });
});
