/**
 * Log volume (explorer histogram and count) from the per-minute continuous
 * aggregate `logs_minute_stats` on TimescaleDB (migration 075).
 *
 * Scanning the logs of a big project costs seconds (6 s for the histogram and
 * 2 s for the count of 5 million logs); the aggregate holds one row per
 * minute, project, level and service. A read is split in three:
 *
 * - whole minutes inside the aggregate's trusted window come from the
 *   aggregate: the refresh policy refreshes the last 30 days every minute and
 *   re-materializes only changed ranges;
 * - minutes TimescaleDB still lists as invalidated (logs written or deleted
 *   inside materialized minutes since the last refresh: late logs, backfills,
 *   retention deletes, and everything after the materialization watermark)
 *   come from the logs table, so the result never lags behind it;
 * - the partial minutes at both edges, the newest minutes and anything older
 *   than the window come from the logs table through the reservoir, exactly
 *   as before.
 *
 * Only filters the aggregate can answer use it: projects, time range, level
 * and service (included or excluded). Text search, metadata, hostname, trace,
 * session and span filters keep the logs table path. Results are identical
 * to the logs table path; only the cost changes.
 */
import { sql } from 'kysely';
import type { Kysely } from 'kysely';
import { isVolumeOnlyFilter, splitByStaleMinutes, zeroFillHistogram, type LogHistogramResult, type LogFilterParams, type LogLevel, type StaleSpan } from '@logtide/reservoir';

const MINUTE_MS = 60_000;

/** The refresh policy covers 30 days; stay a day inside it. */
export const AGGREGATE_WINDOW_MS = 29 * 24 * 60 * 60 * 1000;
/** Minutes newer than this are read from the logs table (the policy runs every minute). */
export const AGGREGATE_TAIL_MS = 5 * MINUTE_MS;

export interface RawRange {
  from: Date;
  to: Date;
  fromExclusive?: boolean;
  toExclusive?: boolean;
}

export interface VolumeSplit {
  /** Half-open, minute-aligned ranges read from the aggregate (empty when none). */
  aggregate: { from: Date; to: Date }[];
  /** Ranges read from the logs table, covering the rest of the request exactly. */
  raw: RawRange[];
}

export type { StaleSpan };

const toArray = <T>(v: T | T[] | undefined): T[] | undefined => (v === undefined ? undefined : Array.isArray(v) ? v : [v]);

/**
 * Whether the aggregate can answer this filter: a volume-only filter (see
 * isVolumeOnlyFilter) over explicit projects; the aggregate rows are per
 * project, so the global scope stays on the logs table.
 */
export function aggregateCanAnswer(filter: LogFilterParams): boolean {
  if (typeof filter.projectId !== 'string' && !Array.isArray(filter.projectId)) return false;
  return isVolumeOnlyFilter(filter);
}

/**
 * Splits [from, to] (bounds as flagged) into the minutes the aggregate
 * answers and the raw ranges around and between them: whole minutes inside
 * the trusted window (older than AGGREGATE_TAIL_MS, newer than
 * AGGREGATE_WINDOW_MS), minus every minute touched by a stale span.
 */
export function splitVolumeRange(range: RawRange, now: Date, stale: StaleSpan[] = []): VolumeSplit {
  const windowStart = Math.ceil((now.getTime() - AGGREGATE_WINDOW_MS) / MINUTE_MS) * MINUTE_MS;
  const tailStart = Math.floor((now.getTime() - AGGREGATE_TAIL_MS) / MINUTE_MS) * MINUTE_MS;
  return splitByStaleMinutes(range, [...stale, [-Infinity, windowStart - 1], [tailStart, Infinity]]);
}

/**
 * Spans TimescaleDB lists as invalid for logs_minute_stats over [from, to]:
 * changes to the logs hypertable not yet moved to the aggregates, and the
 * aggregate's own pending invalidations (which also cover everything after
 * its materialization watermark and before its first refresh). Values are
 * Unix microseconds, inclusive. Null when the catalog cannot be read: the
 * caller then uses the logs table only.
 */
export async function staleSpans(db: Db, from: Date, to: Date): Promise<StaleSpan[] | null> {
  const lo = BigInt(from.getTime()) * 1000n;
  const hi = BigInt(to.getTime()) * 1000n + 999n;
  try {
    const result = await sql<{ lo: string; hi: string }>`
      SELECT l.lowest_modified_value::text AS lo, l.greatest_modified_value::text AS hi
      FROM _timescaledb_catalog.continuous_aggs_hypertable_invalidation_log l
      JOIN _timescaledb_catalog.continuous_agg ca ON ca.raw_hypertable_id = l.hypertable_id
      WHERE ca.user_view_name = 'logs_minute_stats' AND ca.user_view_schema = current_schema()
        AND l.lowest_modified_value <= ${hi.toString()}::bigint AND l.greatest_modified_value >= ${lo.toString()}::bigint
      UNION ALL
      SELECT m.lowest_modified_value::text, m.greatest_modified_value::text
      FROM _timescaledb_catalog.continuous_aggs_materialization_invalidation_log m
      JOIN _timescaledb_catalog.continuous_agg ca ON ca.mat_hypertable_id = m.materialization_id
      WHERE ca.user_view_name = 'logs_minute_stats' AND ca.user_view_schema = current_schema()
        AND m.lowest_modified_value <= ${hi.toString()}::bigint AND m.greatest_modified_value >= ${lo.toString()}::bigint`.execute(db);
    const clamp = (us: bigint): number => Number((us < lo ? lo : us > hi ? hi : us) / 1000n);
    return result.rows.map((r) => [clamp(BigInt(r.lo)), clamp(BigInt(r.hi))] as StaleSpan);
  } catch {
    return null;
  }
}

