// ============================================================================
// MongoDB log volume pre-aggregate
// ============================================================================
// MongoDB has no incremental aggregate, and on the time-series logs
// collection a histogram or count unpacks every log of the range (about 2 s
// for 5 million logs). This keeps the equivalent of a TimescaleDB continuous
// aggregate by hand, with the same exactness rules:
//
// - log_volume_minutes: log count per minute, project, level and service;
// - log_volume_state: the watermark (every minute before it is materialized)
//   and a lease lock for the refresher;
// - log_volume_dirty: minute spans whose counts may be wrong (logs written
//   below the watermark, deletes, a watermark move racing an insert); reads
//   take them from the logs until the refresher recomputes them.
//
// Writers mark a span dirty BEFORE writing below the watermark and check the
// watermark again AFTER writing, so a refresher that moved it meanwhile is
// caught; a span is only cleared after its counts were rewritten. Reads use
// the counts only for whole minutes below the watermark and outside every
// dirty span, and the logs for the rest, so they match a read of the logs.
// The one gap is the few milliseconds between a refresher publishing a new
// watermark and a racing insert marking its logs, for logs older than
// VOLUME_FRESH_MS that arrive exactly then; batches of newer logs (real time)
// skip the checks and cannot fall below the watermark.

import type { Collection, Db, Document } from 'mongodb';
import { randomUUID } from 'node:crypto';
import type { StaleSpan } from '../../core/log-volume.js';
import type { LogFilterParams, LogLevel } from '../../core/types.js';

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
/** The watermark stays this far behind the MongoDB server clock. */
export const VOLUME_LAG_MS = 5 * MINUTE;
/**
 * Writers skip the watermark checks for batches whose logs are all newer than
 * this. Safe while the writer's clock is at most VOLUME_LAG_MS minus this (3
 * minutes) behind the MongoDB server: such logs are always above the watermark.
 */
export const VOLUME_FRESH_MS = 2 * MINUTE;
/** How far one refresh step advances the watermark. */
export const VOLUME_STEP_MS = DAY;
/** A refresher holding the lock longer than this is presumed dead. */
const LOCK_MS = 5 * MINUTE;
/** Time budget of one refresh run. */
const RUN_BUDGET_MS = 20_000;

const STATE_ID = 'logs';

interface StateDoc {
  _id: string;
  watermark?: Date;
  lockUntil?: Date;
  lockOwner?: string;
}

interface DirtyDoc {
  _id?: unknown;
  /** Project, or null for every project. */
  p: string | null;
  /** Half-open, minute aligned. */
  from: Date;
  to: Date;
}

const floorMinute = (ms: number) => Math.floor(ms / MINUTE) * MINUTE;

export interface VolumeRefreshResult {
  ran: boolean;
  recomputedSpans: number;
  watermark: Date | null;
}

export class MongoLogVolume {
  constructor(
    private readonly db: Db,
    private readonly logs: () => Collection,
    /** Options of the read queries ($comment of the request context, analytics maxTimeMS). */
    private readonly readOpts: () => Document = () => ({}),
  ) {}

  private stats(): Collection {
    return this.db.collection('log_volume_minutes');
  }

  private state(): Collection<StateDoc> {
    return this.db.collection<StateDoc>('log_volume_state');
  }

  private dirty(): Collection<DirtyDoc> {
    return this.db.collection<DirtyDoc>('log_volume_dirty');
  }

  async ensureIndexes(): Promise<void> {
    await this.stats().createIndex({ p: 1, m: 1 }, { name: 'idx_volume_project_minute' });
    await this.dirty().createIndex({ from: 1 }, { name: 'idx_volume_dirty_from' });
  }

  async watermark(): Promise<Date | null> {
    const doc = await this.state().findOne({ _id: STATE_ID }, this.readOpts());
    return doc?.watermark ?? null;
  }

  // --------------------------------------------------------------------------
  // Writers
  // --------------------------------------------------------------------------

  /** Whether a batch can touch materialized minutes at all (any log older than VOLUME_FRESH_MS). */
  private mayBeLate(times: Date[], now = Date.now()): boolean {
    return times.some((t) => t.getTime() < now - VOLUME_FRESH_MS);
  }

  /** Dirty spans for the logs older than `before`, one per project (min to max minute). */
  private async markLogs(logs: { projectId: string; time: Date }[], lower: number, before: number): Promise<void> {
    const spans = new Map<string, [number, number]>();
    for (const log of logs) {
      const t = log.time.getTime();
      if (t < lower || t >= before) continue;
      const span = spans.get(log.projectId);
      if (span) {
        span[0] = Math.min(span[0], t);
        span[1] = Math.max(span[1], t);
      } else {
        spans.set(log.projectId, [t, t]);
      }
    }
    if (spans.size === 0) return;
    await this.dirty().insertMany(
      [...spans].map(([p, [lo, hi]]) => ({ p, from: new Date(floorMinute(lo)), to: new Date(floorMinute(hi) + MINUTE) })),
    );
  }

