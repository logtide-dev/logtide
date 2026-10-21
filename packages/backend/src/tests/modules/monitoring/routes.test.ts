import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { db } from '../../../database/index.js';
import { monitoringRoutes, heartbeatRoutes, publicStatusRoutes } from '../../../modules/monitoring/routes.js';
import { createTestContext, createTestSession } from '../../helpers/index.js';

vi.mock('../../../queue/jobs/monitor-notification.js', () => ({
  monitorNotificationQueue: { add: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock('../../../modules/maintenances/service.js', () => ({
  maintenanceService: {
    getProjectsUnderMaintenance: vi.fn().mockResolvedValue(new Set()),
  },
}));
vi.mock('../../../modules/monitoring/checker.js', async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    runHttpCheck: vi.fn().mockResolvedValue({ status: 'up', responseTimeMs: 50, statusCode: 200, errorCode: null }),
    runTcpCheck: vi.fn().mockResolvedValue({ status: 'up', responseTimeMs: 10, statusCode: null, errorCode: null }),
    runHeartbeatCheck: vi.fn().mockResolvedValue({ status: 'up', responseTimeMs: null, statusCode: null, errorCode: null }),
    runLogHeartbeatCheck: vi.fn().mockResolvedValue({ status: 'up', responseTimeMs: null, statusCode: null, errorCode: null }),
    runSslCheck: vi.fn().mockResolvedValue({ status: 'up', responseTimeMs: 30, statusCode: null, errorCode: null }),
    runDnsCheck: vi.fn().mockResolvedValue({ status: 'up', responseTimeMs: 5, statusCode: null, errorCode: null }),
    parseTcpTarget: vi.fn().mockReturnValue({ host: 'localhost', port: 5432 }),
    // pure helpers stay real so target validation is exercised
    parseHostPort: actual.parseHostPort,
    isValidDnsHostname: actual.isValidDnsHostname,
  };
});
vi.mock('../../../database/reservoir.js', () => ({ reservoir: {} }));
// Avoid real DNS in create/update target validation; throw only for sentinel hosts.
vi.mock('../../../utils/ssrf-guard.js', async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    assertHttpTargetAllowed: vi.fn(async (url: string) => {
      if (url.includes('blocked.invalid')) throw new actual.SsrfBlockedError('Target is in a blocked range');
    }),
    resolveAndValidateHost: vi.fn(async (host: string) => {
      if (host.includes('blocked')) throw new actual.SsrfBlockedError('Target is in a blocked range');
      return ['93.184.216.34'];
    }),
  };
});

function authHeaders(token: string) {
  return { Authorization: `Bearer ${token}` };
}

let app: FastifyInstance;
let ctx: Awaited<ReturnType<typeof createTestContext>>;
let authToken: string;

