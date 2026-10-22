import { describe, it, expect } from 'vitest';
import {
  pickAutoInterval,
  intervalSeconds,
  toRateSeries,
  expandAttributeFilters,
  capSeries,
  TooManyFilterValuesError,
} from '../../../modules/metrics/aggregate-options.js';

const H = 3600 * 1000;
const D = 24 * H;
const to = new Date('2026-01-01T00:00:00Z');
const from = (ms: number) => new Date(to.getTime() - ms);

describe('pickAutoInterval', () => {
  it('auto picks 1m for 1h', () => expect(pickAutoInterval(from(H), to)).toBe('1m'));
  it('5m for 6h', () => expect(pickAutoInterval(from(6 * H), to)).toBe('5m'));
  it('15m for 24h', () => expect(pickAutoInterval(from(24 * H), to)).toBe('15m'));
  it('1h for 7d', () => expect(pickAutoInterval(from(7 * D), to)).toBe('1h'));
  it('1d for 30d', () => expect(pickAutoInterval(from(30 * D), to)).toBe('1d'));
  it('1w for 2 years', () => expect(pickAutoInterval(from(730 * D), to)).toBe('1w'));
  it('handles a zero or inverted range', () => expect(pickAutoInterval(to, to)).toBe('1m'));
});

describe('intervalSeconds', () => {
  it('maps every interval', () => {
    expect(intervalSeconds('1m')).toBe(60);
    expect(intervalSeconds('1h')).toBe(3600);
    expect(intervalSeconds('1w')).toBe(604800);
  });
});

describe('toRateSeries', () => {
  const t = (i: number) => new Date(Date.UTC(2026, 0, 1, 0, i));

  it('rate omits first bucket', () => {
    const out = toRateSeries([
      { bucket: t(0), value: 100 },
      { bucket: t(1), value: 160 },
      { bucket: t(2), value: 280 },
    ], 60);
    expect(out).toHaveLength(2);
    expect(out.map((p) => p.value)).toEqual([1, 2]);
  });

  it('rate treats a drop as counter reset (no negative values)', () => {
    const out = toRateSeries([
      { bucket: t(0), value: 1000 },
      { bucket: t(1), value: 30 },
      { bucket: t(2), value: 90 },
    ], 60);
    expect(out.map((p) => p.value)).toEqual([0.5, 1]);
    expect(out.every((p) => p.value >= 0)).toBe(true);
  });

  it('rate computed per label group independently', () => {
    const a = { host: 'a' };
    const b = { host: 'b' };
    const out = toRateSeries([
      { bucket: t(0), value: 10, labels: a },
      { bucket: t(0), value: 1000, labels: b },
      { bucket: t(1), value: 70, labels: a },
      { bucket: t(1), value: 1120, labels: b },
    ], 60, { groupBy: ['host'] });
    expect(out).toHaveLength(2);
    expect(out.find((p) => p.labels?.host === 'a')!.value).toBe(1);
    expect(out.find((p) => p.labels?.host === 'b')!.value).toBe(2);
  });

  it('sums per-series rates into the requested group and never mixes series', () => {
    const a = { route: '/a', host: 'h1' };
    const b = { route: '/b', host: 'h1' };
    const out = toRateSeries([
      { bucket: t(0), value: 1000000, labels: a },
      { bucket: t(0), value: 50, labels: b },
      { bucket: t(1), value: 1000060, labels: a },
      { bucket: t(1), value: 110, labels: b },
    ], 60, { groupBy: [], now: new Date('2030-01-01') });
    expect(out).toHaveLength(1);
    expect(out[0].value).toBe(2);
    expect(out[0].labels).toBeUndefined();
  });

  it('divides by the real elapsed time across a missing bucket', () => {
    const out = toRateSeries([
      { bucket: t(0), value: 0 },
      { bucket: t(3), value: 180 },
    ], 60, { now: new Date('2030-01-01') });
    expect(out.map((p) => p.value)).toEqual([1]);
  });

  it('drops the still-open last bucket', () => {
    const out = toRateSeries([
      { bucket: t(0), value: 0 },
      { bucket: t(1), value: 60 },
      { bucket: t(2), value: 120 },
    ], 60, { now: new Date(Date.UTC(2026, 0, 1, 0, 2, 30)) });
    expect(out).toHaveLength(1);
  });

  it('returns nothing for a single bucket', () => {
    expect(toRateSeries([{ bucket: t(0), value: 5 }], 60)).toEqual([]);
  });
});

describe('expandAttributeFilters', () => {
  it('returns single combo for single values', () => {
    expect(expandAttributeFilters({ a: ['1'], b: ['2'] })).toEqual([{ a: '1', b: '2' }]);
  });

  it('returns one empty combo for no filters', () => {
    expect(expandAttributeFilters({})).toEqual([{}]);
  });

  it('product of two multi-value keys', () => {
    const out = expandAttributeFilters({ a: ['1', '2'], b: ['x', 'y', 'z'] });
    expect(out).toHaveLength(6);
    expect(out).toContainEqual({ a: '2', b: 'z' });
  });

  it('throws over 10 combos', () => {
    expect(() => expandAttributeFilters({ a: ['1', '2', '3'], b: ['1', '2', '3', '4'] })).toThrow(
      TooManyFilterValuesError,
    );
  });

  it('allows exactly 10 combos', () => {
    const vals = Array.from({ length: 10 }, (_, i) => String(i));
    expect(expandAttributeFilters({ a: vals })).toHaveLength(10);
  });
});

describe('capSeries', () => {
  it('keeps everything when under the cap', () => {
    const points = [{ bucket: new Date(0), value: 1, labels: { h: 'a' } }];
    expect(capSeries(points)).toEqual({ points, seriesTotal: 1, seriesShown: 1 });
  });

  it('capSeries keeps top 20 by max and reports totals', () => {
    const points = [];
    for (let i = 0; i < 30; i++) {
      points.push({ bucket: new Date(0), value: i, labels: { h: `h${i}` } });
      points.push({ bucket: new Date(60000), value: i / 2, labels: { h: `h${i}` } });
    }
    const out = capSeries(points);
    expect(out.seriesTotal).toBe(30);
    expect(out.seriesShown).toBe(20);
    const hosts = new Set(out.points.map((p) => p.labels!.h));
    expect(hosts.size).toBe(20);
    expect(hosts.has('h29')).toBe(true);
    expect(hosts.has('h0')).toBe(false);
    expect(out.points).toHaveLength(40);
  });
});
