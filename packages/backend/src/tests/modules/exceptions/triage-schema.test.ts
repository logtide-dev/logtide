import { describe, it, expect } from 'vitest';
import { sql } from 'kysely';
import { db } from '../../../database/index.js';
import { createTestContext, createTestUser } from '../../helpers/factories.js';

async function insertGroup(
  ctx: Awaited<ReturnType<typeof createTestContext>>,
  extra: Record<string, unknown> = {},
) {
  return db
    .insertInto('error_groups')
    .values({
      organization_id: ctx.organization.id,
      project_id: ctx.project.id,
      fingerprint: `fp-${Math.random().toString(36).slice(2)}`,
      exception_type: 'TypeError',
      exception_message: 'boom',
      language: 'nodejs',
      occurrence_count: 1,
      first_seen: new Date(),
      last_seen: new Date(),
      ...extra,
    } as never)
    .returningAll()
    .executeTakeFirstOrThrow();
}

describe('error group triage schema (migration 064)', () => {
  it('error_groups has the triage columns with expected nullability and defaults', async () => {
    const res = await sql<{
      column_name: string;
      is_nullable: string;
      column_default: string | null;
    }>`
      SELECT column_name, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = 'error_groups'
        AND column_name IN ('assigned_to', 'regressed_at', 'ignored_until', 'ignore_until_count', 'ignored_event_count')
    `.execute(db);
    const byName = new Map(res.rows.map((r) => [r.column_name, r]));

    expect(byName.size).toBe(5);
    expect(byName.get('ignored_event_count')!.is_nullable).toBe('NO');
    expect(byName.get('ignored_event_count')!.column_default).toBe('0');
    for (const name of ['assigned_to', 'regressed_at', 'ignored_until', 'ignore_until_count']) {
      expect(byName.get(name)!.is_nullable).toBe('YES');
    }
  });

  it('indexes exist on error_groups and exceptions', async () => {
    const res = await sql<{ indexname: string }>`
      SELECT indexname FROM pg_indexes
      WHERE indexname IN (
        'idx_error_groups_org_status_last_seen',
        'idx_error_groups_assigned_to',
        'idx_exceptions_org_fingerprint_created'
      )
    `.execute(db);
    expect(res.rows.map((r) => r.indexname).sort()).toEqual([
      'idx_error_groups_assigned_to',
      'idx_error_groups_org_status_last_seen',
      'idx_exceptions_org_fingerprint_created',
    ]);
  });

  it('deleting the assigned user sets assigned_to to null', async () => {
    const ctx = await createTestContext();
    const assignee = await createTestUser({ email: `assignee-${Date.now()}@example.com` });
    const group = await insertGroup(ctx, { assigned_to: assignee.id });
    expect(group.assigned_to).toBe(assignee.id);

    await db.deleteFrom('users').where('id', '=', assignee.id).execute();

    const after = await db
      .selectFrom('error_groups')
      .select('assigned_to')
      .where('id', '=', group.id)
      .executeTakeFirstOrThrow();
    expect(after.assigned_to).toBeNull();
  });

  it('existing groups keep working: insert without triage columns succeeds and ignored_event_count is 0', async () => {
    const ctx = await createTestContext();
    const group = await insertGroup(ctx);

    expect(group.ignored_event_count).toBe(0);
    expect(group.assigned_to).toBeNull();
    expect(group.regressed_at).toBeNull();
    expect(group.ignored_until).toBeNull();
    expect(group.ignore_until_count).toBeNull();
  });
});
