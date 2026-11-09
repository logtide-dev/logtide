import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createClient, type ClickHouseClient } from '@clickhouse/client';
import {
  ensureDailyPartitions,
  isDaily,
  lockTable,
  repartitionPending,
  type RepartitionRunner,
  type RepartitionSpec,
} from './repartition.js';
import { logsTableDdl, spansTableDdl } from './daily-tables.js';
import { ClickHouseEngine } from './clickhouse-engine.js';

// Pre-1.6.3 logs layout (monthly, with the full-copy projection).
const LEGACY_LOGS = `
  CREATE TABLE logs (
    id UUID DEFAULT generateUUIDv4(),
    time DateTime64(3) NOT NULL,
    project_id String NOT NULL,
    service LowCardinality(String) NOT NULL,
    level LowCardinality(String) NOT NULL,
    message String NOT NULL,
    metadata String DEFAULT '{}',
    trace_id Nullable(String) DEFAULT NULL,
    span_id Nullable(String) DEFAULT NULL,
    created_at DateTime DEFAULT now(),
    session_id Nullable(String) DEFAULT NULL,
    hostname String MATERIALIZED JSONExtractString(metadata, 'hostname'),
    PROJECTION proj_service_time (SELECT * ORDER BY project_id, service, level, time)
  )
  ENGINE = MergeTree()
  PARTITION BY toYYYYMM(time)
  ORDER BY (project_id, time)
`;

const LEGACY_SPANS = `
  CREATE TABLE spans (
    time DateTime64(3) NOT NULL,
    span_id String NOT NULL,
    trace_id String NOT NULL,
    parent_span_id Nullable(String) DEFAULT NULL,
    organization_id Nullable(String) DEFAULT NULL,
    project_id String NOT NULL,
    service_name LowCardinality(String) NOT NULL,
    operation_name String NOT NULL,
    start_time DateTime64(3) NOT NULL,
    end_time DateTime64(3) NOT NULL,
    duration_ms UInt32 NOT NULL,
    kind LowCardinality(Nullable(String)) DEFAULT NULL,
    status_code LowCardinality(Nullable(String)) DEFAULT NULL,
    status_message Nullable(String) DEFAULT NULL,
    attributes String DEFAULT '{}',
    events String DEFAULT '[]',
    links String DEFAULT '[]',
    resource_attributes String DEFAULT '{}'
  )
  ENGINE = MergeTree()
  PARTITION BY toYYYYMM(time)
  ORDER BY (project_id, trace_id, time)
`;

const LOGS: RepartitionSpec = { table: 'logs', ddl: (n) => logsTableDdl(n), key: 'id' };
const SPANS: RepartitionSpec = { table: 'spans', ddl: (n) => spansTableDdl(n), key: '(trace_id, span_id)' };
const DATABASE = 'logtide_test_repartition';
const FAST = { heartbeatMs: 50, staleMs: 500, settleMs: 0, log: () => undefined };

