import { describe, it, expect } from 'vitest';
import { LOG_LEVELS, type LogLevel } from '@logtide/shared';
import { levelTone } from '$lib/utils/severity';
import type { LogHistogramBucket } from '$lib/api/logs';
import {
  BUCKET_STEPS_SECONDS,
  HISTOGRAM_MAX_BUCKETS,
  bucketToWindow,
  buildHistogramOption,
  pickBucketSeconds,
  pointerSelection,
} from './histogram';

const at = (h: number, m: number, s = 0) => Date.UTC(2026, 9, 21, h, m, s);
const iso = (ms: number) => new Date(ms).toISOString();
const extent = { from: at(9, 0), to: at(11, 0) };

const colors = Object.fromEntries(LOG_LEVELS.map((l) => [l, levelTone(l).chart])) as Record<LogLevel, string>;

function buckets(n: number, startMs: number, stepSeconds: number): LogHistogramBucket[] {
  return Array.from({ length: n }, (_, i) => ({
    time: iso(startMs + i * stepSeconds * 1000),
    total: i + 1,
    byLevel: { info: i, error: 1 },
  }));
}

describe('pickBucketSeconds', () => {
  it.each([
    [15 * 60e3, 10],
    [3600e3, 60],
    [6 * 3600e3, 300],
    [12 * 3600e3, 600],
    [24 * 3600e3, 900],
    [48 * 3600e3, 1800],
    [3 * 86400e3, 3600],
    [7 * 86400e3, 7200],
    [14 * 86400e3, 21600],
    [30 * 86400e3, 43200],
    [365 * 86400e3, 345600],
  ])('pickBucketSeconds(%i) is %i', (ms, s) => expect(pickBucketSeconds(ms)).toBe(s));

  it('never exceeds the bucket budget', () => {
    for (const ms of [1, 999, 61e3, 5 * 3600e3 + 7, 90 * 86400e3, 1000 * 86400e3]) {
      expect(Math.ceil(ms / 1000 / pickBucketSeconds(ms))).toBeLessThanOrEqual(HISTOGRAM_MAX_BUCKETS);
    }
  });

  it('uses the smallest step for an empty or negative range', () => {
    expect(pickBucketSeconds(0)).toBe(BUCKET_STEPS_SECONDS[0]);
    expect(pickBucketSeconds(-5)).toBe(BUCKET_STEPS_SECONDS[0]);
  });
});

describe('bucketToWindow', () => {
  it('bucketToWindow spans one bucket', () => {
    const w = bucketToWindow('2026-10-21T10:00:00.000Z', 60);
    expect(w.from.toISOString()).toBe('2026-10-21T10:00:00.000Z');
    expect(w.to.toISOString()).toBe('2026-10-21T10:01:00.000Z');
  });
});

