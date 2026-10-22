import { describe, it, expect } from 'vitest';
import {
  pickBucketSeconds,
  histogramBucketCount,
  HISTOGRAM_BUCKET_LADDER_SECONDS,
  HISTOGRAM_TARGET_BUCKETS,
} from '../../../modules/query/explorer-params.js';

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function pick(rangeMs: number): number {
  const from = new Date('2026-10-01T00:00:00.000Z');
  return pickBucketSeconds(from, new Date(from.getTime() + rangeMs));
}

describe('pickBucketSeconds', () => {
  it('targets about 60 buckets on a fixed ladder', () => {
    expect(HISTOGRAM_TARGET_BUCKETS).toBe(60);
    expect(HISTOGRAM_BUCKET_LADDER_SECONDS[0]).toBe(1);
    expect(HISTOGRAM_BUCKET_LADDER_SECONDS[HISTOGRAM_BUCKET_LADDER_SECONDS.length - 1]).toBe(604800);
  });

  it.each([
    ['10 s', 10 * SECOND, 1],
    ['60 s', 60 * SECOND, 1],
    ['15 min', 15 * MINUTE, 15],
    ['1 h', HOUR, 60],
    ['6 h', 6 * HOUR, 300],
    ['12 h', 12 * HOUR, 600],
    ['24 h', DAY, 1800],
    ['7 d', 7 * DAY, 10800],
    ['30 d', 30 * DAY, 43200],
    ['2 years', 730 * DAY, 604800],
  ])('picks the bucket size for %s', (_label, rangeMs, expected) => {
    expect(pick(rangeMs)).toBe(expected);
  });

  it('picks the nearest step on a log scale', () => {
    // 7 min / 60 = 7 s per bucket: log(7/5) < log(10/7), so 5 wins
    expect(pick(7 * MINUTE)).toBe(5);
    // 8 min / 60 = 8 s per bucket: log(10/8) < log(8/5), so 10 wins
    expect(pick(8 * MINUTE)).toBe(10);
    // 3 h / 60 = 180 s per bucket: log(180/120) < log(300/180), so 120 wins
    expect(pick(3 * HOUR)).toBe(120);
  });

  it('always returns a ladder value', () => {
    for (const rangeMs of [1, 999, 7 * MINUTE, 3 * HOUR, 90 * DAY]) {
      expect(HISTOGRAM_BUCKET_LADDER_SECONDS).toContain(pick(rangeMs));
    }
  });

  it('throws a RangeError when to is not after from', () => {
    const at = new Date('2026-10-01T00:00:00.000Z');
    expect(() => pickBucketSeconds(at, at)).toThrow(RangeError);
    expect(() => pickBucketSeconds(at, new Date(at.getTime() - 1))).toThrow(RangeError);
  });
});

describe('histogramBucketCount', () => {
  it('counts epoch-aligned buckets including the one holding to', () => {
    const from = new Date('2026-10-01T10:00:00.000Z');
    expect(histogramBucketCount(from, new Date(from.getTime() + HOUR), 60)).toBe(61);
    expect(histogramBucketCount(from, new Date(from.getTime() + HOUR - 1), 60)).toBe(60);
    expect(histogramBucketCount(new Date(from.getTime() + 30 * SECOND), new Date(from.getTime() + 90 * SECOND), 60)).toBe(2);
  });
});
