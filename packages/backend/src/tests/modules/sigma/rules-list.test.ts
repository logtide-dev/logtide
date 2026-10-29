import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { db } from '../../../database/index.js';
import { build } from '../../../server.js';
import { createTestContext, createTestSigmaRule } from '../../helpers/factories.js';
import { createRule } from '../../helpers/sigma-rule-enabled.js';
import { createTestSession } from '../../helpers/auth.js';
import { DETECTION_PACKS } from '../../../modules/detection-packs/pack-definitions.js';
import { classifySource, packIdFor } from '../../../modules/sigma/yaml.js';
import { ruleManagementService } from '../../../modules/sigma/rule-management-service.js';

const auth = (token: string) => ({ authorization: `Bearer ${token}` });
const DAY = 24 * 60 * 60 * 1000;

async function setup() {
  const ctx = await createTestContext();
  const session = await createTestSession(ctx.user.id);
  return { ...ctx, orgId: ctx.organization.id, token: session.token };
}

async function addEvent(orgId: string, ruleId: string, ageMs: number) {
  await db
    .insertInto('detection_events')
    .values({
      time: new Date(Date.now() - ageMs),
      organization_id: orgId,
      project_id: null,
      sigma_rule_id: ruleId,
      log_id: crypto.randomUUID(),
      severity: 'high',
      rule_title: 'r',
      service: 'api',
      log_level: 'error',
      log_message: 'm',
      matched_fields: {},
    } as any)
    .execute();
}

