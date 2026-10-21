// Histogram conformance (plan D6): buckets aligned to multiples of
// `bucketSeconds` since the Unix epoch, zero-filled across the range, only
// logs inside the filter's range counted, `byLevel` without zero levels, and
// every log filter (including a parsed `q`) applied.

import { describe, expect, it } from 'vitest';
import type { LogHistogramParams, LogHistogramResult } from '../../core/types.js';
import type { ConformanceContext, LogCase } from '../harness.js';
import { logCaseParams } from '../harness.js';
import { CONFORMANCE_BASE, WINDOW, minutes } from '../corpus.js';

type Bucket = [minutesFromBase: number, total: number, byLevel: Record<string, number>];

const THIRTY_MINUTES = { from: minutes(0), to: minutes(30) };

function histogramParams(kase: Pick<LogCase, 'q' | 'params' | 'window'>, bucketSeconds: number): LogHistogramParams {
  return { ...logCaseParams(kase), bucketSeconds } as LogHistogramParams;
}

function bucketsOf(result: LogHistogramResult): Bucket[] {
  return result.buckets.map((b) => [(b.time.getTime() - CONFORMANCE_BASE.getTime()) / 60_000, b.total, b.byLevel]);
}

export function describeHistogramConformance(ctx: ConformanceContext): void {
  describe('histogram', () => {
    it('H01 ten-minute buckets over half an hour, inclusive end', async () => {
      const result = await ctx.subject().histogram(histogramParams({ window: THIRTY_MINUTES }, 600));
      expect(result.bucketSeconds).toBe(600);
      expect(bucketsOf(result)).toEqual([
        [0, 9, { info: 2, error: 3, warn: 2, debug: 1, critical: 1 }],
        [10, 10, { info: 6, warn: 2, error: 2 }],
        [20, 6, { error: 2, info: 4 }],
        [30, 0, {}],
      ]);
    });

    it('H02 an exclusive end drops the bucket starting at the end', async () => {
      const result = await ctx.subject().histogram(histogramParams({ window: { ...THIRTY_MINUTES, toExclusive: true } }, 600));
      expect(bucketsOf(result)).toEqual([
        [0, 9, { info: 2, error: 3, warn: 2, debug: 1, critical: 1 }],
        [10, 10, { info: 6, warn: 2, error: 2 }],
        [20, 6, { error: 2, info: 4 }],
      ]);
    });

    it('H03 a parsed level filter', async () => {
      const result = await ctx.subject().histogram(histogramParams({ q: 'level:error', window: THIRTY_MINUTES }, 600));
      expect(bucketsOf(result)).toEqual([
        [0, 3, { error: 3 }],
        [10, 2, { error: 2 }],
        [20, 2, { error: 2 }],
        [30, 0, {}],
      ]);
    });

    it('H04 a range inside buckets counts only the logs in range', async () => {
      const result = await ctx.subject().histogram(histogramParams({ window: { from: minutes(5), to: minutes(25) } }, 600));
      expect(bucketsOf(result).map(([at, total]) => [at, total])).toEqual([[0, 5], [10, 10], [20, 6]]);
    });

    it('H05 five-hour buckets are aligned to the Unix epoch, not to the range', async () => {
      const result = await ctx.subject().histogram(histogramParams({ window: { from: new Date('2026-01-05T07:00:00.000Z'), to: WINDOW.to } }, 18_000));
      expect(result.bucketSeconds).toBe(18_000);
      expect(result.buckets.map((b) => [b.time.toISOString(), b.total, b.byLevel])).toEqual([
        ['2026-01-05T03:00:00.000Z', 0, {}],
        ['2026-01-05T08:00:00.000Z', 25, { info: 12, error: 7, warn: 4, debug: 1, critical: 1 }],
      ]);
    });

    it('H06 a parsed text query', async () => {
      const result = await ctx.subject().histogram(histogramParams({ q: 'timeout OR refused', window: THIRTY_MINUTES }, 600));
      expect(bucketsOf(result).map(([, total]) => total)).toEqual([3, 1, 0, 0]);
    });

    it('H07 no matching log gives zero-filled buckets', async () => {
      const result = await ctx.subject().histogram(histogramParams({ q: 'service:nonexistent', window: THIRTY_MINUTES }, 600));
      expect(bucketsOf(result)).toEqual([[0, 0, {}], [10, 0, {}], [20, 0, {}], [30, 0, {}]]);
    });

    it('H08 too many buckets reject with RangeError', async () => {
      await expect(ctx.subject().histogram(histogramParams({}, 1))).rejects.toBeInstanceOf(RangeError);
    });

    it('H09 a matchNothing merge gives zero-filled buckets', async () => {
      const result = await ctx.subject().histogram(histogramParams({ q: 'level:error', params: { level: ['info'] }, window: THIRTY_MINUTES }, 600));
      expect(bucketsOf(result)).toEqual([[0, 0, {}], [10, 0, {}], [20, 0, {}], [30, 0, {}]]);
    });
  });
}
