// ============================================================================
// ClickHouse traces table: AggregatingMergeTree and its one-time migration
// ============================================================================
// Each ingest request inserts one partial summary row per trace it carried
// (issue #309). The engine merges rows of the same (project_id, trace_id) with
// the column aggregate functions, and every read goes through FINAL, so a
// summary never depends on the spans table or on the order spans and
// summaries land in. duration_ms is derived from the merged window.
//
// Installs created before 1.6.1 have a ReplacingMergeTree traces table. The
// migration copies it (FINAL) into the new layout under an exclusive lock, so
// several backend or worker processes starting together copy it exactly once.
// The old table is kept as traces_backup_<timestamp>.

import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';

export const TRACES_ENGINE = 'AggregatingMergeTree';

export function tracesTableDdl(name: string, ifNotExists: boolean, extraSettings = ''): string {
  return `
    CREATE TABLE ${ifNotExists ? 'IF NOT EXISTS ' : ''}${name} (
      trace_id String NOT NULL,
      organization_id SimpleAggregateFunction(anyLast, Nullable(String)),
      project_id String NOT NULL,
      service_name SimpleAggregateFunction(any, LowCardinality(String)),
      root_service_name SimpleAggregateFunction(anyLast, Nullable(String)),
      root_operation_name SimpleAggregateFunction(anyLast, Nullable(String)),
      start_time SimpleAggregateFunction(min, DateTime64(3)),
      end_time SimpleAggregateFunction(max, DateTime64(3)),
      duration_ms UInt32 ALIAS toUInt32(greatest(0, dateDiff('millisecond', start_time, end_time))),
      span_count SimpleAggregateFunction(sum, UInt64),
      error SimpleAggregateFunction(max, UInt8),
      updated_at SimpleAggregateFunction(max, DateTime) DEFAULT now()
    )
    ENGINE = ${TRACES_ENGINE}
    ORDER BY (project_id, trace_id)
    SETTINGS index_granularity = 8192${extraSettings ? `, ${extraSettings}` : ''}
  `;
}

/** Columns copied from the old table; duration_ms is derived, never stored. */
const COPY_COLUMNS = [
  'trace_id', 'organization_id', 'project_id', 'service_name', 'root_service_name', 'root_operation_name',
  'start_time', 'end_time', 'span_count', 'error', 'updated_at',
].join(', ');

export const TRACES_MIGRATION_LOCK = 'traces_migration_lock';
const TMP_TABLE = 'traces_migration_tmp';

// The copy squashes inserts into 64 MiB blocks (about 300 MiB of server memory
// for 20 million traces instead of about 2 GiB with the defaults). Smaller
// blocks mean more parts, so the temporary table does not throttle or refuse
// inserts on part count; the limits are reset to the defaults after the swap.
const COPY_SETTINGS = 'max_threads = 2, max_block_size = 8192, min_insert_block_size_rows = 1048576, min_insert_block_size_bytes = 67108864';
const COPY_TABLE_SETTINGS = 'parts_to_delay_insert = 1000000, parts_to_throw_insert = 1000000';

export interface TracesMigrationRunner {
  command(query: string): Promise<void>;
  rows<T>(query: string, params?: Record<string, unknown>): Promise<T[]>;
}

export interface TracesMigrationOptions {
  /** How often the lock holder refreshes its heartbeat. */
  heartbeatMs?: number;
  /** A lock whose heartbeat is older than this belongs to a dead process. */
  staleMs?: number;
  /** How often a waiting process re-checks the lock. */
  pollMs?: number;
  /** Give up waiting for another process after this long. */
  maxWaitMs?: number;
  log?: (message: string) => void;
  /** Test seam: runs after the copy, before the check and the swap, while the lock is held. */
  afterCopy?: () => Promise<void>;
}

const DEFAULTS = { heartbeatMs: 5_000, staleMs: 60_000, pollMs: 1_000, maxWaitMs: 30 * 60_000 };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Also matches the Shared/Replicated variants ClickHouse Cloud and Replicated databases report. */
export function isAggregatingEngine(engine: string | null): boolean {
  return engine !== null && /AggregatingMergeTree$/.test(engine);
}

async function tableEngine(run: TracesMigrationRunner, table: string): Promise<string | null> {
  const rows = await run.rows<{ engine: string }>(
    'SELECT engine FROM system.tables WHERE database = currentDatabase() AND name = {name:String}',
    { name: table },
  );
  return rows[0]?.engine ?? null;
}

