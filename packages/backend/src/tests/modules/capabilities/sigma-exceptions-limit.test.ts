import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { db } from '../../../database/index.js';
import { build } from '../../../server.js';
import { capabilities } from '../../../capabilities/index.js';
import { createTestContext, createTestSigmaRule } from '../../helpers/factories.js';
import { createTestSession } from '../../helpers/auth.js';

const CAP = 'sigma.exceptions.max_per_rule';

async function setup() {
  const ctx = await createTestContext();
  const session = await createTestSession(ctx.user.id);
  const rule = await createTestSigmaRule({ organizationId: ctx.organization.id });
  return { orgId: ctx.organization.id, token: session.token, rule };
}

async function setLimit(orgId: string, limit: number) {
  await db
    .insertInto('organization_entitlements')
    .values({ organization_id: orgId, capability: CAP, enabled: null, limit_value: limit })
    .execute();
  capabilities.invalidate(orgId);
}

async function seed(orgId: string, ruleId: string, n: number) {
  for (let i = 0; i < n; i++) {
    await db
      .insertInto('sigma_rule_exceptions')
      .values({
        organization_id: orgId,
        sigma_rule_id: ruleId,
        conditions: JSON.stringify([{ field: 'service', operator: 'equals', values: [`svc-${i}`] }]),
      })
      .execute();
  }
}

function create(app: FastifyInstance, s: { orgId: string; token: string }, ruleId: string) {
  return app.inject({
    method: 'POST',
    url: `/api/v1/sigma/rules/${ruleId}/exceptions`,
    headers: { authorization: `Bearer ${s.token}` },
    payload: { organizationId: s.orgId, conditions: [{ field: 'service', operator: 'equals', values: ['new'] }] },
  });
}

describe('sigma.exceptions.max_per_rule enforcement', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await build({ logger: false });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('blocks create at the per-rule limit with 403 CapabilityError', async () => {
    const s = await setup();
    await setLimit(s.orgId, 2);
    await seed(s.orgId, s.rule.id, 2);

    const res = await create(app, s, s.rule.id);
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe(`capability.${CAP}.limit_reached`);

    const count = await db
      .selectFrom('sigma_rule_exceptions')
      .select((eb) => eb.fn.countAll().as('c'))
      .where('sigma_rule_id', '=', s.rule.id)
      .executeTakeFirstOrThrow();
    expect(Number(count.c)).toBe(2);
  });

  it('allows create under the limit', async () => {
    const s = await setup();
    await setLimit(s.orgId, 3);
    await seed(s.orgId, s.rule.id, 2);

    const res = await create(app, s, s.rule.id);
    expect(res.statusCode).toBe(201);
  });

  it('allows any number when the limit is unlimited', async () => {
    const s = await setup();
    capabilities.invalidate(s.orgId);
    await seed(s.orgId, s.rule.id, 6);

    const res = await create(app, s, s.rule.id);
    expect(res.statusCode).toBe(201);
  });

  it('limit is per rule: another rule in the same org and the same count in another org are unaffected', async () => {
    const a = await setup();
    await setLimit(a.orgId, 1);
    await seed(a.orgId, a.rule.id, 1);

    // Another rule of org A has no exceptions yet.
    const otherRule = await createTestSigmaRule({ organizationId: a.orgId });
    expect((await create(app, a, otherRule.id)).statusCode).toBe(201);
    expect((await create(app, a, a.rule.id)).statusCode).toBe(403);

    // Org B has no limit and as many exceptions on its own rule.
    const b = await setup();
    capabilities.invalidate(b.orgId);
    await seed(b.orgId, b.rule.id, 3);
    expect((await create(app, b, b.rule.id)).statusCode).toBe(201);
  });
});
