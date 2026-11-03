// ============================================================================
// MongoDB log volume pre-aggregate
// ============================================================================
// MongoDB has no incremental aggregate, and on the time-series logs
// collection a histogram or count unpacks every log of the range (about 2 s
// for 5 million logs). This keeps the equivalent of a TimescaleDB continuous
// aggregate by hand, with the same exactness rules. For a logs collection
// named <t>:
//
// - <t>_volume_minutes: log count per minute, project, level and service;
// - <t>_volume_state: the watermark (every minute before it is materialized)
//   and a lease lock for the refresher;
// - <t>_volume_dirty: minute spans whose counts may be wrong; reads take them
//   from the logs until the refresher rewrites their counts.
//
// Writers (late inserts below the watermark, deletes) mark their span dirty
// as `pending` BEFORE writing and release it AFTER writing; the refresher
// never rebuilds or clears a pending span (unless its writer is presumed
// dead), so a span is only cleared after the write it covers has landed and
// been counted. After the write, writers also mark the part of their write a
// refresher moved the watermark past meanwhile.
//
// Rebuilds are idempotent and safe to overlap: every count row carries the
// server time of the logs snapshot it was computed from, a rebuild only
// overwrites rows from older snapshots and only deletes rows of older
// snapshots that its own snapshot no longer has, so two refreshers (a lease
// expired under a slow one) can neither double nor drop counts.
//
// The one gap left: a refresher moving the watermark over minutes that an
// insert of logs older than VOLUME_FRESH_MS writes concurrently, between its
// snapshot and the insert's after-check (the after-check then marks them).
// Batches of newer logs (real time) skip all of this and cannot fall below
// the watermark.

import type { Collection, Db, Document, ObjectId } from 'mongodb';
import { randomUUID } from 'node:crypto';
import type { StaleSpan } from '../../core/log-volume.js';
import type { LogFilterParams, LogLevel } from '../../core/types.js';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
/** The watermark stays this far behind the MongoDB server clock. */
export const VOLUME_LAG_MS = 5 * MINUTE;
/**
 * Writers skip the watermark checks for batches whose logs are all newer than
 * this. Safe while the writer's clock is at most VOLUME_LAG_MS minus this (3
 * minutes) behind the MongoDB server: such logs are always above the watermark.
 */
export const VOLUME_FRESH_MS = 2 * MINUTE;
/** One rebuild covers at most this much time, so a lease renewal comes often. */
export const VOLUME_PIECE_MS = HOUR;
/** A refresher that did not renew its lease for this long is presumed dead. */
const LOCK_MS = 5 * MINUTE;
/** A pending mark older than this belongs to a writer presumed dead. */
const PENDING_TIMEOUT_MS = HOUR;
/** Time budget of one refresh run. */
const RUN_BUDGET_MS = 20_000;
/** Count rows written per bulk write. */
const WRITE_BATCH = 2_000;

const STATE_ID = 'state';

interface StateDoc {
  _id: string;
  watermark?: Date;
  lockUntil?: Date;
  lockOwner?: string;
}

interface DirtyDoc {
  _id?: ObjectId;
  /** Project, or null for every project. */
  p: string | null;
  /** Half-open, minute aligned. */
  from: Date;
  to: Date;
  /** Set while the write it covers is in flight. */
  pending: boolean;
  at: Date;
}

/** Marks a writer placed before its write, to release after it. */
export interface WriteToken {
  watermark: number;
  marks: ObjectId[];
}

const floorMinute = (ms: number) => Math.floor(ms / MINUTE) * MINUTE;
const timeOf = (t: Date | string | number): number => new Date(t).getTime();

export interface VolumeRefreshResult {
  ran: boolean;
  recomputedSpans: number;
  watermark: Date | null;
}

export class MongoLogVolume {
  constructor(
    private readonly db: Db,
    private readonly logs: () => Collection,
    /** Name of the logs collection; the volume collections are named after it. */
    private readonly table: string,
    /** Options of the read queries ($comment of the request context, analytics maxTimeMS). */
    private readonly readOpts: () => Document = () => ({}),
  ) {}

  private stats(): Collection {
    return this.db.collection(`${this.table}_volume_minutes`);
  }

  private state(): Collection<StateDoc> {
    return this.db.collection<StateDoc>(`${this.table}_volume_state`);
  }

