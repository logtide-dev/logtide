import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import crypto, { randomUUID } from 'node:crypto';
import { db } from '../../../database/index.js';
import { exceptionsRoutes } from '../../../modules/exceptions/routes.js';
import {
  createTestContext,
  createTestLog,
  createTestProject,
  createTestUser,
} from '../../helpers/factories.js';

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

type Ctx = Awaited<ReturnType<typeof createTestContext>>;

async function createSession(userId: string) {
  const token = crypto.randomBytes(32).toString('hex');
  await db
    .insertInto('sessions')
    .values({ user_id: userId, token, expires_at: new Date(Date.now() + DAY) })
    .execute();
  return token;
}

async function makeGroup(ctx: Ctx, fingerprint: string, over: Record<string, unknown> = {}, projectId: string | null = ctx.project.id) {
  return db
    .insertInto('error_groups')
    .values({
      organization_id: ctx.organization.id,
      project_id: projectId,
      fingerprint,
      exception_type: 'TypeError',
      exception_message: 'boom',
      language: 'nodejs',
      occurrence_count: 1,
      first_seen: new Date(),
      last_seen: new Date(),
      ...over,
    } as never)
    .returningAll()
    .executeTakeFirstOrThrow();
}

async function addException(
  ctx: Ctx,
  fingerprint: string,
  over: { id?: string; createdAt?: Date; logId?: string } = {},
) {
  return db
    .insertInto('exceptions')
    .values({
      ...(over.id ? { id: over.id } : {}),
      organization_id: ctx.organization.id,
      project_id: ctx.project.id,
      log_id: over.logId ?? randomUUID(),
      exception_type: 'TypeError',
      exception_message: 'boom',
      language: 'nodejs',
      fingerprint,
      raw_stack_trace: 'TypeError: boom\n    at f (/app/a.js:1:1)',
      frame_count: 0,
      created_at: over.createdAt ?? new Date(),
    } as never)
    .returningAll()
    .executeTakeFirstOrThrow();
}

async function addMember(ctx: Ctx, role = 'member') {
  const user = await createTestUser({ email: `m-${randomUUID()}@example.com`, name: 'Member One' });
  await db
    .insertInto('organization_members')
    .values({ user_id: user.id, organization_id: ctx.organization.id, role } as never)
    .execute();
  return user;
}

