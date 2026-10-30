import { describe, it, expect } from 'vitest';
import { db } from '../../../database/index.js';
import { SigmaService } from '../../../modules/sigma/service.js';

const sigmaService = new SigmaService();
import { createTestContext } from '../../helpers/factories.js';
import type { ParsedSigmaRule } from '../../../modules/sigma/types.js';

describe('SigmaService.updateRuleDefinition', () => {
  it('resets level and status when the edited YAML drops them', async () => {
    const ctx = await createTestContext();
    const row = await db
      .insertInto('sigma_rules')
      .values({
        organization_id: ctx.organization.id,
        project_id: ctx.project.id,
        title: 'Custom',
        logsource: JSON.stringify({ product: 'linux' }),
        detection: JSON.stringify({ selection: { a: 'b' }, condition: 'selection' }),
        level: 'critical',
        status: 'experimental',
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    const edited = {
      title: 'Custom',
      logsource: { product: 'linux' },
      detection: { selection: { a: 'b' }, condition: 'selection' },
    } as unknown as ParsedSigmaRule;

    expect(await sigmaService.updateRuleDefinition(row.id, ctx.organization.id, edited, 'title: Custom')).toBe(true);

    const after = await db
      .selectFrom('sigma_rules')
      .select(['level', 'status'])
      .where('id', '=', row.id)
      .where('organization_id', '=', ctx.organization.id)
      .executeTakeFirstOrThrow();
    expect(after.level).toBe('medium');
    expect(after.status).toBeNull();
  });
});
