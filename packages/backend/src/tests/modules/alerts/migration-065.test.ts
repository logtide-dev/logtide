import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { sql } from 'kysely';
import { db } from '../../../database/index.js';
import { createTestContext, createTestAlertRule } from '../../helpers/factories.js';
import { getRuleRow, setRuleLifecycle } from './lifecycle-test-helpers.js';

const MIGRATION_065 = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../migrations/065_alert_rule_lifecycle.sql'
);

const MINUTE = 60_000;

function minutesAgo(n: number): Date {
  // ms precision on purpose: TIMESTAMPTZ round-trips it exactly
  return new Date(Date.now() - n * MINUTE);
}

async function insertHistory(ruleId: string, triggeredAt: Date): Promise<void> {
  await db
    .insertInto('alert_history')
    .values({ rule_id: ruleId, triggered_at: triggeredAt, log_count: 5 })
    .execute();
}

async function runMigration(): Promise<void> {
  await sql.raw(readFileSync(MIGRATION_065, 'utf8')).execute(db);
}

describe('migration 065: alert rule lifecycle', () => {
  let organizationId: string;
  let projectId: string;

  beforeEach(async () => {
    const ctx = await createTestContext();
    organizationId = ctx.organization.id;
    projectId = ctx.project.id;
  });

  it('adds lifecycle columns with ok defaults', async () => {
    const rule = await createTestAlertRule({ organizationId, projectId });
    const row = await getRuleRow(rule.id);
    expect(row.state).toBe('ok');
    expect(row.query).toBeNull();
    expect(row.renotify_minutes).toBeNull();
    expect(row.last_triggered_at).toBeNull();
    expect(row.last_evaluated_at).toBeNull();
    expect(row.last_notified_at).toBeNull();
    expect(row.snoozed_until).toBeNull();
  });

  it('declares the expected column types', async () => {
    const rows = await sql<{ column_name: string; data_type: string; is_nullable: string }>`
      select column_name, data_type, is_nullable
      from information_schema.columns
      where table_schema = current_schema() and table_name = 'alert_rules'
    `.execute(db);
    const cols = Object.fromEntries(rows.rows.map((r) => [r.column_name, r]));
    expect(cols.query).toMatchObject({ data_type: 'text', is_nullable: 'YES' });
    expect(cols.state).toMatchObject({ data_type: 'character varying', is_nullable: 'NO' });
    for (const c of ['last_triggered_at', 'last_evaluated_at', 'last_notified_at', 'snoozed_until']) {
      expect(cols[c]).toMatchObject({ data_type: 'timestamp with time zone', is_nullable: 'YES' });
    }
    expect(cols.renotify_minutes).toMatchObject({ data_type: 'integer', is_nullable: 'YES' });
  });

  it('rejects invalid lifecycle values at the database layer', async () => {
    const rule = await createTestAlertRule({ organizationId, projectId });
    const rocRule = await createTestAlertRule({
      organizationId,
      projectId,
      alertType: 'rate_of_change',
      baselineType: 'rolling_7d_avg',
      deviationMultiplier: 3,
    });

    await expect(setRuleLifecycle(rule.id, { state: 'bogus' as any })).rejects.toThrow(
      /chk_alert_rules_state/
    );
    await expect(setRuleLifecycle(rule.id, { renotify_minutes: 2 })).rejects.toThrow(
      /chk_alert_rules_renotify_range/
    );
    await expect(setRuleLifecycle(rule.id, { renotify_minutes: 1441 })).rejects.toThrow(
      /chk_alert_rules_renotify_range/
    );
    await expect(setRuleLifecycle(rocRule.id, { query: 'timeout' })).rejects.toThrow(
      /chk_alert_rules_threshold_only/
    );
    await expect(setRuleLifecycle(rocRule.id, { renotify_minutes: 30 })).rejects.toThrow(
      /chk_alert_rules_threshold_only/
    );

    // Valid values on a threshold rule are accepted
    await setRuleLifecycle(rule.id, { state: 'firing', renotify_minutes: 5, query: 'timeout' });
    await setRuleLifecycle(rule.id, { renotify_minutes: 1440 });
    const row = await getRuleRow(rule.id);
    expect(row).toMatchObject({ state: 'firing', renotify_minutes: 1440, query: 'timeout' });
  });

  it('is idempotent and backfills lifecycle from alert history', async () => {
    // A: threshold, enabled, time_window 5, latest history 2 minutes ago -> firing
    const a = await createTestAlertRule({ organizationId, projectId, timeWindow: 5 });
    // B: threshold, time_window 5, latest history 30 minutes ago -> ok
    const b = await createTestAlertRule({ organizationId, projectId, timeWindow: 5 });
    // C: disabled threshold, history 1 minute ago -> ok
    const c = await createTestAlertRule({ organizationId, projectId, timeWindow: 5, enabled: false });
    // D: rate-of-change, history 1 minute ago -> ok
    const d = await createTestAlertRule({
      organizationId,
      projectId,
      timeWindow: 5,
      alertType: 'rate_of_change',
      baselineType: 'rolling_7d_avg',
      deviationMultiplier: 3,
    });
    // E: no history
    const e = await createTestAlertRule({ organizationId, projectId, timeWindow: 5 });

    const historyA = minutesAgo(2);
    const historyB = minutesAgo(30);
    const historyC = minutesAgo(1);
    const historyD = minutesAgo(1);
    // an older history row on A must not win over the latest one
    await insertHistory(a.id, minutesAgo(50));
    await insertHistory(a.id, historyA);
    await insertHistory(b.id, historyB);
    await insertHistory(c.id, historyC);
    await insertHistory(d.id, historyD);

    await runMigration();

    const rowA = await getRuleRow(a.id);
    expect(rowA.state).toBe('firing');
    expect(rowA.last_triggered_at?.getTime()).toBe(historyA.getTime());
    expect(rowA.last_notified_at?.getTime()).toBe(historyA.getTime());

    const rowB = await getRuleRow(b.id);
    expect(rowB.state).toBe('ok');
    expect(rowB.last_triggered_at?.getTime()).toBe(historyB.getTime());
    expect(rowB.last_notified_at?.getTime()).toBe(historyB.getTime());

    const rowC = await getRuleRow(c.id);
    expect(rowC.state).toBe('ok');
    expect(rowC.last_triggered_at?.getTime()).toBe(historyC.getTime());

    const rowD = await getRuleRow(d.id);
    expect(rowD.state).toBe('ok');
    expect(rowD.last_triggered_at?.getTime()).toBe(historyD.getTime());

    const rowE = await getRuleRow(e.id);
    expect(rowE.state).toBe('ok');
    expect(rowE.last_triggered_at).toBeNull();
    expect(rowE.last_notified_at).toBeNull();

    // Second run: no error, and rows that already carry lifecycle data are not
    // touched again (a later history row does not move last_triggered_at).
    await insertHistory(b.id, minutesAgo(1));
    await runMigration();

    const rowA2 = await getRuleRow(a.id);
    expect(rowA2.state).toBe('firing');
    expect(rowA2.last_triggered_at?.getTime()).toBe(historyA.getTime());
    const rowB2 = await getRuleRow(b.id);
    expect(rowB2.state).toBe('ok');
    expect(rowB2.last_triggered_at?.getTime()).toBe(historyB.getTime());
    expect((await getRuleRow(e.id)).last_triggered_at).toBeNull();
  });

  it('does not alter alert_history', async () => {
    const rule = await createTestAlertRule({ organizationId, projectId });
    const at = minutesAgo(3);
    await insertHistory(rule.id, at);
    const before = await db
      .selectFrom('alert_history')
      .selectAll()
      .where('rule_id', '=', rule.id)
      .execute();

    await runMigration();

    const after = await db
      .selectFrom('alert_history')
      .selectAll()
      .where('rule_id', '=', rule.id)
      .execute();
    expect(after).toEqual(before);
  });
});
