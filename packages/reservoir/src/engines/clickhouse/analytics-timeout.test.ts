import { describe, it, expect, vi } from 'vitest';
import { ClickHouseEngine } from './clickhouse-engine.js';
import { ANALYTICS_TIMEOUT_MS } from '../../core/constants.js';

const scope = { projectId: 'p1', from: new Date('2026-01-01T00:00:00Z'), to: new Date('2026-01-02T00:00:00Z') };

function engineWith(options: { analyticsTimeoutMs?: number } = {}) {
  const queries: Record<string, unknown>[] = [];
  const fakeClient = {
    command: vi.fn(async () => ({})),
    query: vi.fn(async (args: Record<string, unknown>) => {
      queries.push(args);
      return { json: async () => [] };
    }),
    insert: vi.fn(async () => ({})),
    ping: vi.fn(async () => ({ success: true })),
    close: vi.fn(),
  };
  const engine = new ClickHouseEngine(
    { host: 'x', port: 0, database: 'x', username: 'x', password: 'x' },
    { client: fakeClient as never, skipInitialize: true, ...options },
  );
  return { engine, queries };
}

async function runAnalytics(engine: ClickHouseEngine): Promise<void> {
  await engine.count(scope);
  await engine.histogram({ ...scope, bucketSeconds: 3600 });
  await engine.facets({ ...scope, fields: [{ builtin: 'level' }] });
  await engine.discoverMetadataKeys(scope);
}

describe('ClickHouse analytics time limit', () => {
  it('count, histogram, facets and key discovery carry max_execution_time by default', async () => {
    const { engine, queries } = engineWith();
    await runAnalytics(engine);
    expect(queries).toHaveLength(4);
    for (const q of queries) {
      expect(q.clickhouse_settings).toEqual({ max_execution_time: ANALYTICS_TIMEOUT_MS / 1000 });
    }
  });

  it('the limit is configurable in whole seconds, rounded up', async () => {
    const { engine, queries } = engineWith({ analyticsTimeoutMs: 1500 });
    await runAnalytics(engine);
    for (const q of queries) expect(q.clickhouse_settings).toEqual({ max_execution_time: 2 });
  });

  it('0 disables the limit', async () => {
    const { engine, queries } = engineWith({ analyticsTimeoutMs: 0 });
    await runAnalytics(engine);
    for (const q of queries) expect(q.clickhouse_settings).toBeUndefined();
  });
});
