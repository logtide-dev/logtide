import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import { db } from '../../../database/index.js';
import { reservoirReady } from '../../../database/reservoir.js';
import { getCapabilityUsage } from '../../../modules/metering/capability-usage.js';
import { createTestContext } from '../../helpers/factories.js';

describe('getCapabilityUsage', () => {
  let orgId: string;

  beforeAll(async () => {
    await reservoirReady;
  });

  beforeEach(async () => {
    const ctx = await createTestContext();
    orgId = ctx.organization.id;
    await db.deleteFrom('metering_events').where('organization_id', '=', orgId).execute();
    await db.deleteFrom('organization_entitlements').where('organization_id', '=', orgId).execute();
  });

  it('returns only measurable capabilities (limit + quota), excluding booleans and audit.retention_days', async () => {
    const rows = await getCapabilityUsage(orgId);
    const names = rows.map((r) => r.capability).sort();

    expect(names).toEqual(
      [
        'alerts.max_rules',
        'apikeys.max',
        'dashboards.max_custom',
        'ingestion.max_bytes_monthly',
        'ingestion.max_events_monthly',
        'metrics.max_datapoints_monthly',
        'notifications.max_channels',
        'projects.max',
        'sigma.max_active_rules',
        'storage.max_bytes',
        'tracing.max_spans_monthly',
      ].sort()
    );

    // Boolean gates and the config-ceiling capability never appear.
    expect(names).not.toContain('audit.enabled');
    expect(names).not.toContain('auth.sso');
    expect(names).not.toContain('audit.retention_days');
  });

  it('defaults to unlimited (null limit) with zero counts for a fresh org', async () => {
    const rows = await getCapabilityUsage(orgId);
    const alerts = rows.find((r) => r.capability === 'alerts.max_rules');

    expect(alerts).toMatchObject({ kind: 'limit', current: 0, limit: null });
    expect(rows.every((r) => r.limit === null)).toBe(true);
  });

  it('reports month-to-date metered usage against a configured quota limit', async () => {
    await db
      .insertInto('metering_events')
      .values([
        { time: new Date(), organization_id: orgId, project_id: null, type: 'logs.ingested.events', quantity: 400, metadata: null },
        { time: new Date(), organization_id: orgId, project_id: null, type: 'logs.ingested.events', quantity: 350, metadata: null },
      ])
      .execute();
    await db
      .insertInto('organization_entitlements')
      .values({ organization_id: orgId, capability: 'ingestion.max_events_monthly', enabled: true, limit_value: 2000 })
      .execute();

    const rows = await getCapabilityUsage(orgId);
    const events = rows.find((r) => r.capability === 'ingestion.max_events_monthly');

    expect(events).toMatchObject({ kind: 'quota', current: 750, limit: 2000 });
  });

  it('surfaces a configured resource limit', async () => {
    await db
      .insertInto('organization_entitlements')
      .values({ organization_id: orgId, capability: 'alerts.max_rules', enabled: true, limit_value: 5 })
      .execute();

    const rows = await getCapabilityUsage(orgId);
    const alerts = rows.find((r) => r.capability === 'alerts.max_rules');

    expect(alerts?.limit).toBe(5);
  });
});