function aggregateConditions(filter: LogFilterParams, pieces: { from: Date; to: Date }[]) {
  const projects = toArray(filter.projectId as string | string[])!;
  const levels = toArray(filter.level);
  const services = toArray(filter.service);
  const ranges = sql.join(pieces.map((p) => sql`(bucket >= ${p.from} AND bucket < ${p.to})`), sql` OR `);
  const conditions = [sql`project_id = ANY(${projects}::uuid[])`, sql`(${ranges})`];
  if (levels) conditions.push(sql`level = ANY(${levels}::text[])`);
  if (services) conditions.push(sql`service = ANY(${services}::text[])`);
  if (filter.exclude?.level && filter.exclude.level.length > 0) conditions.push(sql`level <> ALL(${[...filter.exclude.level]}::text[])`);
  if (filter.exclude?.service && filter.exclude.service.length > 0) conditions.push(sql`service <> ALL(${[...filter.exclude.service]}::text[])`);
  return sql.join(conditions, sql` AND `);
}

type Db = Kysely<any>;

/** Per-bucket, per-level counts of the aggregate over whole minutes. */
async function aggregateHistogramRows(db: Db, filter: LogFilterParams, pieces: { from: Date; to: Date }[], bucketSeconds: number) {
  const result = await sql<{ bucket_s: string; level: LogLevel; n: string }>`
    SELECT (floor(extract(epoch FROM bucket) / ${bucketSeconds}) * ${bucketSeconds})::bigint AS bucket_s,
           level, SUM(log_count)::bigint AS n
    FROM logs_minute_stats
    WHERE ${aggregateConditions(filter, pieces)}
    GROUP BY 1, 2`.execute(db);
  return result.rows.map((r) => ({ time: new Date(Number(r.bucket_s) * 1000), level: r.level, count: Number(r.n) }));
}

export interface VolumeReader {
  histogram(params: LogFilterParams & { bucketSeconds: number }): Promise<LogHistogramResult>;
  count(params: LogFilterParams): Promise<{ count: number }>;
}

/**
 * The histogram of `filter`, reading whole minutes from the aggregate. The
 * caller checks aggregateCanAnswer and that bucketSeconds is a multiple of 60.
 */
export async function histogramFromAggregate(
  db: Db,
  raw: VolumeReader,
  filter: LogFilterParams,
  bucketSeconds: number,
  now = new Date(),
): Promise<LogHistogramResult> {
  const stale = await staleSpans(db, filter.from, filter.to);
  if (stale === null) return raw.histogram({ ...filter, bucketSeconds });
  const split = splitVolumeRange(filter, now, stale);
  if (split.aggregate.length === 0) return raw.histogram({ ...filter, bucketSeconds });
  const [fromAggregate, ...rawParts] = await Promise.all([
    aggregateHistogramRows(db, filter, split.aggregate, bucketSeconds),
    ...split.raw.map((r) => raw.histogram({ ...filter, ...r, bucketSeconds })),
  ]);
  const rows = [...fromAggregate];
  for (const part of rawParts as LogHistogramResult[]) {
    for (const bucket of part.buckets) {
      for (const [level, count] of Object.entries(bucket.byLevel)) {
        if (count) rows.push({ time: bucket.time, level: level as LogLevel, count });
      }
    }
  }
  return zeroFillHistogram({ from: filter.from, to: filter.to, toExclusive: filter.toExclusive, bucketSeconds }, rows);
}

/** The count of `filter`, reading whole minutes from the aggregate. The caller checks aggregateCanAnswer. */
export async function countFromAggregate(db: Db, raw: VolumeReader, filter: LogFilterParams, now = new Date()): Promise<number> {
  const stale = await staleSpans(db, filter.from, filter.to);
  if (stale === null) return (await raw.count(filter)).count;
  const split = splitVolumeRange(filter, now, stale);
  if (split.aggregate.length === 0) return (await raw.count(filter)).count;
  const [total, ...rawParts] = await Promise.all([
    sql<{ n: string | null }>`SELECT SUM(log_count)::bigint AS n FROM logs_minute_stats WHERE ${aggregateConditions(filter, split.aggregate)}`
      .execute(db)
      .then((r) => Number(r.rows[0]?.n ?? 0)),
    ...split.raw.map((r) => raw.count({ ...filter, ...r }).then((c) => c.count)),
  ]);
  return rawParts.reduce((sum, n) => sum + n, total);
}
