import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';
import type { FastifyInstance } from 'fastify';
import { db } from '../../../database/index.js';
import { config } from '../../../config/index.js';
import { build } from '../../../server.js';
import { createTestUser } from '../../helpers/factories.js';
import {
  effectiveUserLimit,
  fromStoredUserLimit,
  summarizeUserOrganizationLimits,
  toStoredUserLimit,
} from '../../../modules/organizations/user-limits.js';

const cfg = config as {
  MAX_ORGANIZATIONS_PER_USER?: number;
  MAX_ORGANIZATION_CREATIONS_PER_USER_PER_MONTH?: number;
};

async function session(userId: string) {
  const token = crypto.randomBytes(32).toString('hex');
  await db
    .insertInto('sessions')
    .values({ user_id: userId, token, expires_at: new Date(Date.now() + 86_400_000) })
    .execute();
  return token;
}

async function ownOrg(userId: string, n: number) {
  const org = await db
    .insertInto('organizations')
    .values({ name: `Org ${n}`, slug: `ulim-${n}-${crypto.randomBytes(3).toString('hex')}`, owner_id: userId })
    .returningAll()
    .executeTakeFirstOrThrow();
  await db.insertInto('organization_members').values({ organization_id: org.id, user_id: userId, role: 'owner' }).execute();
  return org;
}

describe('user limit helpers', () => {
  it('resolves the limit in force', () => {
    expect(effectiveUserLimit(null, undefined)).toBeNull();
    expect(effectiveUserLimit(null, 3)).toBe(3);
    expect(effectiveUserLimit(undefined, 3)).toBe(3);
    expect(effectiveUserLimit(-1, 3)).toBeNull();
    expect(effectiveUserLimit(10, 3)).toBe(10);
    expect(effectiveUserLimit(0, 3)).toBe(0);
    expect(effectiveUserLimit(5, undefined)).toBe(5);
  });

  it('round-trips overrides through their stored form', () => {
    for (const override of ['default', 'unlimited', 0, 7] as const) {
      expect(fromStoredUserLimit(toStoredUserLimit(override))).toBe(override);
    }
  });

  it('says which limit blocks a new organization', () => {
    const base = { owned: 2, maxOwned: 3, createdThisMonth: 1, maxCreationsPerMonth: 2 };
    expect(summarizeUserOrganizationLimits(base)).toMatchObject({ canCreate: true, blockedBy: null });
    expect(summarizeUserOrganizationLimits({ ...base, owned: 3 })).toMatchObject({ canCreate: false, blockedBy: 'owned' });
    expect(summarizeUserOrganizationLimits({ ...base, createdThisMonth: 2 })).toMatchObject({ canCreate: false, blockedBy: 'monthly' });
    expect(summarizeUserOrganizationLimits({ ...base, owned: 9, maxOwned: null, maxCreationsPerMonth: null })).toMatchObject({ canCreate: true });
  });
});

