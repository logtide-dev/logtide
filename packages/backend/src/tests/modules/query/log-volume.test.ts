import { describe, it, expect, beforeEach } from 'vitest';
import { sql } from 'kysely';
import { db } from '../../../database/index.js';
import { reservoir } from '../../../database/reservoir.js';
import type { LogFilterParams, LogLevel } from '@logtide/reservoir';
import {
  AGGREGATE_TAIL_MS,
  AGGREGATE_WINDOW_MS,
  aggregateCanAnswer,
  countFromAggregate,
  histogramFromAggregate,
  splitVolumeRange,
} from '../../../modules/query/log-volume.js';
import { createTestContext, createTestProject } from '../../helpers/index.js';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe('splitVolumeRange', () => {
  const now = new Date('2026-11-02T12:00:00.000Z');
  const at = (iso: string) => new Date(iso);

  it('reads whole minutes from the aggregate and the partial edges raw', () => {
    const split = splitVolumeRange({ from: at('2026-11-02T10:00:17.000Z'), to: at('2026-11-02T11:00:42.500Z') }, now);
    expect(split.aggregate).toEqual([{ from: at('2026-11-02T10:01:00.000Z'), to: at('2026-11-02T11:00:00.000Z') }]);
    expect(split.raw).toEqual([
      { from: at('2026-11-02T10:00:17.000Z'), to: at('2026-11-02T10:01:00.000Z'), fromExclusive: undefined, toExclusive: true },
      { from: at('2026-11-02T11:00:00.000Z'), to: at('2026-11-02T11:00:42.500Z'), fromExclusive: false, toExclusive: undefined },
    ]);
  });

  it('aligned bounds need raw only for an inclusive end instant', () => {
    const inclusive = splitVolumeRange({ from: at('2026-11-02T10:00:00.000Z'), to: at('2026-11-02T11:00:00.000Z') }, now);
    expect(inclusive.aggregate).toEqual([{ from: at('2026-11-02T10:00:00.000Z'), to: at('2026-11-02T11:00:00.000Z') }]);
    expect(inclusive.raw).toEqual([{ from: at('2026-11-02T11:00:00.000Z'), to: at('2026-11-02T11:00:00.000Z'), fromExclusive: false, toExclusive: undefined }]);
    const exclusive = splitVolumeRange({ from: at('2026-11-02T10:00:00.000Z'), to: at('2026-11-02T11:00:00.000Z'), toExclusive: true }, now);
    expect(exclusive.raw).toEqual([]);
  });

  it('an exclusive aligned start leaves its first minute raw', () => {
    const split = splitVolumeRange({ from: at('2026-11-02T10:00:00.000Z'), to: at('2026-11-02T10:30:00.000Z'), fromExclusive: true, toExclusive: true }, now);
    expect(split.aggregate[0].from).toEqual(at('2026-11-02T10:01:00.000Z'));
    expect(split.raw[0]).toEqual({ from: at('2026-11-02T10:00:00.000Z'), to: at('2026-11-02T10:01:00.000Z'), fromExclusive: true, toExclusive: true });
  });

  it('the newest minutes and anything older than the window stay raw', () => {
    const split = splitVolumeRange({ from: new Date(now.getTime() - 40 * DAY), to: now }, now);
    expect(split.aggregate).toEqual([{
      from: new Date(Math.ceil((now.getTime() - AGGREGATE_WINDOW_MS) / MIN) * MIN),
      to: new Date(now.getTime() - AGGREGATE_TAIL_MS),
    }]);
    expect(split.raw[0].from).toEqual(new Date(now.getTime() - 40 * DAY));
    expect(split.raw[1].to).toEqual(now);
  });

  it('a range with no whole trusted minute is read raw', () => {
    const range = { from: at('2026-11-02T11:57:00.000Z'), to: now };
    expect(splitVolumeRange(range, now)).toEqual({ aggregate: [], raw: [range] });
    const old = { from: new Date(now.getTime() - 60 * DAY), to: new Date(now.getTime() - 50 * DAY) };
    expect(splitVolumeRange(old, now).aggregate).toEqual([]);
  });

  it('minutes touched by a stale span are read raw, the rest from the aggregate', () => {
    const range = { from: at('2026-11-02T10:00:00.000Z'), to: at('2026-11-02T11:00:00.000Z'), toExclusive: true };
    const stale: [number, number][] = [
      [at('2026-11-02T10:20:30.000Z').getTime(), at('2026-11-02T10:21:10.000Z').getTime()],
      [at('2026-11-02T10:40:00.000Z').getTime(), at('2026-11-02T10:40:00.000Z').getTime()],
    ];
    const split = splitVolumeRange(range, now, stale);
    expect(split.aggregate).toEqual([
      { from: at('2026-11-02T10:00:00.000Z'), to: at('2026-11-02T10:20:00.000Z') },
      { from: at('2026-11-02T10:22:00.000Z'), to: at('2026-11-02T10:40:00.000Z') },
      { from: at('2026-11-02T10:41:00.000Z'), to: at('2026-11-02T11:00:00.000Z') },
    ]);
    expect(split.raw).toEqual([
      { from: at('2026-11-02T10:20:00.000Z'), to: at('2026-11-02T10:22:00.000Z'), fromExclusive: false, toExclusive: true },
      { from: at('2026-11-02T10:40:00.000Z'), to: at('2026-11-02T10:41:00.000Z'), fromExclusive: false, toExclusive: true },
    ]);
  });

  it('a stale span over the whole range leaves it raw', () => {
    const range = { from: at('2026-11-02T10:00:00.000Z'), to: at('2026-11-02T11:00:00.000Z') };
    const split = splitVolumeRange(range, now, [[at('2026-11-02T09:00:00.000Z').getTime(), at('2026-11-02T12:00:00.000Z').getTime()]]);
    expect(split).toEqual({ aggregate: [], raw: [range] });
  });
});

