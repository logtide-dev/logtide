// Trace summary upsert conformance (issue #309): spans of one trace arrive in
// several export requests, each request writes the summary of the spans it
// carried, and every engine merges those partial summaries the same way:
// span counts add up, the time window widens (duration = end - start), the
// error flag is sticky, and root service / operation names are kept once
// known (a request without the root span never clears them). The merge does
// not read the spans table, so it is correct whatever order spans and
// summaries land in. Every case writes under its own project.

import { describe, expect, it } from 'vitest';
import type { TraceRecord } from '../../core/types.js';
import type { ConformanceContext } from '../harness.js';

const BASE = Date.UTC(2026, 0, 7, 9, 0, 0);
const at = (ms: number): Date => new Date(BASE + ms);
const project = (n: number): string => `00000000-0000-4000-8000-0000000e${String(n).padStart(4, '0')}`;

function partial(projectId: string, traceId: string, from: number, to: number, spanCount: number, extra: Partial<TraceRecord> = {}): TraceRecord {
  return {
    traceId,
    projectId,
    serviceName: 'api',
    startTime: at(from),
    endTime: at(to),
    durationMs: to - from,
    spanCount,
    error: false,
    ...extra,
  };
}

function summary(trace: TraceRecord | null) {
  if (!trace) return null;
  return {
    startTime: trace.startTime.toISOString(),
    endTime: trace.endTime.toISOString(),
    durationMs: trace.durationMs,
    spanCount: trace.spanCount,
    error: trace.error,
    rootServiceName: trace.rootServiceName ?? null,
    rootOperationName: trace.rootOperationName ?? null,
  };
}

export function describeTraceUpsertConformance(ctx: ConformanceContext): void {
  describe('trace summary upserts', () => {
    const get = async (traceId: string, projectId: string) => summary(await ctx.subject().getTraceById(traceId, projectId));

    it('TU01 partial summaries from several requests merge', async () => {
      const p = project(1);
      await ctx.subject().upsertTraces([partial(p, 'tu01', 100, 200, 2, { error: true })]);
      await ctx.subject().upsertTraces([partial(p, 'tu01', 300, 400, 2)]);
      await ctx.subject().upsertTraces([partial(p, 'tu01', 0, 1000, 1, { rootServiceName: 'api', rootOperationName: 'GET /checkout' })]);
      expect(await get('tu01', p)).toEqual({
        startTime: at(0).toISOString(),
        endTime: at(1000).toISOString(),
        durationMs: 1000,
        spanCount: 5,
        error: true,
        rootServiceName: 'api',
        rootOperationName: 'GET /checkout',
      });
    });

    it('TU02 a request without the root span keeps the known root names', async () => {
      const p = project(2);
      await ctx.subject().upsertTraces([partial(p, 'tu02', 0, 500, 1, { rootServiceName: 'api', rootOperationName: 'POST /orders' })]);
      await ctx.subject().upsertTraces([partial(p, 'tu02', 400, 900, 1, { serviceName: 'worker' })]);
      expect(await get('tu02', p)).toEqual({
        startTime: at(0).toISOString(),
        endTime: at(900).toISOString(),
        durationMs: 900,
        spanCount: 2,
        error: false,
        rootServiceName: 'api',
        rootOperationName: 'POST /orders',
      });
    });

    it('TU03 one call writes every trace it carries', async () => {
      const p = project(3);
      await ctx.subject().upsertTraces([
        partial(p, 'tu03-a', 0, 10, 1),
        partial(p, 'tu03-b', 20, 50, 3, { error: true }),
        partial(p, 'tu03-c', 60, 61, 2),
      ]);
      expect((await get('tu03-a', p))?.spanCount).toBe(1);
      expect(await get('tu03-b', p)).toMatchObject({ spanCount: 3, durationMs: 30, error: true });
      expect((await get('tu03-c', p))?.spanCount).toBe(2);
    });

    it('TU04 the same trace twice in one call merges both parts', async () => {
      const p = project(4);
      await ctx.subject().upsertTraces([
        partial(p, 'tu04', 100, 200, 2),
        partial(p, 'tu04', 0, 150, 1, { rootServiceName: 'api', rootOperationName: 'GET /' }),
      ]);
      expect(await get('tu04', p)).toMatchObject({ spanCount: 3, durationMs: 200, rootOperationName: 'GET /' });
    });

    it('TU05 the single-trace upsert merges like the batch one', async () => {
      const p = project(5);
      await ctx.subject().upsertTrace(partial(p, 'tu05', 0, 100, 1));
      await ctx.subject().upsertTraces([partial(p, 'tu05', 50, 300, 2, { error: true })]);
      expect(await get('tu05', p)).toMatchObject({ spanCount: 3, durationMs: 300, error: true });
    });

    it('TU06 an empty call is a no-op', async () => {
      await expect(ctx.subject().upsertTraces([])).resolves.toBeUndefined();
    });

    it('TU07 the merged summary is what queryTraces filters and sorts on', async () => {
      const p = project(7);
      await ctx.subject().upsertTraces([partial(p, 'tu07-long', 0, 100, 1), partial(p, 'tu07-short', 0, 300, 1)]);
      await ctx.subject().upsertTraces([partial(p, 'tu07-long', 900, 1000, 1, { error: true })]);
      const result = await ctx.subject().queryTraces({
        projectId: p, from: at(-1000), to: at(10_000), minDurationMs: 500, error: true, sortBy: 'duration', sortOrder: 'desc', limit: 10,
      });
      expect(result.traces.map((t) => [t.traceId, t.durationMs, t.spanCount])).toEqual([['tu07-long', 1000, 2]]);
      expect(result.total).toBe(1);
    });
  });
}
