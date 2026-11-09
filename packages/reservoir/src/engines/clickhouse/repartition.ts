// ============================================================================
// ClickHouse: online move of a MergeTree table to daily partitions
// ============================================================================
// Before 1.6.3 the logs and spans tables were partitioned by month. Retention
// then had to delete rows with ALTER TABLE ... DELETE, a mutation that rewrites
// every part of the month it touches (the whole month, since merged parts mix
// all days), every night. With daily partitions the max retention drops whole
// days (DROP PARTITION, no write at all) and a shorter retention rewrites one
// day only.
//
// The partition key of a table cannot be altered, so the data is copied into a
// new table while the old one keeps serving reads and writes:
//
//   1. copy   every day of the old table goes through a staging table and lands
//             in the new table with REPLACE PARTITION, so a copy interrupted at
//             any point is simply redone (a day replaced twice is the same day)
//   2. swap   EXCHANGE TABLES: writes and reads move to the new table at once
//   3. delta  rows written to the old table after their day was copied (late
//             writes, and inserts in flight during the swap) are added with an
//             anti-join on the row key, which is idempotent as well
//   4. check  the anti-join must now find nothing; then the old table is dropped
//
// One process runs it, under a lock table with a heartbeat (like the traces
// migration). While the lock exists, the engine refuses row deletes on the
// table (retention, project purge), because a row deleted from the old table
// after its day was copied would come back. Those jobs fail and retry on their
// next run.
//
// The copy needs about the size of the table in free disk space; when the disk
// does not have it the move is skipped with a warning and the table keeps its
// monthly partitions (retention still works there, only more expensively).

import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';

export const DAILY_PARTITION_KEY = 'toYYYYMMDD(time)';

export interface RepartitionSpec {
  /** Table to move, e.g. 'logs'. */
  table: string;
  /** CREATE TABLE statement of the target layout for the given name. */
  ddl: (name: string) => string;
  /** Row key of the delta anti-join, e.g. 'id' or '(trace_id, span_id)'. */
  key: string;
}

export interface RepartitionRunner {
  command(query: string, params?: Record<string, unknown>): Promise<void>;
  rows<T>(query: string, params?: Record<string, unknown>): Promise<T[]>;
}

export interface RepartitionOptions {
  heartbeatMs?: number;
  staleMs?: number;
  /** Wait after the swap so inserts buffered for the old table are flushed before the delta. */
  settleMs?: number;
  /** Free space needed, as a multiple of the old table size on disk. */
  freeSpaceFactor?: number;
  log?: (message: string) => void;
  /** Test seam: runs after the copy, before the swap, while the lock is held. */
  afterCopy?: () => Promise<void>;
}

const DEFAULTS = { heartbeatMs: 5_000, staleMs: 60_000, settleMs: 30_000, freeSpaceFactor: 1.2 };

export const lockTable = (table: string) => `${table}_repartition_lock`;
export const newTable = (table: string) => `${table}_repartition_new`;
const stageTable = (table: string) => `${table}_repartition_stage`;
const doneTable = (table: string) => `${table}_repartition_done`;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function partitionKey(run: RepartitionRunner, table: string): Promise<string | null> {
  const rows = await run.rows<{ partition_key: string }>(
    'SELECT partition_key FROM system.tables WHERE database = currentDatabase() AND name = {name:String}',
    { name: table },
  );
  return rows[0]?.partition_key ?? null;
}

export function isDaily(key: string | null): boolean {
  return key !== null && key.replace(/\s/g, '') === DAILY_PARTITION_KEY;
}

/** True while a move of this table is running or was interrupted (deletes must wait). */
export async function repartitionPending(run: RepartitionRunner, table: string): Promise<boolean> {
  const rows = await run.rows<{ n: string | number }>(
    'SELECT count() AS n FROM system.tables WHERE database = currentDatabase() AND name = {name:String}',
    { name: lockTable(table) },
  );
  return Number(rows[0]?.n ?? 0) > 0;
}

