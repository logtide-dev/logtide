import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { db } from '../../../database/index.js';
import piiMaskingRoutes from '../../../modules/pii-masking/routes.js';
import { pipelineRoutes } from '../../../modules/log-pipeline/routes.js';
import patternRoutes from '../../../modules/correlation/pattern-routes.js';
import { organizationsRoutes } from '../../../modules/organizations/routes.js';
import { createTestUser, createTestOrganization, createTestProject } from '../../helpers/factories.js';
import { createTestSession } from '../../helpers/auth.js';

type Role = 'owner' | 'admin' | 'member';

async function cleanAll() {
  await db.deleteFrom('audit_log').execute();
  await db.deleteFrom('log_pipelines').execute();
  await db.deleteFrom('identifier_patterns').execute();
  await db.deleteFrom('organization_pii_salts').execute();
  await db.deleteFrom('pii_masking_rules').execute();
  await db.deleteFrom('logs').execute();
  await db.deleteFrom('api_keys').execute();
  await db.deleteFrom('notifications').execute();
  await db.deleteFrom('organization_members').execute();
  await db.deleteFrom('projects').execute();
  await db.deleteFrom('organizations').execute();
  await db.deleteFrom('sessions').execute();
  await db.deleteFrom('users').execute();
}

const uniq = () => Math.random().toString(36).slice(2, 10);

/** Org with one user of each role, each with a session token. */
async function createOrgWithRoles() {
  const tag = uniq();
  const owner = await createTestUser({ email: `owner-${tag}@example.com` });
  const org = await createTestOrganization({ ownerId: owner.id, slug: `org-${tag}` });
  const admin = await createTestUser({ email: `admin-${tag}@example.com` });
  const member = await createTestUser({ email: `member-${tag}@example.com` });
  await db.insertInto('organization_members').values({ organization_id: org.id, user_id: admin.id, role: 'admin' }).execute();
  await db.insertInto('organization_members').values({ organization_id: org.id, user_id: member.id, role: 'member' }).execute();
  const tokens: Record<Role, string> = {
    owner: (await createTestSession(owner.id)).token,
    admin: (await createTestSession(admin.id)).token,
    member: (await createTestSession(member.id)).token,
  };
  return { org, owner, admin, member, tokens };
}

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