describe('sigma rules list', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await build({ logger: false });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  const list = async (s: { orgId: string; token: string }, qs = '') => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/sigma/rules?organizationId=${s.orgId}${qs}`,
      headers: auth(s.token),
    });
    expect(res.statusCode).toBe(200);
    return res.json() as { rules: any[]; total: number; page: number; pageSize: number };
  };

  it('paginates with total', async () => {
    const s = await setup();
    for (let i = 0; i < 5; i++) await createTestSigmaRule({ organizationId: s.orgId, title: `Rule ${i}` });

    const p1 = await list(s, '&page=1&pageSize=2&sortBy=title&sortOrder=asc');
    expect(p1.total).toBe(5);
    expect(p1.page).toBe(1);
    expect(p1.pageSize).toBe(2);
    expect(p1.rules.map((r) => r.title)).toEqual(['Rule 0', 'Rule 1']);

    const p3 = await list(s, '&page=3&pageSize=2&sortBy=title&sortOrder=asc');
    expect(p3.rules.map((r) => r.title)).toEqual(['Rule 4']);
  });

  it('page beyond the end returns empty rules with total', async () => {
    const s = await setup();
    for (let i = 0; i < 3; i++) await createTestSigmaRule({ organizationId: s.orgId });
    const res = await list(s, '&page=9&pageSize=2');
    expect(res.rules).toEqual([]);
    expect(res.total).toBe(3);
  });

  it('filters by severity', async () => {
    const s = await setup();
    await createTestSigmaRule({ organizationId: s.orgId, level: 'critical', title: 'crit' });
    await createTestSigmaRule({ organizationId: s.orgId, level: 'low', title: 'low' });
    await createTestSigmaRule({ organizationId: s.orgId, level: 'high', title: 'high' });

    const res = await list(s, '&severity=critical,high&sortBy=level&sortOrder=desc');
    expect(res.rules.map((r) => r.title)).toEqual(['crit', 'high']);
    expect(res.total).toBe(2);

    const repeated = await list(s, '&severity=low&severity=high');
    expect(repeated.total).toBe(2);
  });

  it('filters by tactic', async () => {
    const s = await setup();
    const a = await createTestSigmaRule({ organizationId: s.orgId, title: 'exec' });
    await createTestSigmaRule({ organizationId: s.orgId, title: 'other' });
    await db
      .updateTable('sigma_rules')
      .set({ mitre_tactics: ['execution', 'persistence'] })
      .where('id', '=', a.id)
      .execute();

    const res = await list(s, '&tactic=Execution');
    expect(res.rules.map((r) => r.title)).toEqual(['exec']);
  });

  it('filters by source custom/sigmahq/pack', async () => {
    const s = await setup();
    const packId = DETECTION_PACKS[0].id;
    await createTestSigmaRule({ organizationId: s.orgId, title: 'custom one' });
    const hq = await createTestSigmaRule({ organizationId: s.orgId, title: 'hq one' });
    await db.updateTable('sigma_rules').set({ sigmahq_path: 'rules/linux/x.yml' }).where('id', '=', hq.id).execute();
    await createTestSigmaRule({
      organizationId: s.orgId,
      title: 'pack one',
      sigmaId: `pack-${packId}-some-rule`,
    });

    const custom = await list(s, '&source=custom');
    expect(custom.rules.map((r) => r.title)).toEqual(['custom one']);
    expect(custom.rules[0].source).toBe('custom');

    const sigmahq = await list(s, '&source=sigmahq');
    expect(sigmahq.rules.map((r) => r.title)).toEqual(['hq one']);

    const pack = await list(s, '&source=pack');
    expect(pack.rules.map((r) => r.title)).toEqual(['pack one']);
    expect(pack.rules[0].packId).toBe(packId);

    const two = await list(s, '&source=custom,pack');
    expect(two.total).toBe(2);
  });

  it('filters by enabled', async () => {
    const s = await setup();
    await createRule({ organizationId: s.orgId, title: 'on', enabled: true });
    await createRule({ organizationId: s.orgId, title: 'off', enabled: false });
    expect((await list(s, '&enabled=true')).rules.map((r) => r.title)).toEqual(['on']);
    expect((await list(s, '&enabled=false')).rules.map((r) => r.title)).toEqual(['off']);
  });

  it('filters by category', async () => {
    const s = await setup();
    const rel = await createTestSigmaRule({ organizationId: s.orgId, title: 'rel' });
    await createTestSigmaRule({ organizationId: s.orgId, title: 'sec' });
    await db.updateTable('sigma_rules').set({ category: 'reliability' }).where('id', '=', rel.id).execute();

    expect((await list(s, '&category=reliability')).rules.map((r) => r.title)).toEqual(['rel']);
    expect((await list(s, '&category=security')).rules.map((r) => r.title)).toEqual(['sec']);
  });

  it('search escapes percent and underscore', async () => {
    const s = await setup();
    await createTestSigmaRule({ organizationId: s.orgId, title: '100% cpu', description: 'd' });
    await createTestSigmaRule({ organizationId: s.orgId, title: 'a_b rule', description: 'd' });
    await createTestSigmaRule({ organizationId: s.orgId, title: 'axb rule', description: 'd' });
    await createTestSigmaRule({ organizationId: s.orgId, title: 'plain', description: 'd' });

    expect((await list(s, '&search=' + encodeURIComponent('%'))).rules.map((r) => r.title)).toEqual(['100% cpu']);
    expect((await list(s, '&search=' + encodeURIComponent('a_b'))).rules.map((r) => r.title)).toEqual(['a_b rule']);
    expect((await list(s, '&search=' + encodeURIComponent('PLAIN'))).total).toBe(1);
  });

  it('hits7d counts only events in the last 7 days for that rule and org', async () => {
    const s = await setup();
    const other = await setup();
    const rule = await createTestSigmaRule({ organizationId: s.orgId });
    const otherRule = await createTestSigmaRule({ organizationId: s.orgId });
    const foreignRule = await createTestSigmaRule({ organizationId: other.orgId });

    await addEvent(s.orgId, rule.id, 2 * 60 * 60 * 1000);
    await addEvent(s.orgId, rule.id, 3 * DAY);
    await addEvent(s.orgId, rule.id, 9 * DAY);
    await addEvent(s.orgId, otherRule.id, 60 * 1000);
    await addEvent(other.orgId, foreignRule.id, 60 * 1000);

    const res = await list(s);
    const byId = new Map(res.rules.map((r) => [r.id, r]));
    expect(byId.get(rule.id)!.hits7d).toBe(2);
    expect(byId.get(otherRule.id)!.hits7d).toBe(1);
    expect(res.rules.find((r) => r.id === foreignRule.id)).toBeUndefined();
  });

  it('rule without events has hits7d 0 and lastFiredAt null', async () => {
    const s = await setup();
    await createTestSigmaRule({ organizationId: s.orgId });
    const res = await list(s);
    expect(res.rules[0].hits7d).toBe(0);
    expect(res.rules[0].lastFiredAt).toBeNull();
    expect(res.rules[0].exceptionCount).toBe(0);
  });

  it('reports lastFiredAt and exceptionCount', async () => {
    const s = await setup();
    const rule = await createTestSigmaRule({ organizationId: s.orgId });
    const fired = new Date(Date.now() - 3600_000);
    await db.updateTable('sigma_rules').set({ last_fired_at: fired }).where('id', '=', rule.id).execute();
    await db
      .insertInto('sigma_rule_exceptions')
      .values([
        { organization_id: s.orgId, sigma_rule_id: rule.id, conditions: JSON.stringify([{ field: 'service', operator: 'equals', values: ['a'] }]) },
        {
          organization_id: s.orgId,
          sigma_rule_id: rule.id,
          conditions: JSON.stringify([{ field: 'service', operator: 'equals', values: ['b'] }]),
          expires_at: new Date(Date.now() - 3600_000),
        },
      ])
      .execute();

    const res = await list(s);
    expect(res.rules[0].lastFiredAt).toBe(fired.toISOString());
    expect(res.rules[0].exceptionCount).toBe(1);
  });

  it('sortBy hits7d is stable on ties', async () => {
    const s = await setup();
    const rules = [];
    for (let i = 0; i < 4; i++) rules.push(await createTestSigmaRule({ organizationId: s.orgId, title: `r${i}` }));
    await addEvent(s.orgId, rules[2].id, 60_000);
    await addEvent(s.orgId, rules[2].id, 120_000);
    await addEvent(s.orgId, rules[1].id, 60_000);

    const desc = await list(s, '&sortBy=hits7d&sortOrder=desc&pageSize=100');
    expect(desc.rules.slice(0, 2).map((r) => r.id)).toEqual([rules[2].id, rules[1].id]);
    const ties = desc.rules.slice(2).map((r) => r.id);
    expect(ties).toEqual([...ties].sort());

    // Same input, same order, also across pages.
    const again = await list(s, '&sortBy=hits7d&sortOrder=desc&pageSize=100');
    expect(again.rules.map((r) => r.id)).toEqual(desc.rules.map((r) => r.id));
    const p1 = await list(s, '&sortBy=hits7d&sortOrder=desc&pageSize=2&page=1');
    const p2 = await list(s, '&sortBy=hits7d&sortOrder=desc&pageSize=2&page=2');
    expect([...p1.rules, ...p2.rules].map((r) => r.id)).toEqual(desc.rules.map((r) => r.id));
  });

  it('sortBy lastFiredAt keeps never-fired rules last', async () => {
    const s = await setup();
    const a = await createTestSigmaRule({ organizationId: s.orgId, title: 'never' });
    const b = await createTestSigmaRule({ organizationId: s.orgId, title: 'fired' });
    await db.updateTable('sigma_rules').set({ last_fired_at: new Date() }).where('id', '=', b.id).execute();
    expect((await list(s, '&sortBy=lastFiredAt&sortOrder=desc')).rules.map((r) => r.id)).toEqual([b.id, a.id]);
    expect((await list(s, '&sortBy=lastFiredAt&sortOrder=asc')).rules.map((r) => r.id)).toEqual([b.id, a.id]);
  });

  it('org isolation', async () => {
    const a = await setup();
    const b = await setup();
    await createTestSigmaRule({ organizationId: a.orgId, title: 'mine' });
    await createTestSigmaRule({ organizationId: b.orgId, title: 'theirs' });
    const res = await list(a);
    expect(res.rules.map((r) => r.title)).toEqual(['mine']);

    const forbidden = await app.inject({
      method: 'GET',
      url: `/api/v1/sigma/rules?organizationId=${b.orgId}`,
      headers: auth(a.token),
    });
    expect(forbidden.statusCode).toBe(403);
  });

  it('legacy call without page returns all rules', async () => {
    const s = await setup();
    for (let i = 0; i < 30; i++) await createTestSigmaRule({ organizationId: s.orgId });
    const res = await list(s);
    expect(res.rules).toHaveLength(30);
    expect(res.total).toBe(30);
    expect(res.rules[0]).toMatchObject({
      organizationId: s.orgId,
      enabled: true,
      hits7d: 0,
      source: 'custom',
      packId: null,
    });
  });

  it('rejects an invalid page size', async () => {
    const s = await setup();
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/sigma/rules?organizationId=${s.orgId}&pageSize=500`,
      headers: auth(s.token),
    });
    expect(res.statusCode).toBe(400);
  });

  it('classifySource parity with the SQL filter', async () => {
    const s = await setup();
    const packId = DETECTION_PACKS[1].id;
    const rows = [
      await createTestSigmaRule({ organizationId: s.orgId, sigmaId: `pack-${packId}-x` }),
      await createTestSigmaRule({ organizationId: s.orgId, sigmaId: 'pack-unknown-pack-x' }),
      await createTestSigmaRule({ organizationId: s.orgId, sigmaId: 'plain' }),
      await createTestSigmaRule({ organizationId: s.orgId, sigmaId: 'hq-1' }),
    ];
    await db.updateTable('sigma_rules').set({ sigmahq_path: 'rules/a.yml' }).where('id', '=', rows[3].id).execute();

    for (const source of ['custom', 'sigmahq', 'pack'] as const) {
      const viaSql = await ruleManagementService.list({ organizationId: s.orgId, source: [source] });
      const all = await db.selectFrom('sigma_rules').selectAll().where('organization_id', '=', s.orgId).execute();
      const viaTs = all.filter((r) => classifySource(r) === source).map((r) => r.id).sort();
      expect(viaSql.rules.map((r) => r.id).sort()).toEqual(viaTs);
    }
    expect(packIdFor(`pack-${packId}-x`)).toBe(packId);
    expect(packIdFor('pack-unknown-pack-x')).toBeNull();
    expect(packIdFor(null)).toBeNull();
  });
});
