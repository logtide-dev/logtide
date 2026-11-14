import { describe, it, expect, beforeEach, vi } from 'vitest';
import { db } from '../../../database/index.js';
import { createTestContext } from '../../helpers/factories.js';
import { metricsService } from '../../../modules/metrics/service.js';
import { HARDWARE_HISTORY_SERIES } from '@logtide/shared';
import { reservoir } from '../../../database/reservoir.js';
import { hwRecords, healthyPoints, type HwPoint } from './helpers.js';

const { notifyMock, pdResolveMock } = vi.hoisted(() => ({ notifyMock: vi.fn(), pdResolveMock: vi.fn() }));
vi.mock('../../../modules/hardware/notifier.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../modules/hardware/notifier.js')>();
  return { ...actual, notifyHardware: notifyMock, resolveHardwarePagerDuty: pdResolveMock };
});

// The tests drive last_seen_at themselves: the fire-and-forget registration
// of the ingest path (server clock) would race with it.
vi.mock('../../../modules/hardware/registry.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../modules/hardware/registry.js')>();
  return { ...actual, registerHardwareHosts: vi.fn(async () => []) };
});

import { runHardwarePass } from '../../../modules/hardware/evaluation.js';
import { loadProjectHardwareData } from '../../../modules/hardware/loader.js';
import { saveHostState, setHostMuted } from '../../../modules/hardware/repository.js';
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
  const update = (values: Record<string, unknown>) =>
    db.updateTable('hardware_hosts').set(values).where('id', '=', host.id).where('organization_id', '=', orgId).execute();

  // A pass `minute` minutes after the base, with the CPU at `temp` reported 30 s before.
  const base = Date.now() - 3 * 60 * MIN;
  const at = (minute: number) => new Date(base + minute * MIN);
  const step = async (minute: number, temp: number) => {
    await ingest(hostPoints(temp), new Date(at(minute).getTime() - 30_000));
    return runHardwarePass(at(minute));
  };
  const status = async () => (await row()).status;
  return { ctx, orgId, projectId, hostId: host.id, ingest, row, incidents, update, at, step, status };
}

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

