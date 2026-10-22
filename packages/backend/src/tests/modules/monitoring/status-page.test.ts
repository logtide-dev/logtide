import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { db } from '../../../database/index.js';
import { config } from '../../../config/index.js';
import { publicStatusRoutes } from '../../../modules/monitoring/routes.js';
import { statusPageRoutes } from '../../../modules/monitoring/status-page-routes.js';
import { createTestContext, createTestSession, createTestUser } from '../../helpers/index.js';

vi.mock('../../../queue/jobs/monitor-notification.js', () => ({
  monitorNotificationQueue: { add: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock('../../../database/reservoir.js', () => ({ reservoir: {} }));

let app: FastifyInstance;
let ctx: Awaited<ReturnType<typeof createTestContext>>;
let adminToken: string;

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

async function makePublic(projectId = ctx.project.id) {
  await db.updateTable('projects').set({ status_page_visibility: 'public' }).where('id', '=', projectId).execute();
}

async function addMonitor(
  over: Partial<{
    name: string;
    display_name: string | null;
    group_name: string | null;
    display_order: number;
    created_at: Date;
    type: 'http' | 'tcp';
    projectId: string;
    organizationId: string;
    status: 'up' | 'down';
  }> = {}
) {
  const row = await db
    .insertInto('monitors')
    .values({
      organization_id: over.organizationId ?? ctx.organization.id,
      project_id: over.projectId ?? ctx.project.id,
      name: over.name ?? 'Monitor',
      type: over.type ?? 'http',
      target: 'https://example.com',
      display_name: over.display_name ?? null,
      group_name: over.group_name ?? null,
      display_order: over.display_order ?? 0,
      ...(over.created_at ? { created_at: over.created_at } : {}),
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  if (over.status) {
    await db
      .insertInto('monitor_status')
      .values({ monitor_id: row.id, status: over.status })
      .execute();
  }
  return row.id;
}

async function addMember(role: 'member' | 'admin') {
  const user = await createTestUser();
  await db
    .insertInto('organization_members')
    .values({ user_id: user.id, organization_id: ctx.organization.id, role })
    .execute();
  const session = await createTestSession(user.id);
  return session.token;
}

beforeAll(async () => {
  app = Fastify();
  await app.register(publicStatusRoutes, { prefix: '/status' });
  await app.register(statusPageRoutes, { prefix: '/api/v1/status-page' });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  ctx = await createTestContext();
  adminToken = (await createTestSession(ctx.user.id)).token;
});

const q = () => `organizationId=${ctx.organization.id}&projectId=${ctx.project.id}`;

describe('status page config', () => {
  it('GET returns defaults when no row exists', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/v1/status-page/config?${q()}`, headers: auth(adminToken) });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.config).toEqual({
      title: null,
      description: null,
      logoUrl: null,
      accentColor: null,
      showMonitorTypes: false,
    });
    expect(body.subscriptionsAvailable).toBe(false); // visibility is not public
  });

  it('GET lets a plain member read the config', async () => {
    const memberToken = await addMember('member');
    const res = await app.inject({ method: 'GET', url: `/api/v1/status-page/config?${q()}`, headers: auth(memberToken) });
    expect(res.statusCode).toBe(200);
  });

  it('PUT config as member is 403, as admin 200 and upserts', async () => {
    const memberToken = await addMember('member');
    const body = { organizationId: ctx.organization.id, projectId: ctx.project.id, title: 'Acme status' };
    const denied = await app.inject({ method: 'PUT', url: '/api/v1/status-page/config', headers: auth(memberToken), payload: body });
    expect(denied.statusCode).toBe(403);

    const adminToken2 = await addMember('admin');
    const ok = await app.inject({ method: 'PUT', url: '/api/v1/status-page/config', headers: auth(adminToken2), payload: body });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().config.title).toBe('Acme status');

    // Second write updates the same row and keeps untouched fields
    const again = await app.inject({
      method: 'PUT',
      url: '/api/v1/status-page/config',
      headers: auth(adminToken),
      payload: { organizationId: ctx.organization.id, projectId: ctx.project.id, accentColor: '#1a2B3c' },
    });
    expect(again.json().config).toMatchObject({ title: 'Acme status', accentColor: '#1a2B3c' });
    const rows = await db.selectFrom('status_page_config').selectAll().where('project_id', '=', ctx.project.id).execute();
    expect(rows).toHaveLength(1);
  });

  it.each([
    ['http', 'http://example.com/logo.png'],
    ['javascript', 'javascript:alert(1)'],
    ['data', 'data:image/png;base64,AAAA'],
    ['credentials', 'https://user:pw@example.com/logo.png'],
  ])('rejects logoUrl with %s', async (_label, logoUrl) => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/v1/status-page/config',
      headers: auth(adminToken),
      payload: { organizationId: ctx.organization.id, projectId: ctx.project.id, logoUrl },
    });
    expect(res.statusCode).toBe(400);
  });

  it('accepts an https logoUrl', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/v1/status-page/config',
      headers: auth(adminToken),
      payload: { organizationId: ctx.organization.id, projectId: ctx.project.id, logoUrl: 'https://example.com/logo.png' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().config.logoUrl).toBe('https://example.com/logo.png');
  });

  it.each(['#12345', 'red', '#12345g', '123456'])('rejects accent colour %s', async (accentColor) => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/v1/status-page/config',
      headers: auth(adminToken),
      payload: { organizationId: ctx.organization.id, projectId: ctx.project.id, accentColor },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects an over-long title and description', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/v1/status-page/config',
      headers: auth(adminToken),
      payload: { organizationId: ctx.organization.id, projectId: ctx.project.id, title: 'x'.repeat(121) },
    });
    expect(res.statusCode).toBe(400);
    const res2 = await app.inject({
      method: 'PUT',
      url: '/api/v1/status-page/config',
      headers: auth(adminToken),
      payload: { organizationId: ctx.organization.id, projectId: ctx.project.id, description: 'x'.repeat(501) },
    });
    expect(res2.statusCode).toBe(400);
  });

  it('refuses a project of another organization', async () => {
    const other = await createTestContext();
    const res = await app.inject({
      method: 'PUT',
      url: '/api/v1/status-page/config',
      headers: auth(adminToken),
      payload: { organizationId: ctx.organization.id, projectId: other.project.id, title: 'x' },
    });
    expect(res.statusCode).toBe(400);
    const rows = await db.selectFrom('status_page_config').selectAll().where('project_id', '=', other.project.id).execute();
    expect(rows).toHaveLength(0);
  });
});

describe('status page components', () => {
  it('PUT components updates names, groups and order in one transaction', async () => {
    const a = await addMonitor({ name: 'A' });
    const b = await addMonitor({ name: 'B' });
    const res = await app.inject({
      method: 'PUT',
      url: '/api/v1/status-page/components',
      headers: auth(adminToken),
      payload: {
        organizationId: ctx.organization.id,
        projectId: ctx.project.id,
        components: [
          { monitorId: a, displayName: 'Public API', groupName: 'Core', order: 2 },
          { monitorId: b, displayName: null, groupName: null, order: 1 },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    const rows = await db.selectFrom('monitors').select(['id', 'display_name', 'group_name', 'display_order']).where('id', 'in', [a, b]).execute();
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get(a)).toMatchObject({ display_name: 'Public API', group_name: 'Core', display_order: 2 });
    expect(byId.get(b)).toMatchObject({ display_name: null, group_name: null, display_order: 1 });
  });

  it('PUT components rejects a monitor of another project with 400 and changes nothing', async () => {
    const mine = await addMonitor({ name: 'Mine' });
    const other = await createTestContext();
    const foreign = await addMonitor({ name: 'Foreign', projectId: other.project.id, organizationId: other.organization.id });
    const res = await app.inject({
      method: 'PUT',
      url: '/api/v1/status-page/components',
      headers: auth(adminToken),
      payload: {
        organizationId: ctx.organization.id,
        projectId: ctx.project.id,
        components: [
          { monitorId: mine, displayName: 'Changed', groupName: 'G', order: 5 },
          { monitorId: foreign, displayName: 'Hijacked', groupName: null, order: 1 },
        ],
      },
    });
    expect(res.statusCode).toBe(400);
    const rows = await db.selectFrom('monitors').select(['id', 'display_name', 'display_order']).where('id', 'in', [mine, foreign]).execute();
    for (const r of rows) {
      expect(r.display_name).toBeNull();
      expect(r.display_order).toBe(0);
    }
  });

  it('PUT components as member is 403 and duplicates are 400', async () => {
    const a = await addMonitor();
    const memberToken = await addMember('member');
    const payload = {
      organizationId: ctx.organization.id,
      projectId: ctx.project.id,
      components: [{ monitorId: a, displayName: null, groupName: null, order: 0 }],
    };
    const denied = await app.inject({ method: 'PUT', url: '/api/v1/status-page/components', headers: auth(memberToken), payload });
    expect(denied.statusCode).toBe(403);
    const dup = await app.inject({
      method: 'PUT',
      url: '/api/v1/status-page/components',
      headers: auth(adminToken),
      payload: { ...payload, components: [payload.components[0], payload.components[0]] },
    });
    expect(dup.statusCode).toBe(400);
  });
});

describe('public status payload', () => {
  const url = () => `/status/${ctx.organization.slug}/${ctx.project.slug}`;

  it('uses displayName as the public name and groupName', async () => {
    await makePublic();
    await addMonitor({ name: 'internal-api-01', display_name: 'API', group_name: 'Core', status: 'up' });
    const body = (await app.inject({ method: 'GET', url: url() })).json();
    expect(body.monitors).toHaveLength(1);
    expect(body.monitors[0]).toMatchObject({ name: 'API', groupName: 'Core', status: 'up' });
  });

  it('omits type unless showMonitorTypes is true', async () => {
    await makePublic();
    await addMonitor({ name: 'A' });
    let body = (await app.inject({ method: 'GET', url: url() })).json();
    expect(body.showMonitorTypes).toBe(false);
    expect(body.monitors[0]).not.toHaveProperty('type');

    await db
      .insertInto('status_page_config')
      .values({ project_id: ctx.project.id, organization_id: ctx.organization.id, show_monitor_types: true })
      .execute();
    body = (await app.inject({ method: 'GET', url: url() })).json();
    expect(body.showMonitorTypes).toBe(true);
    expect(body.monitors[0].type).toBe('http');
  });

  it('orders by display_order then created_at with stable ties', async () => {
    await makePublic();
    const t = (n: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, n));
    await addMonitor({ name: 'late-first', display_order: 0, created_at: t(30) });
    await addMonitor({ name: 'early-second', display_order: 0, created_at: t(10) });
    await addMonitor({ name: 'last', display_order: 5, created_at: t(1) });
    await addMonitor({ name: 'tie-a', display_order: 1, created_at: t(20) });
    await addMonitor({ name: 'tie-b', display_order: 1, created_at: t(20) });
    const first = (await app.inject({ method: 'GET', url: url() })).json();
    const second = (await app.inject({ method: 'GET', url: url() })).json();
    const names = first.monitors.map((m: any) => m.name);
    expect(names.slice(0, 2)).toEqual(['early-second', 'late-first']);
    expect(names[2]).toMatch(/^tie-/);
    expect(names[3]).toMatch(/^tie-/);
    expect(names[4]).toBe('last');
    expect(second.monitors.map((m: any) => m.name)).toEqual(names);
  });

  it('returns up to 90 uptime buckets with totalChecks', async () => {
    await makePublic();
    const id = await addMonitor({ name: 'History' });
    const now = Date.now();
    await db
      .insertInto('monitor_results')
      .values([
        { time: new Date(now - 60_000), monitor_id: id, organization_id: ctx.organization.id, project_id: ctx.project.id, status: 'up' as const },
        { time: new Date(now - 120_000), monitor_id: id, organization_id: ctx.organization.id, project_id: ctx.project.id, status: 'down' as const },
      ])
      .execute();
    const { sql } = await import('kysely');
    await sql`CALL refresh_continuous_aggregate('monitor_uptime_daily', NOW() - INTERVAL '120 days', NOW() + INTERVAL '1 day')`.execute(db);
    const body = (await app.inject({ method: 'GET', url: url() })).json();
    const history = body.monitors[0].uptimeHistory;
    expect(history.length).toBeGreaterThanOrEqual(1);
    expect(history.length).toBeLessThanOrEqual(90);
    const total = history.reduce((n: number, h: any) => n + h.totalChecks, 0);
    expect(total).toBe(2);
    expect(typeof history[0].uptimePct).toBe('number');
    expect(body.historyDays).toBe(90);
  });

  describe('branding and subscriptions flag', () => {
    const original = config.SMTP_HOST;
    afterEach(() => {
      (config as any).SMTP_HOST = original;
    });

    it('includes branding and subscriptionsEnabled true for public pages with SMTP', async () => {
      await makePublic();
      (config as any).SMTP_HOST = 'smtp.example.com';
      await db
        .insertInto('status_page_config')
        .values({
          project_id: ctx.project.id,
          organization_id: ctx.organization.id,
          title: 'Acme status',
          description: 'Live service health',
          logo_url: 'https://example.com/logo.png',
          accent_color: '#112233',
        })
        .execute();
      const body = (await app.inject({ method: 'GET', url: url() })).json();
      expect(body).toMatchObject({
        title: 'Acme status',
        description: 'Live service health',
        logoUrl: 'https://example.com/logo.png',
        accentColor: '#112233',
        subscriptionsEnabled: true,
      });
    });

    it('subscriptionsEnabled is false without SMTP', async () => {
      await makePublic();
      (config as any).SMTP_HOST = undefined;
      const body = (await app.inject({ method: 'GET', url: url() })).json();
      expect(body.subscriptionsEnabled).toBe(false);
    });

    it('subscriptionsEnabled is false for non-public visibility', async () => {
      (config as any).SMTP_HOST = 'smtp.example.com';
      await db.updateTable('projects').set({ status_page_visibility: 'members_only' }).where('id', '=', ctx.project.id).execute();
      const token = (await createTestSession(ctx.user.id)).token;
      const body = (await app.inject({ method: 'GET', url: url(), headers: auth(token) })).json();
      expect(body.subscriptionsEnabled).toBe(false);
    });
  });

  it('recentIncidents includes resolved incidents of the last 90 days and caps at 50', async () => {
    await makePublic();
    const now = Date.now();
    const rows = [];
    for (let i = 0; i < 55; i++) {
      rows.push({
        organization_id: ctx.organization.id,
        project_id: ctx.project.id,
        title: `Resolved ${i}`,
        status: 'resolved' as const,
        severity: 'minor' as const,
        resolved_at: new Date(now - (i + 1) * 3600_000),
      });
    }
    rows.push({
      organization_id: ctx.organization.id,
      project_id: ctx.project.id,
      title: 'Ancient',
      status: 'resolved' as const,
      severity: 'minor' as const,
      resolved_at: new Date(now - 100 * 86400_000),
    });
    await db.insertInto('status_incidents').values(rows).execute();
    const body = (await app.inject({ method: 'GET', url: url() })).json();
    expect(body.recentIncidents).toHaveLength(50);
    expect(body.recentIncidents.map((i: any) => i.title)).not.toContain('Ancient');
    expect(body.recentIncidents[0].title).toBe('Resolved 0');
    expect(body.recentIncidents[0].affectedComponents).toEqual([]);

    // An 80 day old resolved incident is still listed (inside 90 days)
    await db.deleteFrom('status_incidents').where('project_id', '=', ctx.project.id).execute();
    await db
      .insertInto('status_incidents')
      .values({
        organization_id: ctx.organization.id,
        project_id: ctx.project.id,
        title: 'Eighty days',
        status: 'resolved',
        severity: 'major',
        resolved_at: new Date(now - 80 * 86400_000),
      })
      .execute();
    const body2 = (await app.inject({ method: 'GET', url: url() })).json();
    expect(body2.recentIncidents.map((i: any) => i.title)).toEqual(['Eighty days']);
  });

  it('works for a project with zero monitors', async () => {
    await makePublic();
    const res = await app.inject({ method: 'GET', url: url() });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.overallStatus).toBe('operational');
    expect(body.monitors).toEqual([]);
  });

  it('unicode display names round-trip', async () => {
    await makePublic();
    await addMonitor({ name: 'x', display_name: 'Pagamenti ☕ 日本語', group_name: 'Équipe' });
    const body = (await app.inject({ method: 'GET', url: url() })).json();
    expect(body.monitors[0].name).toBe('Pagamenti ☕ 日本語');
    expect(body.monitors[0].groupName).toBe('Équipe');
  });
});
