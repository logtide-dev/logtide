import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { db } from '../../../database/index.js';
import { build } from '../../../server.js';
import { createTestContext, createTestSigmaRule, createTestAlertRule } from '../../helpers/factories.js';
import { createTestSession } from '../../helpers/auth.js';
import { createRule } from '../../helpers/sigma-rule-enabled.js';

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

async function setup() {
  const ctx = await createTestContext();
  const session = await createTestSession(ctx.user.id);
  return { ...ctx, orgId: ctx.organization.id, token: session.token };
}

describe('sigma rules bulk', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await build({ logger: false });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  const bulk = (s: { token: string }, payload: any) =>
    app.inject({ method: 'POST', url: '/api/v1/sigma/rules/bulk', headers: auth(s.token), payload });

  const enabledOf = async (ids: string[]) =>
    (await db.selectFrom('sigma_rules').select(['id', 'enabled']).where('id', 'in', ids).execute()).map((r) => r.enabled);

  it('enables disabled rules', async () => {
    const s = await setup();
    const a = await createRule({ organizationId: s.orgId, enabled: false });
    const b = await createRule({ organizationId: s.orgId, enabled: false });
    const c = await createTestSigmaRule({ organizationId: s.orgId, enabled: true });

    const res = await bulk(s, { organizationId: s.orgId, ids: [a.id, b.id, c.id], action: 'enable' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ affected: 2 });
    expect(await enabledOf([a.id, b.id, c.id])).toEqual([true, true, true]);
  });

  it('disables enabled rules', async () => {
    const s = await setup();
    const a = await createTestSigmaRule({ organizationId: s.orgId });
    const b = await createTestSigmaRule({ organizationId: s.orgId });
    const res = await bulk(s, { organizationId: s.orgId, ids: [a.id, b.id], action: 'disable' });
    expect(res.json()).toEqual({ affected: 2 });
    expect(await enabledOf([a.id, b.id])).toEqual([false, false]);
  });

  it('ignores ids of another org and reports affected', async () => {
    const s = await setup();
    const other = await setup();
    const mine = await createRule({ organizationId: s.orgId, enabled: false });
    const theirs = await createRule({ organizationId: other.orgId, enabled: false });

    const res = await bulk(s, { organizationId: s.orgId, ids: [mine.id, theirs.id], action: 'enable' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ affected: 1 });
    expect(await enabledOf([theirs.id])).toEqual([false]);

    const del = await bulk(s, { organizationId: s.orgId, ids: [theirs.id], action: 'delete' });
    expect(del.json()).toEqual({ affected: 0 });
    expect(await db.selectFrom('sigma_rules').select('id').where('id', '=', theirs.id).execute()).toHaveLength(1);
  });

  it('delete removes rules, linked alert rules and cascades exceptions', async () => {
    const s = await setup();
    const rule = await createTestSigmaRule({ organizationId: s.orgId });
    const keep = await createTestSigmaRule({ organizationId: s.orgId });
    const alert = await createTestAlertRule({ organizationId: s.orgId });
    await db.updateTable('sigma_rules').set({ alert_rule_id: alert.id }).where('id', '=', rule.id).execute();
    await db
      .insertInto('sigma_rule_exceptions')
      .values({
        organization_id: s.orgId,
        sigma_rule_id: rule.id,
        conditions: JSON.stringify([{ field: 'service', operator: 'equals', values: ['a'] }]),
      })
      .execute();

    const res = await bulk(s, { organizationId: s.orgId, ids: [rule.id], action: 'delete' });
    expect(res.json()).toEqual({ affected: 1 });
    expect(await db.selectFrom('sigma_rules').select('id').where('id', '=', rule.id).execute()).toHaveLength(0);
    expect(await db.selectFrom('alert_rules').select('id').where('id', '=', alert.id).execute()).toHaveLength(0);
    expect(await db.selectFrom('sigma_rule_exceptions').select('id').where('sigma_rule_id', '=', rule.id).execute()).toHaveLength(0);
    expect(await db.selectFrom('sigma_rules').select('id').where('id', '=', keep.id).execute()).toHaveLength(1);
  });

  it('records one audit entry per call', async () => {
    const s = await setup();
    const a = await createTestSigmaRule({ organizationId: s.orgId });
    const b = await createTestSigmaRule({ organizationId: s.orgId });
    await bulk(s, { organizationId: s.orgId, ids: [a.id, b.id], action: 'disable' });

    const rows = await db
      .selectFrom('audit_log')
      .selectAll()
      .where('organization_id', '=', s.orgId)
      .where('action', '=', 'rule.disabled')
      .execute();
    expect(rows).toHaveLength(1);
    expect((rows[0] as any).metadata).toMatchObject({ count: 2, bulk: true });
  });

  it('validates the body', async () => {
    const s = await setup();
    expect((await bulk(s, { organizationId: s.orgId, ids: [], action: 'enable' })).statusCode).toBe(400);
    expect((await bulk(s, { organizationId: s.orgId, ids: ['nope'], action: 'enable' })).statusCode).toBe(400);
    const tooMany = Array.from({ length: 201 }, () => crypto.randomUUID());
    expect((await bulk(s, { organizationId: s.orgId, ids: tooMany, action: 'enable' })).statusCode).toBe(400);
  });

  it('returns 403 for a non member', async () => {
    const s = await setup();
    const other = await setup();
    const res = await bulk(s, { organizationId: other.orgId, ids: [crypto.randomUUID()], action: 'enable' });
    expect(res.statusCode).toBe(403);
  });
});
