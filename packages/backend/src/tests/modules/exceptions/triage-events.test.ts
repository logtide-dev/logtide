import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { db } from '../../../database/index.js';
import { ExceptionService } from '../../../modules/exceptions/service.js';
import {
  ErrorGroupTriageService,
  ErrorGroupValidationError,
} from '../../../modules/exceptions/triage-service.js';
import { createTestContext, createTestLog, createTestProject } from '../../helpers/factories.js';

const triage = new ErrorGroupTriageService(db);
const exceptionService = new ExceptionService(db);
const HOUR = 3600 * 1000;
const MIN = 60 * 1000;

type Ctx = Awaited<ReturnType<typeof createTestContext>>;

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
  over: { id?: string; createdAt?: Date; logId?: string; type?: string; message?: string; projectId?: string | null; frames?: number } = {},
) {
  const row = await db
    .insertInto('exceptions')
    .values({
      ...(over.id ? { id: over.id } : {}),
      organization_id: ctx.organization.id,
      project_id: over.projectId === undefined ? ctx.project.id : over.projectId,
      log_id: over.logId ?? randomUUID(),
      exception_type: over.type ?? 'TypeError',
      exception_message: over.message ?? 'boom',
      language: 'nodejs',
      fingerprint,
      raw_stack_trace: 'TypeError: boom\n    at f (/app/a.js:1:1)',
      frame_count: over.frames ?? 0,
      created_at: over.createdAt ?? new Date(),
    } as never)
    .returningAll()
    .executeTakeFirstOrThrow();

  for (let i = 0; i < (over.frames ?? 0); i++) {
    await db
      .insertInto('stack_frames')
      .values({
        exception_id: row.id,
        frame_index: i,
        file_path: `/app/f${i}.js`,
        function_name: `fn${i}`,
        line_number: 10 + i,
        is_app_code: true,
      } as never)
      .execute();
  }
  return row;
}

async function clean() {
  await db.deleteFrom('stack_frames').execute();
  await db.deleteFrom('exceptions').execute();
  await db.deleteFrom('error_groups').execute();
}

