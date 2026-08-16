import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest';
import { db } from '../../../database/index.js';
import { reservoir, reservoirReady } from '../../../database/reservoir.js';
import { getUsageBreakdown } from '../../../modules/metering/breakdown.js';
import { createTestContext, createTestProject } from '../../helpers/factories.js';

describe('getUsageBreakdown', () => {
  let orgId: string;
  let proj1: { id: string; name: string };
  let proj2: { id: string; name: string };

  beforeAll(async () => {
    await reservoirReady;
  });

  beforeEach(async () => {
    const ctx = await createTestContext();
    orgId = ctx.organization.id;
    proj1 = { id: ctx.project.id, name: ctx.project.name };
    const p2 = await createTestProject({ organizationId: orgId });
    proj2 = { id: p2.id, name: p2.name };

    await db.deleteFrom('metering_events').where('organization_id', '=', orgId).execute();
    await db.deleteFrom('logs').where('project_id', 'in', [proj1.id, proj2.id]).execute();

    // metering: project1 = 100 events / 3000 bytes; project2 = 50 events / 1500 bytes
    await db.insertInto('metering_events').values([
      { time: new Date(), organization_id: orgId, project_id: proj1.id, type: 'logs.ingested.events', quantity: 100, metadata: null },
      { time: new Date(), organization_id: orgId, project_id: proj1.id, type: 'logs.ingested.bytes', quantity: 3000, metadata: null },
      { time: new Date(), organization_id: orgId, project_id: proj2.id, type: 'logs.ingested.events', quantity: 50, metadata: null },
      { time: new Date(), organization_id: orgId, project_id: proj2.id, type: 'logs.ingested.bytes', quantity: 1500, metadata: null },
    ]).execute();

    // logs: project1 -> 3x api/info + 1x api/error ; project2 -> 2x web/info
    const now = new Date();
    const mkLog = (projectId: string, service: string, level: string) => ({
      project_id: projectId, service, level: level as any, message: 'm', time: now,
    });
    await db.insertInto('logs').values([
      mkLog(proj1.id, 'api', 'info'),
      mkLog(proj1.id, 'api', 'info'),
      mkLog(proj1.id, 'api', 'info'),
      mkLog(proj1.id, 'api', 'error'),
      mkLog(proj2.id, 'web', 'info'),
      mkLog(proj2.id, 'web', 'info'),
    ] as any).execute();
  });

  it('breaks down by metering type', async () => {
    const b = await getUsageBreakdown({
      organizationId: orgId,
      from: new Date(Date.now() - 60 * 60 * 1000),
      to: new Date(Date.now() + 5 * 60 * 1000),
    });

    const byType = Object.fromEntries(b.byType.map((t) => [t.type, t.quantity]));
    expect(byType['logs.ingested.events']).toBe(150);
    expect(byType['logs.ingested.bytes']).toBe(4500);
  });

  it('breaks down by project with names, sorted by events desc', async () => {
    const b = await getUsageBreakdown({
      organizationId: orgId,
      from: new Date(Date.now() - 60 * 60 * 1000),
      to: new Date(Date.now() + 5 * 60 * 1000),
    });

    expect(b.byProject).toHaveLength(2);
    expect(b.byProject[0]).toMatchObject({ projectId: proj1.id, projectName: proj1.name, events: 100, bytes: 3000 });
    expect(b.byProject[1]).toMatchObject({ projectId: proj2.id, projectName: proj2.name, events: 50, bytes: 1500 });
  });

  it('breaks down ingested logs by service and by level', async () => {
    const b = await getUsageBreakdown({
      organizationId: orgId,
      from: new Date(Date.now() - 60 * 60 * 1000),
      to: new Date(Date.now() + 5 * 60 * 1000),
    });

    const svc = Object.fromEntries(b.byService.map((s) => [s.value, s.count]));
    expect(svc['api']).toBe(4);
    expect(svc['web']).toBe(2);
    expect(b.byService[0].value).toBe('api'); // sorted desc

    const lvl = Object.fromEntries(b.byLevel.map((l) => [l.value, l.count]));
    expect(lvl['info']).toBe(5);
    expect(lvl['error']).toBe(1);
  });

  it('issues the per-project topValues queries by default', async () => {
    const spy = vi.spyOn(reservoir, 'topValues');

    try {
      await getUsageBreakdown({
        organizationId: orgId,
        from: new Date(Date.now() - 60 * 60 * 1000),
        to: new Date(Date.now() + 5 * 60 * 1000),
      });

      // two projects x (service + level)
      expect(spy).toHaveBeenCalledTimes(4);
    } finally {
      spy.mockRestore();
    }
  });

  it('skips the reservoir entirely when includeValueBreakdowns is false', async () => {
    const spy = vi.spyOn(reservoir, 'topValues');

    try {
      const b = await getUsageBreakdown({
        organizationId: orgId,
        from: new Date(Date.now() - 60 * 60 * 1000),
        to: new Date(Date.now() + 5 * 60 * 1000),
        includeValueBreakdowns: false,
      });

      expect(spy).not.toHaveBeenCalled();
      expect(b.byService).toEqual([]);
      expect(b.byLevel).toEqual([]);

      // the metering-backed halves are unaffected
      const byType = Object.fromEntries(b.byType.map((t) => [t.type, t.quantity]));
      expect(byType['logs.ingested.events']).toBe(150);
      expect(byType['logs.ingested.bytes']).toBe(4500);
      expect(b.byProject).toHaveLength(2);
      expect(b.byProject[0]).toMatchObject({ projectId: proj1.id, events: 100 });
    } finally {
      spy.mockRestore();
    }
  });
});
