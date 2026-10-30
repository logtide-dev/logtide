import { db } from '../../database/index.js';
import { createTestSigmaRule } from './factories.js';

/** createTestSigmaRule ignores `enabled`; this applies it after the insert. */
export async function createRule(
  overrides: Parameters<typeof createTestSigmaRule>[0] & { enabled?: boolean } = {}
) {
  const rule = await createTestSigmaRule(overrides);
  if (overrides.enabled === false) {
    await db.updateTable('sigma_rules').set({ enabled: false }).where('id', '=', rule.id).execute();
  }
  return rule;
}
