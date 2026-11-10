import { describe, it, expect, beforeEach, vi } from 'vitest';
import { db } from '../../../database/index.js';
import { createTestContext } from '../../helpers/factories.js';
import { metricsService } from '../../../modules/metrics/service.js';
import { HARDWARE_HISTORY_SERIES } from '@logtide/shared';
import { reservoir } from '../../../database/reservoir.js';
import { hwRecords, healthyPoints, type HwPoint } from './helpers.js';

const { notifyMock } = vi.hoisted(() => ({ notifyMock: vi.fn() }));
vi.mock('../../../modules/hardware/notifier.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../modules/hardware/notifier.js')>();
  return { ...actual, notifyHardware: notifyMock };
});

// The tests drive last_seen_at themselves: the fire-and-forget registration
// of the ingest path (server clock) would race with it.
vi.mock('../../../modules/hardware/registry.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../modules/hardware/registry.js')>();
  return { ...actual, registerHardwareHosts: vi.fn(async () => []) };
});

import { runHardwarePass, planTransition } from '../../../modules/hardware/evaluation.js';
import { loadProjectHardwareData } from '../../../modules/hardware/loader.js';
import { saveEvaluation } from '../../../modules/hardware/repository.js';
import { evaluateHost } from '../../../modules/hardware/evaluator.js';

const MIN = 60_000;

function cpuTemp(value: number): HwPoint {
  return { name: 'hw.temperature', value, hwType: 'cpu', hwId: 'coretemp-isa-0000', attrs: { sensor: 'Package id 0' } };
}

/** Healthy host with the CPU package at `temp` degrees (85 = warning, 95 = critical). */
function hostPoints(temp: number): HwPoint[] {
  return healthyPoints().map((p) => (p.name === 'hw.temperature' ? cpuTemp(temp) : p));
}

async function setup(hostName = 'srv-1') {
  const ctx = await createTestContext();
  const orgId = ctx.organization.id;
  const projectId = ctx.project.id;
  const host = await db
    .insertInto('hardware_hosts')
    .values({ organization_id: orgId, project_id: projectId, host_name: hostName, last_seen_at: new Date() })
    .returning('id')
    .executeTakeFirstOrThrow();

  const ingest = async (points: HwPoint[], time: Date, name = hostName) => {
    await metricsService.ingestMetrics(hwRecords(points, name, time, projectId, orgId), projectId, orgId);
    await db
      .updateTable('hardware_hosts')
      .set({ last_seen_at: time })
      .where('project_id', '=', projectId)
      .where('organization_id', '=', orgId)
      .where('host_name', '=', name)
      .execute();
  };
  const row = () =>
    db
      .selectFrom('hardware_hosts')
      .selectAll()
      .where('id', '=', host.id)
      .where('organization_id', '=', orgId)
      .executeTakeFirstOrThrow();
  const incidents = () =>
    db
      .selectFrom('incidents')
      .selectAll()
      .where('organization_id', '=', orgId)
      .where('hardware_host_id', '=', host.id)
      .orderBy('created_at')
      .execute();
  return { ctx, orgId, projectId, hostId: host.id, ingest, row, incidents };
}

/** Pass `i` happens at base + i * 2 min, its points 30 s before. */
function clock() {
  const base = Date.now() - 60 * MIN;
  return (i: number) => ({ at: new Date(base + i * 2 * MIN), point: new Date(base + i * 2 * MIN - 30_000) });
}

describe('planTransition', () => {
  it('maps status changes to incident actions', () => {
    expect(planTransition('ok', 'warning')).toBe('open');
    expect(planTransition('unknown', 'critical')).toBe('open');
    expect(planTransition('warning', 'critical')).toBe('escalate');
    expect(planTransition('critical', 'warning')).toBe('deescalate');
    expect(planTransition('critical', 'ok')).toBe('resolve');
    expect(planTransition('stale', 'ok')).toBe('resolve');
    expect(planTransition('critical', 'stale')).toBe('none');
    expect(planTransition('ok', 'unknown')).toBe('none');
    expect(planTransition('stale', 'critical')).toBe('reconcile');
    expect(planTransition('warning', 'warning')).toBe('none');
  });
});