beforeAll(async () => {
  app = Fastify();
  await app.register(monitoringRoutes, { prefix: '/api/v1/monitors' });
  await app.register(heartbeatRoutes, { prefix: '/api/v1/heartbeat' });
  await app.register(publicStatusRoutes, { prefix: '/status' });
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

describe('POST /api/v1/monitors', () => {
  it('creates an HTTP monitor', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/monitors',
      headers: authHeaders(authToken),
      payload: {
        organizationId: ctx.organization.id,
        projectId: ctx.project.id,
        name: 'My API',
        type: 'http',
        target: 'https://example.com/health',
      },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.payload);
    expect(body.monitor.name).toBe('My API');
    expect(body.monitor.type).toBe('http');
  });

  it('creates a heartbeat monitor', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/monitors',
      headers: authHeaders(authToken),
      payload: {
        organizationId: ctx.organization.id,
        projectId: ctx.project.id,
        name: 'Cron',
        type: 'heartbeat',
      },
    });
    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.payload).monitor.type).toBe('heartbeat');
  });

  it('returns 400 for invalid HTTP target', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/monitors',
      headers: authHeaders(authToken),
      payload: {
        organizationId: ctx.organization.id,
        projectId: ctx.project.id,
        name: 'Bad',
        type: 'http',
        target: 'not-a-url',
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 for invalid TCP target (missing port)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/monitors',
      headers: authHeaders(authToken),
      payload: {
        organizationId: ctx.organization.id,
        projectId: ctx.project.id,
        name: 'Bad TCP',
        type: 'tcp',
        target: 'noporthere',
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 401 without auth', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/monitors',
      payload: { organizationId: ctx.organization.id, projectId: ctx.project.id, name: 'x', type: 'heartbeat' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 400 without organizationId', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/monitors',
      headers: authHeaders(authToken),
      payload: { projectId: ctx.project.id, name: 'x', type: 'heartbeat' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 403 when projectId belongs to another organization', async () => {
    // Member of ctx.organization tries to inject a monitor into a foreign
    // project, which would surface on that tenant's public status page.
    const { createTestOrganization, createTestProject } = await import('../../helpers/factories.js');
    const foreignOrg = await createTestOrganization();
    const foreignProject = await createTestProject({ organizationId: foreignOrg.id });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/monitors',
      headers: authHeaders(authToken),
      payload: {
        organizationId: ctx.organization.id,
        projectId: foreignProject.id,
        name: 'Injected',
        type: 'heartbeat',
      },
    });
    expect(res.statusCode).toBe(403);
  });

  it('returns 400 for an HTTP target that resolves to a blocked address (SSRF)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/monitors',
      headers: authHeaders(authToken),
      payload: {
        organizationId: ctx.organization.id,
        projectId: ctx.project.id,
        name: 'SSRF',
        type: 'http',
        target: 'http://blocked.invalid/health',
      },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('GET /api/v1/monitors', () => {
  it('lists monitors for organization', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/v1/monitors',
      headers: authHeaders(authToken),
      payload: { organizationId: ctx.organization.id, projectId: ctx.project.id, name: 'M1', type: 'heartbeat' },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/monitors?organizationId=${ctx.organization.id}`,
      headers: authHeaders(authToken),
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload).monitors.length).toBeGreaterThan(0);
  });

  it('returns 400 without organizationId', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/monitors',
      headers: authHeaders(authToken),
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 401 without auth', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/monitors?organizationId=${ctx.organization.id}`,
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('GET /api/v1/monitors/:id', () => {
  it('returns a monitor by id', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/monitors',
      headers: authHeaders(authToken),
      payload: { organizationId: ctx.organization.id, projectId: ctx.project.id, name: 'Single', type: 'heartbeat' },
    });
    const { monitor } = JSON.parse(createRes.payload);

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/monitors/${monitor.id}?organizationId=${ctx.organization.id}`,
      headers: authHeaders(authToken),
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload).monitor.id).toBe(monitor.id);
  });

  it('returns 404 for unknown id', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/monitors/00000000-0000-0000-0000-000000000000?organizationId=${ctx.organization.id}`,
      headers: authHeaders(authToken),
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('PUT /api/v1/monitors/:id', () => {
  it('updates a monitor', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/monitors',
      headers: authHeaders(authToken),
      payload: { organizationId: ctx.organization.id, projectId: ctx.project.id, name: 'Old', type: 'heartbeat' },
    });
    const { monitor } = JSON.parse(createRes.payload);

    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/monitors/${monitor.id}?organizationId=${ctx.organization.id}`,
      headers: authHeaders(authToken),
      payload: { name: 'New name', enabled: false },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload).monitor.name).toBe('New name');
    expect(JSON.parse(res.payload).monitor.enabled).toBe(false);
  });

  it('returns 404 for unknown id', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/monitors/00000000-0000-0000-0000-000000000000?organizationId=${ctx.organization.id}`,
      headers: authHeaders(authToken),
      payload: { name: 'x' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 400 for invalid HTTP target update', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/monitors',
      headers: authHeaders(authToken),
      payload: {
        organizationId: ctx.organization.id,
        projectId: ctx.project.id,
        name: 'HTTP Mon',
        type: 'http',
        target: 'https://example.com',
      },
    });
    const { monitor } = JSON.parse(createRes.payload);

    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/monitors/${monitor.id}?organizationId=${ctx.organization.id}`,
      headers: authHeaders(authToken),
      payload: { target: 'not-a-url' },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('DELETE /api/v1/monitors/:id', () => {
  it('deletes a monitor', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/monitors',
      headers: authHeaders(authToken),
      payload: { organizationId: ctx.organization.id, projectId: ctx.project.id, name: 'Del', type: 'heartbeat' },
    });
    const { monitor } = JSON.parse(createRes.payload);

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/monitors/${monitor.id}?organizationId=${ctx.organization.id}`,
      headers: authHeaders(authToken),
    });
    expect(res.statusCode).toBe(204);
  });
});