describe('runHardwarePass state machine', () => {
  beforeEach(() => {
    notifyMock.mockReset().mockResolvedValue(undefined);
    pdResolveMock.mockReset().mockResolvedValue(undefined);
  });

  it('debounces: opens after 2 passes and 3 minutes, escalates, de-escalates and recovers after 10 minutes', async () => {
    const s = await setup();

    await s.step(0, 45);
    expect(await s.status()).toBe('ok');

    // ok -> warning: pending first, effective once it held 3 minutes.
    await s.step(2, 88);
    expect(await s.row()).toMatchObject({ status: 'ok', pending_status: 'warning' });
    await s.step(4, 88);
    expect(await s.status()).toBe('ok');
    expect(await s.incidents()).toHaveLength(0);
    await s.step(6, 88);
    let row = await s.row();
    expect(row).toMatchObject({ status: 'warning', pending_status: null, pending_since: null });
    expect(row.status_changed_at.getTime()).toBe(s.at(6).getTime());
    expect(row.episode_started_at?.getTime()).toBe(s.at(6).getTime());
    let incidents = await s.incidents();
    expect(incidents).toHaveLength(1);
    expect(incidents[0]).toMatchObject({ source: 'hardware', severity: 'medium', status: 'open', title: 'Hardware warning: srv-1', project_id: s.projectId });
    expect(incidents[0].description).toContain('CPU sensor');
    expect(row.episode_incident_id).toBe(incidents[0].id);
    expect(notifyMock).toHaveBeenCalledTimes(1);
    expect(notifyMock.mock.calls[0][1]).toMatchObject({ kind: 'degraded', status: 'warning', previousStatus: 'ok', incidentId: incidents[0].id });
    expect(row.is_virtual).toBe(false);
    expect((row.info as Record<string, unknown>).vendor).toBe('Supermicro');

    // warning -> critical: same incident escalated and retitled, notify.
    await s.step(8, 97);
    expect(await s.status()).toBe('warning');
    await s.step(11, 97);
    expect(await s.status()).toBe('critical');
    incidents = await s.incidents();
    expect(incidents).toHaveLength(1);
    expect(incidents[0]).toMatchObject({ severity: 'critical', title: 'Hardware critical: srv-1' });
    expect(notifyMock).toHaveBeenCalledTimes(2);
    expect(notifyMock.mock.calls[1][1]).toMatchObject({ kind: 'degraded', status: 'critical', previousStatus: 'warning' });

    // critical -> warning after 10 minutes: severity lowered, no notification.
    await s.step(13, 88);
    await s.step(19, 88);
    expect(await s.status()).toBe('critical');
    await s.step(23, 88);
    expect(await s.status()).toBe('warning');
    incidents = await s.incidents();
    expect(incidents[0]).toMatchObject({ severity: 'medium', title: 'Hardware warning: srv-1', status: 'open' });
    expect(notifyMock).toHaveBeenCalledTimes(2);

    // -> ok after 10 minutes: resolved + recovered notification, episode closed.
    await s.step(25, 45);
    await s.step(31, 45);
    expect(await s.status()).toBe('warning');
    await s.step(35, 45);
    row = await s.row();
    expect(row).toMatchObject({ status: 'ok', episode_started_at: null, episode_incident_id: null });
    incidents = await s.incidents();
    expect(incidents[0].status).toBe('resolved');
    expect(notifyMock).toHaveBeenCalledTimes(3);
    expect(notifyMock.mock.calls[2][1]).toMatchObject({ kind: 'recovered', status: 'ok', incidentId: incidents[0].id });
    // The recovered notification carries the PagerDuty resolve.
    expect(pdResolveMock).not.toHaveBeenCalled();
  });

  it('a single bad reading opens nothing', async () => {
    const s = await setup();
    await s.step(0, 45);
    await s.step(2, 97);
    await s.step(4, 45);
    await s.step(6, 45);
    expect(await s.row()).toMatchObject({ status: 'ok', pending_status: null });
    expect(await s.incidents()).toHaveLength(0);
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it('a repeated pass with the same data is a no-op (idempotent)', async () => {
    const s = await setup();
    await s.step(0, 97);
    await s.step(3, 97);
    await runHardwarePass(new Date(s.at(3).getTime() + 1000));
    await s.step(5, 97);
    expect(await s.incidents()).toHaveLength(1);
    expect(notifyMock).toHaveBeenCalledTimes(1);
  });

  it('two concurrent passes act once (compare-and-set)', async () => {
    const s = await setup();
    await s.update({ status: 'ok', pending_status: 'critical', pending_since: s.at(-5) });
    await s.ingest(hostPoints(97), new Date(s.at(0).getTime() - 30_000));
    const [a, b] = await Promise.all([runHardwarePass(s.at(0)), runHardwarePass(s.at(0))]);
    expect(a.opened + b.opened).toBe(1);
    expect(a.skipped + b.skipped).toBe(1);
    expect(await s.incidents()).toHaveLength(1);
    expect(notifyMock).toHaveBeenCalledTimes(1);
  });

  it('saveHostState refuses a host changed since it was read, and other organizations', async () => {
    const s = await setup();
    const result = evaluateHost({ latest: [], history: [], now: new Date(), lastSeenAt: new Date() });
    const read = { id: s.hostId, organizationId: s.orgId, status: 'unknown' as const, lastEvaluatedAt: null, muted: false, episodeStartedAt: null };
    const patch = { status: result.status, pendingStatus: null, pendingSince: null, episodeStartedAt: null, episodeIncidentId: null, snapshot: result };
    expect(await saveHostState({ ...read, status: 'critical' }, patch, new Date())).toBe(false);
    expect(await saveHostState({ ...read, muted: true }, patch, new Date())).toBe(false);
    const other = await createTestContext();
    expect(await saveHostState({ ...read, organizationId: other.organization.id }, patch, new Date())).toBe(false);
    expect(await saveHostState(read, patch, new Date())).toBe(true);
    // last_evaluated_at moved: the same read is now outdated.
    expect(await saveHostState(read, patch, new Date())).toBe(false);
  });

  it('muted hosts are evaluated and persisted but never open incidents or notify', async () => {
    const s = await setup();
    await s.update({ muted: true });
    await s.step(0, 97);
    await s.step(3, 97);
    const row = await s.row();
    expect(row.status).toBe('critical');
    expect((row.findings as unknown[]).length).toBeGreaterThan(0);
    expect(row.last_evaluated_at!.getTime()).toBe(s.at(3).getTime());
    expect(await s.incidents()).toHaveLength(0);
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it('a muted host back to ok resolves its incident silently but still resolves it on PagerDuty', async () => {
    const s = await setup();
    await s.step(0, 97);
    await s.step(3, 97);
    expect(notifyMock).toHaveBeenCalledTimes(1);
    const [incident] = await s.incidents();
    await s.update({ muted: true });
    await s.step(5, 45);
    await s.step(15, 45);
    expect(await s.status()).toBe('ok');
    expect((await s.incidents())[0].status).toBe('resolved');
    expect(notifyMock).toHaveBeenCalledTimes(1);
    expect(pdResolveMock).toHaveBeenCalledTimes(1);
    expect(pdResolveMock.mock.calls[0][1]).toBe(incident.id);
  });

  it('unmuting a degraded host starts a new episode: the next pass opens an incident and notifies', async () => {
    const s = await setup();
    await s.update({ muted: true });
    await s.step(0, 97);
    await s.step(3, 97);
    expect(await s.incidents()).toHaveLength(0);
    await setHostMuted(s.hostId, s.orgId, false);
    await s.step(5, 97);
    const incidents = await s.incidents();
    expect(incidents).toHaveLength(1);
    expect(notifyMock).toHaveBeenCalledTimes(1);
    expect((await s.row()).episode_incident_id).toBe(incidents[0].id);
  });

  it('a lost transition is caught up: a degraded host without incident gets one on the next pass', async () => {
    const s = await setup();
    // As if the pass that made it critical failed right after saving.
    await s.update({ status: 'critical', episode_started_at: s.at(-2) });
    await s.step(0, 97);
    expect(await s.incidents()).toHaveLength(1);
    expect(notifyMock).toHaveBeenCalledTimes(1);
    await s.step(2, 97);
    expect(await s.incidents()).toHaveLength(1);
    expect(notifyMock).toHaveBeenCalledTimes(1);
  });

  it('an incident resolved by hand is not reopened in the same episode; PagerDuty is resolved on recovery; a new degradation opens a new one', async () => {
    const s = await setup();
    await s.step(0, 97);
    await s.step(3, 97);
    const [first] = await s.incidents();
    await db.updateTable('incidents').set({ status: 'resolved', resolved_at: s.at(4) }).where('id', '=', first.id).where('organization_id', '=', s.orgId).execute();

    await s.step(5, 97);
    await s.step(7, 97);
    expect(await s.incidents()).toHaveLength(1);
    expect(notifyMock).toHaveBeenCalledTimes(1);

    // Recovery: nothing active to resolve, but the episode incident is resolved on PagerDuty.
    await s.step(9, 45);
    await s.step(19, 45);
    expect(await s.status()).toBe('ok');
    expect(notifyMock).toHaveBeenCalledTimes(1);
    expect(pdResolveMock).toHaveBeenCalledTimes(1);
    expect(pdResolveMock.mock.calls[0][1]).toBe(first.id);

    // Degrades again: new episode, new incident.
    await s.step(21, 97);
    await s.step(24, 97);
    const incidents = await s.incidents();
    expect(incidents).toHaveLength(2);
    expect(incidents[1].status).toBe('open');
    expect(notifyMock).toHaveBeenCalledTimes(2);
  });

  it('going stale keeps the snapshot and the incident; coming back with the same problem does not notify again', async () => {
    const s = await setup();
    await s.step(0, 97);
    await s.step(3, 97);
    expect(notifyMock).toHaveBeenCalledTimes(1);
    const before = await s.row();

    // 20 minutes without data: stale, only the status moves.
    await runHardwarePass(s.at(23));
    const stale = await s.row();
    expect(stale.status).toBe('stale');
    expect(stale.status_changed_at.getTime()).toBe(s.at(23).getTime());
    expect(stale.last_evaluated_at!.getTime()).toBe(s.at(23).getTime());
    expect(stale.components).toEqual(before.components);
    expect(stale.findings).toEqual(before.findings);
    expect(stale.info).toEqual(before.info);
    expect(stale.collectors).toEqual(before.collectors);
    expect((await s.incidents())[0].status).toBe('open');

    // Back, still critical: debounced, then reconciled against the open incident.
    await s.step(25, 97);
    expect(await s.status()).toBe('stale');
    await s.step(28, 97);
    expect(await s.status()).toBe('critical');
    expect(await s.incidents()).toHaveLength(1);
    expect(notifyMock).toHaveBeenCalledTimes(1);
  });

  it('a stale host without an incident that comes back critical opens one', async () => {
    const s = await setup();
    await s.update({ status: 'stale' });
    await s.step(0, 97);
    await s.step(3, 97);
    expect(await s.incidents()).toHaveLength(1);
    expect(notifyMock).toHaveBeenCalledTimes(1);
  });

  it('no point in the latest window while not stale is no new information', async () => {
    const s = await setup();
    await s.step(0, 97);
    await s.step(3, 97);
    const before = await s.row();
    // The registry saw the host (last_seen_at) but no point is in the window.
    await s.update({ last_seen_at: s.at(20) });
    await runHardwarePass(s.at(20));
    const after = await s.row();
    expect(after.status).toBe('critical');
    expect(after.components).toEqual(before.components);
    expect(after.findings).toEqual(before.findings);
    expect(after.last_evaluated_at!.getTime()).toBe(s.at(20).getTime());
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
