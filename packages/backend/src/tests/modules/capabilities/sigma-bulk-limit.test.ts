import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { db } from '../../../database/index.js';
import { build } from '../../../server.js';
import { capabilities } from '../../../capabilities/index.js';
import { createTestContext, createTestSigmaRule } from '../../helpers/factories.js';
import { createTestSession } from '../../helpers/auth.js';
import { createRule } from '../../helpers/sigma-rule-enabled.js';

const CAP = 'sigma.max_active_rules';

async function setup() {
  const ctx = await createTestContext();
  const session = await createTestSession(ctx.user.id);
  return { orgId: ctx.organization.id, token: session.token };
}

async function setLimit(orgId: string, limit: number) {
  await db
    .insertInto('organization_entitlements')
    .values({ organization_id: orgId, capability: CAP, enabled: null, limit_value: limit })
    .execute();
  capabilities.invalidate(orgId);
}

async function disabledRules(orgId: string, n: number) {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) ids.push((await createRule({ organizationId: orgId, enabled: false })).id);
  return ids;
}

async function activeCount(orgId: string) {
  const row = await db
    .selectFrom('sigma_rules')
    .select((eb) => eb.fn.countAll().as('c'))
    .where('organization_id', '=', orgId)
    .where('enabled', '=', true)
    .executeTakeFirstOrThrow();
  return Number(row.c);
}

describe('sigma.max_active_rules enforcement on bulk enable', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await build({ logger: false });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  const enable = (s: { orgId: string; token: string }, ids: string[]) =>
    app.inject({
      method: 'POST',
      url: '/api/v1/sigma/rules/bulk',
      headers: { authorization: `Bearer ${s.token}` },
      payload: { organizationId: s.orgId, ids, action: 'enable' },
    });

  it('bulk enable over the cap fails with 403 and changes nothing', async () => {
    const s = await setup();
    await setLimit(s.orgId, 3);
    await createTestSigmaRule({ organizationId: s.orgId, enabled: true });
    const ids = await disabledRules(s.orgId, 3);

    const res = await enable(s, ids);
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe(`capability.${CAP}.limit_reached`);
    expect(await activeCount(s.orgId)).toBe(1);
  });

  it('under cap succeeds', async () => {
    const s = await setup();
    await setLimit(s.orgId, 3);
    await createTestSigmaRule({ organizationId: s.orgId, enabled: true });
    const ids = await disabledRules(s.orgId, 2);

    const res = await enable(s, ids);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ affected: 2 });
    expect(await activeCount(s.orgId)).toBe(3);
  });

  it('unlimited succeeds', async () => {
    const s = await setup();
    capabilities.invalidate(s.orgId);
    const ids = await disabledRules(s.orgId, 6);
    const res = await enable(s, ids);
    expect(res.statusCode).toBe(200);
    expect(await activeCount(s.orgId)).toBe(6);
  });

  it('org isolation of the count', async () => {
    const a = await setup();
    const b = await setup();
    await setLimit(a.orgId, 2);
    // Org B has many active rules; they must not count against org A.
    for (let i = 0; i < 5; i++) await createTestSigmaRule({ organizationId: b.orgId, enabled: true });
    const ids = await disabledRules(a.orgId, 2);

    const res = await enable(a, ids);
    expect(res.statusCode).toBe(200);
    expect(await activeCount(a.orgId)).toBe(2);
  });
});
