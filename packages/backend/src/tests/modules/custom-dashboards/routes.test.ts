import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { customDashboardsRoutes } from '../../../modules/custom-dashboards/routes.js';
import { fetchPanelData } from '../../../modules/custom-dashboards/panel-data-service.js';
import { createTestContext, createTestSession } from '../../helpers/index.js';

// Mock panel data service so we don't need real DB queries for data endpoint
// Partial mock: fetchPanelData is stubbed (its behavior has its own suites),
// while applyTimeRangeOverride stays real so the batch route's override
// wiring is exercised end to end.
vi.mock('../../../modules/custom-dashboards/panel-data-service.js', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('../../../modules/custom-dashboards/panel-data-service.js')
  >();
  return {
    ...actual,
    fetchPanelData: vi.fn().mockResolvedValue({ rows: [] }),
  };
});

function authHeaders(token: string) {
  return { Authorization: `Bearer ${token}` };
}

function makePanel(id = 'panel-1') {
  return {
    id,
    layout: { x: 0, y: 0, w: 4, h: 3 },
    config: {
      type: 'time_series',
      title: 'Logs',
      source: 'logs',
      projectId: null,
      interval: '24h',
      levels: ['info'],
      service: null,
    },
  };
}

let app: FastifyInstance;
let ctx: Awaited<ReturnType<typeof createTestContext>>;
let authToken: string;

beforeAll(async () => {
  app = Fastify();
  await app.register(customDashboardsRoutes, { prefix: '/api/v1/dashboards' });
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

describe('POST /api/v1/dashboards', () => {
  it('creates a dashboard', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/dashboards',
      headers: authHeaders(authToken),
      payload: { organizationId: ctx.organization.id, name: 'New Dashboard' },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.payload);
    expect(body.dashboard.name).toBe('New Dashboard');
  });

  it('creates with panels', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/dashboards',
      headers: authHeaders(authToken),
      payload: {
        organizationId: ctx.organization.id,
        name: 'With panels',
        panels: [makePanel()],
      },
    });
    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.payload).dashboard.panels).toHaveLength(1);
  });

  it('returns 400 for invalid panel config', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/dashboards',
      headers: authHeaders(authToken),
      payload: {
        organizationId: ctx.organization.id,
        name: 'Bad panels',
        panels: [{ id: 'x', layout: { x: 0, y: 0, w: 1, h: 1 }, config: { type: 'nonexistent_type' } }],
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 401 without auth', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/dashboards',
      payload: { organizationId: ctx.organization.id, name: 'Unauth' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 400 without organizationId', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/dashboards',
      headers: authHeaders(authToken),
      payload: { name: 'No org' },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('Access control - 403 for non-members', () => {
  let strangerToken: string;

  beforeEach(async () => {
    const { createTestUser } = await import('../../helpers/factories.js');
    const stranger = await createTestUser();
    const session = await createTestSession(stranger.id);
    strangerToken = session.token;
  });

  it('POST / returns 403 for non-member', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/dashboards',
      headers: authHeaders(strangerToken),
      payload: { organizationId: ctx.organization.id, name: 'Hack' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('GET / returns 403 for non-member', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/dashboards?organizationId=${ctx.organization.id}`,
      headers: authHeaders(strangerToken),
    });
    expect(res.statusCode).toBe(403);
  });

  it('GET /default returns 403 for non-member', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/dashboards/default?organizationId=${ctx.organization.id}`,
      headers: authHeaders(strangerToken),
    });
    expect(res.statusCode).toBe(403);
  });

  it('PUT /:id returns 403 for non-member', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/dashboards',
      headers: authHeaders(authToken),
      payload: { organizationId: ctx.organization.id, name: 'D' },
    });
    const { dashboard } = JSON.parse(createRes.payload);
    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/dashboards/${dashboard.id}?organizationId=${ctx.organization.id}`,
      headers: authHeaders(strangerToken),
      payload: { name: 'X' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('DELETE /:id returns 403 for non-member', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/dashboards',
      headers: authHeaders(authToken),
      payload: { organizationId: ctx.organization.id, name: 'D' },
    });
    const { dashboard } = JSON.parse(createRes.payload);
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/dashboards/${dashboard.id}?organizationId=${ctx.organization.id}`,
      headers: authHeaders(strangerToken),
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('GET /api/v1/dashboards', () => {
  it('lists dashboards', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/v1/dashboards',
      headers: authHeaders(authToken),
      payload: { organizationId: ctx.organization.id, name: 'D1' },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/dashboards?organizationId=${ctx.organization.id}`,
      headers: authHeaders(authToken),
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload).dashboards.length).toBeGreaterThan(0);
  });

  it('returns 400 without organizationId', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/dashboards',
      headers: authHeaders(authToken),
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 401 without auth', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/dashboards?organizationId=${ctx.organization.id}`,
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('GET /api/v1/dashboards/default', () => {
  it('creates and returns default dashboard', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/dashboards/default?organizationId=${ctx.organization.id}`,
      headers: authHeaders(authToken),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.dashboard.isDefault).toBe(true);
    expect(body.dashboard.panels.length).toBeGreaterThan(0);
  });

  it('returns 400 without organizationId', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/dashboards/default',
      headers: authHeaders(authToken),
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('GET /api/v1/dashboards/:id', () => {
  it('returns a dashboard by id', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/dashboards',
      headers: authHeaders(authToken),
      payload: { organizationId: ctx.organization.id, name: 'Single' },
    });
    const { dashboard } = JSON.parse(createRes.payload);

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/dashboards/${dashboard.id}?organizationId=${ctx.organization.id}`,
      headers: authHeaders(authToken),
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload).dashboard.id).toBe(dashboard.id);
  });

  it('returns 404 for unknown id', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/dashboards/00000000-0000-0000-0000-000000000000?organizationId=${ctx.organization.id}`,
      headers: authHeaders(authToken),
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('PUT /api/v1/dashboards/:id', () => {
  it('updates a dashboard', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/dashboards',
      headers: authHeaders(authToken),
      payload: { organizationId: ctx.organization.id, name: 'Old' },
    });
    const { dashboard } = JSON.parse(createRes.payload);

    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/dashboards/${dashboard.id}?organizationId=${ctx.organization.id}`,
      headers: authHeaders(authToken),
      payload: { name: 'Updated' },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload).dashboard.name).toBe('Updated');
  });
});