/** Physical columns shared by both tables, in the old table's order (MATERIALIZED/ALIAS are recomputed). */
async function copyColumns(run: RepartitionRunner, from: string, to: string): Promise<string> {
  const rows = await run.rows<{ name: string }>(
    `SELECT name FROM system.columns
     WHERE database = currentDatabase() AND table = {from:String} AND default_kind NOT IN ('MATERIALIZED', 'ALIAS')
       AND name IN (SELECT name FROM system.columns WHERE database = currentDatabase() AND table = {to:String}
                    AND default_kind NOT IN ('MATERIALIZED', 'ALIAS'))
     ORDER BY position`,
    { from, to },
  );
  return rows.map((r) => `\`${r.name}\``).join(', ');
}

async function days(run: RepartitionRunner, table: string): Promise<number[]> {
  const rows = await run.rows<{ d: string | number }>(
    `SELECT DISTINCT toYYYYMMDD(time) AS d FROM ${table} ORDER BY d`,
  );
  return rows.map((r) => Number(r.d));
}

async function tryAcquire(run: RepartitionRunner, table: string): Promise<boolean> {
  try {
    await run.command(`CREATE TABLE ${lockTable(table)} (owner String, beat_at DateTime64(3)) ENGINE = MergeTree ORDER BY beat_at`);
    return true;
  } catch (err) {
    if (/already exists/i.test(String((err as Error)?.message ?? err))) return false;
    throw err;
  }
}

/** Age in ms of the newest heartbeat; a lock without beats ages from its creation. */
async function lockAgeMs(run: RepartitionRunner, table: string): Promise<number> {
  const beats = await run.rows<{ age_ms: string | number }>(
    `SELECT dateDiff('millisecond', max(beat_at), now64(3)) AS age_ms FROM ${lockTable(table)} HAVING count() > 0`,
  );
  if (beats[0]) return Number(beats[0].age_ms);
  const created = await run.rows<{ age_ms: string | number }>(
    `SELECT dateDiff('millisecond', metadata_modification_time, now()) AS age_ms
     FROM system.tables WHERE database = currentDatabase() AND name = {name:String}`,
    { name: lockTable(table) },
  );
  return Number(created[0]?.age_ms ?? 0);
}

async function enoughSpace(run: RepartitionRunner, table: string, factor: number, log: (m: string) => void): Promise<boolean> {
  const [size] = await run.rows<{ b: string | number }>(
    `SELECT sum(bytes_on_disk) AS b FROM system.parts WHERE database = currentDatabase() AND table = {name:String} AND active`,
    { name: table },
  );
  const [disk] = await run.rows<{ free: string | number }>(
    `SELECT min(free_space) AS free FROM system.disks WHERE name IN (
       SELECT DISTINCT disk_name FROM system.parts WHERE database = currentDatabase() AND table = {name:String} AND active)`,
    { name: table },
  );
  const need = Number(size?.b ?? 0) * factor;
  const free = Number(disk?.free ?? 0);
  if (free >= need) return true;
  const gib = (n: number) => (n / 2 ** 30).toFixed(1);
  log(
    `[ClickHouse] Not moving ${table} to daily partitions: it needs about ${gib(need)} GiB free, the disk has ${gib(free)} GiB. ` +
    `Retention keeps working on the monthly partitions, at a higher disk cost. Free some space and restart to retry.`,
  );
  return false;
}

/**
 * Moves the table to daily partitions if it is not there yet. Safe to call from
 * several processes: one runs the move, the others return at once. Returns
 * true when the table ends up daily-partitioned.
 */