describe('hardware data loader', () => {
  it('loads latest points and 24h/7d history per host with one query set per project', async () => {
    const s = await setup();
    const now = new Date();
    const mem = (v: number): HwPoint => ({ name: 'hw.memory.errors', value: v, hwType: 'memory', hwId: 'mc0', attrs: { error_type: 'corrected', scope: 'controller' } });
    await s.ingest([mem(2)], new Date(now.getTime() - 3 * 24 * 60 * MIN));
    await s.ingest([mem(4)], new Date(now.getTime() - 20 * 60 * MIN));
    await s.ingest([mem(9), cpuTemp(50)], new Date(now.getTime() - MIN));
    await s.ingest([mem(500)], new Date(now.getTime() - MIN), 'other-host');

    const data = await loadProjectHardwareData(s.projectId, s.orgId, new Set(['srv-1']), now);
    expect([...data.hosts.keys()]).toEqual(['srv-1']);
    const h = data.hosts.get('srv-1')!;
    expect(h.latest.map((p) => p.metric).sort()).toEqual(['hw.memory.errors', 'hw.temperature']);
    const hist = h.history.find((e) => e.metric === 'hw.memory.errors')!;
    expect(hist).toMatchObject({ min24h: 4, max24h: 9, min7d: 2, max7d: 9 });
    expect(hist.attributes).toMatchObject({ 'host.name': 'srv-1', 'hw.id': 'mc0', error_type: 'corrected' });

    const result = evaluateHost({ latest: h.latest, history: h.history, now, lastSeenAt: now });
    expect(result.status).toBe('warning');
    expect(result.findings.map((f) => f.code)).toContain('memory.corrected');
  });

  it('pages the latest window with a time keyset, including many points in one millisecond', async () => {
    const s = await setup();
    const now = new Date();
    const mem = (id: string, v: number): HwPoint => ({ name: 'hw.memory.errors', value: v, hwType: 'memory', hwId: id, attrs: { error_type: 'corrected', scope: 'controller' } });
    // 7 points in one millisecond, then 2, 1 and 1 points at older times.
    await s.ingest(Array.from({ length: 7 }, (_, i) => mem(`mc${i}`, i)), new Date(now.getTime() - MIN));
    await s.ingest([mem('a', 1), mem('b', 1)], new Date(now.getTime() - 3 * MIN));
    await s.ingest([mem('c', 1)], new Date(now.getTime() - 5 * MIN));
    await s.ingest([mem('d', 1)], new Date(now.getTime() - 7 * MIN));

    const paged = await loadProjectHardwareData(s.projectId, s.orgId, new Set(['srv-1']), now, { pageSize: 3 });
    const all = await loadProjectHardwareData(s.projectId, s.orgId, new Set(['srv-1']), now);
    const ids = (d: typeof paged) => d.hosts.get('srv-1')!.latest.map((p) => String(p.attributes['hw.id'])).sort();
    expect(ids(paged)).toHaveLength(11);
    expect(ids(paged)).toEqual(ids(all));
    expect(paged.truncated).toBe(false);
    expect(paged.hosts.get('srv-1')!.partial).toBe(false);
  });

  it('the cap never drops a whole host: hosts left without points are read one by one, all marked partial', async () => {
    const s = await setup();
    await db.insertInto('hardware_hosts').values({ organization_id: s.orgId, project_id: s.projectId, host_name: 'quiet' }).execute();
    const now = new Date();
    await s.ingest(hostPoints(45), new Date(now.getTime() - MIN));
    await s.ingest(hostPoints(45), new Date(now.getTime() - 2 * MIN));
    await s.ingest(hostPoints(97), new Date(now.getTime() - 8 * MIN), 'quiet');

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const data = await loadProjectHardwareData(s.projectId, s.orgId, new Set(['srv-1', 'quiet']), now, { pageSize: 4, maxPoints: 8 });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
    expect(data.truncated).toBe(true);
    expect(data.hosts.get('srv-1')!.partial).toBe(true);
    expect(data.hosts.get('quiet')!.partial).toBe(true);
    expect(data.hosts.get('quiet')!.latest.length).toBe(hostPoints(97).length);
  });

  it('reads history with one hourly min and max aggregate per metric, cached per project for 15 minutes', async () => {
    const s = await setup();
    const now = new Date();
    await s.ingest(hostPoints(45), new Date(now.getTime() - MIN));
    const spy = vi.spyOn(reservoir, 'aggregateMetrics');
    try {
      await loadProjectHardwareData(s.projectId, s.orgId, new Set(['srv-1']), now);
      const metrics = Object.keys(HARDWARE_HISTORY_SERIES).length;
      expect(spy).toHaveBeenCalledTimes(2 * metrics);
      expect(spy.mock.calls.every(([p]) => p.interval === '1h' && p.to.getTime() - p.from.getTime() === 7 * 24 * 60 * MIN)).toBe(true);

      spy.mockClear();
      await loadProjectHardwareData(s.projectId, s.orgId, new Set(['srv-1']), new Date(now.getTime() + 14 * MIN));
      expect(spy).not.toHaveBeenCalled();
      await loadProjectHardwareData(s.projectId, s.orgId, new Set(['srv-1']), new Date(now.getTime() + 15 * MIN));
      expect(spy).toHaveBeenCalledTimes(2 * metrics);
    } finally {
      spy.mockRestore();
    }
  });

  it('does not see another project', async () => {
    const a = await setup('shared-name');
    const b = await setup('shared-name');
    const now = new Date();
    await b.ingest([cpuTemp(99)], new Date(now.getTime() - MIN));
    const data = await loadProjectHardwareData(a.projectId, a.orgId, new Set(['shared-name']), now);
    expect(data.hosts.get('shared-name')!.latest).toEqual([]);
  });
});

