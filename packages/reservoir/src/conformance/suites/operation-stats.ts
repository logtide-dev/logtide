// Operation stats conformance (plan D6): entry spans (default kinds SERVER
// and CONSUMER, root spans when the scope has none and `kinds` was omitted),
// grouped by service and operation, `percentile_cont` percentiles within the
// tolerances below, ordered by count desc, service, operation.

import { describe, expect, it } from 'vitest';
import type { OperationStat, OperationStatsParams } from '../../core/types.js';
import type { ConformanceContext } from '../harness.js';
import { expectBetween, expectMs } from '../harness.js';
import { PROJECT_A, PROJECT_B, WINDOW } from '../corpus.js';

const names = (rows: OperationStat[]): string[] => rows.map((r) => `${r.service}/${r.operation}`);

function stats(ctx: ConformanceContext, params: Partial<OperationStatsParams> = {}): Promise<OperationStat[]> {
  return ctx.subject().getOperationStats({ projectId: PROJECT_A, ...WINDOW, ...params });
}

function row(rows: OperationStat[], name: string): OperationStat {
  const found = rows.find((r) => `${r.service}/${r.operation}` === name);
  expect(found, `row ${name}`).toBeDefined();
  return found!;
}

function expectOrderedPercentiles(rows: OperationStat[]): void {
  for (const r of rows) {
    expect(r.p50Ms <= r.p95Ms && r.p95Ms <= r.p99Ms, `${r.service}/${r.operation} p50 <= p95 <= p99`).toBe(true);
  }
}

export function describeOperationStatsConformance(ctx: ConformanceContext): void {
  describe('operation stats', () => {
    it('O01 default entry spans with counts, errors, averages and percentiles', async () => {
      const rows = await stats(ctx);
      expect(names(rows)).toEqual(['api/GET /users', 'api/POST /orders', 'worker/process job']);
      const get = row(rows, 'api/GET /users');
      expect([get.count, get.errorCount]).toEqual([100, 5]);
      expectMs(get.avgMs, 50.5, 0.01, 'GET /users avgMs');
      expectMs(get.p50Ms, 50.5, 1.5, 'GET /users p50Ms');
      expectMs(get.p95Ms, 95.05, 1.5, 'GET /users p95Ms');
      expectMs(get.p99Ms, 99.01, 1.5, 'GET /users p99Ms');
      const post = row(rows, 'api/POST /orders');
      expect([post.count, post.errorCount]).toEqual([10, 2]);
      expectMs(post.avgMs, 550, 0.01, 'POST /orders avgMs');
      expectBetween(post.p50Ms, 500, 600, 'POST /orders p50Ms');
      expectBetween(post.p95Ms, 900, 1000, 'POST /orders p95Ms');
      expectBetween(post.p99Ms, 900, 1000, 'POST /orders p99Ms');
      const job = row(rows, 'worker/process job');
      expect([job.count, job.errorCount]).toEqual([4, 1]);
      expectMs(job.avgMs, 25, 0.01, 'process job avgMs');
      expectBetween(job.p50Ms, 20, 30, 'process job p50Ms');
      expectOrderedPercentiles(rows);
    });

    it('O02 explicit kinds', async () => {
      const rows = await stats(ctx, { kinds: ['CLIENT'] });
      expect(names(rows)).toEqual(['api/SELECT orders']);
      expect([rows[0].count, rows[0].errorCount]).toEqual([10, 0]);
      expectMs(rows[0].avgMs, 27.5, 0.01, 'SELECT orders avgMs');
      expectOrderedPercentiles(rows);
    });

    it('O03 a service without entry spans falls back to its root spans', async () => {
      const rows = await stats(ctx, { service: 'frontend' });
      expect(names(rows)).toEqual(['frontend/page load']);
      expect([rows[0].count, rows[0].errorCount]).toEqual([3, 0]);
      expectMs(rows[0].avgMs, 24016.67, 0.01, 'page load avgMs');
      expectOrderedPercentiles(rows);
    });

    it('O04 explicit kinds never fall back', async () => {
      expect(await stats(ctx, { service: 'frontend', kinds: ['SERVER'] })).toEqual([]);
    });

    it('O05 a service with entry spans ignores its internal root', async () => {
      const rows = await stats(ctx, { service: 'worker' });
      expect(names(rows)).toEqual(['worker/process job']);
    });

    it('O06 a limit keeps the busiest operations', async () => {
      expect(names(await stats(ctx, { limit: 2 }))).toEqual(['api/GET /users', 'api/POST /orders']);
    });

    it('O07 another project only sees its own spans', async () => {
      const rows = await stats(ctx, { projectId: PROJECT_B });
      expect(names(rows)).toEqual(['api/GET /users']);
      expect(rows[0].count).toBe(1);
      expectMs(rows[0].avgMs, 5000, 0.01, 'project B avgMs');
    });
  });
}