  private dirty(): Collection<DirtyDoc> {
    return this.db.collection<DirtyDoc>(`${this.table}_volume_dirty`);
  }

  async ensureIndexes(): Promise<void> {
    await this.stats().createIndex({ p: 1, m: 1, l: 1, s: 1 }, { name: 'idx_volume_key', unique: true });
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
  private mayBeLate(times: (Date | string)[], now = Date.now()): boolean {
    return times.some((t) => timeOf(t) < now - VOLUME_FRESH_MS);
  }

  /** Marks, per project, the minutes of the logs with lower <= time < before; returns the mark ids. */
  private async markLogs(
    logs: { projectId: string; time: Date | string }[],
    lower: number,
    before: number,
    pending: boolean,
  ): Promise<ObjectId[]> {
    const spans = new Map<string, [number, number]>();
    for (const log of logs) {
      const t = timeOf(log.time);
      if (!Number.isFinite(t) || t < lower || t >= before) continue;
      const span = spans.get(log.projectId);
      if (span) {
        span[0] = Math.min(span[0], t);
        span[1] = Math.max(span[1], t);
      } else {
        spans.set(log.projectId, [t, t]);
      }
    }
    if (spans.size === 0) return [];
    const at = new Date();
    const result = await this.dirty().insertMany(
      [...spans].map(([p, [lo, hi]]) => ({ p, from: new Date(floorMinute(lo)), to: new Date(floorMinute(hi) + MINUTE), pending, at })),
    );
    return Object.values(result.insertedIds);
  }

  /** Marks the minutes of [lo, hi] (inclusive ms) for the projects (or all); nothing when empty. */
  private async markSpan(projects: string[] | null, lo: number, hi: number, pending: boolean): Promise<ObjectId[]> {
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi < lo) return [];
    const span = { from: new Date(floorMinute(lo)), to: new Date(floorMinute(hi) + MINUTE), pending, at: new Date() };
    const docs = projects === null ? [{ p: null, ...span }] : projects.map((p) => ({ p, ...span }));
    const result = await this.dirty().insertMany(docs);
    return Object.values(result.insertedIds);
  }

  private async release(marks: ObjectId[]): Promise<void> {
    if (marks.length > 0) await this.dirty().updateMany({ _id: { $in: marks } }, { $set: { pending: false } });
  }

  /** Before inserting logs: pending marks for those below the watermark. Null when the batch is real time. */
  async beforeInsert(logs: { projectId: string; time: Date | string }[]): Promise<WriteToken | null> {
    if (!this.mayBeLate(logs.map((l) => l.time))) return null;
    const watermark = (await this.watermark())?.getTime() ?? -Infinity;
    return { watermark, marks: await this.markLogs(logs, -Infinity, watermark, true) };
  }

  /** After inserting logs (also after a partial failure): marks what the watermark passed meanwhile, then releases. */
  async afterInsert(logs: { projectId: string; time: Date | string }[], token: WriteToken | null): Promise<void> {
    if (token === null) return;
    const w = (await this.watermark())?.getTime() ?? -Infinity;
    if (w > token.watermark) await this.markLogs(logs, token.watermark, w, false);
    await this.release(token.marks);
  }

  /**
   * Before deleting logs of [from, to] (projects or all): a pending mark for
   * the part below the watermark (only materialized minutes can go wrong; a
   * purge up to 2100 marks nothing past it).
   */
  async beforeDelete(projects: string[] | null, from: Date, to: Date): Promise<WriteToken> {
    const watermark = (await this.watermark())?.getTime() ?? -Infinity;
    return { watermark, marks: await this.markSpan(projects, from.getTime(), Math.min(to.getTime(), watermark - 1), true) };
  }

