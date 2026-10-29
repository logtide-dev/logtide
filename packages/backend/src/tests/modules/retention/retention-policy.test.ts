import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../../database/index.js';
import { retentionService } from '../../../modules/retention/service.js';
import { createTestOrganization } from '../../helpers/factories.js';

describe('retention policy service methods', () => {
  let orgId: string;

  beforeEach(async () => {
    await db.deleteFrom('audit_log').execute();
    orgId = (await createTestOrganization()).id;
  });

  it('updates retention and audits the actor', async () => {
    const res = await retentionService.setOrganizationRetentionPolicy(
      orgId,
      { retentionDays: 30 },
      'ext:billing'
    );
    expect(res).toMatchObject({ success: true, retentionDays: 30 });

    const org = await db.selectFrom('organizations').select('retention_days').where('id', '=', orgId).executeTakeFirstOrThrow();
    expect(org.retention_days).toBe(30);

    const audit = await db
      .selectFrom('audit_log')
      .selectAll()
      .where('action', '=', 'org.retention_updated')
      .where('organization_id', '=', orgId)
      .executeTakeFirstOrThrow();
    expect(audit.metadata).toMatchObject({ actor: 'ext:billing', retentionDays: 30 });
  });

  it('omits actor and handles audit retention', async () => {
    await retentionService.setOrganizationRetentionPolicy(orgId, { auditRetentionDays: 90 });
    const audit = await db
      .selectFrom('audit_log')
      .selectAll()
      .where('action', '=', 'org.retention_updated')
      .where('organization_id', '=', orgId)
      .executeTakeFirstOrThrow();
    expect(Object.keys(audit.metadata as object)).not.toContain('actor');

    const policy = await retentionService.getOrganizationRetentionPolicy(orgId);
    expect(policy.auditRetentionDays).toBe(90);
  });

  it('throws for an unknown organization and for empty input', async () => {
    await expect(
      retentionService.setOrganizationRetentionPolicy('00000000-0000-0000-0000-000000000000', { retentionDays: 30 })
    ).rejects.toThrow('Organization not found');
    await expect(retentionService.setOrganizationRetentionPolicy(orgId, {})).rejects.toThrow();
    await expect(
      retentionService.getOrganizationRetentionPolicy('00000000-0000-0000-0000-000000000000')
    ).rejects.toThrow('Organization not found');
  });
});