describe('aggregateCanAnswer', () => {
  const base: LogFilterParams = { projectId: 'p', from: new Date(0), to: new Date(1) };

  it('accepts projects, window, level and service (included or excluded)', () => {
    expect(aggregateCanAnswer(base)).toBe(true);
    expect(aggregateCanAnswer({ ...base, projectId: ['a', 'b'], level: ['error'], service: 'api', exclude: { level: ['debug'], service: ['cron'] } })).toBe(true);
    expect(aggregateCanAnswer({ ...base, textQuery: { all: [], anyOf: [], none: [] } })).toBe(true);
  });

  it('rejects every condition the aggregate does not hold', () => {
    for (const extra of [
      { hostname: 'h' },
      { traceId: 't' },
      { sessionId: 's' },
      { spanId: 's' },
      { search: 'x' },
      { textQuery: { all: [{ kind: 'word' as const, value: 'x' }], anyOf: [], none: [] } },
      { metadataFilters: [{ key: 'k', op: 'equals' as const, value: 'v', include_missing: false }] },
      { exclude: { hostname: ['h'] } },
      { matchNothing: true },
      { projectId: [] as string[] },
    ]) {
      expect(aggregateCanAnswer({ ...base, ...extra } as LogFilterParams)).toBe(false);
    }
  });
});

