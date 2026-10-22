import { describe, it, expect, beforeEach } from 'vitest';
import { sql } from 'kysely';
import { db } from '../../../database/index.js';
import { createTestContext, createTestSigmaRule } from '../../helpers/factories.js';

async function insertException(organizationId: string, ruleId: string) {
  return db
    .insertInto('sigma_rule_exceptions')
    .values({
      organization_id: organizationId,
      sigma_rule_id: ruleId,
      conditions: JSON.stringify([{ field: 'service', operator: 'equals', values: ['api'] }]),
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}

describe('migration 066', () => {
  beforeEach(async () => {
    await db.deleteFrom('sigma_rule_exceptions').execute();
  });

  it('creates sigma_rule_exceptions with cascade on rule delete', async () => {
    const { organization } = await createTestContext();
    const rule = await createTestSigmaRule({ organizationId: organization.id });
    const ex = await insertException(organization.id, rule.id);

    expect(ex.hit_count).toBe('0');
    expect(ex.expires_at).toBeNull();
    expect(ex.last_hit_at).toBeNull();

    await db.deleteFrom('sigma_rules').where('id', '=', rule.id).execute();
    const left = await db
      .selectFrom('sigma_rule_exceptions')
      .select('id')
      .where('id', '=', ex.id)
      .execute();
    expect(left).toHaveLength(0);
  });

  it('deleting an organization removes its exceptions', async () => {
    const { organization } = await createTestContext();
    const rule = await createTestSigmaRule({ organizationId: organization.id });
    const ex = await insertException(organization.id, rule.id);

    await db.deleteFrom('organizations').where('id', '=', organization.id).execute();
    const left = await db
      .selectFrom('sigma_rule_exceptions')
      .select('id')
      .where('id', '=', ex.id)
      .execute();
    expect(left).toHaveLength(0);
  });

  it('sigma_rules has raw_yaml and last_fired_at nullable', async () => {
    const rows = await sql<{ column_name: string; is_nullable: string }>`
      SELECT column_name, is_nullable FROM information_schema.columns
      WHERE table_name = 'sigma_rules' AND column_name IN ('raw_yaml', 'last_fired_at')
    `.execute(db);
    expect(rows.rows.map((r) => r.column_name).sort()).toEqual(['last_fired_at', 'raw_yaml']);
    for (const r of rows.rows) expect(r.is_nullable).toBe('YES');

    const { organization } = await createTestContext();
    const rule = await createTestSigmaRule({ organizationId: organization.id });
    expect(rule.raw_yaml).toBeNull();
    expect(rule.last_fired_at).toBeNull();
  });

  it('detection_events keeps idx_detection_events_rule and idx_detection_events_org_time', async () => {
    const rows = await sql<{ indexname: string }>`
      SELECT indexname FROM pg_indexes WHERE tablename = 'detection_events'
    `.execute(db);
    const names = rows.rows.map((r) => r.indexname);
    expect(names).toContain('idx_detection_events_rule');
    expect(names).toContain('idx_detection_events_org_time');
  });

  it('has indexes on rule and organization', async () => {
    const rows = await sql<{ indexname: string }>`
      SELECT indexname FROM pg_indexes WHERE tablename = 'sigma_rule_exceptions'
    `.execute(db);
    const names = rows.rows.map((r) => r.indexname);
    expect(names).toContain('idx_sigma_rule_exceptions_rule');
    expect(names).toContain('idx_sigma_rule_exceptions_org');
  });
});