describe('GET /api/v1/monitors/:id/results', () => {
  it('returns results for a monitor', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/monitors',
      headers: authHeaders(authToken),
      payload: { organizationId: ctx.organization.id, projectId: ctx.project.id, name: 'Results', type: 'heartbeat' },
    });
    const { monitor } = JSON.parse(createRes.payload);

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/monitors/${monitor.id}/results?organizationId=${ctx.organization.id}`,
      headers: authHeaders(authToken),
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload).results).toEqual([]);
  });
});

describe('GET /api/v1/monitors/:id/uptime', () => {
  it('returns uptime history', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/monitors',
      headers: authHeaders(authToken),
      payload: { organizationId: ctx.organization.id, projectId: ctx.project.id, name: 'Uptime', type: 'heartbeat' },
    });
    const { monitor } = JSON.parse(createRes.payload);

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/monitors/${monitor.id}/uptime?organizationId=${ctx.organization.id}`,
      headers: authHeaders(authToken),
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload).history).toEqual([]);
  });
});

describe('POST /api/v1/heartbeat/:id/heartbeat', () => {
  it('returns 401 without any auth', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/heartbeat/00000000-0000-0000-0000-000000000000/heartbeat',
    });
    expect(res.statusCode).toBe(401);
  });

});

describe('GET /status/:orgSlug/:projectSlug', () => {
  it('returns 404 for unknown slug', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/status/${ctx.organization.slug}/nonexistent-slug`,
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 404 for disabled status page', async () => {
    // Update project status_page_visibility to 'disabled'
    await db
      .updateTable('projects')
      .set({ status_page_visibility: 'disabled' })
      .where('id', '=', ctx.project.id)
      .execute();

    const res = await app.inject({
      method: 'GET',
      url: `/status/${ctx.organization.slug}/${ctx.project.slug}`,
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns status data for public project', async () => {
    await db
      .updateTable('projects')
      .set({ status_page_visibility: 'public' })
      .where('id', '=', ctx.project.id)
      .execute();

    const res = await app.inject({
      method: 'GET',
      url: `/status/${ctx.organization.slug}/${ctx.project.slug}`,
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.projectSlug).toBe(ctx.project.slug);
    expect(body.overallStatus).toBe('operational');
  });

  it('returns password challenge for password-protected project', async () => {
    await db
      .updateTable('projects')
      .set({ status_page_visibility: 'password' })
      .where('id', '=', ctx.project.id)
      .execute();

    const res = await app.inject({
      method: 'GET',
      url: `/status/${ctx.organization.slug}/${ctx.project.slug}`,
    });
    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.payload).requiresPassword).toBe(true);
  });

  it('returns 401 for wrong password on password-protected project', async () => {
    await db
      .updateTable('projects')
      .set({ status_page_visibility: 'password' })
      .where('id', '=', ctx.project.id)
      .execute();

    const res = await app.inject({
      method: 'GET',
      url: `/status/${ctx.organization.slug}/${ctx.project.slug}`,
      headers: { 'x-status-password': 'wrongpassword' },
    });
    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.payload).error).toBe('Invalid password');
  });

  it('returns 401 for members_only project without auth', async () => {
    await db
      .updateTable('projects')
      .set({ status_page_visibility: 'members_only' })
      .where('id', '=', ctx.project.id)
      .execute();

    const res = await app.inject({
      method: 'GET',
      url: `/status/${ctx.organization.slug}/${ctx.project.slug}`,
    });
    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.payload).requiresAuth).toBe(true);
  });

  it('returns 401 for members_only project with invalid token', async () => {
    await db
      .updateTable('projects')
      .set({ status_page_visibility: 'members_only' })
      .where('id', '=', ctx.project.id)
      .execute();

    const res = await app.inject({
      method: 'GET',
      url: `/status/${ctx.organization.slug}/${ctx.project.slug}`,
      headers: { Authorization: 'Bearer invalid-token-xyz' },
    });
    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.payload).requiresAuth).toBe(true);
  });

  it('returns 403 for members_only project with non-member token', async () => {
    await db
      .updateTable('projects')
      .set({ status_page_visibility: 'members_only' })
      .where('id', '=', ctx.project.id)
      .execute();

    const { createTestUser } = await import('../../helpers/factories.js');
    const stranger = await createTestUser();
    const strangerSession = await createTestSession(stranger.id);

    const res = await app.inject({
      method: 'GET',
      url: `/status/${ctx.organization.slug}/${ctx.project.slug}`,
      headers: { Authorization: `Bearer ${strangerSession.token}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it('returns status data for members_only project with valid member token', async () => {
    await db
      .updateTable('projects')
      .set({ status_page_visibility: 'members_only' })
      .where('id', '=', ctx.project.id)
      .execute();

    const res = await app.inject({
      method: 'GET',
      url: `/status/${ctx.organization.slug}/${ctx.project.slug}`,
      headers: authHeaders(authToken),
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload).projectSlug).toBe(ctx.project.slug);
  });
});

describe('GET /status/:orgSlug/:projectSlug/badge.json', () => {
  it('returns 404 for non-public project', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/status/${ctx.organization.slug}/${ctx.project.slug}/badge.json`,
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns badge JSON for public project', async () => {
    await db
      .updateTable('projects')
      .set({ status_page_visibility: 'public' })
      .where('id', '=', ctx.project.id)
      .execute();

    const res = await app.inject({
      method: 'GET',
      url: `/status/${ctx.organization.slug}/${ctx.project.slug}/badge.json`,
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.status).toBeDefined();
    expect(body.label).toBeDefined();
    expect(body.color).toBeDefined();
  });
});

describe('GET /status/:orgSlug/:projectSlug/badge.svg', () => {
  it('returns unknown badge SVG for non-public project', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/status/${ctx.organization.slug}/${ctx.project.slug}/badge.svg`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('image/svg+xml');
    expect(res.payload).toContain('<svg');
  });

  it('returns operational badge SVG for public project', async () => {
    await db
      .updateTable('projects')
      .set({ status_page_visibility: 'public' })
      .where('id', '=', ctx.project.id)
      .execute();

    const res = await app.inject({
      method: 'GET',
      url: `/status/${ctx.organization.slug}/${ctx.project.slug}/badge.svg`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.payload).toContain('operational');
  });

  it('supports flat-square style', async () => {
    await db
      .updateTable('projects')
      .set({ status_page_visibility: 'public' })
      .where('id', '=', ctx.project.id)
      .execute();

    const res = await app.inject({
      method: 'GET',
      url: `/status/${ctx.organization.slug}/${ctx.project.slug}/badge.svg?style=flat-square`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.payload).toContain('<svg');
  });

  it('supports for-the-badge style', async () => {
    await db
      .updateTable('projects')
      .set({ status_page_visibility: 'public' })
      .where('id', '=', ctx.project.id)
      .execute();

    const res = await app.inject({
      method: 'GET',
      url: `/status/${ctx.organization.slug}/${ctx.project.slug}/badge.svg?style=for-the-badge`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.payload).toContain('STATUS');
  });

  it('supports minimal style', async () => {
    await db
      .updateTable('projects')
      .set({ status_page_visibility: 'public' })
      .where('id', '=', ctx.project.id)
      .execute();

    const res = await app.inject({
      method: 'GET',
      url: `/status/${ctx.organization.slug}/${ctx.project.slug}/badge.svg?style=minimal`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.payload).toContain('<svg');
  });

  it('supports plastic style', async () => {
    await db
      .updateTable('projects')
      .set({ status_page_visibility: 'public' })
      .where('id', '=', ctx.project.id)
      .execute();

    const res = await app.inject({
      method: 'GET',
      url: `/status/${ctx.organization.slug}/${ctx.project.slug}/badge.svg?style=plastic`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.payload).toContain('<svg');
  });
});

describe('invalid UUID :id param', () => {
  it('GET /:id returns 400 for non-uuid id', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/monitors/not-a-uuid?organizationId=${ctx.organization.id}`,
      headers: authHeaders(authToken),
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.payload).error).toBe('Invalid monitor ID');
  });

  it('PUT /:id returns 400 for non-uuid id', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/monitors/bad-id?organizationId=${ctx.organization.id}`,
      headers: authHeaders(authToken),
      payload: { name: 'x' },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.payload).error).toBe('Invalid monitor ID');
  });

  it('DELETE /:id returns 400 for non-uuid id', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/monitors/bad-id?organizationId=${ctx.organization.id}`,
      headers: authHeaders(authToken),
    });
    expect(res.statusCode).toBe(400);
  });

  it('GET /:id/results returns 400 for non-uuid id', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/monitors/bad-id/results?organizationId=${ctx.organization.id}`,
      headers: authHeaders(authToken),
    });
    expect(res.statusCode).toBe(400);
  });

  it('GET /:id/uptime returns 400 for non-uuid id', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/monitors/bad-id/uptime?organizationId=${ctx.organization.id}`,
      headers: authHeaders(authToken),
    });
    expect(res.statusCode).toBe(400);
  });

  it('GET /:id/channels returns 400 for non-uuid id', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/monitors/bad-id/channels?organizationId=${ctx.organization.id}`,
      headers: authHeaders(authToken),
    });
    expect(res.statusCode).toBe(400);
  });

  it('PUT /:id/channels returns 400 for non-uuid id', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/monitors/bad-id/channels?organizationId=${ctx.organization.id}`,
      headers: authHeaders(authToken),
      payload: { channelIds: [] },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 for invalid organizationId', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/monitors/00000000-0000-0000-0000-000000000000?organizationId=not-a-uuid`,
      headers: authHeaders(authToken),
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.payload).error).toBe('organizationId required');
  });
});

