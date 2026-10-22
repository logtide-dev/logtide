import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { db } from '../../../database/index.js';
import { build } from '../../../server.js';
import { DETECTION_PACKS } from '../../../modules/detection-packs/pack-definitions.js';
import { createTestContext, createTestSigmaRule } from '../../helpers/factories.js';
import { createTestSession } from '../../helpers/auth.js';

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

const YAML_A = `title: Edit me
id: c0000000-0000-0000-0000-000000000001
status: stable
level: medium
logsource:
    product: linux
detection:
    selection:
        message|contains: 'first'
    condition: selection
`;

const YAML_B = YAML_A.replace("'first'", "'second'").replace('Edit me', 'Edited');

async function setup() {
  const ctx = await createTestContext();
  const session = await createTestSession(ctx.user.id);
  return { ...ctx, orgId: ctx.organization.id, token: session.token };
}

type S = { token: string; orgId: string };

describe('sigma rule detail, validate, edit and matches', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await build({ logger: false });
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
  });

  const importRule = async (s: S, yaml = YAML_A) => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/sigma/import',
      headers: auth(s.token),
      payload: { organizationId: s.orgId, yaml },
    });
    expect(res.statusCode).toBe(200);
    return res.json().sigmaRule.id as string;
  };
  const detail = (s: S, id: string) =>
    app.inject({ method: 'GET', url: `/api/v1/sigma/rules/${id}?organizationId=${s.orgId}`, headers: auth(s.token) });
  const patch = (s: S, id: string, body: object) =>
    app.inject({
      method: 'PATCH',
      url: `/api/v1/sigma/rules/${id}`,
      headers: auth(s.token),
      payload: { organizationId: s.orgId, ...body },
    });
  const validate = (s: S, orgId: string, yaml: string) =>
    app.inject({
      method: 'POST',
      url: '/api/v1/sigma/validate',
      headers: auth(s.token),
      payload: { organizationId: orgId, yaml },
    });

  it('detail returns stored yaml and yamlReconstructed false', async () => {
    const s = await setup();
    const id = await importRule(s);
    const res = await detail(s, id);
    expect(res.statusCode).toBe(200);
    const rule = res.json().rule;
    expect(rule.yaml).toBe(YAML_A);
    expect(rule.yamlReconstructed).toBe(false);
    expect(rule.editable).toBe(true);
    expect(rule.hits7d).toBe(0);
    expect(rule.lastFiredAt).toBeNull();
    expect(rule.detection).toBeDefined();
    expect(rule.logsource).toBeDefined();
  });

  it('detail reconstructs for a legacy rule (raw_yaml null)', async () => {
    const s = await setup();
    const legacy = await createTestSigmaRule({ organizationId: s.orgId, title: 'Legacy rule' });
    const rule = (await detail(s, legacy.id)).json().rule;
    expect(rule.yamlReconstructed).toBe(true);
    expect(rule.yaml).toContain('title: Legacy rule');
    expect(rule.yaml).toContain('detection:');
  });

  it('pack and sigmahq rules are not editable', async () => {
    const s = await setup();
    const pack = await createTestSigmaRule({
      organizationId: s.orgId,
      sigmaId: `pack-${DETECTION_PACKS[0].id}-1`,
    });
    const hq = await createTestSigmaRule({ organizationId: s.orgId });
    await db.updateTable('sigma_rules').set({ sigmahq_path: 'rules/linux/x.yml' }).where('id', '=', hq.id).execute();

    const packRule = (await detail(s, pack.id)).json().rule;
    expect(packRule.editable).toBe(false);
    expect(packRule.yamlReconstructed).toBe(true);
    expect((await detail(s, hq.id)).json().rule.editable).toBe(false);
  });

  it('detail of another org rule is 404', async () => {
    const s = await setup();
    const other = await setup();
    const id = await importRule(other);
    expect((await detail(s, id)).statusCode).toBe(404);
  });

  it('validate returns errors for missing detection', async () => {
    const s = await setup();
    const res = await validate(s, s.orgId, 'title: nope\nlogsource:\n  product: linux\n');
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.valid).toBe(false);
    expect(body.errors.join(' ')).toContain('detection');
  });

  it('validate returns a summary for a valid rule', async () => {
    const s = await setup();
    const res = await validate(s, s.orgId, YAML_A);
    expect(res.json()).toMatchObject({
      valid: true,
      errors: [],
      summary: { title: 'Edit me', level: 'medium', status: 'stable' },
    });
  });

  it('validate rejects yaml over 64 KiB with 400', async () => {
    const s = await setup();
    const res = await validate(s, s.orgId, `title: ${'a'.repeat(65540)}`);
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('Rule YAML is larger than 64 KiB');
  });

  it('validate reports a multi document yaml as a readable error', async () => {
    const s = await setup();
    const res = await validate(s, s.orgId, `${YAML_A}---\n${YAML_A}`);
    expect(res.statusCode).toBe(200);
    expect(res.json().valid).toBe(false);
    expect(res.json().errors.join(' ')).toMatch(/single document/i);
  });

  it('validate rejects a non member with 403', async () => {
    const s = await setup();
    const other = await setup();
    expect((await validate(s, other.orgId, YAML_A)).statusCode).toBe(403);
  });

  it('import rejects yaml over 64 KiB with 400', async () => {
    const s = await setup();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/sigma/import',
      headers: auth(s.token),
      payload: { organizationId: s.orgId, yaml: `title: ${'a'.repeat(65540)}` },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('Rule YAML is larger than 64 KiB');
  });

  it('multi document yaml on import returns 400 with a readable message', async () => {
    const s = await setup();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/sigma/import',
      headers: auth(s.token),
      payload: { organizationId: s.orgId, yaml: `${YAML_A}---\n${YAML_A}` },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().errors.join(' ')).toMatch(/single document/i);
  });

  it('edit updates detection and keeps enabled, sigma id and exceptions', async () => {
    const s = await setup();
    const id = await importRule(s);
    await db.updateTable('sigma_rules').set({ enabled: false }).where('id', '=', id).execute();
    await db
      .insertInto('sigma_rule_exceptions')
      .values({
        organization_id: s.orgId,
        sigma_rule_id: id,
        conditions: JSON.stringify([{ field: 'service', operator: 'equals', values: ['a'] }]),
      })
      .execute();
    const before = await db.selectFrom('sigma_rules').select('sigma_id').where('id', '=', id).executeTakeFirstOrThrow();

    const res = await patch(s, id, { yaml: YAML_B });
    expect(res.statusCode).toBe(200);

    const row = await db.selectFrom('sigma_rules').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
    expect(row.title).toBe('Edited');
    expect(row.raw_yaml).toBe(YAML_B);
    expect(JSON.stringify(row.detection)).toContain('second');
    expect(row.enabled).toBe(false);
    expect(row.sigma_id).toBe(before.sigma_id);
    const exceptions = await db.selectFrom('sigma_rule_exceptions').select('id').where('sigma_rule_id', '=', id).execute();
    expect(exceptions).toHaveLength(1);
  });

  it('edit of a sigmahq rule returns 409', async () => {
    const s = await setup();
    const hq = await createTestSigmaRule({ organizationId: s.orgId });
    await db.updateTable('sigma_rules').set({ sigmahq_path: 'rules/linux/x.yml' }).where('id', '=', hq.id).execute();
    const res = await patch(s, hq.id, { yaml: YAML_B });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('Only custom rules can be edited');
  });

  it('edit with invalid yaml returns 400 and leaves the row unchanged', async () => {
    const s = await setup();
    const id = await importRule(s);
    const res = await patch(s, id, { yaml: 'title: broken\nlogsource:\n  product: linux\n' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('Invalid rule');
    expect(res.json().errors.length).toBeGreaterThan(0);
    const row = await db.selectFrom('sigma_rules').select(['title', 'raw_yaml']).where('id', '=', id).executeTakeFirstOrThrow();
    expect(row.title).toBe('Edit me');
    expect(row.raw_yaml).toBe(YAML_A);
  });

  it('edit of another org rule returns 404', async () => {
    const s = await setup();
    const other = await setup();
    const id = await importRule(other);
    expect((await patch(s, id, { yaml: YAML_B })).statusCode).toBe(404);
  });

  it('matches returns only this rule and org, newest first, windowed by days', async () => {
    const s = await setup();
    const other = await setup();
    const rule = await createTestSigmaRule({ organizationId: s.orgId });
    const sibling = await createTestSigmaRule({ organizationId: s.orgId });
    const foreign = await createTestSigmaRule({ organizationId: other.orgId });

    // aged explicitly: Postgres NOW() can run ahead of the node clock
    const mk = (orgId: string, projectId: string, ruleId: string, hoursAgo: number, msg: string) => ({
      time: new Date(Date.now() - hoursAgo * 3_600_000),
      organization_id: orgId,
      project_id: projectId,
      sigma_rule_id: ruleId,
      log_id: crypto.randomUUID(),
      severity: 'medium' as const,
      rule_title: 'r',
      service: 'svc',
      log_level: 'error' as const,
      log_message: msg,
      matched_fields: JSON.stringify({}),
    });
    await db
      .insertInto('detection_events')
      .values([
        mk(s.orgId, s.project.id, rule.id, 3, 'old'),
        mk(s.orgId, s.project.id, rule.id, 2, 'new'),
        mk(s.orgId, s.project.id, sibling.id, 2, 'sibling'),
        mk(other.orgId, other.project.id, foreign.id, 2, 'foreign'),
        mk(s.orgId, s.project.id, rule.id, 20 * 24, 'ancient'),
      ])
      .execute();

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/sigma/rules/${rule.id}/matches?organizationId=${s.orgId}`,
      headers: auth(s.token),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(2);
    expect(body.matches.map((m: any) => m.logMessage)).toEqual(['new', 'old']);

    const wide = await app.inject({
      method: 'GET',
      url: `/api/v1/sigma/rules/${rule.id}/matches?organizationId=${s.orgId}&days=30&limit=1`,
      headers: auth(s.token),
    });
    expect(wide.json().total).toBe(3);
    expect(wide.json().matches).toHaveLength(1);

    const tooMany = await app.inject({
      method: 'GET',
      url: `/api/v1/sigma/rules/${rule.id}/matches?organizationId=${s.orgId}&limit=51`,
      headers: auth(s.token),
    });
    expect(tooMany.statusCode).toBe(400);
  });

  it('matches for another org rule returns 404', async () => {
    const s = await setup();
    const other = await setup();
    const foreign = await createTestSigmaRule({ organizationId: other.orgId });
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/sigma/rules/${foreign.id}/matches?organizationId=${s.orgId}`,
      headers: auth(s.token),
    });
    expect(res.statusCode).toBe(404);
  });
});