describe('Error group triage routes', () => {
  let app: FastifyInstance;
  let ctx: Ctx;
  let token: string;
  let auth: { authorization: string };

  beforeAll(async () => {
    app = Fastify();
    await app.register(exceptionsRoutes);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await db.deleteFrom('stack_frames').execute();
    await db.deleteFrom('exceptions').execute();
    await db.deleteFrom('error_groups').execute();
    ctx = await createTestContext();
    token = await createSession(ctx.user.id);
    auth = { authorization: `Bearer ${token}` };
  });

  const get = (url: string, query: Record<string, unknown> = {}, headers = auth) =>
    app.inject({ method: 'GET', url, headers, query: { organizationId: ctx.organization.id, ...query } as never });

  const send = (method: 'PATCH' | 'POST', url: string, payload: Record<string, unknown>, headers = auth) =>
    app.inject({ method, url, headers, payload: { organizationId: ctx.organization.id, ...payload } });

  async function row(id: string) {
    return db.selectFrom('error_groups').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
  }

  describe('GET /api/v1/error-groups (list)', () => {
    it('accepts a comma separated project list', async () => {
      const p2 = await createTestProject({ organizationId: ctx.organization.id, userId: ctx.user.id });
      const p3 = await createTestProject({ organizationId: ctx.organization.id, userId: ctx.user.id });
      await makeGroup(ctx, 'fp-a', {}, ctx.project.id);
      await makeGroup(ctx, 'fp-b', {}, p2.id);
      await makeGroup(ctx, 'fp-c', {}, p3.id);

      const res = await get('/api/v1/error-groups', { projectId: `${ctx.project.id},${p2.id}` });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.total).toBe(2);
      expect(body.groups.map((g: any) => g.projectId).sort()).toEqual([ctx.project.id, p2.id].sort());
    });

    it('rejects a malformed project id with 400', async () => {
      const res = await get('/api/v1/error-groups', { projectId: `${ctx.project.id},not-a-uuid` });
      expect(res.statusCode).toBe(400);
    });

    it('filters by from and to on last_seen', async () => {
      await makeGroup(ctx, 'fp-recent', { last_seen: new Date(Date.now() - HOUR) });
      await makeGroup(ctx, 'fp-old', { last_seen: new Date(Date.now() - 3 * DAY) });

      const res = await get('/api/v1/error-groups', {
        from: new Date(Date.now() - DAY).toISOString(),
        to: new Date().toISOString(),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().groups.map((g: any) => g.fingerprint)).toEqual(['fp-recent']);
    });

    it('sort=events orders by occurrence count', async () => {
      await makeGroup(ctx, 'fp-few', { occurrence_count: 2 });
      await makeGroup(ctx, 'fp-many', { occurrence_count: 50 });

      const res = await get('/api/v1/error-groups', { sort: 'events' });
      expect(res.json().groups.map((g: any) => g.fingerprint)).toEqual(['fp-many', 'fp-few']);
    });

    it('assignedTo=unassigned returns only groups without assignee', async () => {
      const member = await addMember(ctx);
      await makeGroup(ctx, 'fp-assigned', { assigned_to: member.id });
      await makeGroup(ctx, 'fp-free');

      const res = await get('/api/v1/error-groups', { assignedTo: 'unassigned' });
      expect(res.json().groups.map((g: any) => g.fingerprint)).toEqual(['fp-free']);
    });

    it('rejects an unknown sort with 400', async () => {
      const res = await get('/api/v1/error-groups', { sort: 'bogus' });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('PATCH /api/v1/error-groups/:id', () => {
    it('assigns a member', async () => {
      const member = await addMember(ctx);
      const g = await makeGroup(ctx, 'fp-1');

      const res = await send('PATCH', `/api/v1/error-groups/${g.id}`, { assignedTo: member.id });
      expect(res.statusCode).toBe(200);
      expect(res.json().assignedTo).toBe(member.id);
      expect((await row(g.id)).assigned_to).toBe(member.id);
    });

    it('rejects a non-member assignee with 400', async () => {
      const outsider = await createTestUser({ email: `o-${randomUUID()}@example.com` });
      const g = await makeGroup(ctx, 'fp-2');

      const res = await send('PATCH', `/api/v1/error-groups/${g.id}`, { assignedTo: outsider.id });
      expect(res.statusCode).toBe(400);
      expect((await row(g.id)).assigned_to).toBeNull();
    });

    it('ignores with a future date', async () => {
      const g = await makeGroup(ctx, 'fp-3');
      const until = new Date(Date.now() + DAY).toISOString();

      const res = await send('PATCH', `/api/v1/error-groups/${g.id}`, { status: 'ignored', ignoredUntil: until });
      expect(res.statusCode).toBe(200);
      const r = await row(g.id);
      expect(r.status).toBe('ignored');
      expect(new Date(r.ignored_until as never).toISOString()).toBe(until);
    });

    it('ignore until past date is 400 and writes nothing', async () => {
      const g = await makeGroup(ctx, 'fp-4');

      const res = await send('PATCH', `/api/v1/error-groups/${g.id}`, {
        status: 'ignored',
        ignoredUntil: new Date(Date.now() - HOUR).toISOString(),
      });
      expect(res.statusCode).toBe(400);
      expect((await row(g.id)).status).toBe('open');
    });

    it('ignoreUntilCount 0 is 400', async () => {
      const g = await makeGroup(ctx, 'fp-5');
      const res = await send('PATCH', `/api/v1/error-groups/${g.id}`, { status: 'ignored', ignoreUntilCount: 0 });
      expect(res.statusCode).toBe(400);
      expect((await row(g.id)).status).toBe('open');
    });

    it('ignore fields without status are 400', async () => {
      const g = await makeGroup(ctx, 'fp-6');
      const res = await send('PATCH', `/api/v1/error-groups/${g.id}`, { ignoreUntilCount: 5 });
      expect(res.statusCode).toBe(400);
      expect((await row(g.id)).ignore_until_count).toBeNull();
    });

    it('empty body is 400', async () => {
      const g = await makeGroup(ctx, 'fp-7');
      const res = await send('PATCH', `/api/v1/error-groups/${g.id}`, {});
      expect(res.statusCode).toBe(400);
    });

    it('foreign organization group is 404 and untouched', async () => {
      const other = await createTestContext();
      const g = await makeGroup(other, 'fp-foreign');

      const res = await send('PATCH', `/api/v1/error-groups/${g.id}`, { status: 'resolved' });
      expect(res.statusCode).toBe(404);
      expect((await row(g.id)).status).toBe('open');
    });

    it('non-member caller gets 403', async () => {
      const other = await createTestContext();
      const g = await makeGroup(other, 'fp-403');

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/error-groups/${g.id}`,
        headers: auth,
        payload: { organizationId: other.organization.id, status: 'resolved' },
      });
      expect(res.statusCode).toBe(403);
      expect((await row(g.id)).status).toBe('open');
    });

    it('/status endpoint still works', async () => {
      const g = await makeGroup(ctx, 'fp-8');
      const res = await send('PATCH', `/api/v1/error-groups/${g.id}/status`, { status: 'resolved' });
      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe('resolved');
    });
  });

  describe('GET /api/v1/error-groups/trends', () => {
    const range = () => ({
      from: new Date(Date.now() - DAY).toISOString(),
      to: new Date().toISOString(),
    });

    it('is not captured by /:id', async () => {
      const g = await makeGroup(ctx, 'fp-t0');
      const res = await get('/api/v1/error-groups/trends', { ids: g.id, ...range() });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toHaveProperty('trends');
    });

    it('returns arrays for requested ids', async () => {
      const g1 = await makeGroup(ctx, 'fp-t1');
      const g2 = await makeGroup(ctx, 'fp-t2');
      await addException(ctx, 'fp-t1', { createdAt: new Date(Date.now() - 2 * HOUR) });

      const res = await get('/api/v1/error-groups/trends', { ids: `${g1.id},${g2.id}`, ...range(), buckets: 12 });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.buckets).toBe(12);
      expect(body.trends[g1.id]).toHaveLength(12);
      expect(body.trends[g1.id].reduce((a: number, b: number) => a + b, 0)).toBe(1);
      expect(body.trends[g2.id]).toEqual(new Array(12).fill(0));
    });

    it('400 on to before from', async () => {
      const g = await makeGroup(ctx, 'fp-t3');
      const res = await get('/api/v1/error-groups/trends', {
        ids: g.id,
        from: new Date().toISOString(),
        to: new Date(Date.now() - HOUR).toISOString(),
      });
      expect(res.statusCode).toBe(400);
    });

    it('400 on more than 100 ids', async () => {
      const ids = Array.from({ length: 101 }, () => randomUUID()).join(',');
      const res = await get('/api/v1/error-groups/trends', { ids, ...range() });
      expect(res.statusCode).toBe(400);
    });

    it('400 on a range above 90 days', async () => {
      const g = await makeGroup(ctx, 'fp-t4');
      const res = await get('/api/v1/error-groups/trends', {
        ids: g.id,
        from: new Date(Date.now() - 91 * DAY).toISOString(),
        to: new Date().toISOString(),
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('GET /api/v1/error-groups/:id/events', () => {
    it('returns the latest event', async () => {
      const g = await makeGroup(ctx, 'fp-e1');
      await addException(ctx, 'fp-e1', { createdAt: new Date(Date.now() - 2 * HOUR) });
      const newest = await addException(ctx, 'fp-e1', { createdAt: new Date(Date.now() - HOUR) });

      const res = await get(`/api/v1/error-groups/${g.id}/events`);
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.events).toHaveLength(1);
      expect(body.events[0].cursor).toBe(newest.id);
      expect(body.hasOlder).toBe(true);
      expect(body.hasNewer).toBe(false);
    });

    it('paginates older and newer', async () => {
      const g = await makeGroup(ctx, 'fp-e2');
      const e1 = await addException(ctx, 'fp-e2', { createdAt: new Date(Date.now() - 3 * HOUR) });
      const e2 = await addException(ctx, 'fp-e2', { createdAt: new Date(Date.now() - 2 * HOUR) });
      const e3 = await addException(ctx, 'fp-e2', { createdAt: new Date(Date.now() - HOUR) });

      const older = await get(`/api/v1/error-groups/${g.id}/events`, { cursor: e3.id, direction: 'older' });
      expect(older.statusCode).toBe(200);
      expect(older.json().events[0].cursor).toBe(e2.id);
      expect(older.json().hasNewer).toBe(true);

      const newer = await get(`/api/v1/error-groups/${g.id}/events`, { cursor: e1.id, direction: 'newer' });
      expect(newer.json().events[0].cursor).toBe(e2.id);
    });

    it('400 on invalid cursor', async () => {
      const g = await makeGroup(ctx, 'fp-e3');
      await addException(ctx, 'fp-e3');

      const unknown = await get(`/api/v1/error-groups/${g.id}/events`, { cursor: randomUUID(), direction: 'older' });
      expect(unknown.statusCode).toBe(400);
      const malformed = await get(`/api/v1/error-groups/${g.id}/events`, { cursor: 'nope', direction: 'older' });
      expect(malformed.statusCode).toBe(400);
    });

    it('404 for a group of another organization', async () => {
      const other = await createTestContext();
      const g = await makeGroup(other, 'fp-e4');
      const res = await get(`/api/v1/error-groups/${g.id}/events`);
      expect(res.statusCode).toBe(404);
    });
  });

  describe('POST /api/v1/error-groups/bulk', () => {
    it('resolve', async () => {
      const a = await makeGroup(ctx, 'fp-b1');
      const b = await makeGroup(ctx, 'fp-b2');
      const res = await send('POST', '/api/v1/error-groups/bulk', { ids: [a.id, b.id], action: 'resolve' });
      expect(res.statusCode).toBe(200);
      expect(res.json().updated.sort()).toEqual([a.id, b.id].sort());
      expect((await row(a.id)).status).toBe('resolved');
      expect((await row(b.id)).resolved_by).toBe(ctx.user.id);
    });

    it('ignore with count', async () => {
      const a = await makeGroup(ctx, 'fp-b3');
      const res = await send('POST', '/api/v1/error-groups/bulk', {
        ids: [a.id],
        action: 'ignore',
        ignoreUntilCount: 25,
      });
      expect(res.statusCode).toBe(200);
      const r = await row(a.id);
      expect(r.status).toBe('ignored');
      expect(r.ignore_until_count).toBe(25);
    });

    it('assign with null', async () => {
      const member = await addMember(ctx);
      const a = await makeGroup(ctx, 'fp-b4', { assigned_to: member.id });
      const res = await send('POST', '/api/v1/error-groups/bulk', { ids: [a.id], action: 'assign', assignedTo: null });
      expect(res.statusCode).toBe(200);
      expect((await row(a.id)).assigned_to).toBeNull();
    });

    it('reopen', async () => {
      const a = await makeGroup(ctx, 'fp-b5', { status: 'resolved', resolved_at: new Date(), resolved_by: ctx.user.id });
      const res = await send('POST', '/api/v1/error-groups/bulk', { ids: [a.id], action: 'reopen' });
      expect(res.statusCode).toBe(200);
      const r = await row(a.id);
      expect(r.status).toBe('open');
      expect(r.resolved_by).toBeNull();
    });

    it('foreign ids come back in skipped', async () => {
      const mine = await makeGroup(ctx, 'fp-b6');
      const other = await createTestContext();
      const foreign = await makeGroup(other, 'fp-b7');

      const res = await send('POST', '/api/v1/error-groups/bulk', { ids: [mine.id, foreign.id], action: 'resolve' });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ updated: [mine.id], skipped: [foreign.id] });
      expect((await row(foreign.id)).status).toBe('open');
    });

    it('400 on empty ids', async () => {
      const res = await send('POST', '/api/v1/error-groups/bulk', { ids: [], action: 'resolve' });
      expect(res.statusCode).toBe(400);
    });

    it('400 on 101 ids', async () => {
      const ids = Array.from({ length: 101 }, () => randomUUID());
      const res = await send('POST', '/api/v1/error-groups/bulk', { ids, action: 'resolve' });
      expect(res.statusCode).toBe(400);
    });

    it('400 on assign without assignedTo', async () => {
      const a = await makeGroup(ctx, 'fp-b8');
      const res = await send('POST', '/api/v1/error-groups/bulk', { ids: [a.id], action: 'assign' });
      expect(res.statusCode).toBe(400);
    });

    it('401 without token', async () => {
      const a = await makeGroup(ctx, 'fp-b9');
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/error-groups/bulk',
        payload: { organizationId: ctx.organization.id, ids: [a.id], action: 'resolve' },
      });
      expect(res.statusCode).toBe(401);
    });

    it('403 for non-member', async () => {
      const other = await createTestContext();
      const g = await makeGroup(other, 'fp-b10');
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/error-groups/bulk',
        headers: auth,
        payload: { organizationId: other.organization.id, ids: [g.id], action: 'resolve' },
      });
      expect(res.statusCode).toBe(403);
      expect((await row(g.id)).status).toBe('open');
    });
  });

  describe('GET /api/v1/error-groups/by-trace/:traceId', () => {
    it('returns matches with spanId', async () => {
      const g = await makeGroup(ctx, 'fp-tr1');
      const log = await createTestLog({
        projectId: ctx.project.id,
        level: 'error',
        trace_id: 'trace-route-1',
        message: 'failed',
      });
      await db.updateTable('logs').set({ span_id: 'span-9' }).where('id', '=', log.id).execute();
      await addException(ctx, 'fp-tr1', { logId: log.id });

      const res = await get('/api/v1/error-groups/by-trace/trace-route-1', { projectId: ctx.project.id });
      expect(res.statusCode).toBe(200);
      const { groups } = res.json();
      expect(groups).toHaveLength(1);
      expect(groups[0].errorGroupId).toBe(g.id);
      expect(groups[0].spanId).toBe('span-9');
    });

    it('400 without projectId', async () => {
      const res = await get('/api/v1/error-groups/by-trace/trace-x');
      expect(res.statusCode).toBe(400);
    });

    it('404 for a project of another organization', async () => {
      const other = await createTestContext();
      const res = await get('/api/v1/error-groups/by-trace/trace-x', { projectId: other.project.id });
      expect(res.statusCode).toBe(404);
    });

    it('401 without token', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/error-groups/by-trace/trace-x?organizationId=${ctx.organization.id}&projectId=${ctx.project.id}`,
      });
      expect(res.statusCode).toBe(401);
    });
  });
});
