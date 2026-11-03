import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createClient, type ClickHouseClient } from '@clickhouse/client';
import {
  ensureAggregatingTracesTable,
  isAggregatingEngine,
  tracesTableDdl,
  TRACES_ENGINE,
  TRACES_MIGRATION_LOCK,
  type TracesMigrationRunner,
} from './traces-table.js';

// Pre-1.6.1 layout, verbatim.
const LEGACY_DDL = `
  CREATE TABLE traces (
    trace_id String NOT NULL,
    organization_id Nullable(String) DEFAULT NULL,
    project_id String NOT NULL,
    service_name LowCardinality(String) NOT NULL,
    root_service_name Nullable(String) DEFAULT NULL,
    root_operation_name Nullable(String) DEFAULT NULL,
    start_time DateTime64(3) NOT NULL,
    end_time DateTime64(3) NOT NULL,
    duration_ms UInt32 NOT NULL,
    span_count UInt32 NOT NULL,
    error UInt8 DEFAULT 0,
    updated_at DateTime DEFAULT now()
  )
  ENGINE = ReplacingMergeTree(updated_at)
  ORDER BY (project_id, trace_id)
  SETTINGS index_granularity = 8192
`;

const DATABASE = 'logtide_test_traces_migration';
const FAST = { heartbeatMs: 50, staleMs: 2_000, pollMs: 20, maxWaitMs: 20_000, log: () => undefined };

