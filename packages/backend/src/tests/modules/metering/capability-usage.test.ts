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
        'saved_searches.max_per_org',
        'sigma.max_active_rules',
        'status_page.subscribers.max',
        'storage.max_bytes',
        'telemetry.max_bytes_monthly',
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

  it('counts saved searches of the organization only', async () => {
    const ctx = await createTestContext();
    const other = await createTestContext();
    const state = JSON.stringify({ version: 1 });
    await db
      .insertInto('saved_searches')
      .values([
        { organization_id: orgId, created_by: ctx.user.id, name: 'a', visibility: 'organization', state },
        { organization_id: orgId, created_by: ctx.user.id, name: 'b', visibility: 'private', state },
        { organization_id: other.organization.id, created_by: other.user.id, name: 'c', visibility: 'organization', state },
      ])
      .execute();
    await db
      .insertInto('organization_entitlements')
      .values({ organization_id: orgId, capability: 'saved_searches.max_per_org', enabled: true, limit_value: 10 })
      .execute();

    const rows = await getCapabilityUsage(orgId);
    expect(rows.find((r) => r.capability === 'saved_searches.max_per_org')).toMatchObject({
      kind: 'limit',
      current: 2,
      limit: 10,
    });
  });

  it('counts confirmed and still-pending status page subscribers of the organization only', async () => {
    const ctx = await createTestContext();
    const other = await createTestContext();
    const sub = (organizationId: string, projectId: string, email: string, confirmed: boolean, expired = false) => ({
      organization_id: organizationId,
      project_id: projectId,
      email,
      email_normalized: email,
      confirmed_at: confirmed ? new Date() : null,
      confirm_token_hash: confirmed ? null : 'a'.repeat(64),
      confirm_expires_at: confirmed ? null : new Date(Date.now() + (expired ? -3600_000 : 3600_000)),
    });
    await db
      .insertInto('status_page_subscribers')
      .values([
        sub(orgId, ctx.project.id, 'a@example.com', true),
        sub(orgId, ctx.project.id, 'b@example.com', false),
        sub(orgId, ctx.project.id, 'c@example.com', false, true),
        sub(other.organization.id, other.project.id, 'd@example.com', true),
      ])
      .execute();
    await db
      .insertInto('organization_entitlements')
      .values({ organization_id: orgId, capability: 'status_page.subscribers.max', enabled: true, limit_value: 100 })
      .execute();

    const rows = await getCapabilityUsage(orgId);
    expect(rows.find((r) => r.capability === 'status_page.subscribers.max')).toMatchObject({
      kind: 'limit',
      current: 2,
      limit: 100,
    });
  });
});