export async function ensureDailyPartitions(
  run: RepartitionRunner,
  spec: RepartitionSpec,
  options: RepartitionOptions = {},
): Promise<boolean> {
  const o = { ...DEFAULTS, ...options };
  const log = options.log ?? ((m: string) => console.warn(m));
  const { table } = spec;

  const current = await partitionKey(run, table);
  if (current === null) return false; // created later by the engine
  const pending = await repartitionPending(run, table);
  if (isDaily(current) && !pending && (await partitionKey(run, newTable(table))) === null) return true;

  const [db] = await run.rows<{ engine: string }>('SELECT engine FROM system.databases WHERE name = currentDatabase()');
  if (!pending && db?.engine !== 'Atomic' && db?.engine !== 'Replicated') {
    log(`[ClickHouse] Not moving ${table} to daily partitions: the ${db?.engine ?? 'unknown'} database engine cannot EXCHANGE TABLES.`);
    return false;
  }

  if (pending) {
    // Someone else is moving it, or a holder died: take over only a stale lock.
    if ((await lockAgeMs(run, table)) <= o.staleMs) return false;
    await run.command(`DROP TABLE IF EXISTS ${lockTable(table)}`);
  }
  if (!(await tryAcquire(run, table))) return false;

  const owner = `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`.replace(/[^A-Za-z0-9._:-]/g, '_');
  const beat = () => run.command(`INSERT INTO ${lockTable(table)} (owner, beat_at) SELECT {owner:String}, now64(3)`, { owner });
  const timer = setInterval(() => { beat().catch(() => undefined); }, o.heartbeatMs);
  let finished = false;

  try {
    await beat();

    // Phase 1: copy (skipped when a previous run already swapped).
    if (!isDaily(await partitionKey(run, table))) {
      if ((await partitionKey(run, newTable(table))) === null) {
        if (!(await enoughSpace(run, table, o.freeSpaceFactor, log))) {
          finished = true; // nothing started: release the lock so deletes run
          return false;
        }
        await run.command(spec.ddl(newTable(table)));
      }
      await run.command(`CREATE TABLE IF NOT EXISTS ${doneTable(table)} (day UInt32) ENGINE = MergeTree ORDER BY day`);
      const done = new Set(
        (await run.rows<{ day: string | number }>(`SELECT day FROM ${doneTable(table)}`)).map((r) => Number(r.day)),
      );
      const cols = await copyColumns(run, table, newTable(table));
      const todo = (await days(run, table)).filter((d) => !done.has(d));
      log(`[ClickHouse] Moving ${table} to daily partitions (one-time, 1.6.3): ${todo.length} day(s) to copy`);

      for (const [i, day] of todo.entries()) {
        await run.command(`DROP TABLE IF EXISTS ${stageTable(table)}`);
        await run.command(spec.ddl(stageTable(table)));
        await run.command(
          `INSERT INTO ${stageTable(table)} (${cols}) SELECT ${cols} FROM ${table} WHERE toYYYYMMDD(time) = {day:UInt32}`,
          { day },
        );
        await run.command(`ALTER TABLE ${newTable(table)} REPLACE PARTITION ID '${day}' FROM ${stageTable(table)}`);
        await run.command(`INSERT INTO ${doneTable(table)} (day) VALUES ({day:UInt32})`, { day });
        if ((i + 1) % 10 === 0) log(`[ClickHouse] ${table}: ${i + 1}/${todo.length} days copied`);
      }
      await run.command(`DROP TABLE IF EXISTS ${stageTable(table)}`);
      if (options.afterCopy) await options.afterCopy();

      // Phase 2: swap.
      await run.command(`EXCHANGE TABLES ${table} AND ${newTable(table)}`);
      log(`[ClickHouse] ${table} now uses daily partitions; adding the rows written during the copy`);
      await sleep(o.settleMs);
    }

    // Phase 3: delta. newTable(table) now holds the old data.
    const old = newTable(table);
    const cols = await copyColumns(run, old, table);
    const missing = `FROM ${old} WHERE toYYYYMMDD(time) = {day:UInt32}
      AND ${spec.key} NOT IN (SELECT ${spec.key} FROM ${table} WHERE toYYYYMMDD(time) = {day:UInt32})`;
    const oldDays = await days(run, old);
    for (const day of oldDays) {
      await run.command(`INSERT INTO ${table} (${cols}) SELECT ${cols} ${missing}`, { day });
    }

    // Phase 4: check, then drop the old table.
    for (const day of oldDays) {
      const [left] = await run.rows<{ n: string | number }>(`SELECT count() AS n ${missing}`, { day });
      if (Number(left?.n ?? 0) > 0) {
        throw new Error(
          `[ClickHouse] Moving ${table} to daily partitions: ${left.n} row(s) of day ${day} are still missing after the delta. ` +
          `Nothing was dropped; restart to retry.`,
        );
      }
    }
    await run.command(`DROP TABLE IF EXISTS ${old}`);
    await run.command(`DROP TABLE IF EXISTS ${doneTable(table)}`);
    finished = true;
    log(`[ClickHouse] ${table} moved to daily partitions`);
    return true;
  } finally {
    clearInterval(timer);
    // A failed move keeps its lock: deletes stay blocked until a restart resumes it.
    if (finished) await run.command(`DROP TABLE IF EXISTS ${lockTable(table)}`).catch(() => undefined);
  }
}
