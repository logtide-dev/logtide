import { describe, it, expect, vi, afterEach } from 'vitest';
import crypto from 'crypto';
import { db } from '../../../database/index.js';
import {
  incidentsService,
  IncidentsService,
  IncidentError,
  planStatusChange,
  higherSeverity,
  type OpenOrUpdateFromSourceInput,
} from '../../../modules/incidents/index.js';
import { incidentNotificationQueue } from '../../../queue/jobs/incident-notification.js';
import { createTestContext, createTestAlertRule } from '../../helpers/factories.js';
import { createTestMonitor } from './fixtures.js';

const t1 = new Date('2026-10-21T10:00:00.000Z');
const t2 = new Date('2026-10-21T10:05:00.000Z');
const t3 = new Date('2026-10-21T10:10:00.000Z');

async function setup() {
  const ctx = await createTestContext();
  const orgId = ctx.organization.id;
  const rule = await createTestAlertRule({ organizationId: orgId, projectId: ctx.project.id, name: 'High errors' });
  const monitor = await createTestMonitor({ organizationId: orgId, projectId: ctx.project.id, name: 'API health' });

  const alertInput = (o: Partial<OpenOrUpdateFromSourceInput> = {}): OpenOrUpdateFromSourceInput => ({
    organizationId: orgId,
    projectId: ctx.project.id,
    source: 'alert',
    sourceId: rule.id,
    title: 'High errors is firing',
    description: 'More than 10 errors in 5 minutes',
    severity: 'high',
    occurredAt: t1,
    ...o,
  });
  const monitorInput = (o: Partial<OpenOrUpdateFromSourceInput> = {}): OpenOrUpdateFromSourceInput => ({
    organizationId: orgId,
    projectId: ctx.project.id,
    source: 'monitor',
    sourceId: monitor.id,
    title: 'API health is down',
    severity: 'critical',
    occurredAt: t1,
    ...o,
  });

  return { ...ctx, orgId, rule, monitor, alertInput, monitorInput };
}

async function activeRows(orgId: string, column: 'alert_rule_id' | 'monitor_id', sourceId: string) {
  return db
    .selectFrom('incidents')
    .selectAll()
    .where('organization_id', '=', orgId)
    .where(column, '=', sourceId)
    .where('status', 'in', ['open', 'investigating'])
    .execute();
}

