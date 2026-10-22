import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import type { FastifyInstance } from 'fastify';
import { build } from '../../../server.js';
import { db } from '../../../database/index.js';
import { capabilities } from '../../../capabilities/index.js';
import { createTestContext, createTestSession } from '../../helpers/index.js';

// saved_searches.max_per_org on the real app (4-case capability pattern).

const state = { q: 'timeout', projectIds: [] as string[] };

async function setLimit(organizationId: string, limit: number) {
  await db
    .insertInto('organization_entitlements')
    .values({ organization_id: organizationId, capability: 'saved_searches.max_per_org', enabled: null, limit_value: limit })
    .execute();
  capabilities.invalidate(organizationId);
}

async function insertSavedSearch(organizationId: string, userId: string, visibility: 'private' | 'organization') {
  await db
    .insertInto('saved_searches')
    .values({
      organization_id: organizationId,
      created_by: userId,
      name: `Existing ${visibility}`,
      visibility,
      state: JSON.stringify(state),
    })
    .execute();
}

describe('saved_searches.max_per_org enforcement', () => {
  let app: FastifyInstance;
  let orgId: string;
  let userId: string;
  let token: string;

  beforeAll(async () => {
    app = await build();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    const ctx = await createTestContext();
    orgId = ctx.organization.id;
    userId = ctx.user.id;
    token = (await createTestSession(userId)).token;
    capabilities.invalidate(orgId);
  });

  function create(organizationId: string, bearer: string) {
    return request(app.server)
      .post('/api/v1/saved-searches')
      .set('Authorization', `Bearer ${bearer}`)
      .send({ organizationId, name: 'New search', state });
  }

  it('blocks creation at the limit (private searches count)', async () => {
    await setLimit(orgId, 1);
    await insertSavedSearch(orgId, userId, 'private');

    const res = await create(orgId, token);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('capability.saved_searches.max_per_org.limit_reached');
    const count = await db
      .selectFrom('saved_searches')
      .select((eb) => eb.fn.countAll().as('count'))
      .where('organization_id', '=', orgId)
      .executeTakeFirstOrThrow();
    expect(Number(count.count)).toBe(1);
  });

  it('allows creation under the limit', async () => {
    await setLimit(orgId, 2);
    await insertSavedSearch(orgId, userId, 'organization');

    const res = await create(orgId, token);

    expect(res.status).toBe(201);
  });

  it('allows creation with no entitlement row (unlimited default)', async () => {
    await insertSavedSearch(orgId, userId, 'private');
    await insertSavedSearch(orgId, userId, 'organization');

    const res = await create(orgId, token);

    expect(res.status).toBe(201);
  });

  it('does not block org B when org A is at the limit', async () => {
    await setLimit(orgId, 1);
    await insertSavedSearch(orgId, userId, 'private');
    const other = await createTestContext();
    const otherToken = (await createTestSession(other.user.id)).token;
    capabilities.invalidate(other.organization.id);

    const blocked = await create(orgId, token);
    const res = await create(other.organization.id, otherToken);

    expect(blocked.status).toBe(403);
    expect(res.status).toBe(201);
  });
});
