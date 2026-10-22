import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { statusIncidentRoutes } from '../../../modules/status-incidents/routes.js';
import { createTestContext, createTestSession } from '../../helpers/index.js';

vi.mock('../../../queue/jobs/monitor-status-subscribers.js', () => ({
  enqueueStatusSubscriberNotification: vi.fn().mockResolvedValue(undefined),
}));
import { db } from '../../../database/index.js';

function authHeaders(token: string) {
  return { Authorization: `Bearer ${token}` };
}

let app: FastifyInstance;
let ctx: Awaited<ReturnType<typeof createTestContext>>;
let authToken: string;

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
  const session = await createTestSession(ctx.user.id);
  authToken = session.token;
});

async function createIncident(token = authToken) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/status-incidents',
    headers: authHeaders(token),
    payload: {
      organizationId: ctx.organization.id,
      projectId: ctx.project.id,
      title: 'Test incident',
    },
  });
  return JSON.parse(res.payload).incident;
}

describe('POST /api/v1/status-incidents', () => {
  it('creates an incident', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/status-incidents',
      headers: authHeaders(authToken),
      payload: {
        organizationId: ctx.organization.id,
        projectId: ctx.project.id,
        title: 'Outage',
        severity: 'major',
        message: 'Investigating now',
      },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.payload);
    expect(body.incident.title).toBe('Outage');
    expect(body.incident.severity).toBe('major');
  });

  it('returns 401 without auth', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/status-incidents',
      payload: {
        organizationId: ctx.organization.id,
        projectId: ctx.project.id,
        title: 'Unauth',
      },
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 400 for invalid payload', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/status-incidents',
      headers: authHeaders(authToken),
      payload: { organizationId: ctx.organization.id },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 403 when user is a regular member', async () => {
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
      url: '/api/v1/status-incidents',
      headers: authHeaders(memberSession.token),
      payload: {
        organizationId: ctx.organization.id,
        projectId: ctx.project.id,
        title: 'Forbidden',
      },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('GET /api/v1/status-incidents', () => {
  it('lists incidents for a project', async () => {
    await createIncident();

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/status-incidents?organizationId=${ctx.organization.id}&projectId=${ctx.project.id}`,
      headers: authHeaders(authToken),
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload).incidents.length).toBeGreaterThan(0);
  });

  it('returns 400 without required query params', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/status-incidents',
      headers: authHeaders(authToken),
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 403 for non-members', async () => {
    const { createTestUser } = await import('../../helpers/factories.js');
    const stranger = await createTestUser();
    const strangerSession = await createTestSession(stranger.id);

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/status-incidents?organizationId=${ctx.organization.id}&projectId=${ctx.project.id}`,
      headers: authHeaders(strangerSession.token),
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('GET /api/v1/status-incidents/:id', () => {
  it('returns an incident with updates', async () => {
    const incident = await createIncident();

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/status-incidents/${incident.id}?organizationId=${ctx.organization.id}`,
      headers: authHeaders(authToken),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.incident.id).toBe(incident.id);
    expect(Array.isArray(body.updates)).toBe(true);
  });

  it('returns 404 for unknown id', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/status-incidents/00000000-0000-0000-0000-000000000000?organizationId=${ctx.organization.id}`,
      headers: authHeaders(authToken),
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 400 without organizationId', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/status-incidents/some-id',
      headers: authHeaders(authToken),
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('PUT /api/v1/status-incidents/:id', () => {
  it('updates an incident', async () => {
    const incident = await createIncident();

    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/status-incidents/${incident.id}?organizationId=${ctx.organization.id}`,
      headers: authHeaders(authToken),
      payload: { title: 'Updated title', status: 'identified' },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.incident.title).toBe('Updated title');
    expect(body.incident.status).toBe('identified');
  });

  it('returns 404 for unknown id', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/status-incidents/00000000-0000-0000-0000-000000000000?organizationId=${ctx.organization.id}`,
      headers: authHeaders(authToken),
      payload: { title: 'x' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 403 for non-admin members', async () => {
    const { createTestUser } = await import('../../helpers/factories.js');
    const member = await createTestUser();
    await db.insertInto('organization_members').values({
      user_id: member.id,
      organization_id: ctx.organization.id,
      role: 'member',
    }).execute();
    const memberSession = await createTestSession(member.id);
    const incident = await createIncident();

    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/status-incidents/${incident.id}?organizationId=${ctx.organization.id}`,
      headers: authHeaders(memberSession.token),
      payload: { title: 'x' },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('DELETE /api/v1/status-incidents/:id', () => {
  it('deletes an incident', async () => {
    const incident = await createIncident();

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/status-incidents/${incident.id}?organizationId=${ctx.organization.id}`,
      headers: authHeaders(authToken),
    });
    expect(res.statusCode).toBe(204);
  });

  it('returns 404 for unknown id', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/status-incidents/00000000-0000-0000-0000-000000000000?organizationId=${ctx.organization.id}`,
      headers: authHeaders(authToken),
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('POST /api/v1/status-incidents/:id/updates', () => {
  it('adds an update to an incident', async () => {
    const incident = await createIncident();

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/status-incidents/${incident.id}/updates?organizationId=${ctx.organization.id}`,
      headers: authHeaders(authToken),
      payload: { status: 'monitoring', message: 'Monitoring the fix' },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.payload);
    expect(body.update.message).toBe('Monitoring the fix');
    expect(body.update.status).toBe('monitoring');
  });

  it('returns 404 for unknown incident', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/status-incidents/00000000-0000-0000-0000-000000000000/updates?organizationId=${ctx.organization.id}`,
      headers: authHeaders(authToken),
      payload: { status: 'monitoring', message: 'test' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 400 for missing message', async () => {
    const incident = await createIncident();

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/status-incidents/${incident.id}/updates?organizationId=${ctx.organization.id}`,
      headers: authHeaders(authToken),
      payload: { status: 'monitoring' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 403 for non-admin member', async () => {
    const { createTestUser } = await import('../../helpers/factories.js');
    const member = await createTestUser();
    await db.insertInto('organization_members').values({
      user_id: member.id,
      organization_id: ctx.organization.id,
      role: 'member',
    }).execute();
    const memberSession = await createTestSession(member.id);
    const incident = await createIncident();

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/status-incidents/${incident.id}/updates?organizationId=${ctx.organization.id}`,
      headers: authHeaders(memberSession.token),
      payload: { status: 'monitoring', message: 'Forbidden' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('returns 400 when organizationId missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/status-incidents/some-id/updates`,
      headers: authHeaders(authToken),
      payload: { status: 'monitoring', message: 'test' },
    });
    expect(res.statusCode).toBe(400);
  });
});
