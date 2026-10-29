import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { sql } from 'kysely';
import { db } from '../../../database/index.js';
import { createTestContext, createTestAlertRule, createTestUser } from '../../helpers/factories.js';
import { createTestMonitor, insertIncident } from './fixtures.js';

const MIGRATION_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../migrations/062_incidents_generalization.sql'
);

async function historyRows(incidentId: string) {
  return db
    .selectFrom('incident_history')
    .selectAll()
    .where('incident_id', '=', incidentId)
    .orderBy('created_at', 'asc')
    .execute();
}

async function incidentRow(id: string, organizationId: string) {
  return db
    .selectFrom('incidents')
    .selectAll()
    .where('id', '=', id)
    .where('organization_id', '=', organizationId)
    .executeTakeFirstOrThrow();
}

describe('migration 062: incidents generalization', () => {
  let organizationId: string;
  let projectId: string;
  let userId: string;

  beforeEach(async () => {
    const ctx = await createTestContext();
    organizationId = ctx.organization.id;
    projectId = ctx.project.id;
    userId = ctx.user.id;
  });

  it('accepts source alert and rejects unknown sources', async () => {
    await expect(insertIncident({ organizationId, source: 'alert' })).resolves.toBeDefined();
    await expect(insertIncident({ organizationId, source: 'bogus' as any })).rejects.toThrow(
      /incidents_source_check/
    );
  });

  it('adds the new columns with the expected nullability', async () => {
    const rows = await sql<{
      column_name: string;
      data_type: string;
      is_nullable: string;
      column_default: string | null;
    }>`
      select column_name, data_type, is_nullable, column_default
      from information_schema.columns
      where table_schema = current_schema() and table_name = 'incidents'
    `.execute(db);
    const cols: Record<string, { type: string; nullable: string; hasDefault?: true }> = {};
    for (const r of rows.rows) {
      cols[r.column_name] = {
        type: r.data_type,
        nullable: r.is_nullable,
        ...(r.column_default !== null && { hasDefault: true as const }),
      };
    }

    expect(cols.alert_rule_id).toEqual({ type: 'uuid', nullable: 'YES' });
    expect(cols.acknowledged_at.nullable).toBe('YES');
    expect(cols.acknowledged_at.type).toBe('timestamp with time zone');
    expect(cols.acknowledged_by).toEqual({ type: 'uuid', nullable: 'YES' });
    expect(cols.resolved_by).toEqual({ type: 'uuid', nullable: 'YES' });
    expect(cols.last_event_at).toMatchObject({
      type: 'timestamp with time zone',
      nullable: 'NO',
      hasDefault: true,
    });
  });

  it('defaults last_event_at to the insert time', async () => {
    const before = Date.now();
    const row = await insertIncident({ organizationId });
    expect(row.last_event_at).toBeInstanceOf(Date);
    expect(Math.abs(new Date(row.last_event_at).getTime() - before)).toBeLessThan(5000);
  });

  it('allows one active incident per alert rule and a new one after resolve', async () => {
    const rule = await createTestAlertRule({ organizationId, projectId });
    const first = await insertIncident({ organizationId, source: 'alert', alertRuleId: rule.id });
    await expect(
      insertIncident({ organizationId, source: 'alert', alertRuleId: rule.id })
    ).rejects.toThrow(/uq_incidents_active_alert_rule/);

    await db
      .updateTable('incidents')
      .set({ status: 'resolved' })
      .where('id', '=', first.id)
      .where('organization_id', '=', organizationId)
      .execute();

    await expect(
      insertIncident({ organizationId, source: 'alert', alertRuleId: rule.id })
    ).resolves.toBeDefined();
  });

  it('allows one active incident per monitor, acknowledged counts as active', async () => {
    const monitor = await createTestMonitor({ organizationId, projectId });
    await insertIncident({
      organizationId,
      projectId,
      source: 'monitor',
      monitorId: monitor.id,
      status: 'investigating',
    });
    await expect(
      insertIncident({ organizationId, projectId, source: 'monitor', monitorId: monitor.id })
    ).rejects.toThrow(/uq_incidents_active_monitor/);

    // resolved and false positive rows never block a new active one
    const monitor2 = await createTestMonitor({ organizationId, projectId });
    await insertIncident({ organizationId, source: 'monitor', monitorId: monitor2.id, status: 'resolved' });
    await insertIncident({ organizationId, source: 'monitor', monitorId: monitor2.id, status: 'false_positive' });
    await expect(
      insertIncident({ organizationId, source: 'monitor', monitorId: monitor2.id })
    ).resolves.toBeDefined();
  });

  it('keeps the incident and nulls alert_rule_id when the rule is deleted', async () => {
    const rule = await createTestAlertRule({ organizationId, projectId });
    const inc = await insertIncident({ organizationId, source: 'alert', alertRuleId: rule.id });

    await db
      .deleteFrom('alert_rules')
      .where('id', '=', rule.id)
      .where('organization_id', '=', organizationId)
      .execute();

    const row = await incidentRow(inc.id, organizationId);
    expect(row.alert_rule_id).toBeNull();
    expect(row.source).toBe('alert');
  });

  it('records the acting user from logtide.actor_user_id', async () => {
    const inc = await insertIncident({ organizationId });
    await db.transaction().execute(async (trx) => {
      await sql`select set_config('logtide.actor_user_id', ${userId}, true)`.execute(trx);
      await trx
        .updateTable('incidents')
        .set({ status: 'investigating' })
        .where('id', '=', inc.id)
        .where('organization_id', '=', organizationId)
        .execute();
    });

    const [historyRow] = await historyRows(inc.id);
    expect(historyRow).toMatchObject({
      action: 'status_change',
      field_name: 'status',
      user_id: userId,
      old_value: 'open',
      new_value: 'investigating',
      metadata: null,
    });
  });

  it('records a null user and does not leak the actor across pooled connections', async () => {
    const admin = await createTestUser({ email: `admin-${Date.now()}@example.com` });
    await db.updateTable('users').set({ is_admin: true }).where('id', '=', admin.id).execute();
    const assignee = await createTestUser({ email: `assignee-${Date.now()}@example.com` });

    const inc = await insertIncident({ organizationId, assigneeId: assignee.id });
    await db.transaction().execute(async (trx) => {
      await sql`select set_config('logtide.actor_user_id', ${userId}, true)`.execute(trx);
      await trx
        .updateTable('incidents')
        .set({ severity: 'high' })
        .where('id', '=', inc.id)
        .where('organization_id', '=', organizationId)
        .execute();
    });

    // Several plain updates: whatever pooled connection serves them, the
    // transaction-local setting above must be gone.
    await Promise.all(
      ['critical', 'low', 'informational'].map(async (severity, i) => {
        const other = await insertIncident({ organizationId, title: `other ${i}` });
        await db
          .updateTable('incidents')
          .set({ severity: severity as 'critical' })
          .where('id', '=', other.id)
          .where('organization_id', '=', organizationId)
          .execute();
        const rows = await historyRows(other.id);
        expect(rows).toHaveLength(1);
        expect(rows[0].user_id).toBeNull();
      })
    );

    await db
      .updateTable('incidents')
      .set({ status: 'resolved' })
      .where('id', '=', inc.id)
      .where('organization_id', '=', organizationId)
      .execute();

    const rows = await historyRows(inc.id);
    expect(rows.map((r) => [r.action, r.user_id])).toEqual([
      ['severity_change', userId],
      ['status_change', null],
    ]);
    // never the assignee, never an unrelated instance admin
    expect(rows.some((r) => r.user_id === assignee.id || r.user_id === admin.id)).toBe(false);
  });

  it('records assignment changes with text values', async () => {
    const assignee = await createTestUser({ email: `assign-${Date.now()}@example.com` });
    const inc = await insertIncident({ organizationId });
    await db
      .updateTable('incidents')
      .set({ assignee_id: assignee.id })
      .where('id', '=', inc.id)
      .where('organization_id', '=', organizationId)
      .execute();
    await db
      .updateTable('incidents')
      .set({ assignee_id: null })
      .where('id', '=', inc.id)
      .where('organization_id', '=', organizationId)
      .execute();

    const rows = await historyRows(inc.id);
    expect(rows.map((r) => [r.action, r.field_name, r.old_value, r.new_value, r.user_id])).toEqual([
      ['assignment_change', 'assignee_id', null, assignee.id, null],
      ['assignment_change', 'assignee_id', assignee.id, null, null],
    ]);
  });

  it('stores logtide.change_reason as metadata.reason', async () => {
    const inc = await insertIncident({ organizationId });
    await db.transaction().execute(async (trx) => {
      await sql`select set_config('logtide.change_reason', 'recovered', true)`.execute(trx);
      await trx
        .updateTable('incidents')
        .set({ status: 'resolved' })
        .where('id', '=', inc.id)
        .where('organization_id', '=', organizationId)
        .execute();
    });

    const [row] = await historyRows(inc.id);
    expect(row).toMatchObject({ action: 'status_change', user_id: null, metadata: { reason: 'recovered' } });
  });

  it('keeps an explicit resolved_at and stamps now() when none is given', async () => {
    const explicit = new Date('2026-01-02T03:04:05.000Z');
    const a = await insertIncident({ organizationId, title: 'a' });
    const b = await insertIncident({ organizationId, title: 'b' });

    await db
      .updateTable('incidents')
      .set({ status: 'resolved', resolved_at: explicit })
      .where('id', '=', a.id)
      .where('organization_id', '=', organizationId)
      .execute();
    const before = Date.now();
    await db
      .updateTable('incidents')
      .set({ status: 'resolved' })
      .where('id', '=', b.id)
      .where('organization_id', '=', organizationId)
      .execute();

    expect((await incidentRow(a.id, organizationId)).resolved_at).toEqual(explicit);
    const stamped = (await incidentRow(b.id, organizationId)).resolved_at;
    expect(stamped).not.toBeNull();
    expect(Math.abs(new Date(stamped!).getTime() - before)).toBeLessThan(5000);
  });

  it('clears resolution fields on reopen and acknowledgement fields on open', async () => {
    const ackAt = new Date('2026-03-01T10:00:00.000Z');
    const resolvedAt = new Date('2026-03-01T11:00:00.000Z');
    const inc = await insertIncident({ organizationId });

    await db
      .updateTable('incidents')
      .set({
        status: 'resolved',
        acknowledged_at: ackAt,
        acknowledged_by: userId,
        resolved_at: resolvedAt,
        resolved_by: userId,
      })
      .where('id', '=', inc.id)
      .where('organization_id', '=', organizationId)
      .execute();
    let row = await incidentRow(inc.id, organizationId);
    expect(row).toMatchObject({ resolved_at: resolvedAt, resolved_by: userId, acknowledged_by: userId });

    await db
      .updateTable('incidents')
      .set({ status: 'investigating' })
      .where('id', '=', inc.id)
      .where('organization_id', '=', organizationId)
      .execute();
    row = await incidentRow(inc.id, organizationId);
    expect(row).toMatchObject({
      status: 'investigating',
      resolved_at: null,
      resolved_by: null,
      acknowledged_at: ackAt,
      acknowledged_by: userId,
    });

    await db
      .updateTable('incidents')
      .set({ status: 'open' })
      .where('id', '=', inc.id)
      .where('organization_id', '=', organizationId)
      .execute();
    row = await incidentRow(inc.id, organizationId);
    expect(row).toMatchObject({ status: 'open', acknowledged_at: null, acknowledged_by: null });
  });

  it('backfill keeps updated_at and derives last_event_at', async () => {
    const migration = readFileSync(MIGRATION_PATH, 'utf8');
    const start = migration.indexOf('-- BEGIN F4 BACKFILL');
    const end = migration.indexOf('-- END F4 BACKFILL');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const backfill = migration.slice(start, end);

    const windowEnd = new Date('2026-02-03T04:05:06.000Z');
    const createdAt = new Date('2026-02-01T00:00:00.000Z');
    const oldUpdatedAt = new Date('2026-02-10T00:00:00.000Z');
    const SENTINEL = new Error('rollback sentinel');

    let observed: { withWindow: any; withoutWindow: any } | null = null;
    await expect(
      db.transaction().execute(async (trx) => {
        await sql`ALTER TABLE incidents ALTER COLUMN last_event_at DROP NOT NULL`.execute(trx);
        const withWindow = await trx
          .insertInto('incidents')
          .values({
            organization_id: organizationId,
            title: 'with window',
            severity: 'high',
            time_window_start: createdAt,
            time_window_end: windowEnd,
            created_at: createdAt,
            updated_at: oldUpdatedAt,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        const withoutWindow = await trx
          .insertInto('incidents')
          .values({
            organization_id: organizationId,
            title: 'without window',
            severity: 'low',
            created_at: createdAt,
            updated_at: oldUpdatedAt,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        const ids = [withWindow.id, withoutWindow.id];

        await sql`ALTER TABLE incidents DISABLE TRIGGER USER`.execute(trx);
        await sql`UPDATE incidents SET last_event_at = NULL WHERE id = ANY(${ids}::uuid[]) AND organization_id = ${organizationId}`.execute(trx);
        await sql`ALTER TABLE incidents ENABLE TRIGGER USER`.execute(trx);

        const before = await trx
          .selectFrom('incidents')
          .select(['id', 'updated_at', 'last_event_at'])
          .where('id', 'in', ids)
          .where('organization_id', '=', organizationId)
          .execute();
        expect(before.every((r) => r.last_event_at === null)).toBe(true);
        expect(before.every((r) => new Date(r.updated_at).getTime() === oldUpdatedAt.getTime())).toBe(true);

        await sql.raw(backfill).execute(trx);

        const rows = await trx
          .selectFrom('incidents')
          .select(['id', 'updated_at', 'last_event_at'])
          .where('id', 'in', ids)
          .where('organization_id', '=', organizationId)
          .execute();
        const history = await trx
          .selectFrom('incident_history')
          .select('id')
          .where('incident_id', 'in', ids)
          .execute();
        observed = {
          withWindow: rows.find((r) => r.id === withWindow.id),
          withoutWindow: rows.find((r) => r.id === withoutWindow.id),
        };
        expect(history).toHaveLength(0);
        throw SENTINEL;
      })
    ).rejects.toBe(SENTINEL);

    expect(observed).not.toBeNull();
    expect(observed!.withWindow.last_event_at).toEqual(windowEnd);
    expect(observed!.withoutWindow.last_event_at).toEqual(createdAt);
    expect(observed!.withWindow.updated_at).toEqual(oldUpdatedAt);
    expect(observed!.withoutWindow.updated_at).toEqual(oldUpdatedAt);

    // the rollback restored the constraint and dropped the rows
    const cols = await sql<{ is_nullable: string }>`
      select is_nullable from information_schema.columns
      where table_schema = current_schema() and table_name = 'incidents' and column_name = 'last_event_at'
    `.execute(db);
    expect(cols.rows[0].is_nullable).toBe('NO');
  });

  it('backfill resolves older duplicate active monitor incidents', async () => {
    const migration = readFileSync(MIGRATION_PATH, 'utf8');
    const backfill = migration.slice(
      migration.indexOf('-- BEGIN F4 BACKFILL'),
      migration.indexOf('-- END F4 BACKFILL')
    );
    const monitor = await createTestMonitor({ organizationId, projectId });
    const SENTINEL = new Error('rollback sentinel');
    let statuses: Record<string, string> = {};

    await expect(
      db.transaction().execute(async (trx) => {
        // simulate a pre-062 database: no unique index yet
        await sql`DROP INDEX uq_incidents_active_monitor`.execute(trx);
        const older = await trx
          .insertInto('incidents')
          .values({
            organization_id: organizationId,
            title: 'older',
            severity: 'high',
            source: 'monitor',
            monitor_id: monitor.id,
            created_at: new Date('2026-01-01T00:00:00.000Z'),
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        const newer = await trx
          .insertInto('incidents')
          .values({
            organization_id: organizationId,
            title: 'newer',
            severity: 'high',
            source: 'monitor',
            monitor_id: monitor.id,
            created_at: new Date('2026-01-02T00:00:00.000Z'),
          })
          .returning('id')
          .executeTakeFirstOrThrow();

        await sql.raw(backfill).execute(trx);

        const rows = await trx
          .selectFrom('incidents')
          .select(['id', 'status'])
          .where('id', 'in', [older.id, newer.id])
          .where('organization_id', '=', organizationId)
          .execute();
        statuses = Object.fromEntries(rows.map((r) => [r.id === older.id ? 'older' : 'newer', r.status]));
        throw SENTINEL;
      })
    ).rejects.toBe(SENTINEL);

    expect(statuses).toEqual({ older: 'resolved', newer: 'open' });
  });
});