describe('org config role gates: PII masking', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify();
    await app.register(piiMaskingRoutes);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await cleanAll();
  });

  const rulePayload = (name = `rule_${uniq()}`) => ({
    name,
    displayName: 'Rule',
    patternType: 'custom',
    regexPattern: '\\bsecret\\b',
    action: 'redact',
  });

  async function createRuleAs(token: string, orgId: string, extra: Record<string, unknown> = {}) {
    return app.inject({
      method: 'POST',
      url: `/v1/pii-masking/rules?organizationId=${orgId}`,
      headers: bearer(token),
      payload: { ...rulePayload(), ...extra },
    });
  }

  async function seedRule(orgId: string) {
    return db
      .insertInto('pii_masking_rules')
      .values({
        organization_id: orgId,
        project_id: null,
        name: `seed_${uniq()}`,
        display_name: 'Seed',
        description: null,
        pattern_type: 'custom',
        regex_pattern: 'x',
        field_names: [],
        action: 'redact',
        enabled: true,
        priority: 50,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  it('member cannot create (403)', async () => {
    const { org, tokens } = await createOrgWithRoles();
    const res = await createRuleAs(tokens.member, org.id);
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.payload).error).toBe('Only organization owners and admins can change PII masking rules');
    const rows = await db.selectFrom('pii_masking_rules').select('id').where('organization_id', '=', org.id).execute();
    expect(rows).toHaveLength(0);
  });

  it('member cannot update', async () => {
    const { org, tokens } = await createOrgWithRoles();
    const rule = await seedRule(org.id);
    const res = await app.inject({
      method: 'PUT',
      url: `/v1/pii-masking/rules/${rule.id}?organizationId=${org.id}`,
      headers: bearer(tokens.member),
      payload: { displayName: 'Changed' },
    });
    expect(res.statusCode).toBe(403);
    const row = await db.selectFrom('pii_masking_rules').select('display_name').where('id', '=', rule.id).executeTakeFirstOrThrow();
    expect(row.display_name).toBe('Seed');
  });

  it('member cannot delete', async () => {
    const { org, tokens } = await createOrgWithRoles();
    const rule = await seedRule(org.id);
    const res = await app.inject({
      method: 'DELETE',
      url: `/v1/pii-masking/rules/${rule.id}?organizationId=${org.id}`,
      headers: bearer(tokens.member),
    });
    expect(res.statusCode).toBe(403);
    const row = await db.selectFrom('pii_masking_rules').select('id').where('id', '=', rule.id).executeTakeFirst();
    expect(row).toBeDefined();
  });

  it('admin can create/update/delete', async () => {
    const { org, tokens } = await createOrgWithRoles();
    const created = await createRuleAs(tokens.admin, org.id);
    expect(created.statusCode).toBe(201);
    const id = JSON.parse(created.payload).data.id;

    const updated = await app.inject({
      method: 'PUT',
      url: `/v1/pii-masking/rules/${id}?organizationId=${org.id}`,
      headers: bearer(tokens.admin),
      payload: { displayName: 'Changed' },
    });
    expect(updated.statusCode).toBe(200);

    const deleted = await app.inject({
      method: 'DELETE',
      url: `/v1/pii-masking/rules/${id}?organizationId=${org.id}`,
      headers: bearer(tokens.admin),
    });
    expect(deleted.statusCode).toBe(200);
  });

  it('owner can create', async () => {
    const { org, tokens } = await createOrgWithRoles();
    const res = await createRuleAs(tokens.owner, org.id);
    expect(res.statusCode).toBe(201);
  });

  it('member can still list rules and run /test', async () => {
    const { org, tokens } = await createOrgWithRoles();
    const list = await app.inject({
      method: 'GET',
      url: `/v1/pii-masking/rules?organizationId=${org.id}`,
      headers: bearer(tokens.member),
    });
    expect(list.statusCode).toBe(200);

    const test = await app.inject({
      method: 'POST',
      url: `/v1/pii-masking/test?organizationId=${org.id}`,
      headers: bearer(tokens.member),
      payload: { message: 'mail me at john@example.com' },
    });
    expect(test.statusCode).toBe(200);
  });

  it('role check uses the resolved org (admin in org1, member in org2)', async () => {
    const tag = uniq();
    const user = await createTestUser({ email: `multi-${tag}@example.com` });
    const otherOwner = await createTestUser({ email: `other-${tag}@example.com` });
    // org2 is created first, org1 (newest) is the default resolved org
    const org2 = await createTestOrganization({ ownerId: otherOwner.id, slug: `o2-${tag}` });
    await db.insertInto('organization_members').values({ organization_id: org2.id, user_id: user.id, role: 'member' }).execute();
    const otherOwner1 = await createTestUser({ email: `other1-${tag}@example.com` });
    const org1 = await createTestOrganization({ ownerId: otherOwner1.id, slug: `o1-${tag}` });
    await db.insertInto('organization_members').values({ organization_id: org1.id, user_id: user.id, role: 'admin' }).execute();
    const { token } = await createTestSession(user.id);

    const noOrgId = await app.inject({
      method: 'POST',
      url: '/v1/pii-masking/rules',
      headers: bearer(token),
      payload: rulePayload(),
    });
    expect(noOrgId.statusCode).toBe(201);
    expect(JSON.parse(noOrgId.payload).data.organizationId).toBe(org1.id);

    const explicitOrg2 = await createRuleAs(token, org2.id);
    expect(explicitOrg2.statusCode).toBe(403);
    const rows = await db.selectFrom('pii_masking_rules').select('id').where('organization_id', '=', org2.id).execute();
    expect(rows).toHaveLength(0);
  });

  it('admin of org A with organizationId=org B returns 403 (no membership)', async () => {
    const a = await createOrgWithRoles();
    const b = await createOrgWithRoles();
    const res = await createRuleAs(a.tokens.admin, b.org.id);
    expect(res.statusCode).toBe(403);
    const rows = await db.selectFrom('pii_masking_rules').select('id').where('organization_id', '=', b.org.id).execute();
    expect(rows).toHaveLength(0);
  });

  it('create with a project of another org returns 400 and inserts nothing', async () => {
    const a = await createOrgWithRoles();
    const b = await createOrgWithRoles();
    const foreignProject = await createTestProject({ organizationId: b.org.id });

    const res = await createRuleAs(a.tokens.owner, a.org.id, { projectId: foreignProject.id });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.payload).error).toBe('Project not found in this organization');
    const rows = await db.selectFrom('pii_masking_rules').select('id').execute();
    expect(rows).toHaveLength(0);
  });

  it('persists the project id for a project of this org (per-project scope)', async () => {
    const a = await createOrgWithRoles();
    const project = await createTestProject({ organizationId: a.org.id });

    const res = await createRuleAs(a.tokens.admin, a.org.id, { projectId: project.id });
    expect(res.statusCode).toBe(201);
    const id = JSON.parse(res.payload).data.id;
    const row = await db.selectFrom('pii_masking_rules').select('project_id').where('id', '=', id).executeTakeFirstOrThrow();
    expect(row.project_id).toBe(project.id);
  });
});

