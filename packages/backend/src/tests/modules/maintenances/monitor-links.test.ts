import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { maintenanceRoutes } from '../../../modules/maintenances/routes.js';
import { createTestContext, createTestProject, createTestSession } from '../../helpers/index.js';

vi.mock('../../../queue/jobs/monitor-status-subscribers.js', () => ({
  enqueueStatusSubscriberNotification: vi.fn().mockResolvedValue(undefined),
}));
import { db } from '../../../database/index.js';

let app: FastifyInstance;
let ctx: Awaited<ReturnType<typeof createTestContext>>;
let token: string;

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

async function addMonitor(projectId = ctx.project.id, organizationId = ctx.organization.id) {
  const row = await db
    .insertInto('monitors')
    .values({ organization_id: organizationId, project_id: projectId, name: 'Mon', type: 'http', target: 'https://example.com' })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

function create(payload: Record<string, unknown> = {}) {
  return app.inject({
    method: 'POST',
    url: '/api/v1/maintenances',
    headers: auth(token),
    payload: {
      organizationId: ctx.organization.id,
      projectId: ctx.project.id,
      title: 'DB upgrade',
      scheduledStart: new Date(Date.now() + 3600_000).toISOString(),
      scheduledEnd: new Date(Date.now() + 7200_000).toISOString(),
      ...payload,
    },
  });
}

beforeAll(async () => {
  app = Fastify();
  await app.register(maintenanceRoutes, { prefix: '/api/v1/maintenances' });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  ctx = await createTestContext();
  token = (await createTestSession(ctx.user.id)).token;
});

describe('maintenances linked to monitors', () => {
  it('create stores monitorIds and list/detail return them', async () => {
    const a = await addMonitor();
    const res = await create({ monitorIds: [a] });
    expect(res.statusCode).toBe(201);
    const m = res.json().maintenance;
    expect(m.monitorIds).toEqual([a]);

    const list = await app.inject({
      method: 'GET',
      url: `/api/v1/maintenances?organizationId=${ctx.organization.id}&projectId=${ctx.project.id}`,
      headers: auth(token),
    });
    expect(list.json().maintenances[0].monitorIds).toEqual([a]);
    const detail = await app.inject({
      method: 'GET',
      url: `/api/v1/maintenances/${m.id}?organizationId=${ctx.organization.id}`,
      headers: auth(token),
    });
    expect(detail.json().maintenance.monitorIds).toEqual([a]);
  });

  it('create rejects monitors of another project or organization', async () => {
    const otherProject = await createTestProject({ organizationId: ctx.organization.id, userId: ctx.user.id });
    const foreign = await addMonitor(otherProject.id);
    const other = await createTestContext();
    const crossOrg = await addMonitor(other.project.id, other.organization.id);
    expect((await create({ monitorIds: [foreign] })).statusCode).toBe(400);
    expect((await create({ monitorIds: [crossOrg] })).statusCode).toBe(400);
    const rows = await db.selectFrom('scheduled_maintenances').select('id').where('project_id', '=', ctx.project.id).execute();
    expect(rows).toHaveLength(0);
  });

  it('update replaces monitorIds, keeps them when omitted and clears with []', async () => {
    const a = await addMonitor();
    const b = await addMonitor();
    const m = (await create({ monitorIds: [a] })).json().maintenance;
    const url = `/api/v1/maintenances/${m.id}?organizationId=${ctx.organization.id}`;

    const replaced = await app.inject({ method: 'PUT', url, headers: auth(token), payload: { monitorIds: [b] } });
    expect(replaced.json().maintenance.monitorIds).toEqual([b]);
    const kept = await app.inject({ method: 'PUT', url, headers: auth(token), payload: { title: 'Renamed' } });
    expect(kept.json().maintenance.monitorIds).toEqual([b]);
    const cleared = await app.inject({ method: 'PUT', url, headers: auth(token), payload: { monitorIds: [] } });
    expect(cleared.json().maintenance.monitorIds).toEqual([]);
  });

  it('update with a foreign monitor is 400 and keeps the previous links', async () => {
    const a = await addMonitor();
    const other = await createTestContext();
    const foreign = await addMonitor(other.project.id, other.organization.id);
    const m = (await create({ monitorIds: [a] })).json().maintenance;
    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/maintenances/${m.id}?organizationId=${ctx.organization.id}`,
      headers: auth(token),
      payload: { monitorIds: [foreign] },
    });
    expect(res.statusCode).toBe(400);
    const rows = await db.selectFrom('maintenance_monitors').select('monitor_id').where('maintenance_id', '=', m.id).execute();
    expect(rows.map((r) => r.monitor_id)).toEqual([a]);
  });

  it('deleting a monitor removes the link and keeps the maintenance', async () => {
    const a = await addMonitor();
    const m = (await create({ monitorIds: [a] })).json().maintenance;
    await db.deleteFrom('monitors').where('id', '=', a).execute();
    const links = await db.selectFrom('maintenance_monitors').selectAll().where('maintenance_id', '=', m.id).execute();
    expect(links).toHaveLength(0);
    const row = await db.selectFrom('scheduled_maintenances').select('id').where('id', '=', m.id).executeTakeFirst();
    expect(row).toBeDefined();
  });
});
