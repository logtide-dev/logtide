import { describe, it, expect, vi } from 'vitest';
import { MongoDBEngine } from './mongodb-engine.js';
import { ANALYTICS_TIMEOUT_MS } from '../../core/constants.js';

const scope = { projectId: 'p1', from: new Date('2026-01-01T00:00:00Z'), to: new Date('2026-01-02T00:00:00Z') };

function engineWith(options: { analyticsTimeoutMs?: number } = {}) {
  const calls: { kind: string; options?: Record<string, unknown> }[] = [];
  const cursor = { toArray: async () => [] };
  const collection = {
    countDocuments: vi.fn((_filter: unknown, opts?: Record<string, unknown>) => {
      calls.push({ kind: 'countDocuments', options: opts });
      return Promise.resolve(0);
    }),
    aggregate: vi.fn((_pipeline: unknown, opts?: Record<string, unknown>) => {
      calls.push({ kind: 'aggregate', options: opts });
      return cursor;
    }),
  };
  const db = { collection: () => collection, command: vi.fn(() => Promise.resolve({ ok: 1 })) };
  const engine = new MongoDBEngine(
    { host: 'x', port: 0, database: 'x', username: '', password: '' },
    { db: db as never, skipInitialize: true, ...options },
  );
  return { engine, calls };
}

async function runAnalytics(engine: MongoDBEngine): Promise<void> {
  await engine.count(scope);
  await engine.histogram({ ...scope, bucketSeconds: 3600 });
  await engine.facets({ ...scope, fields: [{ builtin: 'level' }] });
  await engine.discoverMetadataKeys(scope);
}

describe('MongoDB analytics time limit', () => {
  it('count, histogram, facets and key discovery carry maxTimeMS by default', async () => {
    const { engine, calls } = engineWith();
    await runAnalytics(engine);
    expect(calls.map((c) => c.kind)).toEqual(['countDocuments', 'aggregate', 'aggregate', 'aggregate']);
    for (const c of calls) expect(c.options?.maxTimeMS).toBe(ANALYTICS_TIMEOUT_MS);
  });

  it('the limit is configurable', async () => {
    const { engine, calls } = engineWith({ analyticsTimeoutMs: 1234 });
    await runAnalytics(engine);
    for (const c of calls) expect(c.options?.maxTimeMS).toBe(1234);
  });

  it('0 disables the limit', async () => {
    const { engine, calls } = engineWith({ analyticsTimeoutMs: 0 });
    await runAnalytics(engine);
    for (const c of calls) expect(c.options).not.toHaveProperty('maxTimeMS');
  });
});
