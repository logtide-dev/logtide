import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { db } from '../../../database/index.js';
import { config } from '../../../config/index.js';
import { OrganizationsService } from '../../../modules/organizations/service.js';
import { organizationsRoutes } from '../../../modules/organizations/routes.js';
import { createTestUser, createTestOrganization } from '../../helpers/factories.js';
import { createTestSession } from '../../helpers/auth.js';

const cfg = config as { MAX_ORGANIZATIONS_PER_USER?: number };

async function addMember(orgId: string, userId: string, role: 'owner' | 'admin' | 'member') {
  await db.insertInto('organization_members').values({ organization_id: orgId, user_id: userId, role }).execute();
}

async function cleanAll() {
  await db.deleteFrom('audit_log').execute();
  await db.deleteFrom('notifications').execute();
  await db.deleteFrom('organization_members').execute();
  await db.deleteFrom('projects').execute();
  await db.deleteFrom('organizations').execute();
  await db.deleteFrom('sessions').execute();
  await db.deleteFrom('users').execute();
}

const tag = () => Math.random().toString(36).slice(2);

describe('transferOwnership hardening (AU5/SR-2, SR-7, SR-8)', () => {
  const service = new OrganizationsService();
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify();
    await app.register(organizationsRoutes, { prefix: '/api/v1/organizations' });
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(cleanAll);
  afterEach(() => {
    delete cfg.MAX_ORGANIZATIONS_PER_USER;
  });

  async function setup(nameLen?: number) {
    const t = tag();
    const owner = await createTestUser({ email: `o-${t}@example.com` });
    const org = await createTestOrganization({ ownerId: owner.id, slug: `s-${t}` });
    if (nameLen) {
      await db.updateTable('organizations').set({ name: 'x'.repeat(nameLen) }).where('id', '=', org.id).execute();
    }
    const target = await createTestUser({ email: `t-${t}@example.com` });
    await addMember(org.id, target.id, 'member');
    return { owner, org, target };
  }

  async function ownedCount(userId: string) {
    return service.countOwnedOrganizations(userId);
  }

  it('AU5: rejects a transfer that would push the target over MAX_ORGANIZATIONS_PER_USER', async () => {
    cfg.MAX_ORGANIZATIONS_PER_USER = 1;
    const { owner, org, target } = await setup();
    await createTestOrganization({ ownerId: target.id, slug: `own-${tag()}` });

    await expect(service.transferOwnership(org.id, owner.id, target.id)).rejects.toThrow('organization_limit_reached');
    expect(await service.getMemberRole(org.id, owner.id)).toBe('owner');
    expect(await ownedCount(target.id)).toBe(1);
  });

  it('AU5: allows the transfer when the target is under the cap', async () => {
    cfg.MAX_ORGANIZATIONS_PER_USER = 2;
    const { owner, org, target } = await setup();
    await createTestOrganization({ ownerId: target.id, slug: `own-${tag()}` });
    await service.transferOwnership(org.id, owner.id, target.id);
    expect(await ownedCount(target.id)).toBe(2);
  });

  it('AU5: parallel transfers to one target cannot overshoot the cap', async () => {
    cfg.MAX_ORGANIZATIONS_PER_USER = 1;
    const a = await setup();
    const t = tag();
    const owner2 = await createTestUser({ email: `o2-${t}@example.com` });
    const org2 = await createTestOrganization({ ownerId: owner2.id, slug: `s2-${t}` });
    await addMember(org2.id, a.target.id, 'member');
    // the target owns nothing yet, cap 1: exactly one of the two may succeed
    const res = await Promise.allSettled([
      service.transferOwnership(a.org.id, a.owner.id, a.target.id),
      service.transferOwnership(org2.id, owner2.id, a.target.id),
    ]);
    expect(res.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await ownedCount(a.target.id)).toBe(1);
  });

  it('AU5: the route answers 403 organization_limit_reached', async () => {
    cfg.MAX_ORGANIZATIONS_PER_USER = 1;
    const { owner, org, target } = await setup();
    await createTestOrganization({ ownerId: target.id, slug: `own-${tag()}` });
    const session = await createTestSession(owner.id);
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/organizations/${org.id}/transfer-ownership`,
      headers: { Authorization: `Bearer ${session.token}` },
      payload: { userId: target.id },
    });
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).error).toBe('organization_limit_reached');
  });

  it('SR-7: rejects a disabled target', async () => {
    const { owner, org, target } = await setup();
    await db.updateTable('users').set({ disabled: true }).where('id', '=', target.id).execute();
    await expect(service.transferOwnership(org.id, owner.id, target.id)).rejects.toThrow('must be a member');
    expect(await service.getMemberRole(org.id, owner.id)).toBe('owner');
  });

  it('SR-7: a leave racing the transfer never leaves an ownerless org', async () => {
    for (let i = 0; i < 5; i++) {
      await cleanAll();
      const { owner, org, target } = await setup();
      await Promise.allSettled([
        service.transferOwnership(org.id, owner.id, target.id),
        service.leaveOrganization(org.id, target.id),
      ]);
      const row = await db.selectFrom('organizations').select('owner_id').where('id', '=', org.id).executeTakeFirstOrThrow();
      const ownerRows = await db
        .selectFrom('organization_members')
        .select('user_id')
        .where('organization_id', '=', org.id)
        .where('role', '=', 'owner')
        .execute();
      expect(ownerRows).toHaveLength(1);
      expect(ownerRows[0].user_id).toBe(row.owner_id);
    }
  });

  it('SR-8: a notification insert failure does not lose the audit row or the success', async () => {
    const { owner, org, target } = await setup(250);
    const session = await createTestSession(owner.id);
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/organizations/${org.id}/transfer-ownership`,
      headers: { Authorization: `Bearer ${session.token}` },
      payload: { userId: target.id },
    });
    expect(res.statusCode).toBe(200);
    const row = await db.selectFrom('organizations').select('owner_id').where('id', '=', org.id).executeTakeFirstOrThrow();
    expect(row.owner_id).toBe(target.id);
    const audits = await db.selectFrom('audit_log').select('id').where('action', '=', 'org.ownership_transferred').execute();
    expect(audits).toHaveLength(1);
  });
});