describe('ErrorGroupTriageService.getTrends', () => {
  beforeEach(clean);

  it('returns one fixed-length array per group, zero filled', async () => {
    const ctx = await createTestContext();
    const g = await makeGroup(ctx, 'fp-trend-empty');
    const to = new Date();
    const from = new Date(to.getTime() - 24 * HOUR);

    const res = await triage.getTrends({ organizationId: ctx.organization.id, ids: [g.id], from, to });

    expect(res.buckets).toBe(24);
    expect(res.trends[g.id]).toEqual(new Array(24).fill(0));
    expect(res.from).toBe(from.toISOString());
    expect(res.bucketMs).toBe(HOUR);
  });

  it('places occurrences in the right bucket and the last instant lands in the last bucket', async () => {
    const ctx = await createTestContext();
    const g = await makeGroup(ctx, 'fp-trend-buckets');
    const from = new Date(Date.now() - 24 * HOUR);
    const to = new Date(from.getTime() + 24 * HOUR);
    await addException(ctx, 'fp-trend-buckets', { createdAt: new Date(from.getTime() + 30 * MIN) });
    await addException(ctx, 'fp-trend-buckets', { createdAt: new Date(from.getTime() + 40 * MIN) });
    await addException(ctx, 'fp-trend-buckets', { createdAt: new Date(from.getTime() + 90 * MIN) });
    await addException(ctx, 'fp-trend-buckets', { createdAt: new Date(to.getTime()) });
    // outside the range on both sides
    await addException(ctx, 'fp-trend-buckets', { createdAt: new Date(from.getTime() - MIN) });
    await addException(ctx, 'fp-trend-buckets', { createdAt: new Date(to.getTime() + MIN) });

    const res = await triage.getTrends({ organizationId: ctx.organization.id, ids: [g.id], from, to });
    const counts = res.trends[g.id];

    expect(counts).toHaveLength(24);
    expect(counts[0]).toBe(2);
    expect(counts[1]).toBe(1);
    expect(counts[23]).toBe(1);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(4);
  });

  it("counts only the group's own fingerprint and project", async () => {
    const ctx = await createTestContext();
    const otherProject = await createTestProject({ organizationId: ctx.organization.id });
    const g = await makeGroup(ctx, 'fp-own');
    await makeGroup(ctx, 'fp-own', {}, otherProject.id);
    const from = new Date(Date.now() - 24 * HOUR);
    const to = new Date(from.getTime() + 24 * HOUR);
    const at = new Date(from.getTime() + 5 * MIN);
    await addException(ctx, 'fp-own', { createdAt: at });
    await addException(ctx, 'fp-own', { createdAt: at, projectId: otherProject.id });
    await addException(ctx, 'fp-different', { createdAt: at });

    const res = await triage.getTrends({ organizationId: ctx.organization.id, ids: [g.id], from, to });
    expect(res.trends[g.id].reduce((a, b) => a + b, 0)).toBe(1);
  });

  it('omits foreign and unknown ids', async () => {
    const ctx = await createTestContext();
    const other = await createTestContext();
    const mine = await makeGroup(ctx, 'fp-mine');
    const foreign = await makeGroup(other, 'fp-foreign');
    const to = new Date();
    const from = new Date(to.getTime() - HOUR);

    const res = await triage.getTrends({
      organizationId: ctx.organization.id,
      ids: [mine.id, foreign.id, randomUUID()],
      from,
      to,
    });
    expect(Object.keys(res.trends)).toEqual([mine.id]);
  });

  it('clamps buckets to 96 and defaults to 24', async () => {
    const ctx = await createTestContext();
    const g = await makeGroup(ctx, 'fp-clamp');
    const to = new Date();
    const from = new Date(to.getTime() - 96 * HOUR);

    const big = await triage.getTrends({ organizationId: ctx.organization.id, ids: [g.id], from, to, buckets: 500 });
    expect(big.buckets).toBe(96);
    expect(big.trends[g.id]).toHaveLength(96);

    const def = await triage.getTrends({ organizationId: ctx.organization.id, ids: [g.id], from, to });
    expect(def.buckets).toBe(24);

    const tiny = await triage.getTrends({ organizationId: ctx.organization.id, ids: [g.id], from, to, buckets: 0 });
    expect(tiny.buckets).toBeGreaterThanOrEqual(1);
  });

  it('returns an empty result for no ids', async () => {
    const ctx = await createTestContext();
    const to = new Date();
    const res = await triage.getTrends({ organizationId: ctx.organization.id, ids: [], from: new Date(to.getTime() - HOUR), to });
    expect(res.trends).toEqual({});
  });
});