describe('log volume from the per-minute aggregate matches the logs table', () => {
  let projectId: string;
  let otherProjectId: string;
  const now = new Date();
  const anchor = Math.floor((now.getTime() - 3 * HOUR) / MIN) * MIN;

  beforeEach(async () => {
    const ctx = await createTestContext();
    projectId = ctx.project.id;
    otherProjectId = (await createTestProject({ organizationId: ctx.organization.id, userId: ctx.user.id })).id;
    const levels: LogLevel[] = ['info', 'info', 'warn', 'error', 'debug', 'critical'];
    const services = ['api', 'worker', 'cron'];
    const rows: { project_id: string; service: string; level: LogLevel; message: string; time: Date }[] = [];
    // 3 hours of logs at odd seconds, the last few minutes, exact minute
    // boundaries and some older than the aggregate window.
    for (let i = 0; i < 400; i++) {
      rows.push({ project_id: i % 5 === 0 ? otherProjectId : projectId, service: services[i % 3], level: levels[i % 6], message: `m${i}`, time: new Date(anchor + i * 27_317) });
    }
    for (let i = 0; i < 20; i++) rows.push({ project_id: projectId, service: 'api', level: 'info', message: `tail${i}`, time: new Date(now.getTime() - i * 13_000) });
    for (let i = 0; i < 10; i++) rows.push({ project_id: projectId, service: 'api', level: 'error', message: `edge${i}`, time: new Date(anchor + i * MIN) });
    for (let i = 0; i < 15; i++) rows.push({ project_id: projectId, service: 'worker', level: 'warn', message: `old${i}`, time: new Date(now.getTime() - 35 * DAY - i * HOUR) });
    await db.insertInto('logs').values(rows).execute();
    await sql`CALL refresh_continuous_aggregate('logs_minute_stats', NULL, NULL)`.execute(db);
  });

  const cases: { name: string; filter: () => LogFilterParams; bucketSeconds: number }[] = [
    { name: 'unaligned 3 hour range, 5 minute buckets', filter: () => ({ projectId, from: new Date(anchor - 17_000), to: new Date(now.getTime()) }), bucketSeconds: 300 },
    { name: 'aligned bounds, 1 minute buckets', filter: () => ({ projectId, from: new Date(anchor), to: new Date(anchor + HOUR) }), bucketSeconds: 60 },
    { name: 'exclusive bounds', filter: () => ({ projectId, from: new Date(anchor), to: new Date(anchor + HOUR), fromExclusive: true, toExclusive: true }), bucketSeconds: 60 },
    { name: 'level and service filters', filter: () => ({ projectId, from: new Date(anchor - 5_000), to: now, level: ['error', 'critical'], service: ['api', 'worker'] }), bucketSeconds: 600 },
    { name: 'excluded levels and services', filter: () => ({ projectId, from: new Date(anchor), to: now, exclude: { level: ['debug'], service: ['cron'] } }), bucketSeconds: 900 },
    { name: 'several projects', filter: () => ({ projectId: [projectId, otherProjectId], from: new Date(anchor + 7_000), to: now }), bucketSeconds: 3600 },
    { name: '40 days, older logs past the window', filter: () => ({ projectId, from: new Date(now.getTime() - 40 * DAY), to: now }), bucketSeconds: 86_400 },
  ];

  for (const kase of cases) {
    it(`histogram: ${kase.name}`, async () => {
      const filter = kase.filter();
      expect(await histogramFromAggregate(db, reservoir, filter, kase.bucketSeconds, now)).toEqual(
        await reservoir.histogram({ ...filter, bucketSeconds: kase.bucketSeconds }),
      );
    });

    it(`count: ${kase.name}`, async () => {
      const filter = kase.filter();
      expect(await countFromAggregate(db, reservoir, filter, now)).toBe((await reservoir.count(filter)).count);
    });
  }

  it('reads only the edges from the logs table once the aggregate is fresh', async () => {
    const ranges: { from: Date; to: Date }[] = [];
    const spy = {
      histogram: (p: LogFilterParams & { bucketSeconds: number }) => { ranges.push({ from: p.from, to: p.to }); return reservoir.histogram(p); },
      count: (p: LogFilterParams) => { ranges.push({ from: p.from, to: p.to }); return reservoir.count(p); },
    };
    const filter = { projectId, from: new Date(anchor - 17_000), to: new Date(anchor + 2 * HOUR + 42_000) };
    expect(await countFromAggregate(db, spy, filter, now)).toBe((await reservoir.count(filter)).count);
    const rawMs = ranges.reduce((sum, r) => sum + (r.to.getTime() - r.from.getTime()), 0);
    expect(rawMs).toBeLessThan(2 * MIN);
  });

  it('logs written after the refresh count at once (late logs, backfills)', async () => {
    const late = Array.from({ length: 12 }, (_, i) => ({
      project_id: projectId, service: 'api', level: 'error' as LogLevel, message: `late${i}`, time: new Date(anchor + 30 * MIN + i * 4_111),
    }));
    await db.insertInto('logs').values(late).execute();
    const filter = { projectId, from: new Date(anchor - 17_000), to: now };
    expect(await histogramFromAggregate(db, reservoir, filter, 300, now)).toEqual(await reservoir.histogram({ ...filter, bucketSeconds: 300 }));
    expect(await countFromAggregate(db, reservoir, filter, now)).toBe((await reservoir.count(filter)).count);
  });

  it('logs deleted after the refresh stop counting at once (retention)', async () => {
    const from = new Date(anchor);
    const to = new Date(anchor + HOUR);
    await db.deleteFrom('logs').where('project_id', '=', projectId).where('time', '>=', from).where('time', '<', to).execute();
    const filter = { projectId, from: new Date(anchor - 17_000), to: now };
    expect(await countFromAggregate(db, reservoir, { projectId, from, to, toExclusive: true }, now)).toBe(0);
    expect(await histogramFromAggregate(db, reservoir, filter, 900, now)).toEqual(await reservoir.histogram({ ...filter, bucketSeconds: 900 }));
  });
});