  /** Before inserting logs: marks those below the watermark. Returns the watermark it saw (null to skip afterInsert). */
  async beforeInsert(logs: { projectId: string; time: Date }[]): Promise<number | null> {
    if (!this.mayBeLate(logs.map((l) => l.time))) return null;
    const w = (await this.watermark())?.getTime() ?? -Infinity;
    await this.markLogs(logs, -Infinity, w);
    return w;
  }

  /** After inserting logs: marks those a refresher moved the watermark past meanwhile. */
  async afterInsert(logs: { projectId: string; time: Date }[], seen: number | null): Promise<void> {
    if (seen === null) return;
    const w = (await this.watermark())?.getTime() ?? -Infinity;
    if (w > seen) await this.markLogs(logs, seen, w);
  }

  /**
   * Before deleting logs of [from, to] (projects or all): marks the part
   * below the watermark (only materialized minutes can go wrong; a purge up to
   * 2100 marks nothing past the watermark, which the refresher would
   * otherwise rebuild forever).
   */
  async beforeDelete(projects: string[] | null, from: Date, to: Date): Promise<number> {
    const w = (await this.watermark())?.getTime() ?? -Infinity;
    await this.markSpan(projects, from.getTime(), Math.min(to.getTime(), w - 1));
    return w;
  }

  /** After the delete: marks the part a refresher moved the watermark past meanwhile. */
  async afterDelete(projects: string[] | null, from: Date, to: Date, seen: number): Promise<void> {
    const w = (await this.watermark())?.getTime() ?? -Infinity;
    if (w > seen) await this.markSpan(projects, Math.max(from.getTime(), seen), Math.min(to.getTime(), w - 1));
  }