describe('pointerSelection', () => {
  it('a click selects the bucket under the pointer', () => {
    const w = pointerSelection({ downTime: at(10, 0, 30), upTime: at(10, 0, 30), movedPx: 1, bucketSeconds: 60, extent });
    expect(w.from.toISOString()).toBe('2026-10-21T10:00:00.000Z');
    expect(w.to.toISOString()).toBe('2026-10-21T10:01:00.000Z');
  });

  it('a drag snaps to bucket edges and accepts reversed drags', () => {
    const w = pointerSelection({ downTime: at(10, 5, 10), upTime: at(10, 2, 50), movedPx: 80, bucketSeconds: 60, extent });
    expect(w.from.toISOString()).toBe('2026-10-21T10:02:00.000Z');
    expect(w.to.toISOString()).toBe('2026-10-21T10:06:00.000Z');
  });

  it('a drag is clamped to the extent', () => {
    const w = pointerSelection({ downTime: at(8, 0), upTime: at(12, 30), movedPx: 400, bucketSeconds: 60, extent });
    expect(w.from.toISOString()).toBe('2026-10-21T09:00:00.000Z');
    expect(w.to.toISOString()).toBe('2026-10-21T11:00:00.000Z');
  });

  it('snaps to the buckets of the extent, not to the epoch', () => {
    const odd = { from: at(10, 0, 20), to: at(10, 10, 20) };
    const w = pointerSelection({ downTime: at(10, 3, 0), upTime: at(10, 3, 0), movedPx: 0, bucketSeconds: 60, extent: odd });
    expect(w.from.toISOString()).toBe('2026-10-21T10:02:20.000Z');
    expect(w.to.toISOString()).toBe('2026-10-21T10:03:20.000Z');
  });

  it('a click outside the extent selects the nearest bucket', () => {
    const w = pointerSelection({ downTime: at(12, 0), upTime: at(12, 0), movedPx: 0, bucketSeconds: 60, extent });
    expect(w.from.toISOString()).toBe('2026-10-21T10:59:00.000Z');
    expect(w.to.toISOString()).toBe('2026-10-21T11:00:00.000Z');
  });

  it('a drag that ends on an edge keeps it', () => {
    const w = pointerSelection({ downTime: at(10, 1), upTime: at(10, 4), movedPx: 50, bucketSeconds: 60, extent });
    expect(w.from.toISOString()).toBe('2026-10-21T10:01:00.000Z');
    expect(w.to.toISOString()).toBe('2026-10-21T10:04:00.000Z');
  });
});

describe('buildHistogramOption', () => {
  const data = buckets(3, at(10, 0), 60);
  const option = buildHistogramOption({ buckets: data, bucketSeconds: 60, colors, formatAxis: (ms) => `t${ms}` });
  const series = option.series as Array<{
    name: string;
    type: string;
    stack: string;
    data: [number, number][];
    itemStyle: { color: string };
  }>;

  it('stacks the five levels in order with tone colours', () => {
    expect(series.map((s) => s.name)).toEqual(['Debug', 'Info', 'Warn', 'Error', 'Critical']);
    expect(series.every((s) => s.type === 'bar' && s.stack === 'level')).toBe(true);
    expect(series.map((s) => s.itemStyle.color)).toEqual(LOG_LEVELS.map((l) => levelTone(l).chart));
  });

  it('places each bar in the middle of its bucket with missing levels as zero', () => {
    const info = series[1].data;
    expect(info.map((p) => p[0])).toEqual([at(10, 0, 30), at(10, 1, 30), at(10, 2, 30)]);
    expect(info.map((p) => p[1])).toEqual([0, 1, 2]);
    expect(series[0].data.map((p) => p[1])).toEqual([0, 0, 0]);
  });

  it('uses a time axis over the whole extent with the given label format', () => {
    const xAxis = option.xAxis as { type: string; min: number; max: number; axisLabel: { formatter: (v: number) => string } };
    expect(xAxis.type).toBe('time');
    expect(xAxis.min).toBe(at(10, 0));
    expect(xAxis.max).toBe(at(10, 3));
    expect(xAxis.axisLabel.formatter(5)).toBe('t5');
  });

  it('formats tooltip counts in en-US', () => {
    const big = buildHistogramOption({
      buckets: [{ time: iso(at(10, 0)), total: 12345, byLevel: { error: 12345 } }],
      bucketSeconds: 60,
      colors,
      formatAxis: () => '10:00',
    });
    const tooltip = big.tooltip as { formatter: (p: unknown) => string };
    const params = LOG_LEVELS.map((l, i) => ({
      seriesName: ['Debug', 'Info', 'Warn', 'Error', 'Critical'][i],
      value: [at(10, 0, 30), l === 'error' ? 12345 : 0],
      color: colors[l],
    }));
    const html = tooltip.formatter(params);
    expect(html).toContain('12,345');
    expect(html).toContain('10:00');
  });

  it('builds an empty chart without buckets', () => {
    const empty = buildHistogramOption({ buckets: [], bucketSeconds: 60, colors, formatAxis: String });
    expect((empty.series as unknown[]).length).toBe(5);
  });
});
