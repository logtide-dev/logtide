import { describe, it, expect } from 'vitest';
import { db } from '../../../database/index.js';
import { incidentsService, IncidentError, type OpenOrUpdateFromSourceInput } from '../../../modules/incidents/index.js';
import { createTestContext } from '../../helpers/factories.js';

const t1 = new Date('2026-11-10T10:00:00.000Z');
const t2 = new Date('2026-11-10T10:02:00.000Z');
const t3 = new Date('2026-11-10T10:04:00.000Z');

async function createHost(organizationId: string, projectId: string, hostName = 'srv-1') {
  return db
    .insertInto('hardware_hosts')
    .values({ organization_id: organizationId, project_id: projectId, host_name: hostName })
    .returning(['id', 'host_name'])
    .executeTakeFirstOrThrow();
}

async function setup() {
  const ctx = await createTestContext();
  const orgId = ctx.organization.id;
  const host = await createHost(orgId, ctx.project.id);
  const input = (o: Partial<OpenOrUpdateFromSourceInput> = {}): OpenOrUpdateFromSourceInput => ({
    organizationId: orgId,
    projectId: ctx.project.id,
    source: 'hardware',
    sourceId: host.id,
    title: 'Hardware warning: srv-1',
    description: 'Disk sda has 8 reallocated sectors',
    severity: 'medium',
    occurredAt: t1,
    metadata: { status: 'warning', link: `/dashboard/hardware/${host.id}` },
    ...o,
  });
  return { ...ctx, orgId, host, input };
}

describe('IncidentsService hardware source', () => {
  it('opens a hardware incident linked to the host, with a hardware sourceRef', async () => {
    const s = await setup();
    const r = await incidentsService.openOrUpdateFromSource(s.input());
    expect(r.created).toBe(true);
    expect(r.incident).toMatchObject({
      source: 'hardware',
      hardwareHostId: s.host.id,
      monitorId: null,
      alertRuleId: null,
      severity: 'medium',
      status: 'open',
    });

    const item = await incidentsService.getItem(r.incident.id, s.orgId);
    expect(item!.sourceRef).toEqual({ kind: 'hardware', id: s.host.id, name: 'srv-1' });

    const events = await incidentsService.listSourceEvents(r.incident.id, s.orgId);
    expect(events).toHaveLength(1);
    expect(events![0]).toMatchObject({ kind: 'hardware_check', summary: 'Hardware health changed' });
  });

  it('updates the same active incident and escalates its severity', async () => {
    const s = await setup();
    const a = await incidentsService.openOrUpdateFromSource(s.input());
    const b = await incidentsService.openOrUpdateFromSource(s.input({ occurredAt: t2, severity: 'critical' }));
    expect(b.created).toBe(false);
    expect(b.incident.id).toBe(a.incident.id);
    expect(b.incident.severity).toBe('critical');
  });

  it('rejects a host of another organization', async () => {
    const s = await setup();
    const other = await createTestContext();
    const foreign = await createHost(other.organization.id, other.project.id, 'foreign');
    await expect(incidentsService.openOrUpdateFromSource(s.input({ sourceId: foreign.id }))).rejects.toBeInstanceOf(IncidentError);
  });

  it('setSeverityFromSource de-escalates the active incident and is a no-op when equal', async () => {
    const s = await setup();
    const opened = await incidentsService.openOrUpdateFromSource(s.input({ severity: 'critical' }));
    const lowered = await incidentsService.setSeverityFromSource({
      organizationId: s.orgId,
      source: 'hardware',
      sourceId: s.host.id,
      severity: 'medium',
    });
    expect(lowered).toMatchObject({ id: opened.incident.id, severity: 'medium' });
    expect(
      await incidentsService.setSeverityFromSource({ organizationId: s.orgId, source: 'hardware', sourceId: s.host.id, severity: 'medium' })
    ).toBeNull();

    const history = (await incidentsService.listHistory(opened.incident.id, s.orgId))!;
    expect(history.find((h) => h.action === 'severity_change')).toMatchObject({
      oldValue: 'critical',
      newValue: 'medium',
      userId: null,
    });
  });

  it('setSeverityFromSource does not touch another organization', async () => {
    const s = await setup();
    await incidentsService.openOrUpdateFromSource(s.input({ severity: 'critical' }));
    const other = await createTestContext();
    expect(
      await incidentsService.setSeverityFromSource({ organizationId: other.organization.id, source: 'hardware', sourceId: s.host.id, severity: 'medium' })
    ).toBeNull();
  });

  it('resolveFromSource resolves the hardware incident; a new transition opens a new one', async () => {
    const s = await setup();
    const opened = await incidentsService.openOrUpdateFromSource(s.input());
    const resolved = await incidentsService.resolveFromSource({
      organizationId: s.orgId,
      source: 'hardware',
      sourceId: s.host.id,
      resolvedAt: t3,
      reason: 'recovered',
    });
    expect(resolved).toMatchObject({ id: opened.incident.id, status: 'resolved' });
    const again = await incidentsService.openOrUpdateFromSource(s.input({ occurredAt: t3 }));
    expect(again.created).toBe(true);
    expect(again.incident.id).not.toBe(opened.incident.id);
  });

  it('keeps the incident when the host is deleted, with no sourceRef', async () => {
    const s = await setup();
    const opened = await incidentsService.openOrUpdateFromSource(s.input());
    await db.deleteFrom('hardware_hosts').where('id', '=', s.host.id).where('organization_id', '=', s.orgId).execute();
    const item = await incidentsService.getItem(opened.incident.id, s.orgId);
    expect(item).toMatchObject({ source: 'hardware', hardwareHostId: null, sourceRef: null });
  });
});
