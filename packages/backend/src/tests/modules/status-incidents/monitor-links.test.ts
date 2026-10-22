import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { statusIncidentRoutes } from '../../../modules/status-incidents/routes.js';
import { createTestContext, createTestProject, createTestSession, createTestUser } from '../../helpers/index.js';
import { insertIncident } from '../incidents/fixtures.js';
import { db } from '../../../database/index.js';

let app: FastifyInstance;
let ctx: Awaited<ReturnType<typeof createTestContext>>;
let token: string;

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

async function addMonitor(projectId = ctx.project.id, organizationId = ctx.organization.id, name = 'Mon') {
  const row = await db
    .insertInto('monitors')
    .values({ organization_id: organizationId, project_id: projectId, name, type: 'http', target: 'https://example.com' })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

async function create(payload: Record<string, unknown>, t = token) {
  return app.inject({
    method: 'POST',
    url: '/api/v1/status-incidents',
    headers: auth(t),
    payload: { organizationId: ctx.organization.id, projectId: ctx.project.id, title: 'Outage', ...payload },
  });
}

beforeAll(async () => {
  app = Fastify();
  await app.register(statusIncidentRoutes, { prefix: '/api/v1/status-incidents' });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  ctx = await createTestContext();
  token = (await createTestSession(ctx.user.id)).token;
});

describe('status updates linked to monitors', () => {
  it('create stores monitorIds of the same project and returns them', async () => {
    const a = await addMonitor();
    const b = await addMonitor();
    const res = await create({ monitorIds: [a, b, a] });
    expect(res.statusCode).toBe(201);
    expect(res.json().incident.monitorIds.sort()).toEqual([a, b].sort());
    const rows = await db.selectFrom('status_incident_monitors').selectAll().execute();
    expect(rows.filter((r) => r.incident_id === res.json().incident.id)).toHaveLength(2);
  });

  it('create rejects ids of another project with 400 and stores nothing', async () => {
    const otherProject = await createTestProject({ organizationId: ctx.organization.id, userId: ctx.user.id });
    const foreign = await addMonitor(otherProject.id);
    const other = await createTestContext();
    const crossOrg = await addMonitor(other.project.id, other.organization.id);

    for (const bad of [foreign, crossOrg]) {
      const res = await create({ monitorIds: [bad] });
      expect(res.statusCode).toBe(400);
    }
    const count = await db.selectFrom('status_incidents').select('id').where('project_id', '=', ctx.project.id).execute();
    expect(count).toHaveLength(0);
  });

  it('rejects more than 50 monitor ids', async () => {
    const ids = Array.from({ length: 51 }, () => '00000000-0000-4000-8000-000000000001');
    const res = await create({ monitorIds: ids });
    expect(res.statusCode).toBe(400);
  });

  it('list and detail return monitorIds', async () => {
    const a = await addMonitor();
    const created = (await create({ monitorIds: [a] })).json().incident;
    const list = await app.inject({
      method: 'GET',
      url: `/api/v1/status-incidents?organizationId=${ctx.organization.id}&projectId=${ctx.project.id}`,
      headers: auth(token),
    });
    expect(list.json().incidents[0].monitorIds).toEqual([a]);
    const detail = await app.inject({
      method: 'GET',
      url: `/api/v1/status-incidents/${created.id}?organizationId=${ctx.organization.id}`,
      headers: auth(token),
    });
    expect(detail.json().incident.monitorIds).toEqual([a]);
    expect(detail.json().incident.sourceIncidentId).toBeNull();
  });

  it('update replaces monitorIds and an empty array clears them', async () => {
    const a = await addMonitor();
    const b = await addMonitor();
    const created = (await create({ monitorIds: [a] })).json().incident;
    const url = `/api/v1/status-incidents/${created.id}?organizationId=${ctx.organization.id}`;

    const replaced = await app.inject({ method: 'PUT', url, headers: auth(token), payload: { monitorIds: [b] } });
    expect(replaced.json().incident.monitorIds).toEqual([b]);

    const untouched = await app.inject({ method: 'PUT', url, headers: auth(token), payload: { title: 'Renamed' } });
    expect(untouched.json().incident.monitorIds).toEqual([b]);

    const cleared = await app.inject({ method: 'PUT', url, headers: auth(token), payload: { monitorIds: [] } });
    expect(cleared.json().incident.monitorIds).toEqual([]);
    const rows = await db.selectFrom('status_incident_monitors').selectAll().where('incident_id', '=', created.id).execute();
    expect(rows).toHaveLength(0);
  });

  it('update with a foreign monitor id is 400 and keeps the previous links', async () => {
    const a = await addMonitor();
    const other = await createTestContext();
    const foreign = await addMonitor(other.project.id, other.organization.id);
    const created = (await create({ monitorIds: [a] })).json().incident;
    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/status-incidents/${created.id}?organizationId=${ctx.organization.id}`,
      headers: auth(token),
      payload: { monitorIds: [foreign] },
    });
    expect(res.statusCode).toBe(400);
    const rows = await db.selectFrom('status_incident_monitors').select('monitor_id').where('incident_id', '=', created.id).execute();
    expect(rows.map((r) => r.monitor_id)).toEqual([a]);
  });

  it('sourceIncidentId must be a monitor incident of the same organization', async () => {
    const mine = await insertIncident({ organizationId: ctx.organization.id, projectId: ctx.project.id, source: 'monitor' });
    const sigma = await insertIncident({ organizationId: ctx.organization.id, projectId: ctx.project.id, source: 'sigma' });
    const other = await createTestContext();
    const foreign = await insertIncident({ organizationId: other.organization.id, projectId: other.project.id, source: 'monitor' });

    const ok = await create({ sourceIncidentId: mine.id });
    expect(ok.statusCode).toBe(201);
    expect(ok.json().incident.sourceIncidentId).toBe(mine.id);

    expect((await create({ sourceIncidentId: sigma.id })).statusCode).toBe(400);
    expect((await create({ sourceIncidentId: foreign.id })).statusCode).toBe(400);
    expect((await create({ sourceIncidentId: '00000000-0000-4000-8000-0000000000aa' })).statusCode).toBe(400);
  });

  it('list filters by sourceIncidentId', async () => {
    const src = await insertIncident({ organizationId: ctx.organization.id, projectId: ctx.project.id, source: 'monitor' });
    await create({ title: 'Linked', sourceIncidentId: src.id });
    await create({ title: 'Unlinked' });
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/status-incidents?organizationId=${ctx.organization.id}&projectId=${ctx.project.id}&sourceIncidentId=${src.id}`,
      headers: auth(token),
    });
    expect(res.json().incidents.map((i: any) => i.title)).toEqual(['Linked']);

    const bad = await app.inject({
      method: 'GET',
      url: `/api/v1/status-incidents?organizationId=${ctx.organization.id}&projectId=${ctx.project.id}&sourceIncidentId=nope`,
      headers: auth(token),
    });
    expect(bad.statusCode).toBe(400);
  });

  it('deleting a monitor removes the link rows and keeps the status update', async () => {
    const a = await addMonitor();
    const created = (await create({ monitorIds: [a] })).json().incident;
    await db.deleteFrom('monitors').where('id', '=', a).execute();
    const rows = await db.selectFrom('status_incident_monitors').selectAll().where('incident_id', '=', created.id).execute();
    expect(rows).toHaveLength(0);
    const still = await db.selectFrom('status_incidents').select('id').where('id', '=', created.id).executeTakeFirst();
    expect(still).toBeDefined();
  });

  it('writes still require admin or owner', async () => {
    const member = await createTestUser();
    await db
      .insertInto('organization_members')
      .values({ user_id: member.id, organization_id: ctx.organization.id, role: 'member' })
      .execute();
    const memberToken = (await createTestSession(member.id)).token;
    const a = await addMonitor();
    expect((await create({ monitorIds: [a] }, memberToken)).statusCode).toBe(403);
  });
});