describe('ErrorGroupTriageService.getEvents', () => {
  beforeEach(clean);

  it('no cursor returns the latest event with frames and log', async () => {
    const ctx = await createTestContext();
    const log = await createTestLog({
      projectId: ctx.project.id,
      level: 'error',
      message: 'latest log',
      service: 'api',
      trace_id: 'trace-latest',
    });
    await db.updateTable('logs').set({ span_id: 'span-1', session_id: 'sess-1' }).where('id', '=', log.id).execute();
    const g = await makeGroup(ctx, 'fp-ev-1');
    await addException(ctx, 'fp-ev-1', { createdAt: new Date(Date.now() - HOUR), message: 'old' });
    const latest = await addException(ctx, 'fp-ev-1', { logId: log.id, message: 'newest', frames: 2 });

    const res = await triage.getEvents({ groupId: g.id, organizationId: ctx.organization.id });

    expect(res).not.toBeNull();
    expect(res!.events).toHaveLength(1);
    const ev = res!.events[0];
    expect(ev.cursor).toBe(latest.id);
    expect(ev.exception.id).toBe(latest.id);
    expect(ev.exception.exceptionMessage).toBe('newest');
    expect(ev.frames.map((f) => f.frameIndex)).toEqual([0, 1]);
    expect(ev.log).not.toBeNull();
    expect(ev.log!.id).toBe(log.id);
    expect(ev.log!.message).toBe('latest log');
    expect(ev.log!.service).toBe('api');
    expect(ev.log!.traceId).toBe('trace-latest');
    expect(ev.log!.spanId).toBe('span-1');
    expect(ev.log!.sessionId).toBe('sess-1');
    expect(res!.hasNewer).toBe(false);
    expect(res!.hasOlder).toBe(true);
  });

  it('latest event is the newest exception even though sample_log_id points at the first', async () => {
    const ctx = await createTestContext();
    const firstLog = await createTestLog({ projectId: ctx.project.id, level: 'error', message: 'first log' });
    const lastLog = await createTestLog({ projectId: ctx.project.id, level: 'error', message: 'last log' });
    const g = await makeGroup(ctx, 'fp-b13', { sample_log_id: firstLog.id });
    await addException(ctx, 'fp-b13', { logId: firstLog.id, createdAt: new Date(Date.now() - 5 * HOUR), message: 'first' });
    await addException(ctx, 'fp-b13', { logId: lastLog.id, createdAt: new Date(Date.now() - MIN), message: 'last' });

    const res = await triage.getEvents({ groupId: g.id, organizationId: ctx.organization.id });

    expect(res!.events[0].exception.exceptionMessage).toBe('last');
    expect(res!.events[0].log!.message).toBe('last log');
  });

  it('older then newer walks the full list without repeats or gaps', async () => {
    const ctx = await createTestContext();
    const g = await makeGroup(ctx, 'fp-walk');
    const base = Date.now() - 10 * HOUR;
    const ids: string[] = [];
    for (let i = 0; i < 6; i++) {
      const e = await addException(ctx, 'fp-walk', { createdAt: new Date(base + i * HOUR) });
      ids.push(e.id);
    }
    const newestFirst = [...ids].reverse();

    // walk older, one at a time
    const walked: string[] = [];
    let cursor: string | undefined;
    let page = await triage.getEvents({ groupId: g.id, organizationId: ctx.organization.id });
    walked.push(page!.events[0].cursor);
    cursor = page!.events[0].cursor;
    while (page!.hasOlder) {
      page = await triage.getEvents({ groupId: g.id, organizationId: ctx.organization.id, cursor, direction: 'older' });
      expect(page!.events).toHaveLength(1);
      walked.push(page!.events[0].cursor);
      cursor = page!.events[0].cursor;
      expect(page!.hasNewer).toBe(true);
    }
    expect(walked).toEqual(newestFirst);

    // walk back newer
    const back: string[] = [cursor!];
    while (true) {
      const p = await triage.getEvents({ groupId: g.id, organizationId: ctx.organization.id, cursor, direction: 'newer' });
      if (p!.events.length === 0) {
        expect(p!.hasNewer).toBe(false);
        break;
      }
      back.push(p!.events[0].cursor);
      cursor = p!.events[0].cursor;
      expect(p!.hasOlder).toBe(true);
    }
    expect(back).toEqual([...newestFirst].reverse());
  });

  it('a page of several events is returned newest first in both directions', async () => {
    const ctx = await createTestContext();
    const g = await makeGroup(ctx, 'fp-page');
    const base = Date.now() - 10 * HOUR;
    const ids: string[] = [];
    for (let i = 0; i < 7; i++) {
      ids.push((await addException(ctx, 'fp-page', { createdAt: new Date(base + i * HOUR) })).id);
    }
    // ids ascending in time; cursor on index 3
    const older = await triage.getEvents({ groupId: g.id, organizationId: ctx.organization.id, cursor: ids[3], direction: 'older', limit: 2 });
    expect(older!.events.map((e) => e.cursor)).toEqual([ids[2], ids[1]]);
    expect(older!.hasOlder).toBe(true);
    expect(older!.hasNewer).toBe(true);

    const newer = await triage.getEvents({ groupId: g.id, organizationId: ctx.organization.id, cursor: ids[3], direction: 'newer', limit: 2 });
    expect(newer!.events.map((e) => e.cursor)).toEqual([ids[5], ids[4]]);
    expect(newer!.hasNewer).toBe(true);
    expect(newer!.hasOlder).toBe(true);

    const lastOlder = await triage.getEvents({ groupId: g.id, organizationId: ctx.organization.id, cursor: ids[2], direction: 'older', limit: 5 });
    expect(lastOlder!.events.map((e) => e.cursor)).toEqual([ids[1], ids[0]]);
    expect(lastOlder!.hasOlder).toBe(false);
  });

  it('rows with identical created_at are ordered by id and still paged exactly once', async () => {
    const ctx = await createTestContext();
    const g = await makeGroup(ctx, 'fp-same-ts');
    const at = new Date(Date.now() - HOUR);
    const rows: string[] = [];
    for (let i = 0; i < 5; i++) {
      rows.push((await addException(ctx, 'fp-same-ts', { createdAt: at })).id);
    }
    const expected = [...rows].sort().reverse(); // (created_at desc, id desc)

    const seen: string[] = [];
    let page = await triage.getEvents({ groupId: g.id, organizationId: ctx.organization.id });
    seen.push(page!.events[0].cursor);
    while (page!.hasOlder) {
      page = await triage.getEvents({
        groupId: g.id,
        organizationId: ctx.organization.id,
        cursor: seen[seen.length - 1],
        direction: 'older',
      });
      seen.push(page!.events[0].cursor);
    }
    expect(seen).toEqual(expected);
  });

  it('hasOlder and hasNewer are correct at both ends and for a single event group', async () => {
    const ctx = await createTestContext();
    const single = await makeGroup(ctx, 'fp-single');
    const only = await addException(ctx, 'fp-single');

    const res = await triage.getEvents({ groupId: single.id, organizationId: ctx.organization.id });
    expect(res!.events.map((e) => e.cursor)).toEqual([only.id]);
    expect(res!.hasOlder).toBe(false);
    expect(res!.hasNewer).toBe(false);

    const older = await triage.getEvents({ groupId: single.id, organizationId: ctx.organization.id, cursor: only.id, direction: 'older' });
    expect(older!.events).toEqual([]);
    expect(older!.hasOlder).toBe(false);
    expect(older!.hasNewer).toBe(true);

    const newer = await triage.getEvents({ groupId: single.id, organizationId: ctx.organization.id, cursor: only.id, direction: 'newer' });
    expect(newer!.events).toEqual([]);
    expect(newer!.hasNewer).toBe(false);
    expect(newer!.hasOlder).toBe(true);
  });

  it('limit above 20 is rejected, as is limit 0', async () => {
    const ctx = await createTestContext();
    const g = await makeGroup(ctx, 'fp-limit');
    await addException(ctx, 'fp-limit');
    await expect(
      triage.getEvents({ groupId: g.id, organizationId: ctx.organization.id, limit: 21 }),
    ).rejects.toBeInstanceOf(ErrorGroupValidationError);
    await expect(
      triage.getEvents({ groupId: g.id, organizationId: ctx.organization.id, limit: 0 }),
    ).rejects.toBeInstanceOf(ErrorGroupValidationError);
    const ok = await triage.getEvents({ groupId: g.id, organizationId: ctx.organization.id, limit: 20 });
    expect(ok!.events).toHaveLength(1);
  });

  it('invalid or foreign cursor throws Invalid cursor', async () => {
    const ctx = await createTestContext();
    const other = await createTestContext();
    const g = await makeGroup(ctx, 'fp-cursor');
    await addException(ctx, 'fp-cursor');
    await makeGroup(other, 'fp-cursor');
    const foreignRow = await addException(other, 'fp-cursor');
    const otherFp = await addException(ctx, 'fp-elsewhere');

    for (const cursor of [randomUUID(), 'not-a-uuid', foreignRow.id, otherFp.id]) {
      await expect(
        triage.getEvents({ groupId: g.id, organizationId: ctx.organization.id, cursor, direction: 'older' }),
      ).rejects.toThrow('Invalid cursor');
    }
  });

  it('event whose log was deleted returns log null but keeps frames', async () => {
    const ctx = await createTestContext();
    const log = await createTestLog({ projectId: ctx.project.id, level: 'error' });
    const g = await makeGroup(ctx, 'fp-gone');
    await addException(ctx, 'fp-gone', { logId: log.id, frames: 3 });
    await db.deleteFrom('logs').where('id', '=', log.id).execute();

    const res = await triage.getEvents({ groupId: g.id, organizationId: ctx.organization.id });

    expect(res!.events[0].log).toBeNull();
    expect(res!.events[0].frames).toHaveLength(3);
  });

  it('merged group includes events of merged fingerprints', async () => {
    const ctx = await createTestContext();
    const target = await makeGroup(ctx, 'fp-target');
    const source = await makeGroup(ctx, 'fp-source');
    await addException(ctx, 'fp-target', { createdAt: new Date(Date.now() - 3 * HOUR) });
    const fromSource = await addException(ctx, 'fp-source', { createdAt: new Date(Date.now() - HOUR) });

    await exceptionService.mergeErrorGroups(target.id, [source.id], ctx.organization.id);

    const res = await triage.getEvents({ groupId: target.id, organizationId: ctx.organization.id, limit: 5 });
    expect(res!.events).toHaveLength(2);
    expect(res!.events[0].cursor).toBe(fromSource.id);
  });

  it("does not mix in the same fingerprint from another project", async () => {
    const ctx = await createTestContext();
    const otherProject = await createTestProject({ organizationId: ctx.organization.id });
    const g = await makeGroup(ctx, 'fp-proj');
    await makeGroup(ctx, 'fp-proj', {}, otherProject.id);
    const mine = await addException(ctx, 'fp-proj', { createdAt: new Date(Date.now() - HOUR) });
    await addException(ctx, 'fp-proj', { projectId: otherProject.id });

    const res = await triage.getEvents({ groupId: g.id, organizationId: ctx.organization.id, limit: 5 });
    expect(res!.events.map((e) => e.cursor)).toEqual([mine.id]);
  });

  it("returns null for another organization's group", async () => {
    const ctx = await createTestContext();
    const other = await createTestContext();
    const g = await makeGroup(other, 'fp-foreign-ev');
    await addException(other, 'fp-foreign-ev');

    expect(await triage.getEvents({ groupId: g.id, organizationId: ctx.organization.id })).toBeNull();
    expect(await triage.getEvents({ groupId: randomUUID(), organizationId: ctx.organization.id })).toBeNull();
  });
});

