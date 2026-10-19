import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../database/index.js';
import { createTestContext } from '../helpers/factories.js';

describe('organization_entitlements table', () => {
  let orgId: string;

  beforeEach(async () => {
    await db.deleteFrom('organization_entitlements').execute();
    const ctx = await createTestContext();
    orgId = ctx.organization.id;
  });

  it('stores a boolean entitlement row and reads it back', async () => {
    await db
      .insertInto('organization_entitlements')
      .values({ organization_id: orgId, capability: 'auth.sso', enabled: false, limit_value: null })
      .execute();

    const rows = await db
      .selectFrom('organization_entitlements')
      .selectAll()
      .where('organization_id', '=', orgId)
      .execute();

    expect(rows).toHaveLength(1);
    expect(rows[0].capability).toBe('auth.sso');
    expect(rows[0].enabled).toBe(false);
    expect(rows[0].limit_value).toBeNull();
  });

  it('stores a numeric limit row and reads it back', async () => {
    await db
      .insertInto('organization_entitlements')
      .values({ organization_id: orgId, capability: 'alerts.max_rules', enabled: null, limit_value: 5 })
      .execute();

    const row = await db
      .selectFrom('organization_entitlements')
      .selectAll()
      .where('organization_id', '=', orgId)
      .where('capability', '=', 'alerts.max_rules')
      .executeTakeFirst();

    // BIGINT since migration 059: the pg driver returns int8 as a string.
    expect(row?.limit_value).toBe('5');
    expect(row?.enabled).toBeNull();
  });

  it('enforces the (organization_id, capability) primary key', async () => {
    await db
      .insertInto('organization_entitlements')
      .values({ organization_id: orgId, capability: 'apikeys.max', enabled: null, limit_value: 1 })
      .execute();

    await expect(
      db
        .insertInto('organization_entitlements')
        .values({ organization_id: orgId, capability: 'apikeys.max', enabled: null, limit_value: 2 })
        .execute()
    ).rejects.toThrow();
  });
});
