import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { db } from '../../../database/index.js';
import piiMaskingRoutes from '../../../modules/pii-masking/routes.js';
import { createTestUser, createTestOrganization, createTestProject } from '../../helpers/factories.js';
import { createTestSession } from '../../helpers/auth.js';

type Role = 'owner' | 'admin' | 'member';

async function cleanAll() {
  await db.deleteFrom('audit_log').execute();
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
