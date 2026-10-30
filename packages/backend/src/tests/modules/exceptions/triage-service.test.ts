import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { db } from '../../../database/index.js';
import { ExceptionService } from '../../../modules/exceptions/service.js';
import {
  ErrorGroupTriageService,
  ErrorGroupValidationError,
} from '../../../modules/exceptions/triage-service.js';
import { createTestContext, createTestUser } from '../../helpers/factories.js';

const triage = new ErrorGroupTriageService(db);
const exceptionService = new ExceptionService(db);
const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

type Ctx = Awaited<ReturnType<typeof createTestContext>>;

async function makeGroup(ctx: Ctx, over: Record<string, unknown> = {}) {
  return db
    .insertInto('error_groups')
    .values({
      organization_id: ctx.organization.id,
      project_id: ctx.project.id,
      fingerprint: `fp-${randomUUID()}`,
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

async function row(id: string) {
  return db.selectFrom('error_groups').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
}

async function addMember(ctx: Ctx) {
  const user = await createTestUser({ email: `m-${randomUUID()}@example.com`, name: 'Member One' });
  await db
    .insertInto('organization_members')
    .values({ user_id: user.id, organization_id: ctx.organization.id, role: 'member' })
    .execute();
  return user;
}

describe('ErrorGroupTriageService', () => {
  beforeEach(async () => {
    await db.deleteFrom('stack_frames').execute();
    await db.deleteFrom('exceptions').execute();
    await db.deleteFrom('error_groups').execute();
  });

  describe('updateErrorGroup status', () => {
    it('resolve sets resolved_by and clears regressed_at', async () => {
      const ctx = await createTestContext();
      const g = await makeGroup(ctx, { regressed_at: new Date() });

      const res = await triage.updateErrorGroup(g.id, ctx.organization.id, { status: 'resolved' }, ctx.user.id);

      expect(res!.status).toBe('resolved');
      expect(res!.resolvedBy).toBe(ctx.user.id);
      expect(res!.resolvedAt).not.toBeNull();
      expect(res!.regressedAt).toBeNull();
    });

    it('resolving an already resolved group keeps the original resolver and time', async () => {
      const ctx = await createTestContext();
      const other = await addMember(ctx);
      const when = new Date(Date.now() - 2 * DAY);
      const g = await makeGroup(ctx, { status: 'resolved', resolved_at: when, resolved_by: other.id });

      await triage.updateErrorGroup(g.id, ctx.organization.id, { status: 'resolved' }, ctx.user.id);

      const after = await row(g.id);
      expect(after.resolved_by).toBe(other.id);
      expect(new Date(after.resolved_at as Date).getTime()).toBe(when.getTime());
    });

    it('reopen clears resolved fields but keeps regressed_at', async () => {
      const ctx = await createTestContext();
      const regressed = new Date(Date.now() - HOUR);
      const g = await makeGroup(ctx, {
        status: 'resolved',
        resolved_at: new Date(),
        resolved_by: ctx.user.id,
        regressed_at: regressed,
      });

      const res = await triage.updateErrorGroup(g.id, ctx.organization.id, { status: 'open' }, ctx.user.id);

      expect(res!.status).toBe('open');
      expect(res!.resolvedAt).toBeNull();
      expect(res!.resolvedBy).toBeNull();
      expect(new Date(res!.regressedAt as Date).getTime()).toBe(regressed.getTime());
    });

    it('reopening does not record a resolver', async () => {
      const ctx = await createTestContext();
      const g = await makeGroup(ctx, { status: 'ignored' });

      await triage.updateErrorGroup(g.id, ctx.organization.id, { status: 'open' }, ctx.user.id);
      expect((await row(g.id)).resolved_by).toBeNull();

      await triage.updateErrorGroup(g.id, ctx.organization.id, { status: 'ignored' }, ctx.user.id);
      expect((await row(g.id)).resolved_by).toBeNull();
    });

    it('open clears the ignore fields', async () => {
      const ctx = await createTestContext();
      const g = await makeGroup(ctx, {
        status: 'ignored',
        ignored_until: new Date(Date.now() + DAY),
        ignore_until_count: 10,
        ignored_event_count: 4,
      });

      await triage.updateErrorGroup(g.id, ctx.organization.id, { status: 'open' }, ctx.user.id);

      const after = await row(g.id);
      expect(after.ignored_until).toBeNull();
      expect(after.ignore_until_count).toBeNull();
      expect(after.ignored_event_count).toBe(0);
    });
  });

  describe('updateErrorGroup ignore', () => {
    it('ignore forever stores no limits', async () => {
      const ctx = await createTestContext();
      const g = await makeGroup(ctx, { ignored_event_count: 9 });

      const res = await triage.updateErrorGroup(g.id, ctx.organization.id, { status: 'ignored' }, ctx.user.id);

      expect(res!.status).toBe('ignored');
      expect(res!.ignoredUntil).toBeNull();
      expect(res!.ignoreUntilCount).toBeNull();
      expect(res!.ignoredEventCount).toBe(0);
    });

    it('ignore until a date stores it and resets the counter', async () => {
      const ctx = await createTestContext();
      const g = await makeGroup(ctx, { ignored_event_count: 9 });
      const until = new Date(Date.now() + DAY);

      const res = await triage.updateErrorGroup(
        g.id,
        ctx.organization.id,
        { status: 'ignored', ignoredUntil: until.toISOString() },
        ctx.user.id,
      );

      expect(new Date(res!.ignoredUntil as Date).getTime()).toBe(until.getTime());
      expect(res!.ignoreUntilCount).toBeNull();
      expect(res!.ignoredEventCount).toBe(0);
    });

    it('ignore until a count stores it and resets the counter', async () => {
      const ctx = await createTestContext();
      const g = await makeGroup(ctx, { ignored_event_count: 9 });

      const res = await triage.updateErrorGroup(
        g.id,
        ctx.organization.id,
        { status: 'ignored', ignoreUntilCount: 50 },
        ctx.user.id,
      );

      expect(res!.ignoreUntilCount).toBe(50);
      expect(res!.ignoredUntil).toBeNull();
      expect(res!.ignoredEventCount).toBe(0);
    });

    it('ignore clears resolved fields', async () => {
      const ctx = await createTestContext();
      const g = await makeGroup(ctx, { status: 'resolved', resolved_at: new Date(), resolved_by: ctx.user.id });

      const res = await triage.updateErrorGroup(g.id, ctx.organization.id, { status: 'ignored' }, ctx.user.id);

      expect(res!.resolvedAt).toBeNull();
      expect(res!.resolvedBy).toBeNull();
    });

    it('ignore rejects a past date, count 0, negative count, count above 1000000, fractions and bad dates', async () => {
      const ctx = await createTestContext();
      const g = await makeGroup(ctx);
      const bad: Array<Record<string, unknown>> = [
        { status: 'ignored', ignoredUntil: new Date(Date.now() - HOUR).toISOString() },
        { status: 'ignored', ignoredUntil: 'not a date' },
        { status: 'ignored', ignoreUntilCount: 0 },
        { status: 'ignored', ignoreUntilCount: -3 },
        { status: 'ignored', ignoreUntilCount: 1_000_001 },
        { status: 'ignored', ignoreUntilCount: 2.5 },
      ];
      for (const patch of bad) {
        await expect(
          triage.updateErrorGroup(g.id, ctx.organization.id, patch as never, ctx.user.id),
        ).rejects.toBeInstanceOf(ErrorGroupValidationError);
      }
      const after = await row(g.id);
      expect(after.status).toBe('open');
      expect(after.ignore_until_count).toBeNull();
      expect(after.ignored_until).toBeNull();
    });

    it('accepts the count boundaries 1 and 1000000', async () => {
      const ctx = await createTestContext();
      const g = await makeGroup(ctx);
      const a = await triage.updateErrorGroup(g.id, ctx.organization.id, { status: 'ignored', ignoreUntilCount: 1 }, ctx.user.id);
      expect(a!.ignoreUntilCount).toBe(1);
      const b = await triage.updateErrorGroup(g.id, ctx.organization.id, { status: 'ignored', ignoreUntilCount: 1_000_000 }, ctx.user.id);
      expect(b!.ignoreUntilCount).toBe(1_000_000);
    });

    it('ignore fields without status ignored are rejected', async () => {
      const ctx = await createTestContext();
      const g = await makeGroup(ctx);
      const future = new Date(Date.now() + DAY).toISOString();
      const bad: Array<Record<string, unknown>> = [
        { ignoreUntilCount: 5 },
        { ignoredUntil: future },
        { status: 'open', ignoreUntilCount: 5 },
        { status: 'resolved', ignoredUntil: future },
      ];
      for (const patch of bad) {
        await expect(
          triage.updateErrorGroup(g.id, ctx.organization.id, patch as never, ctx.user.id),
        ).rejects.toBeInstanceOf(ErrorGroupValidationError);
      }
      expect((await row(g.id)).status).toBe('open');
    });

    it('an empty patch is rejected', async () => {
      const ctx = await createTestContext();
      const g = await makeGroup(ctx);
      await expect(
        triage.updateErrorGroup(g.id, ctx.organization.id, {}, ctx.user.id),
      ).rejects.toBeInstanceOf(ErrorGroupValidationError);
    });
  });

  describe('updateErrorGroup assignee', () => {
    it('assign sets assigned_to, status is untouched', async () => {
      const ctx = await createTestContext();
      const member = await addMember(ctx);
      const g = await makeGroup(ctx, { status: 'resolved', resolved_at: new Date(), resolved_by: ctx.user.id });

      const res = await triage.updateErrorGroup(g.id, ctx.organization.id, { assignedTo: member.id }, ctx.user.id);

      expect(res!.assignedTo).toBe(member.id);
      expect(res!.assignedToName).toBe('Member One');
      expect(res!.status).toBe('resolved');
      expect(res!.resolvedBy).toBe(ctx.user.id);
    });

    it('the organization owner can be assigned', async () => {
      const ctx = await createTestContext();
      const g = await makeGroup(ctx);
      const res = await triage.updateErrorGroup(g.id, ctx.organization.id, { assignedTo: ctx.user.id }, ctx.user.id);
      expect(res!.assignedTo).toBe(ctx.user.id);
    });

    it('null unassigns', async () => {
      const ctx = await createTestContext();
      const member = await addMember(ctx);
      const g = await makeGroup(ctx, { assigned_to: member.id });

      const res = await triage.updateErrorGroup(g.id, ctx.organization.id, { assignedTo: null }, ctx.user.id);

      expect(res!.assignedTo).toBeNull();
      expect((await row(g.id)).assigned_to).toBeNull();
    });

    it('a non-member throws and changes nothing', async () => {
      const ctx = await createTestContext();
      const outsider = await createTestUser({ email: `o-${randomUUID()}@example.com` });
      const g = await makeGroup(ctx);

      await expect(
        triage.updateErrorGroup(g.id, ctx.organization.id, { assignedTo: outsider.id }, ctx.user.id),
      ).rejects.toBeInstanceOf(ErrorGroupValidationError);
      expect((await row(g.id)).assigned_to).toBeNull();
    });

    it('a member of another organization throws', async () => {
      const ctx = await createTestContext();
      const other = await createTestContext();
      const g = await makeGroup(ctx);

      await expect(
        triage.updateErrorGroup(g.id, ctx.organization.id, { assignedTo: other.user.id }, ctx.user.id),
      ).rejects.toBeInstanceOf(ErrorGroupValidationError);
    });

    it('a malformed assignee id throws a validation error', async () => {
      const ctx = await createTestContext();
      const g = await makeGroup(ctx);
      await expect(
        triage.updateErrorGroup(g.id, ctx.organization.id, { assignedTo: 'nope' }, ctx.user.id),
      ).rejects.toBeInstanceOf(ErrorGroupValidationError);
    });

    it('status and assignee can change together', async () => {
      const ctx = await createTestContext();
      const member = await addMember(ctx);
      const g = await makeGroup(ctx);

      const res = await triage.updateErrorGroup(
        g.id,
        ctx.organization.id,
        { status: 'resolved', assignedTo: member.id },
        ctx.user.id,
      );

      expect(res!.status).toBe('resolved');
      expect(res!.assignedTo).toBe(member.id);
    });
  });

  describe('updateErrorGroup scoping', () => {
    it("returns null for a group of another organization and does not modify it", async () => {
      const ctx = await createTestContext();
      const other = await createTestContext();
      const g = await makeGroup(other);

      const res = await triage.updateErrorGroup(g.id, ctx.organization.id, { status: 'resolved' }, ctx.user.id);

      expect(res).toBeNull();
      const after = await row(g.id);
      expect(after.status).toBe('open');
      expect(after.resolved_by).toBeNull();
    });

    it('returns null for an unknown group id', async () => {
      const ctx = await createTestContext();
      const res = await triage.updateErrorGroup(randomUUID(), ctx.organization.id, { status: 'resolved' }, ctx.user.id);
      expect(res).toBeNull();
    });
  });

  describe('bulkUpdateErrorGroups', () => {
    it('bulk resolve updates all found ids and reports foreign ids as skipped', async () => {
      const ctx = await createTestContext();
      const other = await createTestContext();
      const a = await makeGroup(ctx);
      const b = await makeGroup(ctx);
      const foreign = await makeGroup(other);
      const missing = randomUUID();

      const res = await triage.bulkUpdateErrorGroups({
        organizationId: ctx.organization.id,
        ids: [a.id, b.id, foreign.id, missing],
        action: 'resolve',
        actorUserId: ctx.user.id,
      });

      expect(res.updated.sort()).toEqual([a.id, b.id].sort());
      expect(res.skipped.sort()).toEqual([foreign.id, missing].sort());
      expect((await row(a.id)).status).toBe('resolved');
      expect((await row(a.id)).resolved_by).toBe(ctx.user.id);
      expect((await row(b.id)).status).toBe('resolved');
      const untouched = await row(foreign.id);
      expect(untouched.status).toBe('open');
      expect(untouched.resolved_by).toBeNull();
    });

    it('bulk reopen reopens resolved groups', async () => {
      const ctx = await createTestContext();
      const a = await makeGroup(ctx, { status: 'resolved', resolved_at: new Date(), resolved_by: ctx.user.id });

      const res = await triage.bulkUpdateErrorGroups({
        organizationId: ctx.organization.id,
        ids: [a.id],
        action: 'reopen',
        actorUserId: ctx.user.id,
      });

      expect(res.updated).toEqual([a.id]);
      const after = await row(a.id);
      expect(after.status).toBe('open');
      expect(after.resolved_by).toBeNull();
    });

    it('bulk ignore applies the same until options to every row', async () => {
      const ctx = await createTestContext();
      const a = await makeGroup(ctx, { ignored_event_count: 3 });
      const b = await makeGroup(ctx);
      const until = new Date(Date.now() + DAY);

      const res = await triage.bulkUpdateErrorGroups({
        organizationId: ctx.organization.id,
        ids: [a.id, b.id],
        action: 'ignore',
        ignoredUntil: until.toISOString(),
        ignoreUntilCount: 20,
        actorUserId: ctx.user.id,
      });

      expect(res.updated).toHaveLength(2);
      for (const id of [a.id, b.id]) {
        const r = await row(id);
        expect(r.status).toBe('ignored');
        expect(new Date(r.ignored_until as Date).getTime()).toBe(until.getTime());
        expect(r.ignore_until_count).toBe(20);
        expect(r.ignored_event_count).toBe(0);
      }
    });

    it('bulk ignore validates the options', async () => {
      const ctx = await createTestContext();
      const a = await makeGroup(ctx);
      await expect(
        triage.bulkUpdateErrorGroups({
          organizationId: ctx.organization.id,
          ids: [a.id],
          action: 'ignore',
          ignoreUntilCount: 0,
          actorUserId: ctx.user.id,
        }),
      ).rejects.toBeInstanceOf(ErrorGroupValidationError);
      expect((await row(a.id)).status).toBe('open');
    });

    it('bulk assign sets the assignee, null unassigns', async () => {
      const ctx = await createTestContext();
      const member = await addMember(ctx);
      const a = await makeGroup(ctx);
      const b = await makeGroup(ctx, { assigned_to: ctx.user.id });

      await triage.bulkUpdateErrorGroups({
        organizationId: ctx.organization.id,
        ids: [a.id, b.id],
        action: 'assign',
        assignedTo: member.id,
        actorUserId: ctx.user.id,
      });
      expect((await row(a.id)).assigned_to).toBe(member.id);
      expect((await row(b.id)).assigned_to).toBe(member.id);

      await triage.bulkUpdateErrorGroups({
        organizationId: ctx.organization.id,
        ids: [a.id, b.id],
        action: 'assign',
        assignedTo: null,
        actorUserId: ctx.user.id,
      });
      expect((await row(a.id)).assigned_to).toBeNull();
      expect((await row(b.id)).assigned_to).toBeNull();
    });

    it('bulk assign requires the assignedTo key and a member', async () => {
      const ctx = await createTestContext();
      const outsider = await createTestUser({ email: `o-${randomUUID()}@example.com` });
      const a = await makeGroup(ctx);

      await expect(
        triage.bulkUpdateErrorGroups({
          organizationId: ctx.organization.id,
          ids: [a.id],
          action: 'assign',
          actorUserId: ctx.user.id,
        }),
      ).rejects.toBeInstanceOf(ErrorGroupValidationError);
      await expect(
        triage.bulkUpdateErrorGroups({
          organizationId: ctx.organization.id,
          ids: [a.id],
          action: 'assign',
          assignedTo: outsider.id,
          actorUserId: ctx.user.id,
        }),
      ).rejects.toBeInstanceOf(ErrorGroupValidationError);
    });

    it('bulk handles duplicate ids once', async () => {
      const ctx = await createTestContext();
      const a = await makeGroup(ctx);

      const res = await triage.bulkUpdateErrorGroups({
        organizationId: ctx.organization.id,
        ids: [a.id, a.id, a.id],
        action: 'resolve',
        actorUserId: ctx.user.id,
      });

      expect(res.updated).toEqual([a.id]);
      expect(res.skipped).toEqual([]);
    });

    it('bulk rejects empty and more than 100 ids', async () => {
      const ctx = await createTestContext();
      await expect(
        triage.bulkUpdateErrorGroups({
          organizationId: ctx.organization.id,
          ids: [],
          action: 'resolve',
          actorUserId: ctx.user.id,
        }),
      ).rejects.toBeInstanceOf(ErrorGroupValidationError);
      await expect(
        triage.bulkUpdateErrorGroups({
          organizationId: ctx.organization.id,
          ids: Array.from({ length: 101 }, () => randomUUID()),
          action: 'resolve',
          actorUserId: ctx.user.id,
        }),
      ).rejects.toBeInstanceOf(ErrorGroupValidationError);
    });

    it('bulk accepts exactly 100 ids', async () => {
      const ctx = await createTestContext();
      const res = await triage.bulkUpdateErrorGroups({
        organizationId: ctx.organization.id,
        ids: Array.from({ length: 100 }, () => randomUUID()),
        action: 'resolve',
        actorUserId: ctx.user.id,
      });
      expect(res.updated).toEqual([]);
      expect(res.skipped).toHaveLength(100);
    });

    it('bulk rejects malformed ids', async () => {
      const ctx = await createTestContext();
      await expect(
        triage.bulkUpdateErrorGroups({
          organizationId: ctx.organization.id,
          ids: ['not-a-uuid'],
          action: 'resolve',
          actorUserId: ctx.user.id,
        }),
      ).rejects.toBeInstanceOf(ErrorGroupValidationError);
    });
  });

  describe('ExceptionService.updateErrorGroupStatus delegation', () => {
    it('still behaves as before for existing callers', async () => {
      const ctx = await createTestContext();
      const g = await makeGroup(ctx);

      const resolved = await exceptionService.updateErrorGroupStatus(g.id, ctx.organization.id, 'resolved', ctx.user.id);
      expect(resolved!.status).toBe('resolved');
      expect(resolved!.resolvedBy).toBe(ctx.user.id);
      expect(resolved!.resolvedAt).not.toBeNull();

      const reopened = await exceptionService.updateErrorGroupStatus(g.id, ctx.organization.id, 'open');
      expect(reopened!.status).toBe('open');
      expect(reopened!.resolvedAt).toBeNull();
      expect(reopened!.resolvedBy).toBeNull();

      const ignored = await exceptionService.updateErrorGroupStatus(g.id, ctx.organization.id, 'ignored', ctx.user.id);
      expect(ignored!.status).toBe('ignored');
      expect(ignored!.resolvedBy).toBeNull();

      expect(
        await exceptionService.updateErrorGroupStatus(randomUUID(), ctx.organization.id, 'resolved'),
      ).toBeNull();
    });
  });
});