describe('parsePositiveInt edge cases', () => {
  it('GET /:id/results clamps negative limit to default', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/monitors',
      headers: authHeaders(authToken),
      payload: { organizationId: ctx.organization.id, projectId: ctx.project.id, name: 'Lim', type: 'heartbeat' },
    });
    const { monitor } = JSON.parse(createRes.payload);

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/monitors/${monitor.id}/results?organizationId=${ctx.organization.id}&limit=-5`,
      headers: authHeaders(authToken),
    });
    expect(res.statusCode).toBe(200);
  });

  it('GET /:id/uptime clamps NaN days to default', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/monitors',
      headers: authHeaders(authToken),
      payload: { organizationId: ctx.organization.id, projectId: ctx.project.id, name: 'Up', type: 'heartbeat' },
    });
    const { monitor } = JSON.parse(createRes.payload);

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/monitors/${monitor.id}/uptime?organizationId=${ctx.organization.id}&days=abc`,
      headers: authHeaders(authToken),
    });
    expect(res.statusCode).toBe(200);
  });
});

describe('GET /api/v1/monitors/:id/results with limit', () => {
  it('respects the limit query parameter', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/monitors',
      headers: authHeaders(authToken),
      payload: {
        organizationId: ctx.organization.id,
        projectId: ctx.project.id,
        name: 'Limited results',
        type: 'heartbeat',
      },
    });
    const { monitor } = JSON.parse(createRes.payload);

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/monitors/${monitor.id}/results?organizationId=${ctx.organization.id}&limit=5`,
      headers: authHeaders(authToken),
    });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(JSON.parse(res.payload).results)).toBe(true);
  });
});

// ===========================================================================
// W12: ssl / dns monitors, display fields, http config limits
// ===========================================================================
describe('monitor form fields (W12)', () => {
  async function create(payload: Record<string, unknown>) {
    return app.inject({
      method: 'POST',
      url: '/api/v1/monitors',
      headers: authHeaders(authToken),
      payload: { organizationId: ctx.organization.id, projectId: ctx.project.id, name: 'W12 monitor', ...payload },
    });
  }

  it('creates an ssl monitor and stores default warnDays 14', async () => {
    const res = await create({ type: 'ssl', target: 'example.com' });
    expect(res.statusCode).toBe(201);
    const { monitor } = JSON.parse(res.payload);
    expect(monitor.type).toBe('ssl');
    expect(monitor.checkConfig).toEqual({ warnDays: 14 });
  });

  it('rejects ssl warnDays 0 and 366', async () => {
    expect((await create({ type: 'ssl', target: 'example.com', checkConfig: { warnDays: 0 } })).statusCode).toBe(400);
    expect((await create({ type: 'ssl', target: 'example.com', checkConfig: { warnDays: 366 } })).statusCode).toBe(400);
    expect((await create({ type: 'ssl', target: 'example.com', checkConfig: { warnDays: 30 } })).statusCode).toBe(201);
  });

  it('rejects an ssl target that resolves to a blocked range', async () => {
    const res = await create({ type: 'ssl', target: 'blocked.internal:443' });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.payload).error).toMatch(/blocked/i);
  });

  it('accepts ssl host:port and rejects a scheme in the target', async () => {
    const ok = await create({ type: 'ssl', target: 'example.com:8443' });
    expect(ok.statusCode).toBe(201);
    expect(JSON.parse(ok.payload).monitor.target).toBe('example.com:8443');
    expect((await create({ type: 'ssl', target: 'https://example.com' })).statusCode).toBe(400);
    expect((await create({ type: 'ssl', target: 'example.com:70000' })).statusCode).toBe(400);
    expect((await create({ type: 'ssl' })).statusCode).toBe(400);
  });

  it('creates a dns monitor with MX and expected value', async () => {
    const res = await create({
      type: 'dns',
      target: 'example.com',
      checkConfig: { recordType: 'MX', expectedValue: 'mx.example.com' },
    });
    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.payload).monitor.checkConfig).toEqual({
      recordType: 'MX',
      expectedValue: 'mx.example.com',
    });
  });

  it('rejects dns recordType SRV', async () => {
    const res = await create({ type: 'dns', target: 'example.com', checkConfig: { recordType: 'SRV' } });
    expect(res.statusCode).toBe(400);
  });

  it('rejects a dns target that is an IP address', async () => {
    expect((await create({ type: 'dns', target: '10.0.0.1', checkConfig: { recordType: 'A' } })).statusCode).toBe(400);
    expect((await create({ type: 'dns', target: 'example.com:53', checkConfig: { recordType: 'A' } })).statusCode).toBe(400);
  });

  it('update validates checkConfig against the existing monitor type', async () => {
    const { monitor } = JSON.parse((await create({ type: 'ssl', target: 'example.com' })).payload);
    const url = `/api/v1/monitors/${monitor.id}?organizationId=${ctx.organization.id}`;

    const bad = await app.inject({
      method: 'PUT',
      url,
      headers: authHeaders(authToken),
      payload: { checkConfig: { recordType: 'A' } },
    });
    expect(bad.statusCode).toBe(400);

    const ok = await app.inject({
      method: 'PUT',
      url,
      headers: authHeaders(authToken),
      payload: { checkConfig: { warnDays: 30 } },
    });
    expect(ok.statusCode).toBe(200);
    expect(JSON.parse(ok.payload).monitor.checkConfig).toEqual({ warnDays: 30 });

    const badTarget = await app.inject({
      method: 'PUT',
      url,
      headers: authHeaders(authToken),
      payload: { target: 'https://example.com' },
    });
    expect(badTarget.statusCode).toBe(400);
  });

  it('stores and returns displayName and groupName, rejects displayName over 255', async () => {
    const res = await create({
      type: 'heartbeat',
      displayName: 'API (Europe)',
      groupName: 'Core services',
      displayOrder: 3,
    });
    expect(res.statusCode).toBe(201);
    const { monitor } = JSON.parse(res.payload);
    expect(monitor.displayName).toBe('API (Europe)');
    expect(monitor.groupName).toBe('Core services');
    expect(monitor.displayOrder).toBe(3);

    const fetched = await app.inject({
      method: 'GET',
      url: `/api/v1/monitors/${monitor.id}?organizationId=${ctx.organization.id}`,
      headers: authHeaders(authToken),
    });
    expect(JSON.parse(fetched.payload).monitor.displayName).toBe('API (Europe)');

    expect((await create({ type: 'heartbeat', displayName: 'x'.repeat(256) })).statusCode).toBe(400);
    expect((await create({ type: 'heartbeat', groupName: 'g'.repeat(101) })).statusCode).toBe(400);
  });

  it('defaults display fields for a monitor that sets none', async () => {
    const { monitor } = JSON.parse((await create({ type: 'heartbeat' })).payload);
    expect(monitor.displayName).toBeNull();
    expect(monitor.groupName).toBeNull();
    expect(monitor.displayOrder).toBe(0);
    expect(monitor.checkConfig).toBeNull();
  });

  it('rejects http method FETCH and upper-cases get', async () => {
    const bad = await create({ type: 'http', target: 'https://example.com', httpConfig: { method: 'FETCH' } });
    expect(bad.statusCode).toBe(400);

    const ok = await create({ type: 'http', target: 'https://example.com', httpConfig: { method: 'get' } });
    expect(ok.statusCode).toBe(201);
    expect(JSON.parse(ok.payload).monitor.httpConfig.method).toBe('GET');
  });

  it('rejects more than 20 headers and a header name with a space', async () => {
    const many = Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`X-H-${i}`, 'v']));
    expect((await create({ type: 'http', target: 'https://example.com', httpConfig: { headers: many } })).statusCode).toBe(400);

    const spaced = await create({
      type: 'http',
      target: 'https://example.com',
      httpConfig: { headers: { 'Bad Name': 'v' } },
    });
    expect(spaced.statusCode).toBe(400);

    const long = await create({
      type: 'http',
      target: 'https://example.com',
      httpConfig: { headers: { 'X-Long': 'v'.repeat(1025) } },
    });
    expect(long.statusCode).toBe(400);

    const fine = await create({
      type: 'http',
      target: 'https://example.com',
      httpConfig: { headers: { 'X-Token': 'abc' } },
    });
    expect(fine.statusCode).toBe(201);
  });

  it('monitor of another organization stays invisible (404)', async () => {
    const { monitor } = JSON.parse((await create({ type: 'ssl', target: 'example.com' })).payload);
    const other = await createTestContext();
    const otherSession = await createTestSession(other.user.id);
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/monitors/${monitor.id}?organizationId=${other.organization.id}`,
      headers: authHeaders(otherSession.token),
    });
    expect(res.statusCode).toBe(404);
  });
});