  /** Marks the minutes of [lo, hi] (inclusive ms) dirty; nothing when empty. */
  private async markSpan(projects: string[] | null, lo: number, hi: number): Promise<void> {
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi < lo) return;
    const span = { from: new Date(floorMinute(lo)), to: new Date(floorMinute(hi) + MINUTE) };
    const docs = projects === null ? [{ p: null, ...span }] : projects.map((p) => ({ p, ...span }));
    await this.dirty().insertMany(docs);
  }

  // --------------------------------------------------------------------------
  // Readers
  // --------------------------------------------------------------------------

  /** Spans the counts must not answer for: from the watermark on, and every dirty span of the projects. */
  async staleSpans(projects: string[], from: Date, to: Date): Promise<StaleSpan[]> {
    // Both reads start inside async functions so that a failure of either
    // rejects this call instead of leaving the other promise unhandled.
    const [w, dirty] = await Promise.all([
      this.watermark(),
      (async () => this.dirty()
        .find({ from: { $lte: to }, to: { $gt: from }, $or: [{ p: null }, { p: { $in: projects } }] }, this.readOpts())
        .toArray())(),
    ]);
    const spans: StaleSpan[] = dirty.map((d) => [d.from.getTime(), d.to.getTime() - 1]);
    spans.push(w ? [w.getTime(), Infinity] : [-Infinity, Infinity]);
    return spans;
  }

  private match(filter: LogFilterParams, projects: string[], pieces: { from: Date; to: Date }[]): Document {
    const and: Document[] = [{ p: { $in: projects } }, { $or: pieces.map((r) => ({ m: { $gte: r.from, $lt: r.to } })) }];
    const asList = <T>(v: T | T[]) => (Array.isArray(v) ? v : [v]);
    if (filter.level !== undefined) and.push({ l: { $in: asList(filter.level) } });
    if (filter.service !== undefined) and.push({ s: { $in: asList(filter.service) } });
    if (filter.exclude?.level?.length) and.push({ l: { $nin: [...filter.exclude.level] } });
    if (filter.exclude?.service?.length) and.push({ s: { $nin: [...filter.exclude.service] } });
    return { $and: and };
  }

  /** Histogram rows (bucket start ms, level, count) of the counts over whole minutes. */
  async histogramRows(
    filter: LogFilterParams,
    projects: string[],
    pieces: { from: Date; to: Date }[],
    bucketMs: number,
  ): Promise<{ time: Date; level: LogLevel; count: number }[]> {
    const ms = { $toLong: '$m' };
    const rows = await this.stats()
      .aggregate([
        { $match: this.match(filter, projects, pieces) },
        { $group: { _id: { b: { $subtract: [ms, { $mod: [ms, bucketMs] }] }, l: '$l' }, n: { $sum: '$n' } } },
      ], this.readOpts())
      .toArray();
    return rows.map((r) => ({ time: new Date(Number(r._id.b)), level: r._id.l as LogLevel, count: Number(r.n) }));
  }

  async count(filter: LogFilterParams, projects: string[], pieces: { from: Date; to: Date }[]): Promise<number> {
    const rows = await this.stats()
      .aggregate([{ $match: this.match(filter, projects, pieces) }, { $group: { _id: null, n: { $sum: '$n' } } }], this.readOpts())
      .toArray();
    return Number(rows[0]?.n ?? 0);
  }

  // --------------------------------------------------------------------------
  // Refresher
  // --------------------------------------------------------------------------

  /** Rewrites the counts of [from, to) (one project or all) from the logs. */
  private async rebuild(p: string | null, from: Date, to: Date): Promise<void> {
    if (to.getTime() <= from.getTime()) return;
    const scope: Document = { time: { $gte: from, $lt: to }, ...(p !== null ? { project_id: p } : {}) };
    await this.stats().deleteMany({ m: { $gte: from, $lt: to }, ...(p !== null ? { p } : {}) });
    const groups = await this.logs()
      .aggregate(
        [
          { $match: scope },
          {
            $group: {
              _id: { p: '$project_id', m: { $dateTrunc: { date: '$time', unit: 'minute' } }, l: '$level', s: '$service' },
              n: { $sum: 1 },
            },
          },
        ],
        { allowDiskUse: true },
      )
      .toArray();
    if (groups.length === 0) return;
    await this.stats().insertMany(
      groups.map((g) => ({ p: g._id.p, m: g._id.m, l: g._id.l, s: g._id.s, n: g.n })),
      { ordered: false },
    );
  }

  /** The MongoDB server clock: the watermark never trusts a client clock. */
  private async serverNow(): Promise<number> {
    const hello = await this.db.command({ hello: 1 });
    const local = hello.localTime instanceof Date ? hello.localTime.getTime() : Date.now();
    return local;
  }

  /**
   * One refresh run: recompute the dirty spans below the watermark, then move
   * the watermark forward (VOLUME_STEP_MS at a time, within a time budget) up
   * to VOLUME_LAG_MS behind the server clock. Several processes may call it;
   * a lease lock lets one run at a time. `nowOverride` is for tests.
   */
  async refresh(nowOverride?: number): Promise<VolumeRefreshResult> {
    const startedAt = Date.now();
    const owner = randomUUID();
    const now = nowOverride ?? (await this.serverNow());
    await this.state().updateOne({ _id: STATE_ID }, { $setOnInsert: { _id: STATE_ID } }, { upsert: true });
    const locked = await this.state().findOneAndUpdate(
      { _id: STATE_ID, $or: [{ lockUntil: { $exists: false } }, { lockUntil: { $lt: new Date(now) } }] },
      { $set: { lockUntil: new Date(now + LOCK_MS), lockOwner: owner } },
      { returnDocument: 'after' },
    );
    if (!locked) return { ran: false, recomputedSpans: 0, watermark: await this.watermark() };

    let recomputed = 0;
    try {
      let w = locked.watermark?.getTime();
      if (w === undefined) {
        // First run: start at the oldest log (or the target when there is none).
        const oldest = await this.logs().find({}, { projection: { time: 1, _id: 0 } }).sort({ time: 1 }).limit(1).toArray();
        w = oldest[0] ? floorMinute(new Date(oldest[0].time).getTime()) : floorMinute(now - VOLUME_LAG_MS);
        await this.state().updateOne({ _id: STATE_ID, lockOwner: owner }, { $set: { watermark: new Date(w) } });
      }

      // Dirty spans below the watermark, oldest first; a span is removed only
      // after its counts were rewritten, and only the part below the watermark
      // is rebuilt (the watermark move rebuilds the rest).
      const dirty = await this.dirty().find({ from: { $lt: new Date(w) } }).sort({ from: 1 }).limit(500).toArray();
      for (const d of dirty) {
        if (Date.now() - startedAt > RUN_BUDGET_MS) break;
        const end = new Date(Math.min(d.to.getTime(), w));
        await this.rebuild(d.p, d.from, end);
        if (d.to.getTime() <= w) await this.dirty().deleteOne({ _id: d._id });
        recomputed++;
      }

      const target = floorMinute(now - VOLUME_LAG_MS);
      while (w < target && Date.now() - startedAt < RUN_BUDGET_MS) {
        const next = Math.min(target, w + VOLUME_STEP_MS);
        await this.rebuild(null, new Date(w), new Date(next));
        const moved = await this.state().updateOne(
          { _id: STATE_ID, lockOwner: owner, watermark: new Date(w) },
          { $set: { watermark: new Date(next) } },
        );
        if (moved.modifiedCount !== 1) break;
        w = next;
      }
      return { ran: true, recomputedSpans: recomputed, watermark: new Date(w) };
    } finally {
      await this.state().updateOne({ _id: STATE_ID, lockOwner: owner }, { $set: { lockUntil: new Date(0) } });
    }
  }
}