describe('ErrorGroupTriageService.getErrorGroupsByTrace', () => {
  beforeEach(clean);

  async function errorLog(ctx: Ctx, traceId: string, spanId: string | null, level: 'error' | 'info' = 'error') {
    const log = await createTestLog({ projectId: ctx.project.id, level, trace_id: traceId, message: `m-${level}` });
    if (spanId) {
      await db.updateTable('logs').set({ span_id: spanId }).where('id', '=', log.id).execute();
    }
    return log;
  }

  it('returns groups for error logs of the trace with their span ids', async () => {
    const ctx = await createTestContext();
    const g1 = await makeGroup(ctx, 'fp-t1', { exception_type: 'TypeError', status: 'resolved' });
    const g2 = await makeGroup(ctx, 'fp-t2', { exception_type: 'RangeError', exception_message: 'range' });
    const l1 = await errorLog(ctx, 'trace-a', 'span-1');
    const l2 = await errorLog(ctx, 'trace-a', 'span-2');
    await addException(ctx, 'fp-t1', { logId: l1.id });
    await addException(ctx, 'fp-t2', { logId: l2.id, type: 'RangeError', message: 'range' });

    const res = await triage.getErrorGroupsByTrace({
      organizationId: ctx.organization.id,
      projectId: ctx.project.id,
      traceId: 'trace-a',
    });

    expect(res).not.toBeNull();
    expect(res).toHaveLength(2);
    const m1 = res!.find((m) => m.errorGroupId === g1.id)!;
    expect(m1.spanId).toBe('span-1');
    expect(m1.logId).toBe(l1.id);
    expect(m1.status).toBe('resolved');
    expect(m1.exceptionType).toBe('TypeError');
    expect(m1.projectId).toBe(ctx.project.id);
    expect(typeof m1.occurredAt).toBe('string');
    const m2 = res!.find((m) => m.errorGroupId === g2.id)!;
    expect(m2.spanId).toBe('span-2');
    expect(m2.exceptionMessage).toBe('range');
  });

  it('ignores info logs of the same trace', async () => {
    const ctx = await createTestContext();
    await makeGroup(ctx, 'fp-info');
    const info = await errorLog(ctx, 'trace-b', 'span-1', 'info');
    await addException(ctx, 'fp-info', { logId: info.id });

    const res = await triage.getErrorGroupsByTrace({
      organizationId: ctx.organization.id,
      projectId: ctx.project.id,
      traceId: 'trace-b',
    });
    expect(res).toEqual([]);
  });

  it('returns null for a project of another organization', async () => {
    const ctx = await createTestContext();
    const other = await createTestContext();

    const res = await triage.getErrorGroupsByTrace({
      organizationId: ctx.organization.id,
      projectId: other.project.id,
      traceId: 'trace-c',
    });
    expect(res).toBeNull();
  });

  it('returns null for a soft-deleted project', async () => {
    const ctx = await createTestContext();
    await db.updateTable('projects').set({ deleted_at: new Date() }).where('id', '=', ctx.project.id).execute();

    const res = await triage.getErrorGroupsByTrace({
      organizationId: ctx.organization.id,
      projectId: ctx.project.id,
      traceId: 'trace-d',
    });
    expect(res).toBeNull();
  });

  it('deduplicates repeated exceptions of one group in one span', async () => {
    const ctx = await createTestContext();
    const g = await makeGroup(ctx, 'fp-dup');
    const l1 = await errorLog(ctx, 'trace-e', 'span-1');
    const l2 = await errorLog(ctx, 'trace-e', 'span-1');
    const l3 = await errorLog(ctx, 'trace-e', 'span-2');
    await addException(ctx, 'fp-dup', { logId: l1.id });
    await addException(ctx, 'fp-dup', { logId: l2.id });
    await addException(ctx, 'fp-dup', { logId: l3.id });

    const res = await triage.getErrorGroupsByTrace({
      organizationId: ctx.organization.id,
      projectId: ctx.project.id,
      traceId: 'trace-e',
    });

    expect(res).toHaveLength(2);
    expect(res!.every((m) => m.errorGroupId === g.id)).toBe(true);
    expect(res!.map((m) => m.spanId).sort()).toEqual(['span-1', 'span-2']);
  });

  it('does not return exceptions of another organization sharing a log id', async () => {
    const ctx = await createTestContext();
    const other = await createTestContext();
    await makeGroup(other, 'fp-x');
    const log = await errorLog(ctx, 'trace-f', 'span-1');
    await addException(other, 'fp-x', { logId: log.id });

    const res = await triage.getErrorGroupsByTrace({
      organizationId: ctx.organization.id,
      projectId: ctx.project.id,
      traceId: 'trace-f',
    });
    expect(res).toEqual([]);
  });
});

