import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../../database/index.js';
import { capabilities } from '../../../capabilities/index.js';
import {
  EntitlementValidationError,
  getOrganizationEntitlements,
  setOrganizationEntitlements,
  resetOrganizationEntitlement,
} from '../../../modules/capabilities/entitlements-service.js';
import { createTestOrganization } from '../../helpers/factories.js';

async function lastAudit(orgId: string) {
  return db
    .selectFrom('audit_log')
    .selectAll()
    .where('action', '=', 'org.entitlements_updated')
    .where('organization_id', '=', orgId)
    .orderBy('time', 'desc')
    .executeTakeFirst();
}

describe('entitlements service', () => {
  let orgId: string;

  beforeEach(async () => {
    await db.deleteFrom('audit_log').execute();
    const org = await createTestOrganization();
    orgId = org.id;
  });

  it('writes the row, refreshes capabilities and audits the actor', async () => {
    const res = await setOrganizationEntitlements(
      orgId,
      [{ capability: 'projects.max', limitValue: 5 }],
      'ext:billing'
    );
    expect(res).toEqual({ updated: 1 });
    expect(await capabilities.getLimit(orgId, 'projects.max')).toBe(5);

    const audit = await lastAudit(orgId);
    expect((audit!.metadata as any).actor).toBe('ext:billing');
  });

  it('omits the actor key when no actor is given', async () => {
    await setOrganizationEntitlements(orgId, [{ capability: 'projects.max', limitValue: 3 }]);
    const audit = await lastAudit(orgId);
    expect(Object.keys(audit!.metadata as object)).not.toContain('actor');
  });

  it('rejects unknown capabilities without writing anything', async () => {
    await expect(
      setOrganizationEntitlements(orgId, [
        { capability: 'projects.max', limitValue: 5 },
        { capability: 'nope.nothing', limitValue: 1 },
      ])
    ).rejects.toBeInstanceOf(EntitlementValidationError);
    const rows = await db
      .selectFrom('organization_entitlements')
      .selectAll()
      .where('organization_id', '=', orgId)
      .execute();
    expect(rows).toHaveLength(0);
  });

  it('rejects a boolean capability without enabled', async () => {
    await expect(
      setOrganizationEntitlements(orgId, [{ capability: 'auth.sso' }])
    ).rejects.toBeInstanceOf(EntitlementValidationError);
  });

  it('reports overrides and resets them with the actor', async () => {
    await setOrganizationEntitlements(orgId, [{ capability: 'projects.max', limitValue: 7 }]);
    const got = await getOrganizationEntitlements(orgId);
    expect(got.overrides['projects.max']).toEqual({ enabled: null, limitValue: 7 });
    expect(got.defaults['projects.max']).toBeDefined();

    expect(await resetOrganizationEntitlement(orgId, 'projects.max', 'ext:billing')).toEqual({
      removed: true,
    });
    expect((await lastAudit(orgId))!.metadata as any).toMatchObject({
      reset: ['projects.max'],
      actor: 'ext:billing',
    });
    expect(await resetOrganizationEntitlement(orgId, 'projects.max')).toEqual({ removed: false });
    await expect(resetOrganizationEntitlement(orgId, 'bogus')).rejects.toBeInstanceOf(
      EntitlementValidationError
    );
  });
});
