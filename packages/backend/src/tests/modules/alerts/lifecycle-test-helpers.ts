import type { Selectable } from 'kysely';
import { db } from '../../../database/index.js';
import type { AlertRulesTable, AlertRuleState } from '../../../database/types.js';

export type RuleLifecyclePatch = Partial<{
  query: string | null;
  state: AlertRuleState;
  last_triggered_at: Date | null;
  last_notified_at: Date | null;
  snoozed_until: Date | null;
  renotify_minutes: number | null;
}>;

async function organizationOf(ruleId: string): Promise<string> {
  const row = await db
    .selectFrom('alert_rules')
    .select('organization_id')
    .where('id', '=', ruleId)
    .executeTakeFirst();
  if (!row) throw new Error(`alert rule ${ruleId} not found`);
  return row.organization_id;
}

/**
 * Write lifecycle columns directly (tests only). Scoped by id and the rule's
 * own organization_id, like every production query on alert_rules.
 */
export async function setRuleLifecycle(ruleId: string, patch: RuleLifecyclePatch): Promise<void> {
  const organizationId = await organizationOf(ruleId);
  await db
    .updateTable('alert_rules')
    .set(patch)
    .where('id', '=', ruleId)
    .where('organization_id', '=', organizationId)
    .execute();
}

export async function getRuleRow(ruleId: string): Promise<Selectable<AlertRulesTable>> {
  const organizationId = await organizationOf(ruleId);
  return db
    .selectFrom('alert_rules')
    .selectAll()
    .where('id', '=', ruleId)
    .where('organization_id', '=', organizationId)
    .executeTakeFirstOrThrow();
}
