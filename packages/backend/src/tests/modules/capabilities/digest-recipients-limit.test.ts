import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import crypto from 'crypto';
import { db } from '../../../database/index.js';
import { digestsRoutes } from '../../../modules/digests/routes.js';
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

async function insertConfig(organizationId: string) {
  return db
    .insertInto('digest_configs')
    .values({ organization_id: organizationId, frequency: 'daily', delivery_hour: 8 })
    .returningAll()
    .executeTakeFirstOrThrow();
}

async function insertRecipient(organizationId: string, configId: string, email: string) {
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

describe('digests.max_recipients enforcement', () => {
  let app: FastifyInstance;
  let orgId: string;
  let userId: string;
  let token: string;
  let configId: string;

  beforeAll(async () => {
    app = Fastify();
    await app.register(contextPlugin);
    await app.register(digestsRoutes, { prefix: '/api/v1/digests' });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await db.deleteFrom('organization_entitlements').execute();
    await db.deleteFrom('digest_recipients').execute();
    await db.deleteFrom('digest_configs').execute();
    await db.deleteFrom('sessions').execute();
    await db.deleteFrom('organization_members').execute();
    await db.deleteFrom('projects').execute();
    await db.deleteFrom('organizations').execute();
    await db.deleteFrom('users').execute();

    const ctx = await createTestContext();
    orgId = ctx.organization.id;
    userId = ctx.user.id;
    token = await createTestSession(userId);
    const config = await insertConfig(orgId);
    configId = config.id;
    capabilities.invalidate(orgId);
  });

  // Case 1: at limit => blocked
  it('blocks adding a recipient when the org limit is reached', async () => {
    await db
      .insertInto('organization_entitlements')
      .values({ organization_id: orgId, capability: 'digests.max_recipients', enabled: null, limit_value: 1 })
      .execute();
    capabilities.invalidate(orgId);

    await insertRecipient(orgId, configId, 'first@example.com');

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/digests/recipients?organizationId=${orgId}`,
      headers: { Authorization: `Bearer ${token}` },
      payload: { email: 'second@example.com' },
    });

    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body);
    expect(body.code).toBe('capability.digests.max_recipients.limit_reached');
  });

  // Case 2: under limit => passes
  it('allows adding a recipient when under the limit', async () => {
    await db
      .insertInto('organization_entitlements')
      .values({ organization_id: orgId, capability: 'digests.max_recipients', enabled: null, limit_value: 2 })
      .execute();
    capabilities.invalidate(orgId);

    await insertRecipient(orgId, configId, 'first@example.com');

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/digests/recipients?organizationId=${orgId}`,
      headers: { Authorization: `Bearer ${token}` },
      payload: { email: 'second@example.com' },
    });

    expect(res.statusCode).toBe(201);
  });

  // Case 3: unlimited default (no entitlement row) => passes
  it('allows adding a recipient when no limit is configured (unlimited default)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/digests/recipients?organizationId=${orgId}`,
      headers: { Authorization: `Bearer ${token}` },
      payload: { email: 'anyone@example.com' },
    });

    expect(res.statusCode).toBe(201);
  });

  // Case 4: org isolation => org A at limit does not block org B
  it('does not block org B when org A is at the limit', async () => {
    await db
      .insertInto('organization_entitlements')
      .values({ organization_id: orgId, capability: 'digests.max_recipients', enabled: null, limit_value: 1 })
      .execute();
    capabilities.invalidate(orgId);
    await insertRecipient(orgId, configId, 'first@example.com');

    const ctxB = await createTestContext();
    const tokenB = await createTestSession(ctxB.user.id);
    await insertConfig(ctxB.organization.id);
    capabilities.invalidate(ctxB.organization.id);

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/digests/recipients?organizationId=${ctxB.organization.id}`,
      headers: { Authorization: `Bearer ${tokenB}` },
      payload: { email: 'orgb@example.com' },
    });

    expect(res.statusCode).toBe(201);
  });
});
