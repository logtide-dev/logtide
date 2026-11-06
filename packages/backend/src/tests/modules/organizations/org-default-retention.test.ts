import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { config } from '../../../config/index.js';
import { OrganizationsService } from '../../../modules/organizations/service.js';
import { createTestUser } from '../../helpers/factories.js';
import { db } from '../../../database/index.js';

const cfg = config as { DEFAULT_ORG_RETENTION_DAYS?: number };

describe('DEFAULT_ORG_RETENTION_DAYS', () => {
  const service = new OrganizationsService();

  beforeEach(() => {
    delete cfg.DEFAULT_ORG_RETENTION_DAYS;
  });

  afterEach(() => {
    delete cfg.DEFAULT_ORG_RETENTION_DAYS;
  });

  it('new organizations keep the 90 day column default when unset', async () => {
    const user = await createTestUser();
    const org = await service.createOrganization({ userId: user.id, name: 'Unset default' });
    expect(org.retentionDays).toBe(90);
  });

  it('new organizations start at the configured retention', async () => {
    cfg.DEFAULT_ORG_RETENTION_DAYS = 7;
    const user = await createTestUser();
    const org = await service.createOrganization({ userId: user.id, name: 'Free default' });
    expect(org.retentionDays).toBe(7);
    const row = await db.selectFrom('organizations').select('retention_days').where('id', '=', org.id).executeTakeFirstOrThrow();
    expect(row.retention_days).toBe(7);
  });
});
