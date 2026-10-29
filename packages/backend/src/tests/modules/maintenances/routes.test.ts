import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { db } from '../../../database/index.js';
import { maintenanceRoutes } from '../../../modules/maintenances/routes.js';
import { createTestContext, createTestSession } from '../../helpers/index.js';

vi.mock('../../../queue/jobs/monitor-status-subscribers.js', () => ({
  enqueueStatusSubscriberNotification: vi.fn().mockResolvedValue(undefined),
}));

function authHeaders(token: string) {
  return { Authorization: `Bearer ${token}` };
}

let app: FastifyInstance;
let ctx: Awaited<ReturnType<typeof createTestContext>>;
let authToken: string;
const futureStart = new Date(Date.now() + 3_600_000).toISOString();
const futureEnd = new Date(Date.now() + 7_200_000).toISOString();

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
  const session = await createTestSession(ctx.user.id);
  authToken = session.token;
});

describe('POST /api/v1/maintenances', () => {
  it('creates a maintenance window', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/maintenances',
      headers: authHeaders(authToken),
      payload: {
        organizationId: ctx.organization.id,
        projectId: ctx.project.id,
        title: 'Planned upgrade',
        scheduledStart: futureStart,
        scheduledEnd: futureEnd,
      },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.payload);
    expect(body.maintenance.title).toBe('Planned upgrade');
    expect(body.maintenance.status).toBe('scheduled');
  });

  it('returns 400 for invalid date range (end before start)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/maintenances',
      headers: authHeaders(authToken),
      payload: {
        organizationId: ctx.organization.id,
        projectId: ctx.project.id,
        title: 'Bad dates',
        scheduledStart: futureEnd,
        scheduledEnd: futureStart,
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 401 without auth', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/maintenances',
      payload: {
        organizationId: ctx.organization.id,
        projectId: ctx.project.id,
        title: 'Unauth',
        scheduledStart: futureStart,
        scheduledEnd: futureEnd,
      },
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 403 when user is not admin/owner', async () => {
    // Create a member (not owner/admin) in a different org
    const { createTestUser } = await import('../../helpers/factories.js');
    const member = await createTestUser();
    await db.insertInto('organization_members').values({
      user_id: member.id,
      organization_id: ctx.organization.id,
      role: 'member',
    }).execute();
    const memberSession = await createTestSession(member.id);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/maintenances',
      headers: authHeaders(memberSession.token),
      payload: {
        organizationId: ctx.organization.id,
        projectId: ctx.project.id,
        title: 'Forbidden',
        scheduledStart: futureStart,
        scheduledEnd: futureEnd,
      },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('GET /api/v1/maintenances', () => {
  it('lists maintenances for a project', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/v1/maintenances',
      headers: authHeaders(authToken),
      payload: {
        organizationId: ctx.organization.id,
        projectId: ctx.project.id,
        title: 'First',
        scheduledStart: futureStart,
        scheduledEnd: futureEnd,
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/maintenances?organizationId=${ctx.organization.id}&projectId=${ctx.project.id}`,
      headers: authHeaders(authToken),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.maintenances.length).toBeGreaterThan(0);
  });

  it('returns 400 when missing organizationId', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/maintenances?projectId=${ctx.project.id}`,
      headers: authHeaders(authToken),
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when missing projectId', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/maintenances?organizationId=${ctx.organization.id}`,
      headers: authHeaders(authToken),
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 403 for non-member', async () => {
    const { createTestUser } = await import('../../helpers/factories.js');
    const stranger = await createTestUser();
    const strangerSession = await createTestSession(stranger.id);
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/maintenances?organizationId=${ctx.organization.id}&projectId=${ctx.project.id}`,
      headers: authHeaders(strangerSession.token),
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('GET /api/v1/maintenances/:id', () => {
  it('returns a maintenance by id', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/maintenances',
      headers: authHeaders(authToken),
      payload: {
        organizationId: ctx.organization.id,
        projectId: ctx.project.id,
        title: 'Single',
        scheduledStart: futureStart,
        scheduledEnd: futureEnd,
      },
    });
    const { maintenance } = JSON.parse(createRes.payload);

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/maintenances/${maintenance.id}?organizationId=${ctx.organization.id}`,
      headers: authHeaders(authToken),
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload).maintenance.id).toBe(maintenance.id);
  });

  it('returns 404 for unknown id', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/maintenances/00000000-0000-0000-0000-000000000000?organizationId=${ctx.organization.id}`,
      headers: authHeaders(authToken),
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 403 for non-member', async () => {
    const { createTestUser } = await import('../../helpers/factories.js');
    const stranger = await createTestUser();
    const strangerSession = await createTestSession(stranger.id);
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/maintenances/some-id?organizationId=${ctx.organization.id}`,
      headers: authHeaders(strangerSession.token),
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('PUT /api/v1/maintenances/:id - access control', () => {
  it('returns 403 for non-admin member', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/maintenances',
      headers: authHeaders(authToken),
      payload: {
        organizationId: ctx.organization.id,
        projectId: ctx.project.id,
        title: 'Admin created',
        scheduledStart: futureStart,
        scheduledEnd: futureEnd,
      },
    });
    const { maintenance } = JSON.parse(createRes.payload);

    const { createTestUser } = await import('../../helpers/factories.js');
    const member = await createTestUser();
    await db.insertInto('organization_members').values({
      user_id: member.id,
      organization_id: ctx.organization.id,
      role: 'member',
    }).execute();
    const memberSession = await createTestSession(member.id);

    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/maintenances/${maintenance.id}?organizationId=${ctx.organization.id}`,
      headers: authHeaders(memberSession.token),
      payload: { title: 'Should fail' },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('DELETE /api/v1/maintenances/:id - access control', () => {
  it('returns 403 for non-admin member', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/maintenances',
      headers: authHeaders(authToken),
      payload: {
        organizationId: ctx.organization.id,
        projectId: ctx.project.id,
        title: 'Admin created 2',
        scheduledStart: futureStart,
        scheduledEnd: futureEnd,
      },
    });
    const { maintenance } = JSON.parse(createRes.payload);

    const { createTestUser } = await import('../../helpers/factories.js');
    const member = await createTestUser();
    await db.insertInto('organization_members').values({
      user_id: member.id,
      organization_id: ctx.organization.id,
      role: 'member',
    }).execute();
    const memberSession = await createTestSession(member.id);

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/maintenances/${maintenance.id}?organizationId=${ctx.organization.id}`,
      headers: authHeaders(memberSession.token),
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('PUT /api/v1/maintenances/:id', () => {
  it('updates a maintenance', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/maintenances',
      headers: authHeaders(authToken),
      payload: {
        organizationId: ctx.organization.id,
        projectId: ctx.project.id,
        title: 'Old title',
        scheduledStart: futureStart,
        scheduledEnd: futureEnd,
      },
    });
    const { maintenance } = JSON.parse(createRes.payload);

    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/maintenances/${maintenance.id}?organizationId=${ctx.organization.id}`,
      headers: authHeaders(authToken),
      payload: { title: 'New title' },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload).maintenance.title).toBe('New title');
  });

  it('returns 404 for unknown id', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/maintenances/00000000-0000-0000-0000-000000000000?organizationId=${ctx.organization.id}`,
      headers: authHeaders(authToken),
      payload: { title: 'x' },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('DELETE /api/v1/maintenances/:id', () => {
  it('deletes a maintenance', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/maintenances',
      headers: authHeaders(authToken),
      payload: {
        organizationId: ctx.organization.id,
        projectId: ctx.project.id,
        title: 'To delete',
        scheduledStart: futureStart,
        scheduledEnd: futureEnd,
      },
    });
    const { maintenance } = JSON.parse(createRes.payload);

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/maintenances/${maintenance.id}?organizationId=${ctx.organization.id}`,
      headers: authHeaders(authToken),
    });
    expect(res.statusCode).toBe(204);
  });

  it('returns 404 for unknown id', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/maintenances/00000000-0000-0000-0000-000000000000?organizationId=${ctx.organization.id}`,
      headers: authHeaders(authToken),
    });
    expect(res.statusCode).toBe(404);
  });
});