describe('IncidentsService source lifecycle', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('opens an alert incident with created true and a created history row', async () => {
    const s = await setup();
    const r = await incidentsService.openOrUpdateFromSource(s.alertInput({ occurredAt: t1, metadata: { logCount: 12 } }));

    expect(r.created).toBe(true);
    expect(r.incident).toMatchObject({
      source: 'alert',
      alertRuleId: s.rule.id,
      monitorId: null,
      status: 'open',
      lastEventAt: t1,
      timeWindowStart: t1,
      timeWindowEnd: t1,
      title: 'High errors is firing',
      description: 'More than 10 errors in 5 minutes',
      severity: 'high',
      projectId: s.project.id,
      organizationId: s.orgId,
    });

    const history = (await incidentsService.listHistory(r.incident.id, s.orgId))!;
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      action: 'created',
      userId: null,
      metadata: { source: 'alert', sourceId: s.rule.id, occurredAt: t1.toISOString(), data: { logCount: 12 } },
    });
  });

  it('updates the active incident on the next trigger', async () => {
    const s = await setup();
    const first = await incidentsService.openOrUpdateFromSource(s.alertInput({ occurredAt: t1, severity: 'high' }));
    const second = await incidentsService.openOrUpdateFromSource(
      s.alertInput({ occurredAt: t2, severity: 'critical', title: 'Another title', description: 'Another description' })
    );

    expect(second.created).toBe(false);
    expect(second.incident.id).toBe(first.incident.id);
    expect(second.incident).toMatchObject({
      lastEventAt: t2,
      timeWindowStart: t1,
      timeWindowEnd: t2,
      severity: 'critical',
      title: first.incident.title,
      description: first.incident.description,
      status: 'open',
    });

    const history = (await incidentsService.listHistory(first.incident.id, s.orgId))!;
    expect(history.filter((h) => h.action === 'source_event')).toHaveLength(1);
    expect(history.filter((h) => h.action === 'created')).toHaveLength(1);
    expect(history.find((h) => h.action === 'source_event')).toMatchObject({
      userId: null,
      metadata: { source: 'alert', sourceId: s.rule.id, occurredAt: t2.toISOString(), data: null },
    });

    const events = await incidentsService.listSourceEvents(first.incident.id, s.orgId);
    expect(events!.map((e) => [e.kind, e.time])).toEqual([
      ['alert_trigger', t2.toISOString()],
      ['alert_trigger', t1.toISOString()],
    ]);
  });

  it('never moves last_event_at backwards or downgrades severity', async () => {
    const s = await setup();
    const first = await incidentsService.openOrUpdateFromSource(s.alertInput({ occurredAt: t2, severity: 'high' }));
    const second = await incidentsService.openOrUpdateFromSource(s.alertInput({ occurredAt: t1, severity: 'low' }));

    expect(second.created).toBe(false);
    expect(second.incident.id).toBe(first.incident.id);
    expect(second.incident).toMatchObject({ lastEventAt: t2, timeWindowEnd: t2, severity: 'high' });
  });

  it('keeps an acknowledged incident acknowledged on retrigger', async () => {
    const s = await setup();
    const first = await incidentsService.openOrUpdateFromSource(s.alertInput());
    const acked = await incidentsService.acknowledge(first.incident.id, s.orgId, s.user.id);

    const again = await incidentsService.openOrUpdateFromSource(s.alertInput({ occurredAt: t2 }));
    expect(again.created).toBe(false);
    expect(again.incident).toMatchObject({
      id: first.incident.id,
      status: 'investigating',
      acknowledgedBy: s.user.id,
    });
    expect(new Date(again.incident.acknowledgedAt!).getTime()).toBe(new Date(acked!.acknowledgedAt!).getTime());
  });

  it('concurrent calls create exactly one incident', async () => {
    const s = await setup();
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        incidentsService.openOrUpdateFromSource(s.monitorInput({ occurredAt: new Date(t1.getTime() + i * 1000) }))
      )
    );

    expect(results.filter((r) => r.created)).toHaveLength(1);
    expect(new Set(results.map((r) => r.incident.id)).size).toBe(1);
    const rows = await activeRows(s.orgId, 'monitor_id', s.monitor.id);
    expect(rows).toHaveLength(1);
    expect(new Date(rows[0].last_event_at).getTime()).toBe(t1.getTime() + 4000);

    const history = (await incidentsService.listHistory(rows[0].id, s.orgId))!;
    expect(history.filter((h) => h.action === 'created')).toHaveLength(1);
    expect(history.filter((h) => h.action === 'source_event')).toHaveLength(4);
  });

  it('does not enqueue an incident notification', async () => {
    const s = await setup();
    const spy = vi.spyOn(incidentNotificationQueue, 'add');
    await incidentsService.openOrUpdateFromSource(s.alertInput());
    await incidentsService.openOrUpdateFromSource(s.alertInput({ occurredAt: t2 }));
    await incidentsService.openOrUpdateFromSource(s.monitorInput());
    await incidentsService.resolveFromSource({
      organizationId: s.orgId,
      source: 'monitor',
      sourceId: s.monitor.id,
      resolvedAt: t3,
      reason: 'recovered',
    });
    expect(spy).not.toHaveBeenCalled();
  });

  it('opens a new incident after the previous one was resolved by hand', async () => {
    const s = await setup();
    const first = await incidentsService.openOrUpdateFromSource(s.alertInput());
    await incidentsService.update(first.incident.id, s.orgId, { status: 'resolved' }, s.user.id);

    const next = await incidentsService.openOrUpdateFromSource(s.alertInput({ occurredAt: t2 }));
    expect(next.created).toBe(true);
    expect(next.incident.id).not.toBe(first.incident.id);
    expect(next.incident.status).toBe('open');

    const old = await incidentsService.getItem(first.incident.id, s.orgId);
    expect(old!.status).toBe('resolved');
  });

  it('rejects a source that belongs to another organization', async () => {
    const a = await setup();
    const b = await setup();

    await expect(
      incidentsService.openOrUpdateFromSource(a.alertInput({ sourceId: b.rule.id }))
    ).rejects.toMatchObject({ code: 'source_not_found', statusCode: 404, message: 'Incident source not found' });
    await expect(
      incidentsService.openOrUpdateFromSource(a.monitorInput({ sourceId: b.monitor.id }))
    ).rejects.toMatchObject({ code: 'source_not_found' });
    await expect(
      incidentsService.openOrUpdateFromSource(a.alertInput({ sourceId: crypto.randomUUID() }))
    ).rejects.toMatchObject({ code: 'source_not_found' });
    await expect(
      incidentsService.openOrUpdateFromSource(a.alertInput({ sourceId: 'not-a-uuid' }))
    ).rejects.toMatchObject({ code: 'source_not_found' });
    // an alert rule id passed as a monitor source does not resolve either
    await expect(
      incidentsService.openOrUpdateFromSource(a.monitorInput({ sourceId: a.rule.id }))
    ).rejects.toMatchObject({ code: 'source_not_found' });

    const rowsA = await db.selectFrom('incidents').select('id').where('organization_id', '=', a.orgId).execute();
    const rowsB = await db.selectFrom('incidents').select('id').where('organization_id', '=', b.orgId).execute();
    expect(rowsA).toHaveLength(0);
    expect(rowsB).toHaveLength(0);
  });

  it('rejects a project of another organization', async () => {
    const a = await setup();
    const b = await setup();
    await expect(
      incidentsService.openOrUpdateFromSource(a.alertInput({ projectId: b.project.id }))
    ).rejects.toMatchObject({ code: 'source_not_found' });
    const rows = await db.selectFrom('incidents').select('id').where('organization_id', '=', a.orgId).execute();
    expect(rows).toHaveLength(0);

    const orgWide = await incidentsService.openOrUpdateFromSource(a.alertInput({ projectId: null }));
    expect(orgWide.incident.projectId).toBeNull();
  });

  it('stores monitor ids in monitor_id and alert ids in alert_rule_id', async () => {
    const s = await setup();
    const mon1 = await incidentsService.openOrUpdateFromSource(s.monitorInput());
    const mon2 = await incidentsService.openOrUpdateFromSource(s.monitorInput({ occurredAt: t2 }));
    const al1 = await incidentsService.openOrUpdateFromSource(s.alertInput());
    const al2 = await incidentsService.openOrUpdateFromSource(s.alertInput({ occurredAt: t2 }));

    for (const r of [mon1, mon2]) {
      expect(r.incident).toMatchObject({ source: 'monitor', monitorId: s.monitor.id, alertRuleId: null });
    }
    for (const r of [al1, al2]) {
      expect(r.incident).toMatchObject({ source: 'alert', alertRuleId: s.rule.id, monitorId: null });
    }
    expect(mon2.created).toBe(false);
    expect(al2.created).toBe(false);

    const item = await incidentsService.getItem(mon2.incident.id, s.orgId);
    expect(item!.sourceRef).toEqual({ kind: 'monitor', id: s.monitor.id, name: 'API health' });
  });

  it('resolveFromSource resolves the active incident with the given time and reason', async () => {
    const s = await setup();
    const opened = await incidentsService.openOrUpdateFromSource(s.monitorInput());

    const resolved = await incidentsService.resolveFromSource({
      organizationId: s.orgId,
      source: 'monitor',
      sourceId: s.monitor.id,
      resolvedAt: t3,
      reason: 'recovered',
    });
    expect(resolved).toMatchObject({ id: opened.incident.id, status: 'resolved', resolvedAt: t3, resolvedBy: null });

    const history = (await incidentsService.listHistory(resolved!.id, s.orgId))!;
    expect(history[0]).toMatchObject({
      action: 'status_change',
      newValue: 'resolved',
      userId: null,
      metadata: { reason: 'recovered' },
    });
  });

  it('resolveFromSource returns null when nothing is active and is idempotent', async () => {
    const s = await setup();
    const input = {
      organizationId: s.orgId,
      source: 'alert' as const,
      sourceId: s.rule.id,
      resolvedAt: t3,
      reason: 'manual' as const,
    };
    expect(await incidentsService.resolveFromSource(input)).toBeNull();

    await incidentsService.openOrUpdateFromSource(s.alertInput());
    const first = await incidentsService.resolveFromSource(input);
    expect(first).toMatchObject({ status: 'resolved' });
    expect(await incidentsService.resolveFromSource(input)).toBeNull();

    const history = (await incidentsService.listHistory(first!.id, s.orgId))!;
    expect(history.filter((h) => h.action === 'status_change')).toHaveLength(1);
    expect(history.find((h) => h.action === 'status_change')!.metadata).toEqual({ reason: 'manual' });
    expect(await incidentsService.resolveFromSource({ ...input, sourceId: 'not-a-uuid' })).toBeNull();
  });

  it('resolveFromSource also resolves an acknowledged incident', async () => {
    const s = await setup();
    const opened = await incidentsService.openOrUpdateFromSource(s.alertInput());
    await incidentsService.acknowledge(opened.incident.id, s.orgId, s.user.id);

    const resolved = await incidentsService.resolveFromSource({
      organizationId: s.orgId,
      source: 'alert',
      sourceId: s.rule.id,
      resolvedAt: t3,
      reason: 'recovered',
    });
    expect(resolved).toMatchObject({ id: opened.incident.id, status: 'resolved', acknowledgedBy: s.user.id });
  });

  it('resolveFromSource does not touch another organization', async () => {
    const a = await setup();
    const b = await setup();
    const openedB = await incidentsService.openOrUpdateFromSource(b.monitorInput());

    expect(
      await incidentsService.resolveFromSource({
        organizationId: a.orgId,
        source: 'monitor',
        sourceId: b.monitor.id,
        resolvedAt: t3,
        reason: 'recovered',
      })
    ).toBeNull();
    const rowB = await incidentsService.getItem(openedB.incident.id, b.orgId);
    expect(rowB!.status).toBe('open');
  });

  it('the barrel exposes the contract and typed errors', () => {
    expect(incidentsService).toBeInstanceOf(IncidentsService);
    expect(typeof incidentsService.openOrUpdateFromSource).toBe('function');
    expect(typeof incidentsService.resolveFromSource).toBe('function');
    expect(typeof incidentsService.acknowledge).toBe('function');
    expect(typeof planStatusChange).toBe('function');
    expect(higherSeverity('low', 'high')).toBe('high');
    const err = new IncidentError('invalid_transition', 'x');
    expect(err).toBeInstanceOf(Error);
    expect(err.statusCode).toBe(409);
    expect(err.code).toBe('invalid_transition');
    expect(new IncidentError('invalid_assignee', 'x').statusCode).toBe(400);
    expect(new IncidentError('source_not_found', 'x').statusCode).toBe(404);
  });
});