describe('DELETE /api/v1/dashboards/:id', () => {
  it('deletes a non-default dashboard', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/dashboards',
      headers: authHeaders(authToken),
      payload: { organizationId: ctx.organization.id, name: 'To delete' },
    });
    const { dashboard } = JSON.parse(createRes.payload);

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/dashboards/${dashboard.id}?organizationId=${ctx.organization.id}`,
      headers: authHeaders(authToken),
    });
    expect(res.statusCode).toBe(204);
  });

  it('returns 400 when trying to delete default dashboard', async () => {
    const defaultRes = await app.inject({
      method: 'GET',
      url: `/api/v1/dashboards/default?organizationId=${ctx.organization.id}`,
      headers: authHeaders(authToken),
    });
    const { dashboard } = JSON.parse(defaultRes.payload);

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/dashboards/${dashboard.id}?organizationId=${ctx.organization.id}`,
      headers: authHeaders(authToken),
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('POST /api/v1/dashboards/import-yaml', () => {
  it('imports a dashboard from YAML', async () => {
    const yaml = `
name: YAML Import
schema_version: 1
panels:
  - id: p1
    layout: { x: 0, y: 0, w: 4, h: 3 }
    config:
      type: time_series
      title: Logs
      source: logs
      projectId: null
      interval: "24h"
      levels: [info]
      service: null
`;
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/dashboards/import-yaml',
      headers: authHeaders(authToken),
      payload: { organizationId: ctx.organization.id, yaml },
    });
    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.payload).dashboard.name).toBe('YAML Import');
  });

  it('returns 400 for invalid YAML', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/dashboards/import-yaml',
      headers: authHeaders(authToken),
      payload: { organizationId: ctx.organization.id, yaml: ': invalid: {{' },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('GET /api/v1/dashboards/:id/export-yaml', () => {
  it('exports a dashboard as YAML', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/dashboards',
      headers: authHeaders(authToken),
      payload: { organizationId: ctx.organization.id, name: 'Export me' },
    });
    const { dashboard } = JSON.parse(createRes.payload);

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/dashboards/${dashboard.id}/export-yaml?organizationId=${ctx.organization.id}`,
      headers: authHeaders(authToken),
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/x-yaml');
    expect(res.payload).toContain('name: Export me');
  });

  it('returns 404 for unknown dashboard', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/dashboards/00000000-0000-0000-0000-000000000000/export-yaml?organizationId=${ctx.organization.id}`,
      headers: authHeaders(authToken),
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('POST /api/v1/dashboards/:id/panels/data', () => {
  it('returns panel data for a dashboard', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/dashboards',
      headers: authHeaders(authToken),
      payload: {
        organizationId: ctx.organization.id,
        name: 'Data dash',
        panels: [makePanel('p-data')],
      },
    });
    const { dashboard } = JSON.parse(createRes.payload);

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/dashboards/${dashboard.id}/panels/data`,
      headers: authHeaders(authToken),
      payload: { organizationId: ctx.organization.id },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload).panels).toBeDefined();
  });

  it('returns 404 for unknown dashboard', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/dashboards/00000000-0000-0000-0000-000000000000/panels/data`,
      headers: authHeaders(authToken),
      payload: { organizationId: ctx.organization.id },
    });
    expect(res.statusCode).toBe(404);
  });

  it('filters panels by panelIds when specified', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/dashboards',
      headers: authHeaders(authToken),
      payload: {
        organizationId: ctx.organization.id,
        name: 'Filter dash',
        panels: [makePanel('panel-a'), makePanel('panel-b')],
      },
    });
    const { dashboard } = JSON.parse(createRes.payload);

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/dashboards/${dashboard.id}/panels/data`,
      headers: authHeaders(authToken),
      payload: { organizationId: ctx.organization.id, panelIds: ['panel-a'] },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(Object.keys(body.panels)).toContain('panel-a');
  });

  it('returns 400 when organizationId missing from panels/data', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/dashboards/00000000-0000-0000-0000-000000000000/panels/data`,
      headers: authHeaders(authToken),
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it('applies the dashboard-level timeRange override (#305)', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/dashboards',
      headers: authHeaders(authToken),
      payload: {
        organizationId: ctx.organization.id,
        name: 'Override dash',
        panels: [makePanel('p-override')],
      },
    });
    const { dashboard } = JSON.parse(createRes.payload);

    // The stored panel is a 24h time_series; with the override the fetcher
    // must receive a config rewritten to 15m for this request only.
    vi.mocked(fetchPanelData).mockClear();
    const overridden = await app.inject({
      method: 'POST',
      url: `/api/v1/dashboards/${dashboard.id}/panels/data`,
      headers: authHeaders(authToken),
      payload: { organizationId: ctx.organization.id, timeRange: '15m' },
    });
    expect(overridden.statusCode).toBe(200);
    expect(fetchPanelData).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'time_series', interval: '15m' }),
      expect.anything(),
    );

    // Without the override the stored config wins again (nothing persisted).
    vi.mocked(fetchPanelData).mockClear();
    const plain = await app.inject({
      method: 'POST',
      url: `/api/v1/dashboards/${dashboard.id}/panels/data`,
      headers: authHeaders(authToken),
      payload: { organizationId: ctx.organization.id },
    });
    expect(plain.statusCode).toBe(200);
    expect(fetchPanelData).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'time_series', interval: '24h' }),
      expect.anything(),
    );
  });

  it('rejects an unknown timeRange override', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/dashboards/00000000-0000-0000-0000-000000000000/panels/data`,
      headers: authHeaders(authToken),
      payload: { organizationId: ctx.organization.id, timeRange: '2h' },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('POST /api/v1/dashboards/:id/set-default', () => {
  async function makeDashboard(payload: Record<string, unknown> = {}) {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/dashboards',
      headers: authHeaders(authToken),
      payload: { organizationId: ctx.organization.id, name: 'D', ...payload },
    });
    return JSON.parse(res.body).dashboard;
  }

  it('promotes a dashboard to default', async () => {
    const d = await makeDashboard();
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/dashboards/${d.id}/set-default?organizationId=${ctx.organization.id}`,
      headers: authHeaders(authToken),
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).dashboard.isDefault).toBe(true);
  });

  it('returns 400 without organizationId', async () => {
    const d = await makeDashboard();
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/dashboards/${d.id}/set-default`,
      headers: authHeaders(authToken),
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 403 for non-member', async () => {
    const d = await makeDashboard();
    const otherCtx = await createTestContext();
    const otherSession = await createTestSession(otherCtx.user.id);
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/dashboards/${d.id}/set-default?organizationId=${ctx.organization.id}`,
      headers: authHeaders(otherSession.token),
    });
    expect(res.statusCode).toBe(403);
  });

  it('returns 404 for unknown dashboard', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/dashboards/00000000-0000-0000-0000-000000000000/set-default?organizationId=${ctx.organization.id}`,
      headers: authHeaders(authToken),
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 400 when promoting a personal dashboard', async () => {
    const d = await makeDashboard({ isPersonal: true });
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/dashboards/${d.id}/set-default?organizationId=${ctx.organization.id}`,
      headers: authHeaders(authToken),
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when promoting a project-scoped dashboard', async () => {
    const d = await makeDashboard({ projectId: ctx.project.id });
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/dashboards/${d.id}/set-default?organizationId=${ctx.organization.id}`,
      headers: authHeaders(authToken),
    });
    expect(res.statusCode).toBe(400);
  });
});