describe('per-user organization limits', () => {
  let app: FastifyInstance;
  let userId: string;
  let token: string;
  let adminToken: string;

  beforeAll(async () => {
    app = await build();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await db.deleteFrom('sessions').execute();
    await db.deleteFrom('organization_members').execute();
    await db.deleteFrom('projects').execute();
    await db.deleteFrom('organizations').execute();
    await db.deleteFrom('organization_creation_log').execute();
    await db.deleteFrom('users').execute();
    const user = await createTestUser({ email: `ulim-${Date.now()}@example.com` });
    userId = user.id;
    token = await session(userId);
    const admin = await createTestUser({ email: `ulim-admin-${Date.now()}@example.com` });
    await db.updateTable('users').set({ is_admin: true }).where('id', '=', admin.id).execute();
    adminToken = await session(admin.id);
  });

  afterEach(() => {
    delete cfg.MAX_ORGANIZATIONS_PER_USER;
    delete cfg.MAX_ORGANIZATION_CREATIONS_PER_USER_PER_MONTH;
  });

  const create = (name: string) =>
    app.inject({
      method: 'POST',
      url: '/api/v1/organizations',
      headers: { Authorization: `Bearer ${token}` },
      payload: { name },
    });

  const limits = async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/organizations/limits',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    return JSON.parse(res.body).limits;
  };

  const patchLimits = (id: string, payload: unknown, bearer = adminToken) =>
    app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/users/${id}/organization-limits`,
      headers: { Authorization: `Bearer ${bearer}` },
      payload: payload as object,
    });

  describe('GET /organizations/limits', () => {
    it('reports no limits when the instance sets none', async () => {
      await ownOrg(userId, 1);
      expect(await limits()).toEqual({
        owned: 1,
        maxOwned: null,
        createdThisMonth: 0,
        maxCreationsPerMonth: null,
        canCreate: true,
        blockedBy: null,
      });
    });

    it('reports the instance limits and when one is reached', async () => {
      cfg.MAX_ORGANIZATIONS_PER_USER = 2;
      cfg.MAX_ORGANIZATION_CREATIONS_PER_USER_PER_MONTH = 5;
      await ownOrg(userId, 1);
      expect(await limits()).toMatchObject({ owned: 1, maxOwned: 2, maxCreationsPerMonth: 5, canCreate: true });
      await ownOrg(userId, 2);
      expect(await limits()).toMatchObject({ owned: 2, maxOwned: 2, canCreate: false, blockedBy: 'owned' });
    });

    it('counts creations of the month and reports the monthly limit', async () => {
      cfg.MAX_ORGANIZATION_CREATIONS_PER_USER_PER_MONTH = 1;
      expect((await create('First')).statusCode).toBe(201);
      expect(await limits()).toMatchObject({ createdThisMonth: 1, canCreate: false, blockedBy: 'monthly' });
    });

    it('requires a session', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/organizations/limits' });
      expect(res.statusCode).toBe(401);
    });
  });

  describe('override on the user', () => {
    it('raises the instance limit for one user only', async () => {
      cfg.MAX_ORGANIZATIONS_PER_USER = 1;
      await ownOrg(userId, 1);
      expect((await create('Second')).statusCode).toBe(403);

      expect((await patchLimits(userId, { maxOwned: 3 })).statusCode).toBe(200);
      expect(await limits()).toMatchObject({ owned: 1, maxOwned: 3, canCreate: true });
      expect((await create('Second')).statusCode).toBe(201);

      // Another user keeps the instance limit.
      const other = await createTestUser({ email: `ulim-other-${Date.now()}@example.com` });
      await ownOrg(other.id, 9);
      const otherToken = await session(other.id);
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/organizations',
        headers: { Authorization: `Bearer ${otherToken}` },
        payload: { name: 'Nope' },
      });
      expect(res.statusCode).toBe(403);
    });

    it('lifts both limits with unlimited', async () => {
      cfg.MAX_ORGANIZATIONS_PER_USER = 1;
      cfg.MAX_ORGANIZATION_CREATIONS_PER_USER_PER_MONTH = 1;
      await patchLimits(userId, { maxOwned: 'unlimited', maxCreationsPerMonth: 'unlimited' });
      expect((await create('One')).statusCode).toBe(201);
      expect((await create('Two')).statusCode).toBe(201);
      expect(await limits()).toMatchObject({ maxOwned: null, maxCreationsPerMonth: null, canCreate: true });
    });

    it('can restrict a user on an instance without limits, down to zero', async () => {
      await patchLimits(userId, { maxOwned: 0 });
      const res = await create('Blocked');
      expect(res.statusCode).toBe(403);
      const body = JSON.parse(res.body);
      expect(body.error).toBe('organization_limit_reached');
      expect(body.limits).toMatchObject({ maxOwned: 0, blockedBy: 'owned' });
    });

    it('raises only the monthly limit and leaves the other field alone', async () => {
      cfg.MAX_ORGANIZATION_CREATIONS_PER_USER_PER_MONTH = 1;
      await patchLimits(userId, { maxOwned: 4 });
      await patchLimits(userId, { maxCreationsPerMonth: 2 });
      expect(await limits()).toMatchObject({ maxOwned: 4, maxCreationsPerMonth: 2 });
      expect((await create('One')).statusCode).toBe(201);
      expect((await create('Two')).statusCode).toBe(201);
      const third = await create('Three');
      expect(third.statusCode).toBe(403);
      expect(JSON.parse(third.body).error).toBe('organization_creation_limit_reached');
    });

    it('goes back to the instance setting with default', async () => {
      cfg.MAX_ORGANIZATIONS_PER_USER = 1;
      await patchLimits(userId, { maxOwned: 'unlimited' });
      const res = await patchLimits(userId, { maxOwned: 'default' });
      expect(JSON.parse(res.body).organizationLimits).toMatchObject({
        overrides: { maxOwned: 'default', maxCreationsPerMonth: 'default' },
        instance: { maxOwned: 1, maxCreationsPerMonth: null },
        effective: { maxOwned: 1 },
      });
    });

    it('applies the override to ownership transfers', async () => {
      cfg.MAX_ORGANIZATIONS_PER_USER = 1;
      const other = await createTestUser({ email: `ulim-recv-${Date.now()}@example.com` });
      await ownOrg(other.id, 1);
      const org = await ownOrg(userId, 2);
      await db.insertInto('organization_members').values({ organization_id: org.id, user_id: other.id, role: 'admin' }).execute();
      const transfer = () =>
        app.inject({
          method: 'POST',
          url: `/api/v1/organizations/${org.id}/transfer-ownership`,
          headers: { Authorization: `Bearer ${token}` },
          payload: { userId: other.id },
        });

      expect((await transfer()).statusCode).not.toBe(200);
      await patchLimits(other.id, { maxOwned: 2 });
      expect((await transfer()).statusCode).toBe(200);
    });
  });

  describe('PATCH /admin/users/:id/organization-limits', () => {
    it('is for instance administrators only', async () => {
      expect((await patchLimits(userId, { maxOwned: 5 }, token)).statusCode).toBe(403);
    });

    it('rejects invalid values and unknown fields', async () => {
      for (const payload of [{ maxOwned: -1 }, { maxOwned: 1.5 }, { maxOwned: 'lots' }, { maxOwned: 100001 }, { other: 1 }]) {
        expect((await patchLimits(userId, payload)).statusCode, JSON.stringify(payload)).toBe(400);
      }
    });

    it('answers 404 for an unknown user', async () => {
      expect((await patchLimits(crypto.randomUUID(), { maxOwned: 5 })).statusCode).toBe(404);
    });

    it('shows limits in the user details and records an audit entry', async () => {
      cfg.MAX_ORGANIZATIONS_PER_USER = 2;
      await ownOrg(userId, 1);
      await patchLimits(userId, { maxOwned: 6 });

      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/admin/users/${userId}`,
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).organizationLimits).toEqual({
        effective: {
          owned: 1,
          maxOwned: 6,
          createdThisMonth: 0,
          maxCreationsPerMonth: null,
          canCreate: true,
          blockedBy: null,
        },
        overrides: { maxOwned: 6, maxCreationsPerMonth: 'default' },
        instance: { maxOwned: 2, maxCreationsPerMonth: null },
      });

      await auditFlushed();
      const audit = await db
        .selectFrom('audit_log')
        .select(['action', 'metadata'])
        .where('action', '=', 'user.organization_limits_changed')
        .execute();
      expect(audit).toHaveLength(1);
      expect(audit[0].metadata).toMatchObject({
        previous: { maxOwned: 'default', maxCreationsPerMonth: 'default' },
        current: { maxOwned: 6, maxCreationsPerMonth: 'default' },
      });
    });
  });
});

/** The audit service buffers writes; wait for the flush. */
async function auditFlushed() {
  const { auditLogService } = await import('../../../modules/audit-log/index.js');
  const service = auditLogService as unknown as { flush?: () => Promise<void> };
  if (typeof service.flush === 'function') await service.flush();
  else await new Promise((resolve) => setTimeout(resolve, 1500));
}
