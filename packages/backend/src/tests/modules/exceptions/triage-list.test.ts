import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { db } from '../../../database/index.js';
import { ExceptionService } from '../../../modules/exceptions/service.js';
import {
  createTestContext,
  createTestProject,
  createTestUser,
} from '../../helpers/factories.js';

const service = new ExceptionService(db);
const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

type Ctx = Awaited<ReturnType<typeof createTestContext>>;

async function makeGroup(
  ctx: Ctx,
  over: Record<string, unknown> = {},
  projectId: string | null = ctx.project.id,
) {
  return db
    .insertInto('error_groups')
    .values({
      organization_id: ctx.organization.id,
      project_id: projectId,
      fingerprint: `fp-${randomUUID()}`,
      exception_type: 'TypeError',
      exception_message: 'boom',
      language: 'nodejs',
      occurrence_count: 1,
      first_seen: new Date(),
      last_seen: new Date(),
      affected_services: ['api'],
      ...over,
    } as never)
    .returningAll()
    .executeTakeFirstOrThrow();
}

describe('ExceptionService.getErrorGroups triage filters', () => {
  beforeEach(async () => {
    await db.deleteFrom('stack_frames').execute();
    await db.deleteFrom('exceptions').execute();
    await db.deleteFrom('error_groups').execute();
  });

  it('filters by several projects', async () => {
    const ctx = await createTestContext();
    const p2 = await createTestProject({ organizationId: ctx.organization.id });
    const p3 = await createTestProject({ organizationId: ctx.organization.id });
    const a = await makeGroup(ctx, {}, ctx.project.id);
    const b = await makeGroup(ctx, {}, p2.id);
    await makeGroup(ctx, {}, p3.id);

    const res = await service.getErrorGroups({
      organizationId: ctx.organization.id,
      projectIds: [ctx.project.id, p2.id],
    });
    expect(res.groups.map((g) => g.id).sort()).toEqual([a.id, b.id].sort());
    expect(res.total).toBe(2);
  });

  it('time range filters on last_seen, not first_seen', async () => {
    const ctx = await createTestContext();
    const now = Date.now();
    const recent = await makeGroup(ctx, {
      first_seen: new Date(now - 10 * DAY),
      last_seen: new Date(now - HOUR),
    });
    await makeGroup(ctx, {
      first_seen: new Date(now - 10 * DAY),
      last_seen: new Date(now - 3 * DAY),
    });

    const res = await service.getErrorGroups({
      organizationId: ctx.organization.id,
      from: new Date(now - DAY),
      to: new Date(now + HOUR),
    });
    expect(res.groups.map((g) => g.id)).toEqual([recent.id]);
    expect(res.total).toBe(1);
  });

  it('sort=events orders by occurrence_count desc', async () => {
    const ctx = await createTestContext();
    const now = Date.now();
    const low = await makeGroup(ctx, { occurrence_count: 2, last_seen: new Date(now) });
    const high = await makeGroup(ctx, { occurrence_count: 50, last_seen: new Date(now - HOUR) });
    const mid = await makeGroup(ctx, { occurrence_count: 10, last_seen: new Date(now - 2 * HOUR) });

    const res = await service.getErrorGroups({ organizationId: ctx.organization.id, sort: 'events' });
    expect(res.groups.map((g) => g.id)).toEqual([high.id, mid.id, low.id]);
  });

  it('sort=first_seen orders by first_seen desc', async () => {
    const ctx = await createTestContext();
    const now = Date.now();
    const oldest = await makeGroup(ctx, { first_seen: new Date(now - 5 * DAY), last_seen: new Date(now) });
    const newest = await makeGroup(ctx, { first_seen: new Date(now - HOUR), last_seen: new Date(now - 2 * HOUR) });
    const middle = await makeGroup(ctx, { first_seen: new Date(now - DAY), last_seen: new Date(now - HOUR) });

    const res = await service.getErrorGroups({ organizationId: ctx.organization.id, sort: 'first_seen' });
    expect(res.groups.map((g) => g.id)).toEqual([newest.id, middle.id, oldest.id]);
  });

  it('default order is last_seen desc', async () => {
    const ctx = await createTestContext();
    const now = Date.now();
    const a = await makeGroup(ctx, { occurrence_count: 99, last_seen: new Date(now - 3 * HOUR) });
    const b = await makeGroup(ctx, { occurrence_count: 1, last_seen: new Date(now - HOUR) });
    const c = await makeGroup(ctx, { occurrence_count: 5, last_seen: new Date(now - 2 * HOUR) });

    const res = await service.getErrorGroups({ organizationId: ctx.organization.id });
    expect(res.groups.map((g) => g.id)).toEqual([b.id, c.id, a.id]);
  });

  it('service filters on affected_services', async () => {
    const ctx = await createTestContext();
    const other = await createTestContext();
    const apiOnly = await makeGroup(ctx, { affected_services: ['api'] });
    await makeGroup(ctx, { affected_services: ['worker'] });
    const both = await makeGroup(ctx, { affected_services: ['api', 'worker'] });
    await makeGroup(other, { affected_services: ['api'] });

    const res = await service.getErrorGroups({ organizationId: ctx.organization.id, service: 'api' });
    expect(res.groups.map((g) => g.id).sort()).toEqual([apiOnly.id, both.id].sort());
    expect(res.total).toBe(2);

    const none = await service.getErrorGroups({ organizationId: ctx.organization.id, service: 'nope' });
    expect(none.groups).toEqual([]);
    expect(none.total).toBe(0);

    const caseSensitive = await service.getErrorGroups({ organizationId: ctx.organization.id, service: 'API' });
    expect(caseSensitive.total).toBe(0);
  });

  it('assignedTo=unassigned returns only groups without assignee', async () => {
    const ctx = await createTestContext();
    const user = await createTestUser({ email: `u-${randomUUID()}@example.com` });
    await makeGroup(ctx, { assigned_to: user.id });
    const free = await makeGroup(ctx);

    const res = await service.getErrorGroups({ organizationId: ctx.organization.id, assignedTo: 'unassigned' });
    expect(res.groups.map((g) => g.id)).toEqual([free.id]);
    expect(res.total).toBe(1);
  });

  it("assignedTo=<uuid> returns only that user's groups", async () => {
    const ctx = await createTestContext();
    const user = await createTestUser({ email: `u-${randomUUID()}@example.com` });
    const mine = await makeGroup(ctx, { assigned_to: user.id });
    await makeGroup(ctx);
    await makeGroup(ctx, { assigned_to: ctx.user.id });

    const res = await service.getErrorGroups({ organizationId: ctx.organization.id, assignedTo: user.id });
    expect(res.groups.map((g) => g.id)).toEqual([mine.id]);
    expect(res.total).toBe(1);
  });

  it('pagination is stable when many rows share last_seen', async () => {
    const ctx = await createTestContext();
    const same = new Date(Date.now() - HOUR);
    for (let i = 0; i < 30; i++) {
      await makeGroup(ctx, { last_seen: same });
    }
    const seen: string[] = [];
    for (let page = 0; page < 3; page++) {
      const res = await service.getErrorGroups({
        organizationId: ctx.organization.id,
        limit: 10,
        offset: page * 10,
      });
      expect(res.total).toBe(30);
      expect(res.groups).toHaveLength(10);
      seen.push(...res.groups.map((g) => g.id));
    }
    expect(new Set(seen).size).toBe(30);
  });

  it('returns triage fields and joined names', async () => {
    const ctx = await createTestContext();
    const assignee = await createTestUser({ email: `as-${randomUUID()}@example.com`, name: 'Ada Assignee' });
    const resolver = await createTestUser({ email: `rs-${randomUUID()}@example.com`, name: 'Rex Resolver' });
    const regressed = new Date(Date.now() - HOUR);
    const until = new Date(Date.now() + DAY);
    const g = await makeGroup(ctx, {
      assigned_to: assignee.id,
      resolved_by: resolver.id,
      regressed_at: regressed,
      ignored_until: until,
      ignore_until_count: 25,
      ignored_event_count: 7,
    });

    const res = await service.getErrorGroups({ organizationId: ctx.organization.id });
    const got = res.groups.find((x) => x.id === g.id)!;
    expect(got.assignedTo).toBe(assignee.id);
    expect(got.assignedToName).toBe('Ada Assignee');
    expect(got.assignedToEmail).toBe(assignee.email);
    expect(got.resolvedByName).toBe('Rex Resolver');
    expect(new Date(got.regressedAt as Date).getTime()).toBe(regressed.getTime());
    expect(new Date(got.ignoredUntil as Date).getTime()).toBe(until.getTime());
    expect(got.ignoreUntilCount).toBe(25);
    expect(got.ignoredEventCount).toBe(7);

    const byId = await service.getErrorGroupById(g.id);
    expect(byId?.assignedToName).toBe('Ada Assignee');
    expect(byId?.resolvedByName).toBe('Rex Resolver');
    expect(byId?.ignoreUntilCount).toBe(25);

    const plain = await makeGroup(ctx);
    const plainGot = (await service.getErrorGroupById(plain.id))!;
    expect(plainGot.assignedTo).toBeNull();
    expect(plainGot.assignedToName).toBeNull();
    expect(plainGot.regressedAt).toBeNull();
    expect(plainGot.ignoredEventCount).toBe(0);
  });

  it("does not leak another organization's groups", async () => {
    const ctx = await createTestContext();
    const other = await createTestContext();
    const mine = await makeGroup(ctx);
    await makeGroup(other);

    const res = await service.getErrorGroups({ organizationId: ctx.organization.id });
    expect(res.groups.map((g) => g.id)).toEqual([mine.id]);

    const foreignProject = await service.getErrorGroups({
      organizationId: ctx.organization.id,
      projectIds: [other.project.id],
    });
    expect(foreignProject.groups).toEqual([]);
    expect(foreignProject.total).toBe(0);
  });

  it('total honours every filter', async () => {
    const ctx = await createTestContext();
    const now = Date.now();
    await makeGroup(ctx, { status: 'open', language: 'python', exception_type: 'ValueError', affected_services: ['api'], last_seen: new Date(now - HOUR) });
    await makeGroup(ctx, { status: 'open', language: 'python', exception_type: 'ValueError', affected_services: ['api'], last_seen: new Date(now - 2 * HOUR) });
    await makeGroup(ctx, { status: 'resolved', language: 'python', exception_type: 'ValueError', affected_services: ['api'], last_seen: new Date(now - HOUR) });
    await makeGroup(ctx, { status: 'open', language: 'nodejs', exception_type: 'ValueError', affected_services: ['api'], last_seen: new Date(now - HOUR) });
    await makeGroup(ctx, { status: 'open', language: 'python', exception_type: 'ValueError', affected_services: ['worker'], last_seen: new Date(now - HOUR) });
    await makeGroup(ctx, { status: 'open', language: 'python', exception_type: 'ValueError', affected_services: ['api'], last_seen: new Date(now - 5 * DAY) });

    const filters = {
      organizationId: ctx.organization.id,
      projectIds: [ctx.project.id],
      status: 'open' as const,
      language: 'python' as const,
      search: 'valueerror',
      service: 'api',
      from: new Date(now - DAY),
      to: new Date(now),
      assignedTo: 'unassigned',
    };
    const res = await service.getErrorGroups(filters);
    expect(res.total).toBe(2);
    expect(res.groups).toHaveLength(2);

    const page = await service.getErrorGroups({ ...filters, limit: 1 });
    expect(page.groups).toHaveLength(1);
    expect(page.total).toBe(2);
  });

  it('keeps the legacy single projectId filter', async () => {
    const ctx = await createTestContext();
    const p2 = await createTestProject({ organizationId: ctx.organization.id });
    const a = await makeGroup(ctx, {}, ctx.project.id);
    await makeGroup(ctx, {}, p2.id);

    const res = await service.getErrorGroups({ organizationId: ctx.organization.id, projectId: ctx.project.id });
    expect(res.groups.map((g) => g.id)).toEqual([a.id]);
  });

  it('getTopErrorGroups carries the triage fields', async () => {
    const ctx = await createTestContext();
    const g = await makeGroup(ctx, { occurrence_count: 4, regressed_at: new Date() });
    const top = await service.getTopErrorGroups({ organizationId: ctx.organization.id });
    expect(top.map((t) => t.id)).toEqual([g.id]);
    expect(top[0].regressedAt).toBeTruthy();
    expect(top[0].assignedTo).toBeNull();
  });
});
