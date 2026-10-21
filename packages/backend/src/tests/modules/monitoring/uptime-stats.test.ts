import { describe, it, expect, beforeEach } from 'vitest';
import { sql } from 'kysely';
import { db } from '../../../database/index.js';
import { createTestContext } from '../../helpers/index.js';
import { insertIncident } from '../incidents/fixtures.js';
import {
  getUptimeSummary,
  getResponseTimes,
  getOutages,
} from '../../../modules/monitoring/uptime-stats.js';

const HOUR = 3600_000;
const DAY = 24 * HOUR;

let ctx: Awaited<ReturnType<typeof createTestContext>>;
let monitorId: string;

async function createMonitor(organizationId: string, projectId: string) {
  const row = await db
    .insertInto('monitors')
    .values({
      organization_id: organizationId,
      project_id: projectId,
      name: 'Stats monitor',
      type: 'http',
      target: 'https://example.com',
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

async function seed(
  rows: Array<{ ageMs: number; status: 'up' | 'down'; responseTimeMs?: number | null }>,
  forMonitorId = monitorId
) {
  if (rows.length === 0) return;
  await db
    .insertInto('monitor_results')
    .values(
      rows.map((r) => ({
        time: new Date(Date.now() - r.ageMs),
        monitor_id: forMonitorId,
        organization_id: ctx.organization.id,
        project_id: ctx.project.id,
        status: r.status,
        response_time_ms: r.responseTimeMs ?? null,
      }))
    )
    .execute();
}

beforeEach(async () => {
  ctx = await createTestContext();
  monitorId = await createMonitor(ctx.organization.id, ctx.project.id);
});

describe('getUptimeSummary', () => {
  it('has null percentages and 0 checks for a monitor without results', async () => {
    const summary = await getUptimeSummary(monitorId, ctx.organization.id);
    expect(summary).not.toBeNull();
    for (const key of ['24h', '7d', '30d', '90d'] as const) {
      expect(summary!.windows[key]).toEqual({ uptimePct: null, totalChecks: 0 });
    }
  });

  it('24h and 7d come from raw results (9 of 10 up in 24h gives 90, plus 10 down checks 3 days ago gives 45 for 7d)', async () => {
    await seed([
      ...Array.from({ length: 9 }, (_, i) => ({ ageMs: (i + 1) * 30 * 60_000, status: 'up' as const })),
      { ageMs: 2 * HOUR, status: 'down' as const },
      ...Array.from({ length: 10 }, (_, i) => ({ ageMs: 3 * DAY + i * 60_000, status: 'down' as const })),
    ]);

    const summary = await getUptimeSummary(monitorId, ctx.organization.id);
    expect(summary!.windows['24h']).toEqual({ uptimePct: 90, totalChecks: 10 });
    expect(summary!.windows['7d']).toEqual({ uptimePct: 45, totalChecks: 20 });
  });

  it('rounds to two decimals', async () => {
    await seed([
      { ageMs: HOUR, status: 'up' },
      { ageMs: 2 * HOUR, status: 'up' },
      { ageMs: 3 * HOUR, status: 'down' },
    ]);
    const summary = await getUptimeSummary(monitorId, ctx.organization.id);
    expect(summary!.windows['24h'].uptimePct).toBe(66.67);
  });

  it('30d and 90d come from monitor_uptime_daily (refresh the aggregate after seeding results 60 days old)', async () => {
    await seed([
      ...Array.from({ length: 8 }, (_, i) => ({ ageMs: 60 * DAY + i * 60_000, status: 'up' as const })),
      ...Array.from({ length: 2 }, (_, i) => ({ ageMs: 60 * DAY + (i + 10) * 60_000, status: 'down' as const })),
    ]);
    await sql`CALL refresh_continuous_aggregate('monitor_uptime_daily', NULL, NOW() - INTERVAL '1 day')`.execute(db);

    const summary = await getUptimeSummary(monitorId, ctx.organization.id);
    expect(summary!.windows['90d']).toEqual({ uptimePct: 80, totalChecks: 10 });
    // 60 days ago is outside the 30 day window
    expect(summary!.windows['30d']).toEqual({ uptimePct: null, totalChecks: 0 });
    // and outside the raw windows
    expect(summary!.windows['7d']).toEqual({ uptimePct: null, totalChecks: 0 });
  });

  it('returns null for a monitor of another organization', async () => {
    const other = await createTestContext();
    expect(await getUptimeSummary(monitorId, other.organization.id)).toBeNull();
  });
});

describe('getResponseTimes', () => {
  it('24h uses 5 minute buckets aligned to the bucket and counts failures', async () => {
    // Anchor inside one aligned 5 minute bucket well in the past
    const bucketStart = Math.floor((Date.now() - 2 * HOUR) / 300_000) * 300_000;
    const at = (offsetSec: number) => Date.now() - (bucketStart + offsetSec * 1000);
    await seed([
      { ageMs: at(10), status: 'up', responseTimeMs: 100 },
      { ageMs: at(60), status: 'up', responseTimeMs: 200 },
      { ageMs: at(120), status: 'down', responseTimeMs: 300 },
    ]);

    const res = await getResponseTimes(monitorId, ctx.organization.id, '24h');
    expect(res).not.toBeNull();
    expect(res!.bucketSeconds).toBe(300);
    expect(res!.points).toHaveLength(1);
    const p = res!.points[0];
    expect(new Date(p.time).getTime()).toBe(bucketStart);
    expect(p.avgMs).toBe(200);
    expect(p.p95Ms).toBe(290);
    expect(p.failures).toBe(1);
  });

  it('uses 1 hour buckets for 7d and 6 hour buckets for 30d', async () => {
    expect((await getResponseTimes(monitorId, ctx.organization.id, '7d'))!.bucketSeconds).toBe(3600);
    expect((await getResponseTimes(monitorId, ctx.organization.id, '30d'))!.bucketSeconds).toBe(21600);
  });

  it('returns no points for a monitor without results and null avg for buckets without timings', async () => {
    expect((await getResponseTimes(monitorId, ctx.organization.id, '24h'))!.points).toEqual([]);
    await seed([{ ageMs: HOUR, status: 'down', responseTimeMs: null }]);
    const res = await getResponseTimes(monitorId, ctx.organization.id, '24h');
    expect(res!.points).toHaveLength(1);
    expect(res!.points[0]).toMatchObject({ avgMs: null, p95Ms: null, failures: 1 });
  });

  it('ignores results outside the range and of other monitors', async () => {
    const otherMonitor = await createMonitor(ctx.organization.id, ctx.project.id);
    await seed([{ ageMs: 2 * DAY, status: 'up', responseTimeMs: 10 }]);
    await seed([{ ageMs: HOUR, status: 'up', responseTimeMs: 10 }], otherMonitor);
    expect((await getResponseTimes(monitorId, ctx.organization.id, '24h'))!.points).toEqual([]);
  });

  it('returns null for a monitor of another organization', async () => {
    const other = await createTestContext();
    expect(await getResponseTimes(monitorId, other.organization.id, '24h')).toBeNull();
  });
});

describe('getOutages', () => {
  it('lists monitor incidents newest first with durationSeconds and null resolvedAt for an open one', async () => {
    const older = await insertIncident({
      organizationId: ctx.organization.id,
      projectId: ctx.project.id,
      source: 'monitor',
      monitorId,
      status: 'resolved',
      title: 'Monitor down: old',
      createdAt: new Date(Date.now() - 3 * DAY),
    });
    await db
      .updateTable('incidents')
      .set({ resolved_at: new Date(Date.now() - 3 * DAY + 600_000) })
      .where('id', '=', older.id)
      .where('organization_id', '=', ctx.organization.id)
      .execute();
    const open = await insertIncident({
      organizationId: ctx.organization.id,
      projectId: ctx.project.id,
      source: 'monitor',
      monitorId,
      status: 'open',
      severity: 'critical',
      title: 'Monitor down: new',
      createdAt: new Date(Date.now() - HOUR),
    });

    const res = await getOutages(monitorId, ctx.organization.id, 20);
    expect(res!.outages.map((o) => o.incidentId)).toEqual([open.id, older.id]);
    expect(res!.outages[0]).toMatchObject({
      title: 'Monitor down: new',
      status: 'open',
      severity: 'critical',
      resolvedAt: null,
      durationSeconds: null,
    });
    expect(res!.outages[1].durationSeconds).toBe(600);
    expect(typeof res!.outages[1].resolvedAt).toBe('string');
    expect(typeof res!.outages[0].startedAt).toBe('string');
  });

  it('ignores sigma incidents and incidents of other monitors', async () => {
    const otherMonitor = await createMonitor(ctx.organization.id, ctx.project.id);
    await insertIncident({ organizationId: ctx.organization.id, projectId: ctx.project.id, source: 'sigma' });
    await insertIncident({
      organizationId: ctx.organization.id,
      projectId: ctx.project.id,
      source: 'monitor',
      monitorId: otherMonitor,
    });
    const mine = await insertIncident({
      organizationId: ctx.organization.id,
      projectId: ctx.project.id,
      source: 'monitor',
      monitorId,
    });

    const res = await getOutages(monitorId, ctx.organization.id, 20);
    expect(res!.outages.map((o) => o.incidentId)).toEqual([mine.id]);
  });

  it('respects the limit', async () => {
    for (let i = 0; i < 3; i++) {
      await insertIncident({
        organizationId: ctx.organization.id,
        projectId: ctx.project.id,
        source: 'monitor',
        monitorId,
        status: 'resolved',
        createdAt: new Date(Date.now() - (i + 1) * DAY),
      });
    }
    expect((await getOutages(monitorId, ctx.organization.id, 2))!.outages).toHaveLength(2);
  });

  it('returns null for a monitor of another organization', async () => {
    const other = await createTestContext();
    expect(await getOutages(monitorId, other.organization.id, 20)).toBeNull();
  });
});
