import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../../database/index.js';
import { OrganizationsService } from '../../../modules/organizations/service.js';
import { createTestUser, createTestOrganization } from '../../helpers/factories.js';

async function addMember(orgId: string, userId: string, role: 'owner' | 'admin' | 'member') {
  await db
    .insertInto('organization_members')
    .values({ organization_id: orgId, user_id: userId, role })
    .execute();
}

async function cleanAll() {
  await db.deleteFrom('audit_log').execute();
  await db.deleteFrom('logs').execute();
  await db.deleteFrom('alert_history').execute();
  await db.deleteFrom('sigma_rules').execute();
  await db.deleteFrom('alert_rules').execute();
  await db.deleteFrom('api_keys').execute();
  await db.deleteFrom('notifications').execute();
  await db.deleteFrom('organization_members').execute();
  await db.deleteFrom('projects').execute();
  await db.deleteFrom('organizations').execute();
  await db.deleteFrom('sessions').execute();
  await db.deleteFrom('users').execute();
}

async function owners(orgId: string) {
  return db
    .selectFrom('organization_members')
    .select(['user_id', 'role'])
    .where('organization_id', '=', orgId)
    .where('role', '=', 'owner')
    .execute();
}

describe('OrganizationsService.transferOwnership', () => {
  const service = new OrganizationsService();

  beforeEach(async () => {
    await cleanAll();
  });

  async function setup() {
    const owner = await createTestUser({ email: `owner-${Date.now()}-${Math.random()}@example.com` });
    const org = await createTestOrganization({ ownerId: owner.id, slug: `t-${Math.random().toString(36).slice(2)}` });
    const target = await createTestUser({ email: `target-${Date.now()}-${Math.random()}@example.com` });
    await addMember(org.id, target.id, 'member');
    return { owner, org, target };
  }

  it('transfers owner_id and swaps roles (new owner, previous admin)', async () => {
    const { owner, org, target } = await setup();

    const result = await service.transferOwnership(org.id, owner.id, target.id);
    expect(result).toEqual({ previousOwnerId: owner.id, newOwnerId: target.id });

    const row = await db.selectFrom('organizations').select('owner_id').where('id', '=', org.id).executeTakeFirstOrThrow();
    expect(row.owner_id).toBe(target.id);
    expect(await service.getMemberRole(org.id, target.id)).toBe('owner');
    expect(await service.getMemberRole(org.id, owner.id)).toBe('admin');
  });

  it('leaves exactly one owner row and owner_id equals it', async () => {
    const { owner, org, target } = await setup();
    await service.transferOwnership(org.id, owner.id, target.id);

    const rows = await owners(org.id);
    expect(rows).toHaveLength(1);
    const row = await db.selectFrom('organizations').select('owner_id').where('id', '=', org.id).executeTakeFirstOrThrow();
    expect(rows[0].user_id).toBe(row.owner_id);
  });

  it('rejects a non-owner caller (admin)', async () => {
    const { owner, org, target } = await setup();
    const admin = await createTestUser({ email: `admin-${Date.now()}@example.com` });
    await addMember(org.id, admin.id, 'admin');

    await expect(service.transferOwnership(org.id, admin.id, target.id)).rejects.toThrow(
      'Only the organization owner can transfer ownership'
    );
    const row = await db.selectFrom('organizations').select('owner_id').where('id', '=', org.id).executeTakeFirstOrThrow();
    expect(row.owner_id).toBe(owner.id);
  });

  it('rejects a caller who is not a member', async () => {
    const { org, target } = await setup();
    const stranger = await createTestUser({ email: `stranger-${Date.now()}@example.com` });

    await expect(service.transferOwnership(org.id, stranger.id, target.id)).rejects.toThrow(
      'Only the organization owner can transfer ownership'
    );
  });

  it('rejects transfer to self', async () => {
    const { owner, org } = await setup();
    await expect(service.transferOwnership(org.id, owner.id, owner.id)).rejects.toThrow(
      'You already own this organization'
    );
    expect(await owners(org.id)).toHaveLength(1);
  });

  it('rejects a target who is not a member of this org', async () => {
    const { owner, org } = await setup();
    const outsider = await createTestUser({ email: `outsider-${Date.now()}@example.com` });

    await expect(service.transferOwnership(org.id, owner.id, outsider.id)).rejects.toThrow(
      'The new owner must be a member of this organization'
    );
    const row = await db.selectFrom('organizations').select('owner_id').where('id', '=', org.id).executeTakeFirstOrThrow();
    expect(row.owner_id).toBe(owner.id);
    expect(await service.getMemberRole(org.id, owner.id)).toBe('owner');
  });

  it('rejects a target who is a member of a different org only', async () => {
    const { owner, org } = await setup();
    const otherOwner = await createTestUser({ email: `other-${Date.now()}@example.com` });
    const otherOrg = await createTestOrganization({ ownerId: otherOwner.id, slug: `o-${Math.random().toString(36).slice(2)}` });
    const foreign = await createTestUser({ email: `foreign-${Date.now()}@example.com` });
    await addMember(otherOrg.id, foreign.id, 'member');

    await expect(service.transferOwnership(org.id, owner.id, foreign.id)).rejects.toThrow(
      'The new owner must be a member of this organization'
    );
    expect(await service.getMemberRole(org.id, foreign.id)).toBeNull();
    expect(await service.getMemberRole(otherOrg.id, foreign.id)).toBe('member');
  });

  it('two concurrent transfers by the same owner: exactly one resolves, one owner remains', async () => {
    const { owner, org, target } = await setup();
    const second = await createTestUser({ email: `second-${Date.now()}@example.com` });
    await addMember(org.id, second.id, 'member');

    const results = await Promise.allSettled([
      service.transferOwnership(org.id, owner.id, target.id),
      service.transferOwnership(org.id, owner.id, second.id),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);

    const rows = await owners(org.id);
    expect(rows).toHaveLength(1);
    const row = await db.selectFrom('organizations').select('owner_id').where('id', '=', org.id).executeTakeFirstOrThrow();
    expect(rows[0].user_id).toBe(row.owner_id);
    expect(row.owner_id).not.toBe(owner.id);
  });

  it('notifies the new owner', async () => {
    const { owner, org, target } = await setup();
    await service.transferOwnership(org.id, owner.id, target.id);

    const notes = await db
      .selectFrom('notifications')
      .selectAll()
      .where('user_id', '=', target.id)
      .execute();
    expect(notes).toHaveLength(1);
    expect(notes[0].title).toContain('You are now the owner of');
  });

  it('unknown org throws Organization not found', async () => {
    const { owner, target } = await setup();
    await expect(
      service.transferOwnership('00000000-0000-4000-8000-000000000000', owner.id, target.id)
    ).rejects.toThrow('Organization not found');
  });
});