// ===========================================================================
// W12: uptime summary, response times, outages
// ===========================================================================
describe('monitor stats routes (W12)', () => {
  async function createMonitorViaApi() {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/monitors',
      headers: authHeaders(authToken),
      payload: { organizationId: ctx.organization.id, projectId: ctx.project.id, name: 'Stats', type: 'heartbeat' },
    });
    return JSON.parse(res.payload).monitor.id as string;
  }

  it('GET uptime-summary returns the four windows', async () => {
    const id = await createMonitorViaApi();
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/monitors/${id}/uptime-summary?organizationId=${ctx.organization.id}`,
      headers: authHeaders(authToken),
    });
    expect(res.statusCode).toBe(200);
    expect(Object.keys(JSON.parse(res.payload).windows).sort()).toEqual(['24h', '30d', '7d', '90d']);
  });

  it('GET response-times returns bucketSeconds and points', async () => {
    const id = await createMonitorViaApi();
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/monitors/${id}/response-times?organizationId=${ctx.organization.id}&range=7d`,
      headers: authHeaders(authToken),
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload)).toEqual({ bucketSeconds: 3600, points: [] });
  });

  it('response-times rejects an unknown range with 400', async () => {
    const id = await createMonitorViaApi();
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/monitors/${id}/response-times?organizationId=${ctx.organization.id}&range=1y`,
      headers: authHeaders(authToken),
    });
    expect(res.statusCode).toBe(400);
  });

  it('GET outages returns an empty list for a fresh monitor and clamps the limit', async () => {
    const id = await createMonitorViaApi();
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/monitors/${id}/outages?organizationId=${ctx.organization.id}&limit=9999`,
      headers: authHeaders(authToken),
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload)).toEqual({ outages: [] });
  });

  it('all three return 404 for a monitor of another organization', async () => {
    const id = await createMonitorViaApi();
    const other = await createTestContext();
    const otherSession = await createTestSession(other.user.id);
    for (const path of ['uptime-summary', 'response-times', 'outages']) {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/monitors/${id}/${path}?organizationId=${other.organization.id}`,
        headers: authHeaders(otherSession.token),
      });
      expect(res.statusCode).toBe(404);
    }
  });

  it('returns 403 for a non-member and 400 for a bad id', async () => {
    const id = await createMonitorViaApi();
    const other = await createTestContext();
    const forbidden = await app.inject({
      method: 'GET',
      url: `/api/v1/monitors/${id}/outages?organizationId=${other.organization.id}`,
      headers: authHeaders(authToken),
    });
    expect(forbidden.statusCode).toBe(403);

    const bad = await app.inject({
      method: 'GET',
      url: `/api/v1/monitors/not-a-uuid/uptime-summary?organizationId=${ctx.organization.id}`,
      headers: authHeaders(authToken),
    });
    expect(bad.statusCode).toBe(400);
  });
});