describe('org config role gates: log pipelines', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify();
    await app.register(pipelineRoutes, { prefix: '/api/v1/pipelines' });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await cleanAll();
  });

  const steps = [{ type: 'parser', parser: 'json' }];
  const DENIED = 'Only organization owners and admins can change log pipelines';

  async function seedPipeline(orgId: string) {
    return db
      .insertInto('log_pipelines')
      .values({
        organization_id: orgId,
        project_id: null,
        name: `seed-${uniq()}`,
        description: null,
        enabled: true,
        steps: JSON.stringify(steps) as any,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  const create = (app: FastifyInstance, token: string, orgId: string) =>
    app.inject({
      method: 'POST',
      url: '/api/v1/pipelines',
      headers: bearer(token),
      payload: { organizationId: orgId, name: `p-${uniq()}`, steps },
    });

  const importYaml = (app: FastifyInstance, token: string, orgId: string) =>
    app.inject({
      method: 'POST',
      url: '/api/v1/pipelines/import-yaml',
      headers: bearer(token),
      payload: { organizationId: orgId, yaml: 'name: imported\nsteps:\n  - type: parser\n    parser: json\n' },
    });

  const update = (app: FastifyInstance, token: string, orgId: string, id: string) =>
    app.inject({
      method: 'PUT',
      url: `/api/v1/pipelines/${id}?organizationId=${orgId}`,
      headers: bearer(token),
      payload: { name: 'renamed' },
    });

  const remove = (app: FastifyInstance, token: string, orgId: string, id: string) =>
    app.inject({
      method: 'DELETE',
      url: `/api/v1/pipelines/${id}?organizationId=${orgId}`,
      headers: bearer(token),
    });

  it('member gets 403 on all four writes and nothing changes', async () => {
    const { org, tokens } = await createOrgWithRoles();
    const seeded = await seedPipeline(org.id);

    const results = await Promise.all([
      create(app, tokens.member, org.id),
      importYaml(app, tokens.member, org.id),
      update(app, tokens.member, org.id, seeded.id),
      remove(app, tokens.member, org.id, seeded.id),
    ]);
    for (const r of results) {
      expect(r.statusCode).toBe(403);
      expect(JSON.parse(r.payload).error).toBe(DENIED);
    }
    const rows = await db.selectFrom('log_pipelines').select(['id', 'name']).where('organization_id', '=', org.id).execute();
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe(seeded.name);
  });

  it('admin can create, import, update and delete', async () => {
    const { org, tokens } = await createOrgWithRoles();
    const created = await create(app, tokens.admin, org.id);
    expect(created.statusCode).toBe(201);
    const id = JSON.parse(created.payload).pipeline.id;
    expect((await update(app, tokens.admin, org.id, id)).statusCode).toBe(200);
    expect((await remove(app, tokens.admin, org.id, id)).statusCode).toBe(204);
    expect((await importYaml(app, tokens.admin, org.id)).statusCode).toBe(201);
  });

  it('owner can create, import, update and delete', async () => {
    const { org, tokens } = await createOrgWithRoles();
    const created = await create(app, tokens.owner, org.id);
    expect(created.statusCode).toBe(201);
    const id = JSON.parse(created.payload).pipeline.id;
    expect((await update(app, tokens.owner, org.id, id)).statusCode).toBe(200);
    expect((await remove(app, tokens.owner, org.id, id)).statusCode).toBe(204);
    expect((await importYaml(app, tokens.owner, org.id)).statusCode).toBe(201);
  });

  it('members can GET pipelines and run preview', async () => {
    const { org, tokens } = await createOrgWithRoles();
    const seeded = await seedPipeline(org.id);

    const list = await app.inject({
      method: 'GET',
      url: `/api/v1/pipelines?organizationId=${org.id}`,
      headers: bearer(tokens.member),
    });
    expect(list.statusCode).toBe(200);

    const one = await app.inject({
      method: 'GET',
      url: `/api/v1/pipelines/${seeded.id}?organizationId=${org.id}`,
      headers: bearer(tokens.member),
    });
    expect(one.statusCode).toBe(200);

    const preview = await app.inject({
      method: 'POST',
      url: `/api/v1/pipelines/preview?organizationId=${org.id}`,
      headers: bearer(tokens.member),
      payload: { message: '{"a":1}', steps },
    });
    expect(preview.statusCode).toBe(200);
  });

  it('admin of another org gets 403 on writes', async () => {
    const a = await createOrgWithRoles();
    const b = await createOrgWithRoles();
    const seeded = await seedPipeline(b.org.id);

    const results = await Promise.all([
      create(app, a.tokens.admin, b.org.id),
      update(app, a.tokens.admin, b.org.id, seeded.id),
      remove(app, a.tokens.admin, b.org.id, seeded.id),
    ]);
    for (const r of results) expect(r.statusCode).toBe(403);
    const rows = await db.selectFrom('log_pipelines').select('id').where('organization_id', '=', b.org.id).execute();
    expect(rows).toHaveLength(1);
  });
});

describe('org config role gates: identifier patterns', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify();
    await app.register(patternRoutes);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await cleanAll();
  });

  const DENIED = 'Only organization owners and admins can change identifier patterns';

  async function seedPattern(orgId: string) {
    return db
      .insertInto('identifier_patterns')
      .values({
        organization_id: orgId,
        name: `seed_${uniq()}`,
        display_name: 'Seed',
        description: null,
        pattern: 'ORD-\\d+',
        field_names: [],
        enabled: true,
        priority: 50,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  const create = (token: string, orgId: string) =>
    app.inject({
      method: 'POST',
      url: `/v1/patterns?organizationId=${orgId}`,
      headers: bearer(token),
      payload: { name: `p_${uniq()}`, displayName: 'Pattern', pattern: 'ORD-\\d+' },
    });

  const update = (token: string, orgId: string, id: string) =>
    app.inject({
      method: 'PUT',
      url: `/v1/patterns/${id}?organizationId=${orgId}`,
      headers: bearer(token),
      payload: { displayName: 'Changed' },
    });

  const remove = (token: string, orgId: string, id: string) =>
    app.inject({
      method: 'DELETE',
      url: `/v1/patterns/${id}?organizationId=${orgId}`,
      headers: bearer(token),
    });

  it('member gets 403 on create, update and delete and nothing changes', async () => {
    const { org, tokens } = await createOrgWithRoles();
    const seeded = await seedPattern(org.id);

    const results = await Promise.all([
      create(tokens.member, org.id),
      update(tokens.member, org.id, seeded.id),
      remove(tokens.member, org.id, seeded.id),
    ]);
    for (const r of results) {
      expect(r.statusCode).toBe(403);
      expect(JSON.parse(r.payload).error).toBe(DENIED);
    }
    const rows = await db.selectFrom('identifier_patterns').select(['id', 'display_name']).where('organization_id', '=', org.id).execute();
    expect(rows).toHaveLength(1);
    expect(rows[0].display_name).toBe('Seed');
  });

  it('admin can create, update and delete', async () => {
    const { org, tokens } = await createOrgWithRoles();
    const created = await create(tokens.admin, org.id);
    expect(created.statusCode).toBe(201);
    const id = JSON.parse(created.payload).data.id;
    expect((await update(tokens.admin, org.id, id)).statusCode).toBe(200);
    expect((await remove(tokens.admin, org.id, id)).statusCode).toBe(200);
  });

  it('owner can create, update and delete', async () => {
    const { org, tokens } = await createOrgWithRoles();
    const created = await create(tokens.owner, org.id);
    expect(created.statusCode).toBe(201);
    const id = JSON.parse(created.payload).data.id;
    expect((await update(tokens.owner, org.id, id)).statusCode).toBe(200);
    expect((await remove(tokens.owner, org.id, id)).statusCode).toBe(200);
  });

  it('members can GET patterns, defaults and run /test', async () => {
    const { org, tokens } = await createOrgWithRoles();
    const list = await app.inject({ method: 'GET', url: `/v1/patterns?organizationId=${org.id}`, headers: bearer(tokens.member) });
    expect(list.statusCode).toBe(200);
    const defaults = await app.inject({ method: 'GET', url: '/v1/patterns/defaults', headers: bearer(tokens.member) });
    expect(defaults.statusCode).toBe(200);
    const test = await app.inject({
      method: 'POST',
      url: '/v1/patterns/test',
      headers: bearer(tokens.member),
      payload: { pattern: 'ORD-\\d+', text: 'see ORD-123' },
    });
    expect(test.statusCode).toBe(200);
  });

  it('role check uses the resolved org when organizationId is omitted', async () => {
    const tag = uniq();
    const user = await createTestUser({ email: `pm-${tag}@example.com` });
    const o2Owner = await createTestUser({ email: `po2-${tag}@example.com` });
    const org2 = await createTestOrganization({ ownerId: o2Owner.id, slug: `po2-${tag}` });
    await db.insertInto('organization_members').values({ organization_id: org2.id, user_id: user.id, role: 'admin' }).execute();
    const o1Owner = await createTestUser({ email: `po1-${tag}@example.com` });
    const org1 = await createTestOrganization({ ownerId: o1Owner.id, slug: `po1-${tag}` });
    await db.insertInto('organization_members').values({ organization_id: org1.id, user_id: user.id, role: 'member' }).execute();
    const { token } = await createTestSession(user.id);

    // newest org (org1) is the default and the user is only a member there
    const res = await app.inject({
      method: 'POST',
      url: '/v1/patterns',
      headers: bearer(token),
      payload: { name: `p_${uniq()}`, displayName: 'Pattern', pattern: 'ORD-\\d+' },
    });
    expect(res.statusCode).toBe(403);
    expect((await create(token, org2.id)).statusCode).toBe(201);
  });

  it('admin of another org gets 403', async () => {
    const a = await createOrgWithRoles();
    const b = await createOrgWithRoles();
    const seeded = await seedPattern(b.org.id);
    const results = await Promise.all([
      create(a.tokens.admin, b.org.id),
      update(a.tokens.admin, b.org.id, seeded.id),
      remove(a.tokens.admin, b.org.id, seeded.id),
    ]);
    for (const r of results) expect(r.statusCode).toBe(403);
  });
});

describe('org config role gates: organization general (regression pin)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify();
    await app.register(organizationsRoutes, { prefix: '/api/v1/organizations' });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await cleanAll();
  });

  it('admin cannot PUT organization (403)', async () => {
    const { org, tokens } = await createOrgWithRoles();
    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/organizations/${org.id}`,
      headers: bearer(tokens.admin),
      payload: { name: 'Hijacked' },
    });
    expect(res.statusCode).toBe(403);
    const row = await db.selectFrom('organizations').select('name').where('id', '=', org.id).executeTakeFirstOrThrow();
    expect(row.name).toBe(org.name);
  });

  it('member cannot DELETE organization', async () => {
    const { org, tokens } = await createOrgWithRoles();
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/organizations/${org.id}`,
      headers: bearer(tokens.member),
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.statusCode).toBeLessThan(500);
    const row = await db.selectFrom('organizations').select('id').where('id', '=', org.id).executeTakeFirst();
    expect(row).toBeDefined();
  });

  it('owner can PUT', async () => {
    const { org, tokens } = await createOrgWithRoles();
    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/organizations/${org.id}`,
      headers: bearer(tokens.owner),
      payload: { name: 'Renamed by owner' },
    });
    expect(res.statusCode).toBe(200);
    const row = await db.selectFrom('organizations').select('name').where('id', '=', org.id).executeTakeFirstOrThrow();
    expect(row.name).toBe('Renamed by owner');
  });
});