describe('ClickHouse move to daily partitions (integration)', () => {
  let client: ClickHouseClient;
  let available = false;

  const run = (): RepartitionRunner => ({
    command: async (query, params) => { await client.command({ query, query_params: params }); },
    rows: async <T>(query: string, params?: Record<string, unknown>) =>
      (await (await client.query({ query, query_params: params, format: 'JSONEachRow' })).json()) as T[],
  });
  const rows = <T>(query: string) => run().rows<T>(query);
  const keyOf = async (t: string) =>
    (await rows<{ k: string }>(`SELECT partition_key AS k FROM system.tables WHERE database = currentDatabase() AND name = '${t}'`))[0]?.k ?? null;
  const tables = async () =>
    (await rows<{ name: string }>('SELECT name FROM system.tables WHERE database = currentDatabase() ORDER BY name')).map((r) => r.name);
  const logIds = async () =>
    (await rows<{ id: string }>('SELECT toString(id) AS id FROM logs ORDER BY id')).map((r) => r.id);

  let n = 0;
  const insertLog = (time: string, metadata = '{}') =>
    client.command({
      query: `INSERT INTO logs (id, time, project_id, service, level, message, metadata)
              VALUES (generateUUIDv4(), '${time}', 'p1', 'api', 'info', 'm${n++}', '${metadata}')`,
    });

  beforeAll(async () => {
    const probe = createClient({ url: 'http://localhost:18123', username: 'default', password: '' });
    try {
      await probe.command({ query: `CREATE DATABASE IF NOT EXISTS ${DATABASE}` });
      available = true;
    } catch {
      console.warn('ClickHouse not available at localhost:18123 - skipping daily partition tests');
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

  async function seedLogs(): Promise<void> {
    await client.command({ query: LEGACY_LOGS });
    await insertLog('2026-09-30 23:59:59.000', '{"hostname":"a"}');
    await insertLog('2026-10-01 00:00:00.000');
    await insertLog('2026-10-01 12:00:00.000');
    await insertLog('2026-10-02 08:00:00.000');
  }

  it('leaves a daily-partitioned table alone', async () => {
    await client.command({ query: logsTableDdl('logs') });
    expect(await ensureDailyPartitions(run(), LOGS, FAST)).toBe(true);
    expect(await tables()).toEqual(['logs']);
  });

  it('moves a monthly table to daily partitions with every row, then cleans up', async () => {
    await seedLogs();
    const before = await logIds();

    expect(await ensureDailyPartitions(run(), LOGS, FAST)).toBe(true);

    expect(isDaily(await keyOf('logs'))).toBe(true);
    expect(await logIds()).toEqual(before);
    expect(await tables()).toEqual(['logs']);
    const days = await rows<{ p: string }>(
      "SELECT DISTINCT partition AS p FROM system.parts WHERE database = currentDatabase() AND table = 'logs' AND active ORDER BY p",
    );
    expect(days.map((d) => d.p)).toEqual(['20260930', '20261001', '20261002']);
    // MATERIALIZED columns are recomputed, not copied.
    const [host] = await rows<{ h: string }>("SELECT hostname AS h FROM logs WHERE time = '2026-09-30 23:59:59.000'");
    expect(host.h).toBe('a');
  });

  it('adds the rows written to the old table after their day was copied', async () => {
    await seedLogs();
    let late: string[] = [];
    await ensureDailyPartitions(run(), LOGS, {
      ...FAST,
      afterCopy: async () => {
        await insertLog('2026-10-01 13:00:00.000'); // already-copied day
        await insertLog('2026-10-05 09:00:00.000'); // day that did not exist yet
        late = await logIds();
      },
    });
    expect(await logIds()).toEqual(late);
    expect(late).toHaveLength(6);
    expect(await tables()).toEqual(['logs']);
  });

  it('resumes an interrupted move without duplicating rows, and blocks deletes meanwhile', async () => {
    await seedLogs();
    const before = await logIds();

    await expect(
      ensureDailyPartitions(run(), LOGS, { ...FAST, afterCopy: async () => { throw new Error('killed'); } }),
    ).rejects.toThrow('killed');
    expect(await repartitionPending(run(), 'logs')).toBe(true);
    expect(isDaily(await keyOf('logs'))).toBe(false);

    // A live holder is never taken over; a stale one is.
    expect(await ensureDailyPartitions(run(), LOGS, { ...FAST, staleMs: 60_000 })).toBe(false);
    await new Promise((r) => setTimeout(r, 700));
    expect(await ensureDailyPartitions(run(), LOGS, FAST)).toBe(true);

    expect(await logIds()).toEqual(before);
    expect(await repartitionPending(run(), 'logs')).toBe(false);
    expect(await tables()).toEqual(['logs']);
  });

  it('keeps the monthly table when the disk is too small for the copy', async () => {
    await seedLogs();
    const messages: string[] = [];
    expect(
      await ensureDailyPartitions(run(), LOGS, { ...FAST, freeSpaceFactor: 1e15, log: (m) => messages.push(m) }),
    ).toBe(false);
    expect(isDaily(await keyOf('logs'))).toBe(false);
    expect(await tables()).toEqual(['logs']);
    expect(messages.join(' ')).toMatch(/GiB free/);
    expect(await rows(`SELECT 1 FROM system.tables WHERE database = currentDatabase() AND name = '${lockTable('logs')}'`)).toEqual([]);
  });

  it('an engine started on a pre-1.6.3 install moves both tables in the background', async () => {
    await seedLogs();
    await client.command({ query: LEGACY_SPANS });
    const before = await logIds();

    const engine = new ClickHouseEngine(
      { host: 'localhost', port: 18123, database: DATABASE, username: 'default', password: '' },
      { insertFlushMs: 50, traceSummaryFlushMs: 0, repartitionOptions: FAST },
    );
    await engine.connect();
    try {
      await engine.initialize();
      await engine.repartitionSettled();

      expect(isDaily(await keyOf('logs'))).toBe(true);
      expect(isDaily(await keyOf('spans'))).toBe(true);
      expect(await logIds()).toEqual(before);
      const [ddl] = await rows<{ q: string }>("SELECT create_table_query AS q FROM system.tables WHERE database = currentDatabase() AND name = 'logs'");
      expect(ddl.q).toContain('proj_minute_volume');
      expect(ddl.q).not.toContain('proj_service_time');
      // Retention deletes run again once the move is over.
      await engine.deleteByTimeRange({ projectId: 'p1', from: new Date(0), to: new Date('2026-10-01T00:00:00Z') });
    } finally {
      await engine.disconnect();
    }
  });

  it('moves spans keyed by trace and span id', async () => {
    await client.command({ query: LEGACY_SPANS });
    for (const [t, s, time] of [['t1', 's1', '2026-10-01 10:00:00.000'], ['t1', 's2', '2026-10-02 10:00:00.000']]) {
      await client.command({
        query: `INSERT INTO spans (time, span_id, trace_id, project_id, service_name, operation_name, start_time, end_time, duration_ms)
                VALUES ('${time}', '${s}', '${t}', 'p1', 'api', 'op', '${time}', '${time}', 1)`,
      });
    }
    expect(await ensureDailyPartitions(run(), SPANS, FAST)).toBe(true);
    expect(isDaily(await keyOf('spans'))).toBe(true);
    expect(await rows('SELECT span_id FROM spans ORDER BY span_id')).toEqual([{ span_id: 's1' }, { span_id: 's2' }]);
  });
});
