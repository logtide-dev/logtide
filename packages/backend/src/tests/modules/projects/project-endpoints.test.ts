import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { sql } from 'kysely';
import Fastify, { type FastifyInstance } from 'fastify';
import { db } from '../../../database/index.js';
import { reservoir } from '../../../database/reservoir.js';
import { projectsService } from '../../../modules/projects/service.js';
import * as uptimeStats from '../../../modules/monitoring/uptime-stats.js';
import { projectsRoutes } from '../../../modules/projects/routes.js';
import { clearProjectStatsCache } from '../../../modules/projects/stats.js';
import { getProjectHealthSettings } from '../../../modules/project-health/index.js';
import {
  createTestUser,
  createTestOrganization,
  createTestProject,
} from '../../helpers/factories.js';
import { createTestSession } from '../../helpers/auth.js';

vi.mock('../../../modules/monitoring/uptime-stats.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../modules/monitoring/uptime-stats.js')>();
  return { ...actual, getUptimeSummary: vi.fn((...args: Parameters<typeof actual.getUptimeSummary>) => actual.getUptimeSummary(...args)) };
});

describe('project stats, health and summary endpoints', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify();
    await app.register(projectsRoutes, { prefix: '/api/v1/projects' });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => clearProjectStatsCache());
  afterEach(() => vi.restoreAllMocks());

  async function setup(role: 'owner' | 'member' = 'owner') {
    const owner = await createTestUser({ email: `ph-${Date.now()}-${Math.random()}@example.com` });
    const org = await createTestOrganization({ ownerId: owner.id });
    const project = await createTestProject({ organizationId: org.id, userId: owner.id });
    let user = owner;
    if (role === 'member') {
      user = await createTestUser({ email: `phm-${Date.now()}-${Math.random()}@example.com` });
      await db
        .insertInto('organization_members')
        .values({ user_id: user.id, organization_id: org.id, role: 'member' })
        .execute();
    }
    const session = await createTestSession(user.id);
    return { owner, org, project, token: session.token };
  }

  const call = (token: string, method: 'GET' | 'PUT', url: string, payload?: unknown) =>
    app.inject({
      method,
      url: `/api/v1/projects${url}`,
      headers: { Authorization: `Bearer ${token}` },
      payload: payload as never,
    });

  describe('GET /stats', () => {
    it('returns 24 hourly buckets and open incident counts', async () => {
      const { org, project, token } = await setup();
      await db
        .insertInto('incidents')
        .values([
          { organization_id: org.id, project_id: project.id, title: 'a', severity: 'high', status: 'open' },
          { organization_id: org.id, project_id: project.id, title: 'b', severity: 'high', status: 'resolved' },
        ])
        .execute();
      const res = await call(token, 'GET', `/stats?organizationId=${org.id}`);
      expect(res.statusCode).toBe(200);
      const entry = res.json().projects[project.id];
      expect(entry.hourly).toHaveLength(24);
      expect(entry.openIncidents).toBe(1);
      expect(entry.logs24h).toBe(0);
    });

    it('403 for another org, 400 without organizationId', async () => {
      const a = await setup();
      const b = await setup();
      expect((await call(a.token, 'GET', `/stats?organizationId=${b.org.id}`)).statusCode).toBe(403);
      expect((await call(a.token, 'GET', '/stats')).statusCode).toBe(400);
    });

    it('a failing reservoir call drops only that project', async () => {
      const { owner, org, project, token } = await setup();
      const second = await createTestProject({ organizationId: org.id, userId: owner.id });
      const real = reservoir.aggregate.bind(reservoir);
      vi.spyOn(reservoir, 'aggregate').mockImplementation(async (params: any) => {
        if (params.projectId === project.id) throw new Error('boom');
        return real(params);
      });
      const res = await call(token, 'GET', `/stats?organizationId=${org.id}`);
      expect(res.statusCode).toBe(200);
      const projects = res.json().projects;
      expect(projects[project.id]).toBeUndefined();
      expect(projects[second.id]).toBeDefined();
    });

    it('sums error and critical levels', async () => {
      const { org, project, token } = await setup();
      vi.spyOn(reservoir, 'aggregate').mockImplementation(
        async () =>
          ({
            total: 15,
            timeseries: [
              {
                bucket: new Date(Math.floor(Date.now() / 3600_000) * 3600_000),
                total: 15,
                byLevel: { error: 3, critical: 2, info: 10 },
              },
            ],
          }) as never
      );
      const res = await call(token, 'GET', `/stats?organizationId=${org.id}`);
      const entry = res.json().projects[project.id];
      expect(entry.logs24h).toBe(15);
      expect(entry.errors24h).toBe(5);
      expect(entry.hourly[23]).toBe(15);
    });
  });

  describe('GET /health-summary and /:id/health', () => {
    it('no_data until an event arrives, then healthy', async () => {
      const { org, project, token } = await setup();
      let res = await call(token, 'GET', `/health-summary?organizationId=${org.id}`);
      expect(res.json().projects[project.id]).toEqual({ status: 'no_data', openIssues: [] });
      await db.updateTable('projects').set({ has_logs_at: new Date() }).where('id', '=', project.id).execute();
      res = await call(token, 'GET', `/health-summary?organizationId=${org.id}`);
      expect(res.json().projects[project.id].status).toBe('healthy');
    });

    it('critical unless muted', async () => {
      const { org, project, token } = await setup();
      await db.updateTable('projects').set({ has_logs_at: new Date() }).where('id', '=', project.id).execute();
      await db
        .insertInto('project_health_issues')
        .values({
          organization_id: org.id,
          project_id: project.id,
          check_key: 'silent',
          severity: 'critical',
          opened_at: new Date(),
          last_seen_at: new Date(),
          details: {},
        } as never)
        .execute();
      let res = await call(token, 'GET', `/health-summary?organizationId=${org.id}`);
      expect(res.json().projects[project.id].status).toBe('critical');
      expect(
        (await call(token, 'PUT', `/${project.id}/health/mutes/silent`, { duration: '24h' })).statusCode
      ).toBe(204);
      res = await call(token, 'GET', `/health-summary?organizationId=${org.id}`);
      expect(res.json().projects[project.id].status).toBe('healthy');
      expect(res.json().projects[project.id].openIssues[0].muted).toBe(true);
      const health = (await call(token, 'GET', `/${project.id}/health`)).json();
      expect(health.issues).toHaveLength(1);
      expect(health.issues[0].mute).not.toBeNull();
      expect(health.checks).toMatchObject({ piiRejected24h: 0, revokedKey24h: 0, receiving: true });
      expect(health.settings).toEqual({ silentMinutes: 60, healthChannelIds: [] });
      expect(
        (await call(token, 'PUT', `/${project.id}/health/mutes/silent`, { duration: null })).statusCode
      ).toBe(204);
    });

    it('403 summary for another org; 404 for projects of another org', async () => {
      const a = await setup();
      const b = await setup();
      expect((await call(a.token, 'GET', `/health-summary?organizationId=${b.org.id}`)).statusCode).toBe(403);
      expect((await call(a.token, 'GET', `/${b.project.id}/health`)).statusCode).toBe(404);
      expect((await call(a.token, 'GET', `/${b.project.id}/summary`)).statusCode).toBe(404);
      expect(
        (await call(a.token, 'PUT', `/${b.project.id}/health/mutes/silent`, { duration: '24h' })).statusCode
      ).toBe(404);
      expect(
        (await call(a.token, 'PUT', `/${b.project.id}/notification-settings`, { silentMinutes: 30 })).statusCode
      ).toBe(404);
    });
  });

  describe('GET /:id/health secondary sources', () => {
    it('a failing skew source does not 500 the response', async () => {
      const { project, token } = await setup();
      vi.spyOn(projectsService, 'getIngestionHealth').mockRejectedValue(new Error('boom'));
      const res = await call(token, 'GET', `/${project.id}/health`);
      expect(res.statusCode).toBe(200);
      expect(res.json().checks.skew).toEqual({ logs: null, spans: null, metrics: null });
      expect(res.json().checks.piiRejected24h).toBe(0);
    });
  });

  describe('GET /:id/summary', () => {
    it('runs per-monitor uptime lookups with bounded concurrency', async () => {
      const { org, project, token } = await setup();
      for (let i = 0; i < 12; i++) {
        await db
          .insertInto('monitors')
          .values({ organization_id: org.id, project_id: project.id, name: `m${i}`, type: 'http', target: 'https://x.test' } as never)
          .execute();
      }
      let inFlight = 0;
      let peak = 0;
      vi.mocked(uptimeStats.getUptimeSummary).mockImplementation((async () => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 15));
        inFlight--;
        return null;
      }) as never);
      try {
        const res = await call(token, 'GET', `/${project.id}/summary`);
        expect(res.statusCode).toBe(200);
        expect(peak).toBeGreaterThan(1);
        expect(peak).toBeLessThanOrEqual(5);
      } finally {
        vi.mocked(uptimeStats.getUptimeSummary).mockReset();
      }
    });

    it('returns tiles, each field independently null on failure', async () => {
      const { project, token } = await setup();
      let res = await call(token, 'GET', `/${project.id}/summary`);
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({
        logs24h: 0,
        openErrorGroups: 0,
        tracesP95Ms: null,
        uptime30dPct: null,
        monitorCount: 0,
        openIncidents: 0,
      });
      vi.spyOn(reservoir, 'aggregate').mockRejectedValue(new Error('down'));
      res = await call(token, 'GET', `/${project.id}/summary`);
      expect(res.statusCode).toBe(200);
      expect(res.json().logs24h).toBeNull();
      expect(res.json().openIncidents).toBe(0);
    });

    it('weights uptime by totalChecks', async () => {
      const { org, project, token } = await setup();
      const mk = async (name: string) =>
        (
          await db
            .insertInto('monitors')
            .values({
              organization_id: org.id,
              project_id: project.id,
              name,
              type: 'http',
              target: 'https://x.test',
            } as never)
            .returning('id')
            .executeTakeFirstOrThrow()
        ).id;
      const m1 = await mk('m1');
      const m2 = await mk('m2');
      const rows = (monitorId: string, up: number, total: number) =>
        Array.from({ length: total }, (_, i) => ({
          time: new Date(Date.now() - (i + 1) * 1000),
          monitor_id: monitorId,
          organization_id: org.id,
          status: i < up ? 'up' : 'down',
          project_id: project.id,
        }));
      await db
        .insertInto('monitor_results')
        .values([...rows(m1, 4, 4), ...rows(m2, 2, 4)] as never)
        .execute();
      await sql`CALL refresh_continuous_aggregate('monitor_uptime_daily', NULL, date_trunc('day', NOW() + INTERVAL '1 day'))`.execute(db);
      const res = await call(token, 'GET', `/${project.id}/summary`);
      expect(res.json().monitorCount).toBe(2);
      expect(res.json().uptime30dPct).toBe(75);
    });
  });

  describe('PUT validation and roles', () => {
    it('member can GET but PUT is 403', async () => {
      const { org, project, token } = await setup('member');
      expect((await call(token, 'GET', `/${project.id}/health`)).statusCode).toBe(200);
      expect((await call(token, 'GET', `/stats?organizationId=${org.id}`)).statusCode).toBe(200);
      expect(
        (await call(token, 'PUT', `/${project.id}/health/mutes/silent`, { duration: '24h' })).statusCode
      ).toBe(403);
      expect(
        (await call(token, 'PUT', `/${project.id}/notification-settings`, { silentMinutes: 30 })).statusCode
      ).toBe(403);
    });

    it('409 when changing mutes or settings of a soft-deleted project', async () => {
      const { project, token } = await setup();
      await db.updateTable('projects').set({ deleted_at: new Date() }).where('id', '=', project.id).execute();
      const m = await call(token, 'PUT', `/${project.id}/health/mutes/silent`, { duration: '24h' });
      expect(m.statusCode).toBe(409);
      expect(m.json().error).toBe('Cannot update a deleted project');
      const n = await call(token, 'PUT', `/${project.id}/notification-settings`, { silentMinutes: 30 });
      expect(n.statusCode).toBe(409);
      expect(n.json().error).toBe('Cannot update a deleted project');
    });

    it('400 on invalid check key, duration and silentMinutes', async () => {
      const { project, token } = await setup();
      expect(
        (await call(token, 'PUT', `/${project.id}/health/mutes/nope`, { duration: '24h' })).statusCode
      ).toBe(400);
      expect(
        (await call(token, 'PUT', `/${project.id}/health/mutes/silent`, { duration: '1h' })).statusCode
      ).toBe(400);
      expect(
        (await call(token, 'PUT', `/${project.id}/notification-settings`, { silentMinutes: 5 })).statusCode
      ).toBe(400);
      expect(
        (await call(token, 'PUT', `/${project.id}/notification-settings`, { silentMinutes: 1441 })).statusCode
      ).toBe(400);
    });

    it('saves settings and rejects channels of another org', async () => {
      const a = await setup();
      const b = await setup();
      const mkChannel = async (orgId: string) =>
        (
          await db
            .insertInto('notification_channels')
            .values({
              organization_id: orgId,
              name: 'c',
              type: 'email',
              config: { recipients: ['a@b.co'] },
              enabled: true,
            } as never)
            .returning('id')
            .executeTakeFirstOrThrow()
        ).id;
      const own = await mkChannel(a.org.id);
      const foreign = await mkChannel(b.org.id);
      const bad = await call(a.token, 'PUT', `/${a.project.id}/notification-settings`, {
        healthChannelIds: [foreign],
      });
      expect(bad.statusCode).toBe(400);
      const ok = await call(a.token, 'PUT', `/${a.project.id}/notification-settings`, {
        healthChannelIds: [own],
        silentMinutes: 30,
      });
      expect(ok.statusCode).toBe(200);
      expect(ok.json()).toEqual({ silentMinutes: 30, healthChannelIds: [own] });
      expect((await getProjectHealthSettings(a.org.id, a.project.id)).silentMinutes).toBe(30);
    });
  });
});