describe('runHardwarePass transitions', () => {
  beforeEach(() => {
    notifyMock.mockReset().mockResolvedValue(undefined);
  });

  it('opens, escalates, de-escalates and resolves one incident with the right notifications', async () => {
    const s = await setup();
    const t = clock();

    // ok
    await s.ingest(hostPoints(45), t(0).point);
    await runHardwarePass(t(0).at);
    expect((await s.row()).status).toBe('ok');
    expect(await s.incidents()).toHaveLength(0);

    // ok -> warning: open + notify
    await s.ingest(hostPoints(88), t(1).point);
    await runHardwarePass(t(1).at);
    let incidents = await s.incidents();
    expect(incidents).toHaveLength(1);
    expect(incidents[0]).toMatchObject({ source: 'hardware', severity: 'medium', status: 'open', title: 'Hardware warning: srv-1', project_id: s.projectId });
    expect(incidents[0].description).toContain('CPU sensor');
    expect(notifyMock).toHaveBeenCalledTimes(1);
    expect(notifyMock.mock.calls[0][1]).toMatchObject({ kind: 'degraded', status: 'warning', previousStatus: 'ok', incidentId: incidents[0].id });
    const row = await s.row();
    expect(row.status).toBe('warning');
    expect(row.status_changed_at.getTime()).toBe(t(1).at.getTime());
    expect(row.is_virtual).toBe(false);
    expect((row.info as Record<string, unknown>).vendor).toBe('Supermicro');

    // warning -> critical: same incident escalated and retitled, notify
    await s.ingest(hostPoints(97), t(2).point);
    await runHardwarePass(t(2).at);
    incidents = await s.incidents();
    expect(incidents).toHaveLength(1);
    expect(incidents[0]).toMatchObject({ severity: 'critical', title: 'Hardware critical: srv-1' });
    expect(notifyMock).toHaveBeenCalledTimes(2);
    expect(notifyMock.mock.calls[1][1]).toMatchObject({ kind: 'degraded', status: 'critical', previousStatus: 'warning' });

    // critical -> warning: severity lowered, no notification
    await s.ingest(hostPoints(88), t(3).point);
    await runHardwarePass(t(3).at);
    incidents = await s.incidents();
    expect(incidents[0]).toMatchObject({ severity: 'medium', title: 'Hardware warning: srv-1', status: 'open' });
    expect(notifyMock).toHaveBeenCalledTimes(2);

    // -> ok: resolved + recovered notification
    await s.ingest(hostPoints(45), t(4).point);
    await runHardwarePass(t(4).at);
    incidents = await s.incidents();
    expect(incidents[0].status).toBe('resolved');
    expect(notifyMock).toHaveBeenCalledTimes(3);
    expect(notifyMock.mock.calls[2][1]).toMatchObject({ kind: 'recovered', status: 'ok', incidentId: incidents[0].id });
  });

  it('a repeated pass with the same data is a no-op (idempotent)', async () => {
    const s = await setup();
    const t = clock();
    await s.ingest(hostPoints(97), t(0).point);
    await runHardwarePass(t(0).at);
    await runHardwarePass(new Date(t(0).at.getTime() + 1000));
    expect(await s.incidents()).toHaveLength(1);
    expect(notifyMock).toHaveBeenCalledTimes(1);
  });

  it('two concurrent passes notify once (compare-and-set on the stored status)', async () => {
    const s = await setup();
    const t = clock();
    await s.ingest(hostPoints(97), t(0).point);
    const [a, b] = await Promise.all([runHardwarePass(t(0).at), runHardwarePass(t(0).at)]);
    expect(a.opened + b.opened).toBe(1);
    expect(a.skipped + b.skipped).toBe(1);
    expect(await s.incidents()).toHaveLength(1);
    expect(notifyMock).toHaveBeenCalledTimes(1);
  });

  it('saveEvaluation refuses a stale expected status', async () => {
    const s = await setup();
    const result = evaluateHost({ latest: [], history: [], now: new Date(), lastSeenAt: new Date() });
    expect(await saveEvaluation({ id: s.hostId, organizationId: s.orgId }, 'critical', result, new Date())).toBe(false);
    expect(await saveEvaluation({ id: s.hostId, organizationId: s.orgId }, 'unknown', result, new Date())).toBe(true);
    // Another organization cannot write the row.
    const other = await createTestContext();
    expect(await saveEvaluation({ id: s.hostId, organizationId: other.organization.id }, result.status, result, new Date())).toBe(false);
  });

  it('muted hosts are evaluated and persisted but never open incidents or notify', async () => {
    const s = await setup();
    await db.updateTable('hardware_hosts').set({ muted: true }).where('id', '=', s.hostId).where('organization_id', '=', s.orgId).execute();
    const t = clock();
    await s.ingest(hostPoints(97), t(0).point);
    await runHardwarePass(t(0).at);
    const row = await s.row();
    expect(row.status).toBe('critical');
    expect((row.findings as unknown[]).length).toBeGreaterThan(0);
    expect(row.last_evaluated_at!.getTime()).toBe(t(0).at.getTime());
    expect(await s.incidents()).toHaveLength(0);
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it('a muted host back to ok resolves its incident silently', async () => {
    const s = await setup();
    const t = clock();
    await s.ingest(hostPoints(97), t(0).point);
    await runHardwarePass(t(0).at);
    expect(notifyMock).toHaveBeenCalledTimes(1);
    await db.updateTable('hardware_hosts').set({ muted: true }).where('id', '=', s.hostId).where('organization_id', '=', s.orgId).execute();
    await s.ingest(hostPoints(45), t(1).point);
    await runHardwarePass(t(1).at);
    expect((await s.incidents())[0].status).toBe('resolved');
    expect(notifyMock).toHaveBeenCalledTimes(1);
  });

  it('going stale does nothing; coming back with the same problem does not notify again', async () => {
    const s = await setup();
    const t = clock();
    await s.ingest(hostPoints(97), t(0).point);
    await runHardwarePass(t(0).at);
    expect(notifyMock).toHaveBeenCalledTimes(1);

    // 20 minutes without data: stale, the incident stays open.
    const later = new Date(t(0).at.getTime() + 20 * MIN);
    await runHardwarePass(later);
    expect((await s.row()).status).toBe('stale');
    expect((await s.incidents())[0].status).toBe('open');
    expect(notifyMock).toHaveBeenCalledTimes(1);

    // Back, still critical: reconciled against the open incident, no new notification.
    await s.ingest(hostPoints(97), new Date(later.getTime() + MIN));
    await runHardwarePass(new Date(later.getTime() + 2 * MIN));
    expect((await s.row()).status).toBe('critical');
    expect(await s.incidents()).toHaveLength(1);
    expect(notifyMock).toHaveBeenCalledTimes(1);
  });

  it('a stale host without an incident that comes back critical opens one', async () => {
    const s = await setup();
    await db.updateTable('hardware_hosts').set({ status: 'stale' }).where('id', '=', s.hostId).where('organization_id', '=', s.orgId).execute();
    const t = clock();
    await s.ingest(hostPoints(97), t(0).point);
    await runHardwarePass(t(0).at);
    expect(await s.incidents()).toHaveLength(1);
    expect(notifyMock).toHaveBeenCalledTimes(1);
  });

  it('skips hosts of soft-deleted projects and hosts not seen for over 24 h', async () => {
    const s = await setup();
    await db
      .updateTable('hardware_hosts')
      .set({ last_seen_at: new Date(Date.now() - 25 * 60 * MIN), status: 'ok' })
      .where('id', '=', s.hostId)
      .where('organization_id', '=', s.orgId)
      .execute();
    const r = await runHardwarePass(new Date());
    expect(r.evaluated).toBe(0);
  });
});