describe('ClickHouse traces table migration (integration)', () => {
  let client: ClickHouseClient;
  let available = false;

  const run: () => TracesMigrationRunner = () => ({
    command: async (query) => { await client.command({ query }); },
    rows: async <T>(query: string, params?: Record<string, unknown>) =>
      (await (await client.query({ query, query_params: params, format: 'JSONEachRow' })).json()) as T[],
  });
  const rows = <T>(query: string) => run().rows<T>(query);
  const engineOf = async (name: string) =>
    (await rows<{ engine: string }>(`SELECT engine FROM system.tables WHERE database = currentDatabase() AND name = '${name}'`))[0]?.engine ?? null;
  const tables = async () =>
    (await rows<{ name: string }>('SELECT name FROM system.tables WHERE database = currentDatabase() ORDER BY name')).map((r) => r.name);

  async function seedLegacy(): Promise<void> {
    await client.command({ query: LEGACY_DDL });
    // Separate inserts give separate, unmerged parts: two versions of t1 (the
    // later one must win) and a single row for t2 with a NULL root.
    await client.command({ query: `INSERT INTO traces VALUES ('t1', 'org', 'p1', 'api', 'api', 'GET /a', '2026-01-01 00:00:00.000', '2026-01-01 00:00:01.000', 1000, 2, 0, '2026-01-01 00:00:01')` });
    await client.command({ query: `INSERT INTO traces VALUES ('t1', 'org', 'p1', 'api', 'api', 'GET /a', '2026-01-01 00:00:00.000', '2026-01-01 00:00:03.000', 3000, 5, 1, '2026-01-01 00:00:05')` });
    await client.command({ query: `INSERT INTO traces VALUES ('t2', NULL, 'p1', 'worker', NULL, NULL, '2026-01-01 00:01:00.000', '2026-01-01 00:01:00.250', 250, 1, 0, '2026-01-01 00:01:01')` });
  }

  const summaries = () => rows<Record<string, unknown>>(
    `SELECT trace_id, organization_id, service_name, root_service_name, root_operation_name,
            toString(start_time) AS start_time, toString(end_time) AS end_time, duration_ms, toUInt64(span_count) AS span_count, error
     FROM traces FINAL ORDER BY trace_id`,
  );

  beforeAll(async () => {
    const probe = createClient({ url: 'http://localhost:18123', username: 'default', password: '' });
    try {
      await probe.command({ query: `CREATE DATABASE IF NOT EXISTS ${DATABASE}` });
      available = true;
    } catch {
      console.warn('ClickHouse not available at localhost:18123 - skipping traces migration tests');
    } finally {
      await probe.close();
    }
    if (available) client = createClient({ url: 'http://localhost:18123', username: 'default', password: '', database: DATABASE });
  });

  beforeEach(async ({ skip }) => {
    if (!available) skip();
    for (const name of await tables()) await client.command({ query: `DROP TABLE IF EXISTS ${name} SYNC` });
  });

  afterAll(async () => {
    if (!available) return;
    await client.command({ query: `DROP DATABASE IF EXISTS ${DATABASE} SYNC` });
    await client.close();
  });

  it('creates the aggregating table on a fresh database', async () => {
    await ensureAggregatingTracesTable(run(), FAST);
    expect(await engineOf('traces')).toBe(TRACES_ENGINE);
    expect(await tables()).toEqual(['traces']);
  });

  it('copies the latest version of every trace and keeps the old table as a backup', async () => {
    await seedLegacy();
    const before = await summaries();

    await ensureAggregatingTracesTable(run(), FAST);

    expect(await engineOf('traces')).toBe(TRACES_ENGINE);
    expect(await summaries()).toEqual(before);
    expect(before[0]).toMatchObject({ trace_id: 't1', span_count: '5', duration_ms: 3000, error: 1 });
    const backups = (await tables()).filter((n) => n.startsWith('traces_backup_'));
    expect(backups).toHaveLength(1);
    expect(await engineOf(backups[0])).toBe('ReplacingMergeTree');
    expect(await tables()).not.toContain(TRACES_MIGRATION_LOCK);
    expect(await tables()).not.toContain('traces_migration_tmp');    const [ddl] = await rows<{ create_table_query: string }>("SELECT create_table_query FROM system.tables WHERE database = currentDatabase() AND name = 'traces'");
    expect(ddl.create_table_query).not.toMatch(/parts_to_(delay|throw)_insert/);
  });

  it('merges new partial summaries into migrated traces', async () => {
    await seedLegacy();
    await ensureAggregatingTracesTable(run(), FAST);
    await client.command({ query: `INSERT INTO traces (trace_id, project_id, service_name, root_service_name, root_operation_name, start_time, end_time, span_count, error) VALUES ('t1', 'p1', 'db', NULL, NULL, '2026-01-01 00:00:02.000', '2026-01-01 00:00:04.000', 1, 0)` });

    const [t1] = await summaries();
    expect(t1).toMatchObject({ span_count: '6', duration_ms: 4000, error: 1, root_operation_name: 'GET /a', organization_id: 'org' });
  });

  it('is a no-op once migrated', async () => {
    await seedLegacy();
    await ensureAggregatingTracesTable(run(), FAST);
    const after = await tables();
    await ensureAggregatingTracesTable(run(), FAST);
    expect(await tables()).toEqual(after);
  });

  it('copies exactly once when several processes start together', async () => {
    await seedLegacy();
    const before = await summaries();

    // Every call gets its own client, like separate backend and worker processes.
    const clients = Array.from({ length: 6 }, () => createClient({ url: 'http://localhost:18123', username: 'default', password: '', database: DATABASE }));
    let copies = 0;
    // Barrier: every process issues its lock CREATE at the same moment, so the
    // test exercises the mutex itself rather than the waiters' polling.
    let arrived = 0;
    let release: () => void = () => undefined;
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    setTimeout(() => release(), 3_000);
    try {
      await Promise.all(clients.map((c) => ensureAggregatingTracesTable({
        command: async (query) => {
          if (/^CREATE TABLE (IF NOT EXISTS )?traces_migration_lock /.test(query)) {
            if (++arrived === clients.length) release();
            await barrier;
          }
          await c.command({ query });
        },
        rows: async <T>(query: string, params?: Record<string, unknown>) =>
          (await (await c.query({ query, query_params: params, format: 'JSONEachRow' })).json()) as T[],
      }, { ...FAST, afterCopy: async () => { copies++; await new Promise((r) => setTimeout(r, 300)); } })));
    } finally {
      await Promise.all(clients.map((c) => c.close()));
    }

    expect(arrived).toBe(clients.length);
    expect(copies).toBe(1);
    expect(await summaries()).toEqual(before);
    expect((await tables()).filter((n) => n.startsWith('traces_backup_'))).toHaveLength(1);
    expect(await tables()).not.toContain(TRACES_MIGRATION_LOCK);
  });

  it('refuses to start over a dead holder and leaves the traces table untouched', async () => {
    await seedLegacy();
    await client.command({ query: `CREATE TABLE ${TRACES_MIGRATION_LOCK} (owner String, beat_at DateTime64(3)) ENGINE = MergeTree ORDER BY beat_at` });
    await client.command({ query: `INSERT INTO ${TRACES_MIGRATION_LOCK} VALUES ('crashed-host:1:abcd', now64(3) - INTERVAL 10 MINUTE)` });

    await expect(ensureAggregatingTracesTable(run(), FAST)).rejects.toThrow(/crashed-host:1:abcd.*DROP TABLE traces_migration_lock/s);
    expect(await engineOf('traces')).toBe('ReplacingMergeTree');

    // After the operator drops the lock, the next start migrates.
    await client.command({ query: `DROP TABLE ${TRACES_MIGRATION_LOCK}` });
    await ensureAggregatingTracesTable(run(), FAST);
    expect(await engineOf('traces')).toBe(TRACES_ENGINE);
  });

  it('discards a partial copy left by a holder that died mid-copy', async () => {
    await seedLegacy();
    await client.command({ query: `CREATE TABLE traces_migration_tmp (x UInt8) ENGINE = Memory` });
    const before = await summaries();

    await ensureAggregatingTracesTable(run(), FAST);

    expect(await summaries()).toEqual(before);
    expect(await tables()).not.toContain('traces_migration_tmp');
  });

  it('recognises the Shared and Replicated variants as migrated', () => {
    expect(isAggregatingEngine('AggregatingMergeTree')).toBe(true);
    expect(isAggregatingEngine('SharedAggregatingMergeTree')).toBe(true);
    expect(isAggregatingEngine('ReplicatedAggregatingMergeTree')).toBe(true);
    expect(isAggregatingEngine('ReplacingMergeTree')).toBe(false);
    expect(isAggregatingEngine('SharedReplacingMergeTree')).toBe(false);
    expect(isAggregatingEngine(null)).toBe(false);
  });

  const staleLock = async () => {
    await client.command({ query: `CREATE TABLE ${TRACES_MIGRATION_LOCK} (owner String, beat_at DateTime64(3)) ENGINE = MergeTree ORDER BY beat_at` });
    await client.command({ query: `INSERT INTO ${TRACES_MIGRATION_LOCK} VALUES ('crashed-host:1:abcd', now64(3) - INTERVAL 10 MINUTE)` });
  };

  it('finishes a swap interrupted between EXCHANGE and the backup rename', async () => {
    await seedLegacy();
    const before = await summaries();
    // State left by a holder that died right after EXCHANGE TABLES.
    await client.command({ query: tracesTableDdl('traces_migration_tmp', false) });
    await client.command({ query: `INSERT INTO traces_migration_tmp SELECT trace_id, organization_id, project_id, service_name, root_service_name, root_operation_name, start_time, end_time, span_count, error, updated_at FROM traces FINAL` });
    await client.command({ query: 'EXCHANGE TABLES traces AND traces_migration_tmp' });
    await staleLock();

    await ensureAggregatingTracesTable(run(), FAST);

    expect(await engineOf('traces')).toBe(TRACES_ENGINE);
    expect(await summaries()).toEqual(before);
    const names = await tables();
    expect(names.filter((n) => n.startsWith('traces_backup_'))).toHaveLength(1);
    expect(names).not.toContain('traces_migration_tmp');
    expect(names).not.toContain(TRACES_MIGRATION_LOCK);
  });

  it('finishes a swap interrupted between the two renames of an Ordinary database', async () => {
    await seedLegacy();
    const before = await summaries();
    await client.command({ query: tracesTableDdl('traces_migration_tmp', false) });
    await client.command({ query: `INSERT INTO traces_migration_tmp SELECT trace_id, organization_id, project_id, service_name, root_service_name, root_operation_name, start_time, end_time, span_count, error, updated_at FROM traces FINAL` });
    await client.command({ query: 'RENAME TABLE traces TO traces_backup_20260101000000' });
    await staleLock();

    await ensureAggregatingTracesTable(run(), FAST);

    expect(await engineOf('traces')).toBe(TRACES_ENGINE);
    expect(await summaries()).toEqual(before);
    expect(await tables()).toEqual(['traces', 'traces_backup_20260101000000']);
  });

  it('never recreates a missing traces table while another process holds the lock', async () => {
    await client.command({ query: `CREATE TABLE ${TRACES_MIGRATION_LOCK} (owner String, beat_at DateTime64(3)) ENGINE = MergeTree ORDER BY beat_at` });
    const beats = setInterval(() => {
      client.command({ query: `INSERT INTO ${TRACES_MIGRATION_LOCK} VALUES ('live-host:1:abcd', now64(3))` }).catch(() => undefined);
    }, 50);
    try {
      await expect(ensureAggregatingTracesTable(run(), { ...FAST, maxWaitMs: 500 })).rejects.toThrow(/Waited/);
    } finally {
      clearInterval(beats);
    }
    expect(await tables()).toEqual([TRACES_MIGRATION_LOCK]);
  });

  it('releases the lock when the first heartbeat fails', async () => {
    await seedLegacy();
    const base = run();
    let failed = false;
    const flaky: TracesMigrationRunner = {
      rows: base.rows,
      command: async (query) => {
        if (!failed && query.startsWith(`INSERT INTO ${TRACES_MIGRATION_LOCK}`)) { failed = true; throw new Error('network blip'); }
        await base.command(query);
      },
    };
    await expect(ensureAggregatingTracesTable(flaky, FAST)).rejects.toThrow(/network blip/);
    expect(await tables()).toEqual(['traces']);

    await ensureAggregatingTracesTable(run(), FAST);
    expect(await engineOf('traces')).toBe(TRACES_ENGINE);
  });

  it('aborts without changes when an older version writes during the copy', async () => {
    await seedLegacy();
    await expect(ensureAggregatingTracesTable(run(), {
      ...FAST,
      afterCopy: async () => {
        await client.command({ query: `INSERT INTO traces VALUES ('t3', NULL, 'p1', 'api', NULL, NULL, '2026-01-01 00:02:00.000', '2026-01-01 00:02:01.000', 1000, 1, 0, now())` });
      },
    })).rejects.toThrow(/check failed.*older version/s);

    expect(await engineOf('traces')).toBe('ReplacingMergeTree');
    expect(await tables()).toEqual(['traces']);
  });
});