describe('ExceptionService.getExceptionByLogId errorGroupId', () => {
  beforeEach(clean);

  it('includes errorGroupId', async () => {
    const ctx = await createTestContext();
    const g = await makeGroup(ctx, 'fp-bylog');
    const e = await addException(ctx, 'fp-bylog');

    const res = await exceptionService.getExceptionByLogId(e.log_id, ctx.organization.id);
    expect(res!.errorGroupId).toBe(g.id);
  });

  it('is null when the group row is missing', async () => {
    const ctx = await createTestContext();
    const e = await addException(ctx, 'fp-no-group');
    // the insert trigger creates the group; remove it to simulate a missing row
    await db.deleteFrom('error_groups').where('organization_id', '=', ctx.organization.id).execute();

    const res = await exceptionService.getExceptionByLogId(e.log_id, ctx.organization.id);
    expect(res).not.toBeNull();
    expect(res!.errorGroupId).toBeNull();
  });

  it('does not pick the group of a sibling project with the same fingerprint', async () => {
    const ctx = await createTestContext();
    const otherProject = await createTestProject({ organizationId: ctx.organization.id });
    await makeGroup(ctx, 'fp-sib', {}, otherProject.id);
    const e = await addException(ctx, 'fp-sib');
    // drop the group the insert trigger created for the exception's own project
    await db.deleteFrom('error_groups').where('project_id', '=', ctx.project.id).execute();

    const res = await exceptionService.getExceptionByLogId(e.log_id, ctx.organization.id);
    expect(res!.errorGroupId).toBeNull();
  });
});
