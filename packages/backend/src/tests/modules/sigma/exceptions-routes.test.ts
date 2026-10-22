import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { db } from '../../../database/index.js';
import { build } from '../../../server.js';
import { createTestContext, createTestSigmaRule, createTestUser } from '../../helpers/factories.js';
import { createTestSession } from '../../helpers/auth.js';

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

const CONDITIONS = [{ field: 'service', operator: 'equals', values: ['api'] }];

async function setup() {
  const ctx = await createTestContext();
  const session = await createTestSession(ctx.user.id);
  const rule = await createTestSigmaRule({ organizationId: ctx.organization.id });
  return { ...ctx, orgId: ctx.organization.id, rule, token: session.token };
}

describe('sigma rule exceptions routes', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await build({ logger: false });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('creates an exception and lists it', async () => {
    const s = await setup();
    const created = await app.inject({
      method: 'POST',
      url: `/api/v1/sigma/rules/${s.rule.id}/exceptions`,
      headers: auth(s.token),
      payload: { organizationId: s.orgId, conditions: CONDITIONS, reason: 'noisy deploy' },
    });
    expect(created.statusCode).toBe(201);
    const { exception } = created.json();
    expect(exception).toMatchObject({
      ruleId: s.rule.id,
      conditions: CONDITIONS,
      reason: 'noisy deploy',
      expiresAt: null,
      hitCount: 0,
      lastHitAt: null,
      createdBy: s.user.id,
    });

    const listed = await app.inject({
      method: 'GET',
      url: `/api/v1/sigma/rules/${s.rule.id}/exceptions?organizationId=${s.orgId}`,
      headers: auth(s.token),
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().exceptions.map((e: any) => e.id)).toEqual([exception.id]);
  });

  it('lists newest first and keeps expired exceptions', async () => {
    const s = await setup();
    const first = await db
      .insertInto('sigma_rule_exceptions')
      .values({
        organization_id: s.orgId,
        sigma_rule_id: s.rule.id,
        conditions: JSON.stringify(CONDITIONS),
        expires_at: new Date(Date.now() - 3600_000),
        created_at: new Date(Date.now() - 7200_000),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const created = await app.inject({
      method: 'POST',
      url: `/api/v1/sigma/rules/${s.rule.id}/exceptions`,
      headers: auth(s.token),
      payload: { organizationId: s.orgId, conditions: CONDITIONS },
    });
    const listed = await app.inject({
      method: 'GET',
      url: `/api/v1/sigma/rules/${s.rule.id}/exceptions?organizationId=${s.orgId}`,
      headers: auth(s.token),
    });
    const ids = listed.json().exceptions.map((e: any) => e.id);
    expect(ids).toEqual([created.json().exception.id, first.id]);
    expect(listed.json().exceptions[1].expiresAt).not.toBeNull();
  });

  it('rejects invalid conditions with 400', async () => {
    const s = await setup();
    for (const conditions of [
      [],
      [{ field: 'bad field', operator: 'equals', values: ['x'] }],
      [{ field: 'service', operator: 'equals', values: ['a', 'b'] }],
    ]) {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/sigma/rules/${s.rule.id}/exceptions`,
        headers: auth(s.token),
        payload: { organizationId: s.orgId, conditions },
      });
      expect(res.statusCode).toBe(400);
    }
    const past = await app.inject({
      method: 'POST',
      url: `/api/v1/sigma/rules/${s.rule.id}/exceptions`,
      headers: auth(s.token),
      payload: {
        organizationId: s.orgId,
        conditions: CONDITIONS,
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      },
    });
    expect(past.statusCode).toBe(400);
  });

  it('deletes an exception', async () => {
    const s = await setup();
    const created = await app.inject({
      method: 'POST',
      url: `/api/v1/sigma/rules/${s.rule.id}/exceptions`,
      headers: auth(s.token),
      payload: { organizationId: s.orgId, conditions: CONDITIONS },
    });
    const id = created.json().exception.id;

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/v1/sigma/rules/${s.rule.id}/exceptions/${id}?organizationId=${s.orgId}`,
      headers: auth(s.token),
    });
    expect(del.statusCode).toBe(200);
    expect(del.json()).toEqual({ success: true });

    const again = await app.inject({
      method: 'DELETE',
      url: `/api/v1/sigma/rules/${s.rule.id}/exceptions/${id}?organizationId=${s.orgId}`,
      headers: auth(s.token),
    });
    expect(again.statusCode).toBe(404);
  });

  it("returns 404 for a rule of another organization (create, list and delete)", async () => {
    const mine = await setup();
    const other = await setup();
    const foreignException = await db
      .insertInto('sigma_rule_exceptions')
      .values({
        organization_id: other.orgId,
        sigma_rule_id: other.rule.id,
        conditions: JSON.stringify(CONDITIONS),
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    // Caller is a member of their own org but names someone else's rule id.
    const create = await app.inject({
      method: 'POST',
      url: `/api/v1/sigma/rules/${other.rule.id}/exceptions`,
      headers: auth(mine.token),
      payload: { organizationId: mine.orgId, conditions: CONDITIONS },
    });
    expect(create.statusCode).toBe(404);
    expect(create.json()).toEqual({ error: 'Sigma rule not found' });

    const list = await app.inject({
      method: 'GET',
      url: `/api/v1/sigma/rules/${other.rule.id}/exceptions?organizationId=${mine.orgId}`,
      headers: auth(mine.token),
    });
    expect(list.statusCode).toBe(404);

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/v1/sigma/rules/${other.rule.id}/exceptions/${foreignException.id}?organizationId=${mine.orgId}`,
      headers: auth(mine.token),
    });
    expect(del.statusCode).toBe(404);

    const still = await db
      .selectFrom('sigma_rule_exceptions')
      .select('id')
      .where('id', '=', foreignException.id)
      .execute();
    expect(still).toHaveLength(1);
  });

  it('does not delete an exception through another rule of the same organization', async () => {
    const s = await setup();
    const otherRule = await createTestSigmaRule({ organizationId: s.orgId });
    const created = await app.inject({
      method: 'POST',
      url: `/api/v1/sigma/rules/${s.rule.id}/exceptions`,
      headers: auth(s.token),
      payload: { organizationId: s.orgId, conditions: CONDITIONS },
    });
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/sigma/rules/${otherRule.id}/exceptions/${created.json().exception.id}?organizationId=${s.orgId}`,
      headers: auth(s.token),
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 403 for a non member', async () => {
    const s = await setup();
    const outsider = await createTestUser({ email: `outsider-${Date.now()}@example.com` });
    const session = await createTestSession(outsider.id);
    const create = await app.inject({
      method: 'POST',
      url: `/api/v1/sigma/rules/${s.rule.id}/exceptions`,
      headers: auth(session.token),
      payload: { organizationId: s.orgId, conditions: CONDITIONS },
    });
    expect(create.statusCode).toBe(403);
    const list = await app.inject({
      method: 'GET',
      url: `/api/v1/sigma/rules/${s.rule.id}/exceptions?organizationId=${s.orgId}`,
      headers: auth(session.token),
    });
    expect(list.statusCode).toBe(403);
    const del = await app.inject({
      method: 'DELETE',
      url: `/api/v1/sigma/rules/${s.rule.id}/exceptions/${s.rule.id}?organizationId=${s.orgId}`,
      headers: auth(session.token),
    });
    expect(del.statusCode).toBe(403);
  });

  it('requires authentication', async () => {
    const s = await setup();
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/sigma/rules/${s.rule.id}/exceptions?organizationId=${s.orgId}`,
    });
    expect(res.statusCode).toBe(401);
  });

  it('records an audit entry on create and delete', async () => {
    const s = await setup();
    const created = await app.inject({
      method: 'POST',
      url: `/api/v1/sigma/rules/${s.rule.id}/exceptions`,
      headers: auth(s.token),
      payload: { organizationId: s.orgId, conditions: CONDITIONS },
    });
    const id = created.json().exception.id;
    await app.inject({
      method: 'DELETE',
      url: `/api/v1/sigma/rules/${s.rule.id}/exceptions/${id}?organizationId=${s.orgId}`,
      headers: auth(s.token),
    });

    const audit = await db
      .selectFrom('audit_log')
      .selectAll()
      .where('organization_id', '=', s.orgId)
      .where('resource_id', '=', s.rule.id)
      .orderBy('time', 'asc')
      .execute();
    expect(audit.map((a) => a.action)).toEqual(['rule.updated', 'rule.updated']);
    expect(audit[0]).toMatchObject({
      actor_id: s.user.id,
      metadata: { exception: 'added', exceptionId: id },
    });
    expect(audit[1].metadata).toMatchObject({ exception: 'removed', exceptionId: id });
  });
});