  /** After the delete: marks the part a refresher moved the watermark past meanwhile, then releases. */
  async afterDelete(projects: string[] | null, from: Date, to: Date, token: WriteToken): Promise<void> {
    const w = (await this.watermark())?.getTime() ?? -Infinity;
    if (w > token.watermark) {
      await this.markSpan(projects, Math.max(from.getTime(), token.watermark), Math.min(to.getTime(), w - 1), false);
    }
    await this.release(token.marks);
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

  /** The MongoDB server clock: snapshots and the watermark never trust a client clock. */
  private async serverNow(): Promise<number> {
    const hello = await this.db.command({ hello: 1 });
    return hello.localTime instanceof Date ? hello.localTime.getTime() : Date.now();
  }

  /**
   * Rewrites the counts of [from, to) (one project or all) from the logs, at
   * most VOLUME_PIECE_MS long. Rows of newer snapshots are left alone, rows of
   * older snapshots the logs no longer have are deleted: overlapping rebuilds
   * converge on the newest snapshot.
   */
  private async rebuild(p: string | null, from: Date, to: Date): Promise<void> {
    if (to.getTime() <= from.getTime()) return;
    const snapshot = await this.serverNow();
    const scope: Document = { time: { $gte: from, $lt: to }, ...(p !== null ? { project_id: p } : {}) };
    const cursor = this.logs().aggregate(
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
    );
    let batch: Document[] = [];
    const flush = async () => {
      if (batch.length === 0) return;
      const ops = batch;
      batch = [];
      await this.stats().bulkWrite(ops as never[], { ordered: false });
    };
    for await (const g of cursor) {
      const key = { p: g._id.p, m: g._id.m, l: g._id.l, s: g._id.s ?? null };
      batch.push({
        updateOne: {
          filter: key,
          update: [
            {
              $set: {
                n: { $cond: [{ $gte: [snapshot, { $ifNull: ['$at', 0] }] }, { $literal: g.n }, '$n'] },
                at: { $max: [{ $ifNull: ['$at', 0] }, snapshot] },
              },
            },
          ],
          upsert: true,
        },
      });
      if (batch.length >= WRITE_BATCH) await flush();
    }
    await flush();
    await this.stats().deleteMany({ m: { $gte: from, $lt: to }, at: { $lt: snapshot }, ...(p !== null ? { p } : {}) });
  }

  /** Renews the lease; false when another refresher took it (this one then stops). */
  private async renew(owner: string): Promise<boolean> {
    const until = new Date((await this.serverNow()) + LOCK_MS);
    const result = await this.state().updateOne({ _id: STATE_ID, lockOwner: owner }, { $set: { lockUntil: until } });
    return result.matchedCount === 1;
  }

  /**
   * The minutes of [from, to) holding logs or counts (one project or all), or
   * null when neither has any: a purge marks everything since 1970, and only
   * the stretch with data needs rebuilding.
   */
  private async dataExtent(p: string | null, from: number, to: number): Promise<[number, number] | null> {
    const range = { $gte: new Date(from), $lt: new Date(to) };
    const logScope = { time: range, ...(p !== null ? { project_id: p } : {}) };
    const statScope = { m: range, ...(p !== null ? { p } : {}) };
    const [firstLog, lastLog, firstStat, lastStat] = await Promise.all([
      this.logs().find(logScope, { projection: { time: 1, _id: 0 } }).sort({ time: 1 }).limit(1).next(),
      this.logs().find(logScope, { projection: { time: 1, _id: 0 } }).sort({ time: -1 }).limit(1).next(),
      this.stats().find(statScope, { projection: { m: 1, _id: 0 } }).sort({ m: 1 }).limit(1).next(),
      this.stats().find(statScope, { projection: { m: 1, _id: 0 } }).sort({ m: -1 }).limit(1).next(),
    ]);
    const starts = [firstLog?.time, firstStat?.m].filter((v) => v != null).map((v) => floorMinute(timeOf(v)));
    const ends = [lastLog?.time, lastStat?.m].filter((v) => v != null).map((v) => floorMinute(timeOf(v)) + MINUTE);
    if (starts.length === 0) return null;
    return [Math.max(from, Math.min(...starts)), Math.min(to, Math.max(...ends))];
  }

  /**
   * Rebuilds [from, to) piece by piece, renewing the lease before each: true
   * when done, false when the lease was lost, else where it stopped (out of time).
   */
  private async rebuildRange(owner: string, p: string | null, from: number, to: number, deadline: number): Promise<boolean | number> {
    const extent = await this.dataExtent(p, from, to);
    if (extent === null) return true;
    let at = extent[0];
    to = extent[1];
    while (at < to) {
      if (Date.now() > deadline) return at;
      if (!(await this.renew(owner))) return false;
      const next = Math.min(to, at + VOLUME_PIECE_MS);
      await this.rebuild(p, new Date(at), new Date(next));
      at = next;
    }
    return true;
  }

  /**
   * One refresh run: rewrite the dirty spans below the watermark (merged per
   * project), then move the watermark forward up to VOLUME_LAG_MS behind the
   * server clock, within a time budget. Several processes may call it; a
   * lease lock lets one run at a time. `nowOverride` replaces the server clock
   * for the watermark target (tests).
   */
  async refresh(nowOverride?: number): Promise<VolumeRefreshResult> {
    const deadline = Date.now() + RUN_BUDGET_MS;
    const owner = randomUUID();
    const serverNow = await this.serverNow();
    const now = nowOverride ?? serverNow;
    await this.state().updateOne({ _id: STATE_ID }, { $setOnInsert: { _id: STATE_ID } }, { upsert: true });
    const locked = await this.state().findOneAndUpdate(
      { _id: STATE_ID, $or: [{ lockUntil: { $exists: false } }, { lockUntil: { $lt: new Date(serverNow) } }] },
      { $set: { lockUntil: new Date(serverNow + LOCK_MS), lockOwner: owner } },
      { returnDocument: 'after' },
    );
    if (!locked) return { ran: false, recomputedSpans: 0, watermark: await this.watermark() };

    let recomputed = 0;
    try {
      let w = locked.watermark?.getTime();
      if (w === undefined) {
        // First run: start at the oldest log (or the target when there is none).
        const oldest = await this.logs().find({}, { projection: { time: 1, _id: 0 } }).sort({ time: 1 }).limit(1).toArray();
        w = oldest[0] ? floorMinute(timeOf(oldest[0].time)) : floorMinute(now - VOLUME_LAG_MS);
        await this.state().updateOne({ _id: STATE_ID, lockOwner: owner }, { $set: { watermark: new Date(w) } });
      }
      const wm = w;

      // Released (or abandoned) dirty spans below the watermark, merged per
      // project; pending ones belong to writes still in flight.
      const dirty = await this.dirty()
        .find({
          from: { $lt: new Date(wm) },
          $or: [{ pending: false }, { pending: { $exists: false } }, { at: { $lt: new Date(Date.now() - PENDING_TIMEOUT_MS) } }],
        })
        .sort({ from: 1 })
        .limit(5_000)
        .toArray();
      const byProject = new Map<string | null, DirtyDoc[]>();
      for (const d of dirty) byProject.set(d.p, [...(byProject.get(d.p) ?? []), d]);
      for (const [p, docs] of byProject) {
        // Merge overlapping or touching spans, clipped to the watermark.
        const merged: { from: number; to: number; docs: DirtyDoc[] }[] = [];
        for (const d of docs) {
          const from = d.from.getTime();
          const to = Math.min(d.to.getTime(), wm);
          const last = merged[merged.length - 1];
          if (last && from <= last.to) {
            last.to = Math.max(last.to, to);
            last.docs.push(d);
          } else {
            merged.push({ from, to, docs: [d] });
          }
        }
        for (const span of merged) {
          const reached = await this.rebuildRange(owner, p, span.from, span.to, deadline);
          if (reached === false) return { ran: true, recomputedSpans: recomputed, watermark: new Date(wm) };
          if (typeof reached === 'number') {
            // Out of time: what was rebuilt is fine, the rest stays dirty.
            await this.dirty().updateMany({ _id: { $in: span.docs.map((d) => d._id!) } }, { $max: { from: new Date(reached) } });
            return { ran: true, recomputedSpans: recomputed, watermark: new Date(wm) };
          }
          const done = span.docs.filter((d) => d.to.getTime() <= wm).map((d) => d._id!);
          const rest = span.docs.filter((d) => d.to.getTime() > wm).map((d) => d._id!);
          if (done.length > 0) await this.dirty().deleteMany({ _id: { $in: done } });
          if (rest.length > 0) await this.dirty().updateMany({ _id: { $in: rest } }, { $set: { from: new Date(wm) } });
          recomputed++;
        }
      }

      const target = floorMinute(now - VOLUME_LAG_MS);
      while (w < target && Date.now() < deadline) {
        if (!(await this.renew(owner))) break;
        const next = Math.min(target, w + VOLUME_PIECE_MS);
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
