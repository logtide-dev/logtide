import { describe, it, expect, vi } from 'vitest';
import { withContext } from '@logtide/shared/context';
import {
  ClickHouseEngine,
  DEFAULT_INSERT_FLUSH_MS,
  DEFAULT_TRACE_SUMMARY_FLUSH_MS,
  type ClickHouseEngineOptions,
} from './clickhouse-engine.js';

function setup(options: Omit<ClickHouseEngineOptions, 'client'> = {}) {
  const inserts: any[] = [];
  const fakeClient = {
    command: vi.fn(async () => ({})),
    query: vi.fn(async () => ({ json: async () => ({ data: [] }) })),
    insert: vi.fn(async (args: any) => {
      inserts.push(args);
      return {};
    }),
    ping: vi.fn(async () => ({ success: true })),
    close: vi.fn(),
  } as any;
  const engine = new ClickHouseEngine(
    { host: 'x', port: 0, database: 'x', username: 'x', password: 'x' },
    { client: fakeClient, skipInitialize: true, ...options },
  );
  return { engine, inserts };
}

const log = { time: new Date(), projectId: 'p1', service: 'api', level: 'info' as const, message: 'hi' };
const trace = {
  traceId: 't1',
  projectId: 'p1',
  serviceName: 'api',
  startTime: new Date(),
  endTime: new Date(),
  durationMs: 0,
  spanCount: 1,
  error: false,
};

describe('ClickHouseEngine insert settings', () => {
  it('waits for a shared async insert flush of DEFAULT_INSERT_FLUSH_MS on log inserts', async () => {
    const { engine, inserts } = setup();
    await engine.ingest([log]);
    expect(inserts[0].clickhouse_settings).toEqual({
      async_insert: 1,
      wait_for_async_insert: 1,
      async_insert_busy_timeout_ms: DEFAULT_INSERT_FLUSH_MS,
    });
  });

  it('uses insertFlushMs when given', async () => {
    const { engine, inserts } = setup({ insertFlushMs: 3000 });
    await engine.ingest([log]);
    expect(inserts[0].clickhouse_settings.async_insert_busy_timeout_ms).toBe(3000);
  });

  it('keeps the request id in query_id and out of the insert settings', async () => {
    // A per-request log_comment would split the server-side async insert
    // buffers, one part per request.
    const { engine, inserts } = setup();
    await withContext({ requestId: 'req-ins', organizationId: 'org-ins' }, async () => {
      await engine.ingest([log]);
    });
    expect(inserts[0].query_id.startsWith('req-ins')).toBe(true);
    expect(inserts[0].clickhouse_settings).not.toHaveProperty('log_comment');
  });

  it('writes trace summaries without waiting, in a long flush window', async () => {
    const { engine, inserts } = setup();
    await engine.upsertTraces([trace]);
    expect(inserts[0].table).toBe('traces');
    expect(inserts[0].clickhouse_settings).toEqual({
      async_insert: 1,
      wait_for_async_insert: 0,
      async_insert_busy_timeout_ms: DEFAULT_TRACE_SUMMARY_FLUSH_MS,
    });
  });

  it('writes trace summaries like the spans when traceSummaryFlushMs is 0', async () => {
    const { engine, inserts } = setup({ insertFlushMs: 50, traceSummaryFlushMs: 0 });
    await engine.upsertTraces([trace]);
    expect(inserts[0].clickhouse_settings).toEqual({
      async_insert: 1,
      wait_for_async_insert: 1,
      async_insert_busy_timeout_ms: 50,
    });
  });
});
