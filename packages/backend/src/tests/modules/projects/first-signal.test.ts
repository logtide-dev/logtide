import crypto from 'crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { db } from '../../../database/index.js';
import { projectsRoutes } from '../../../modules/projects/routes.js';
import { projectsService } from '../../../modules/projects/service.js';
import {
  createTestUser,
  createTestOrganization,
  createTestProject,
} from '../../helpers/factories.js';
import { createTestSession } from '../../helpers/auth.js';

describe('first-signal and last-events', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify();
    await app.register(projectsRoutes, { prefix: '/api/v1/projects' });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  async function setup() {
    const user = await createTestUser({ email: `fs-${Date.now()}-${Math.random()}@example.com` });
    const org = await createTestOrganization({ ownerId: user.id });
    const project = await createTestProject({ organizationId: org.id, userId: user.id });
    const session = await createTestSession(user.id);
    return { user, org, project, token: session.token };
  }

  const firstSignal = (token: string, projectId: string) =>
    app.inject({
      method: 'GET',
      url: `/api/v1/projects/${projectId}/first-signal`,
      headers: { Authorization: `Bearer ${token}` },
    });

  const lastEvents = (token: string, organizationId: string) =>
    app.inject({
      method: 'GET',
      url: `/api/v1/projects/last-events?organizationId=${organizationId}`,
      headers: { Authorization: `Bearer ${token}` },
    });

  async function setFlags(
    projectId: string,
    flags: { logs?: Date | null; traces?: Date | null; metrics?: Date | null },
  ) {
    await db
      .updateTable('projects')
      .set({
        ...(flags.logs !== undefined ? { has_logs_at: flags.logs } : {}),
        ...(flags.traces !== undefined ? { has_traces_at: flags.traces } : {}),
        ...(flags.metrics !== undefined ? { has_metrics_at: flags.metrics } : {}),
      })
      .where('id', '=', projectId)
      .execute();
  }

  it('is all false with null timestamps for a fresh project', async () => {
    const { token, project } = await setup();
    const res = await firstSignal(token, project.id);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      logs: false,
      traces: false,
      metrics: false,
      errors: false,
      firstAt: null,
      lastEventAt: null,
    });
  });

  it('reports logs true after has_logs_at is set through markHasData', async () => {
    const { token, project } = await setup();
    await projectsService.markHasData(project.id, 'logs');
    const body = (await firstSignal(token, project.id)).json();
    expect(body.logs).toBe(true);
    expect(body.traces).toBe(false);
    expect(body.metrics).toBe(false);
    expect(body.firstAt).not.toBeNull();
    expect(body.lastEventAt).not.toBeNull();
  });

  it('a traces-only project reports traces true and logs false', async () => {
    const { token, project } = await setup();
    await setFlags(project.id, { traces: new Date() });
    const body = (await firstSignal(token, project.id)).json();
    expect(body).toMatchObject({ logs: false, traces: true, metrics: false, errors: false });
  });

  it('a metrics-only project reports metrics true', async () => {
    const { token, project } = await setup();
    await setFlags(project.id, { metrics: new Date() });
    const body = (await firstSignal(token, project.id)).json();
    expect(body).toMatchObject({ logs: false, traces: false, metrics: true });
  });

  it('errors is true when an exception row exists for the project, false otherwise', async () => {
    const { user, token, org, project } = await setup();
    const other = await createTestProject({ organizationId: org.id, userId: user.id });
    expect((await firstSignal(token, project.id)).json().errors).toBe(false);

    // An exception on a sibling project must not count.
    await insertException(org.id, other.id);
    expect((await firstSignal(token, project.id)).json().errors).toBe(false);

    await insertException(org.id, project.id);
    const body = (await firstSignal(token, project.id)).json();
    expect(body.errors).toBe(true);
    // Errors also arrive as logs, so they do not move the timestamps.
    expect(body.lastEventAt).toBeNull();
  });

  async function insertException(organizationId: string, projectId: string) {
    await db
      .insertInto('exceptions')
      .values({
        organization_id: organizationId,
        project_id: projectId,
        log_id: crypto.randomUUID(),
        exception_type: 'Error',
        exception_message: 'boom',
        language: 'nodejs',
        fingerprint: `fp-${Math.random()}`,
        raw_stack_trace: 'Error: boom',
        frame_count: 0,
      } as never)
      .execute();
  }

  it('firstAt is the earliest flag and lastEventAt the latest', async () => {
    const { token, project } = await setup();
    const early = new Date('2026-10-01T10:00:00.000Z');
    const mid = new Date('2026-10-02T10:00:00.000Z');
    const late = new Date('2026-10-03T10:00:00.000Z');
    await setFlags(project.id, { logs: mid, traces: early, metrics: late });
    const body = (await firstSignal(token, project.id)).json();
    expect(body.firstAt).toBe(early.toISOString());
    expect(body.lastEventAt).toBe(late.toISOString());
  });

  it('404 for a soft-deleted project', async () => {
    const { token, project } = await setup();
    await db.updateTable('projects').set({ deleted_at: new Date() }).where('id', '=', project.id).execute();
    expect((await firstSignal(token, project.id)).statusCode).toBe(404);
  });

  it('404 for a user outside the organization and no signal data leaks', async () => {
    const { project } = await setup();
    await setFlags(project.id, { logs: new Date() });
    const outsider = await createTestUser({ email: `out-${Date.now()}@example.com` });
    const session = await createTestSession(outsider.id);
    const res = await firstSignal(session.token, project.id);
    expect(res.statusCode).toBe(404);
    expect(res.body).not.toContain('lastEventAt');
  });

  it('400 for a malformed project id', async () => {
    const { token } = await setup();
    expect((await firstSignal(token, 'not-a-uuid')).statusCode).toBe(400);
  });

  describe('last-events', () => {
    it('returns null for projects without data and a timestamp for those with', async () => {
      const { user, token, org, project } = await setup();
      const quiet = await createTestProject({ organizationId: org.id, userId: user.id });
      const when = new Date('2026-10-05T08:00:00.000Z');
      await setFlags(project.id, { logs: new Date('2026-10-04T08:00:00.000Z'), metrics: when });

      const res = await lastEvents(token, org.id);
      expect(res.statusCode).toBe(200);
      const { lastEvents: map } = res.json();
      expect(map[project.id]).toBe(when.toISOString());
      expect(map[quiet.id]).toBeNull();
    });

    it('is forbidden for a foreign organizationId and reveals nothing', async () => {
      const { org } = await setup();
      const outsider = await createTestUser({ email: `lo-${Date.now()}@example.com` });
      const session = await createTestSession(outsider.id);
      const res = await lastEvents(session.token, org.id);
      expect(res.statusCode).toBe(403);
      expect(res.json().lastEvents).toBeUndefined();
    });

    it('never includes soft-deleted projects', async () => {
      const { user, token, org, project } = await setup();
      const gone = await createTestProject({ organizationId: org.id, userId: user.id });
      await db.updateTable('projects').set({ deleted_at: new Date() }).where('id', '=', gone.id).execute();
      const { lastEvents: map } = (await lastEvents(token, org.id)).json();
      expect(Object.keys(map)).toEqual([project.id]);
    });

    it('requires organizationId', async () => {
      const { token } = await setup();
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/projects/last-events',
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(400);
    });
  });
});