/** Atomic acquire: CREATE TABLE without IF NOT EXISTS succeeds for one process only. */
async function tryAcquire(run: TracesMigrationRunner): Promise<boolean> {
  try {
    await run.command(
      `CREATE TABLE ${TRACES_MIGRATION_LOCK} (owner String, beat_at DateTime64(3)) ENGINE = MergeTree ORDER BY beat_at`,
    );
    return true;
  } catch (err) {
    if (/already exists/i.test(String((err as Error)?.message ?? err))) return false;
    throw err;
  }
}

async function beat(run: TracesMigrationRunner, owner: string): Promise<void> {
  await run.command(
    `INSERT INTO ${TRACES_MIGRATION_LOCK} (owner, beat_at) SELECT '${owner}', now64(3)`,
  );
}

/**
 * Holder and age in ms of the newest heartbeat. A lock without heartbeats yet
 * (its holder is between the create and the first beat, or died there) ages
 * from the lock table's creation time. Both ages use the server clock.
 */
async function lockState(run: TracesMigrationRunner): Promise<{ owner: string; ageMs: number } | 'gone'> {
  try {
    const rows = await run.rows<{ owner: string; age_ms: string | number }>(
      `SELECT argMax(owner, beat_at) AS owner, dateDiff('millisecond', max(beat_at), now64(3)) AS age_ms
       FROM ${TRACES_MIGRATION_LOCK} HAVING count() > 0`,
    );
    if (rows[0]) return { owner: rows[0].owner, ageMs: Number(rows[0].age_ms) };
    const created = await run.rows<{ age_ms: string | number }>(
      `SELECT dateDiff('millisecond', metadata_modification_time, now()) AS age_ms
       FROM system.tables WHERE database = currentDatabase() AND name = {name:String}`,
      { name: TRACES_MIGRATION_LOCK },
    );
    if (!created[0]) return 'gone';
    return { owner: 'another process', ageMs: Number(created[0].age_ms) };
  } catch (err) {
    if (/doesn't exist|does not exist|UNKNOWN_TABLE/i.test(String((err as Error)?.message ?? err))) return 'gone';
    throw err;
  }
}

function backupName(): string {
  return `traces_backup_${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}`;
}

/**
 * Finishes a swap whose holder died after the copy was verified. The tmp
 * table then holds the previous data (Atomic: died between EXCHANGE and the
 * backup rename) or the migrated data (Ordinary: died between the two
 * renames). Only called with a stale lock, so no live holder races it.
 * Returns true when the traces table is in the new layout afterwards.
 */
async function recoverInterruptedSwap(run: TracesMigrationRunner, log: (m: string) => void): Promise<boolean> {
  const traces = await tableEngine(run, 'traces');
  const tmp = await tableEngine(run, TMP_TABLE);
  if (isAggregatingEngine(traces) && tmp !== null && !isAggregatingEngine(tmp)) {
    const backup = backupName();
    await run.command(`RENAME TABLE ${TMP_TABLE} TO ${backup}`);
    log(`[ClickHouse] Finished an interrupted traces migration. The previous table is kept as ${backup}.`);
  } else if (traces === null && isAggregatingEngine(tmp)) {
    await run.command(`RENAME TABLE ${TMP_TABLE} TO traces`);
    await run.command('ALTER TABLE traces RESET SETTING parts_to_delay_insert, parts_to_throw_insert').catch(() => undefined);
    log('[ClickHouse] Finished an interrupted traces migration.');
  } else if (!isAggregatingEngine(traces)) {
    return false;
  }
  await run.command(`DROP TABLE IF EXISTS ${TRACES_MIGRATION_LOCK}`);
  return true;
}

/**
 * Brings the traces table to the AggregatingMergeTree layout. Safe to call
 * from several processes at once: exactly one copies, the others wait for it.
 * The runner must allow long queries: the copy and its check scan the whole
 * traces table.
 */
export async function ensureAggregatingTracesTable(
  run: TracesMigrationRunner,
  options: TracesMigrationOptions = {},
): Promise<void> {
  const o = { ...DEFAULTS, ...options };
  const log = options.log ?? ((m: string) => console.warn(m));
  const owner = `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`.replace(/[^A-Za-z0-9._:-]/g, '_');
  const started = Date.now();

  for (;;) {
    const engine = await tableEngine(run, 'traces');
    const state = await lockState(run);

    if (state === 'gone') {
      if (isAggregatingEngine(engine)) return;
      if (engine === null) {
        // Fresh install. Only without a lock: while one exists the table can
        // be missing for a moment, between the two renames of an Ordinary swap.
        await run.command(tracesTableDdl('traces', true));
        continue;
      }
      if (await tryAcquire(run)) break;
      continue;
    }

    if (state.ageMs > o.staleMs) {
      if (await recoverInterruptedSwap(run, log)) return;
      throw new Error(
        `[ClickHouse] The traces table migration started by ${state.owner} stopped without finishing ` +
        `(last heartbeat ${Math.round(state.ageMs / 1000)}s ago). The traces table was not changed. Make sure no ` +
        `LogTide process is still migrating, then run DROP TABLE ${TRACES_MIGRATION_LOCK} and restart.`,
      );
    }
    if (isAggregatingEngine(engine)) return;
    if (Date.now() - started > o.maxWaitMs) {
      throw new Error(
        `[ClickHouse] Waited ${Math.round(o.maxWaitMs / 60_000)} minutes for another process to migrate the traces table. ` +
        `Restart once it has finished.`,
      );
    }
    log(`[ClickHouse] Waiting for ${state.owner} to migrate the traces table`);
    await sleep(o.pollMs);
  }

  // Lock held from here on.
  let lastBeatOk = Date.now();
  const timer = setInterval(() => {
    beat(run, owner).then(() => { lastBeatOk = Date.now(); }, () => undefined);
  }, o.heartbeatMs);
  // swapStarted: the tmp table may hold data that must survive, never drop it.
  // swapDone: both swap steps ran. A swap that failed halfway keeps the lock,
  // so a later start finishes it (recoverInterruptedSwap) once it is stale.
  let swapStarted = false;
  let swapDone = false;

  try {
    await beat(run, owner);
    lastBeatOk = Date.now();

    // Another process may have finished between our last check and the acquire.
    if (isAggregatingEngine(await tableEngine(run, 'traces'))) return;

    log('[ClickHouse] Migrating the traces table to AggregatingMergeTree (one-time, 1.6.1)');
    // A previous holder that died mid-copy can leave a partial copy behind.
    await run.command(`DROP TABLE IF EXISTS ${TMP_TABLE}`);
    await run.command(tracesTableDdl(TMP_TABLE, false, COPY_TABLE_SETTINGS));
    await run.command(
      `INSERT INTO ${TMP_TABLE} (${COPY_COLUMNS}) SELECT ${COPY_COLUMNS} FROM traces FINAL SETTINGS ${COPY_SETTINGS}`,
    );

    if (options.afterCopy) await options.afterCopy();

    const [before] = await run.rows<{ n: string; spans: string }>(
      'SELECT count() AS n, sum(span_count) AS spans FROM traces FINAL',
    );
    const [after] = await run.rows<{ n: string; spans: string }>(
      `SELECT count() AS n, sum(span_count) AS spans FROM ${TMP_TABLE} FINAL`,
    );
    if (before.n !== after.n || before.spans !== after.spans) {
      throw new Error(
        `[ClickHouse] Traces migration check failed (${before.n} traces / ${before.spans} spans before, ` +
        `${after.n} / ${after.spans} after). The old table was left untouched. Stop every LogTide process of an ` +
        `older version (they keep writing to the old table) and restart.`,
      );
    }

    // Waiters treat a lock without a heartbeat for staleMs as dead: never swap
    // when they may be about to.
    if (Date.now() - lastBeatOk > o.staleMs / 2) {
      throw new Error('[ClickHouse] Lost the traces migration heartbeat; the old table was left untouched. Restart to retry.');
    }

    const backup = backupName();
    const [db] = await run.rows<{ engine: string }>(
      'SELECT engine FROM system.databases WHERE name = currentDatabase()',
    );
    swapStarted = true;
    if (db?.engine === 'Atomic' || db?.engine === 'Replicated') {
      await run.command(`EXCHANGE TABLES traces AND ${TMP_TABLE}`);
      await run.command(`RENAME TABLE ${TMP_TABLE} TO ${backup}`);
    } else {
      // Ordinary databases cannot EXCHANGE and a multi-table RENAME is not
      // atomic there either: two explicit steps, recoverable one by one.
      await run.command(`RENAME TABLE traces TO ${backup}`);
      await run.command(`RENAME TABLE ${TMP_TABLE} TO traces`);
    }
    swapDone = true;
    await run.command('ALTER TABLE traces RESET SETTING parts_to_delay_insert, parts_to_throw_insert').catch((err) => {
      log(`[ClickHouse] Could not reset the part limits of the migrated traces table: ${(err as Error)?.message ?? err}`);
    });
    log(`[ClickHouse] Traces table migrated (${after.n} traces). The previous table is kept as ${backup}.`);
  } catch (err) {
    if (!swapStarted) await run.command(`DROP TABLE IF EXISTS ${TMP_TABLE}`).catch(() => undefined);
    throw err;
  } finally {
    clearInterval(timer);
    if (!swapStarted || swapDone) {
      await run.command(`DROP TABLE IF EXISTS ${TRACES_MIGRATION_LOCK}`).catch(() => undefined);
    }
  }
}
