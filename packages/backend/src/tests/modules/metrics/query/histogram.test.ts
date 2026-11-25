import { describe, it, expect } from 'vitest';
import {
  normalizeHistogram,
  histBucketsToSeries,
  diffHistogram,
  cumulativeToDelta,
  mergeHistograms,
  histogramQuantile,
  histogramScalar,
  dropOpenBuckets,
  histSeriesToScalar,
  mergeHistSeries,
  foldTopNHistograms,
  type Histogram,
  type HistSeries,
} from '../../../../modules/metrics/query/histogram.js';
import { applyDeltaRate } from '../../../../modules/metrics/query/series-fold.js';
import { effectiveTemporality, queryResultUnit, isHistogramType } from '../../../../modules/metrics/query/units.js';

const MIN = 60_000;
const h = (bounds: number[], counts: number[], sum = 0, count?: number): Histogram => ({
  bounds,
  counts,
  sum,
  count: count ?? counts.reduce((a, b) => a + b, 0),
});

describe('histogramQuantile', () => {
  it('interpolates linearly inside the bucket holding the rank', () => {
    // buckets: (-inf,10]=10, (10,20]=10, (20,+inf)=0 -> total 20
    const x = h([10, 20], [10, 10, 0]);
    expect(histogramQuantile(x, 0.5)).toBeCloseTo(10); // rank 10: end of first bucket
    expect(histogramQuantile(x, 0.75)).toBeCloseTo(15); // rank 15: half of second
    expect(histogramQuantile(x, 0.95)).toBeCloseTo(19);
    expect(histogramQuantile(x, 0.99)).toBeCloseTo(19.8);
  });

  it('uses 0 as the lower edge of the first bucket when bounds are positive', () => {
    const x = h([100, 200], [4, 0, 0]);
    expect(histogramQuantile(x, 0.5)).toBeCloseTo(50);
    expect(histogramQuantile(x, 0.25)).toBeCloseTo(25);
  });

  it('returns the bound of a first bucket whose bound is not positive', () => {
    expect(histogramQuantile(h([0, 1], [3, 1, 0]), 0.5)).toBe(0);
    expect(histogramQuantile(h([-5, 1], [3, 1, 0]), 0.5)).toBe(-5);
  });

  it('the +Inf bucket returns the last finite bound', () => {
    const x = h([1, 2, 5], [1, 1, 1, 7]);
    expect(histogramQuantile(x, 0.5)).toBe(5);
    expect(histogramQuantile(x, 0.99)).toBe(5);
    // rank inside a finite bucket still interpolates
    expect(histogramQuantile(x, 0.25)).toBeCloseTo(2 + 3 * 0.5);
  });

  it('skips empty buckets', () => {
    const x = h([1, 2, 4, 8], [0, 0, 2, 2, 0]);
    expect(histogramQuantile(x, 0.5)).toBeCloseTo(4);
    expect(histogramQuantile(x, 0.75)).toBeCloseTo(6);
  });

  it('is null for an empty histogram and the mean without bounds', () => {
    expect(histogramQuantile(h([1, 2], [0, 0, 0]), 0.5)).toBeNull();
    expect(histogramQuantile(h([], [4], 20), 0.9)).toBe(5);
  });

  it('clamps q', () => {
    const x = h([10], [2, 0]);
    expect(histogramQuantile(x, 2)).toBeCloseTo(10);
    expect(histogramQuantile(x, -1)).toBeCloseTo(0);
  });
});

describe('histogramScalar', () => {
  const x = h([10, 20], [10, 10, 0], 300, 20);
  it('maps each aggregation', () => {
    expect(histogramScalar(x, 'p50')).toBeCloseTo(10);
    expect(histogramScalar(x, 'p95')).toBeCloseTo(19);
    expect(histogramScalar(x, 'p99')).toBeCloseTo(19.8);
    expect(histogramScalar(x, 'avg')).toBe(15);
    expect(histogramScalar(x, 'count')).toBe(20);
    expect(histogramScalar(x, 'sum')).toBe(300);
    expect(histogramScalar(x, 'rate', 60)).toBeCloseTo(20 / 60);
    // min / max / last fall back to avg
    expect(histogramScalar(x, 'min')).toBe(15);
    expect(histogramScalar(x, 'max')).toBe(15);
    expect(histogramScalar(x, 'last')).toBe(15);
  });

  it('nulls', () => {
    expect(histogramScalar(null, 'p95')).toBeNull();
    expect(histogramScalar(x, 'rate', null)).toBeNull();
    expect(histogramScalar(x, 'rate', 0)).toBeNull();
    expect(histogramScalar(h([1], [0, 0], 0, 0), 'avg')).toBeNull();
    expect(histogramScalar(h([1], [0, 0], 0, 0), 'count')).toBe(0);
  });
});

describe('diffHistogram (cumulative snapshots)', () => {
  it('subtracts bucket by bucket', () => {
    expect(diffHistogram(h([1, 2], [1, 2, 3], 10), h([1, 2], [2, 4, 3], 25))).toEqual(h([1, 2], [1, 2, 0], 15, 3));
  });

  it('a count decrease is a reset: the new snapshot is the delta', () => {
    const cur = h([1, 2], [1, 0, 0], 1);
    expect(diffHistogram(h([1, 2], [5, 5, 5], 50), cur)).toBe(cur);
  });

  it('a bucket decrease is a reset even when the count grows', () => {
    const cur = h([1, 2], [0, 10, 10], 40);
    expect(diffHistogram(h([1, 2], [5, 1, 1], 9), cur)).toBe(cur);
  });

  it('changed bounds are a reset', () => {
    const cur = h([1, 5], [3, 3, 3], 9);
    expect(diffHistogram(h([1, 2], [1, 1, 1], 3), cur)).toBe(cur);
    expect(diffHistogram(h([1], [1, 1], 3), cur)).toBe(cur);
  });
});

describe('cumulativeToDelta', () => {
  const grid = [0, MIN, 2 * MIN, 3 * MIN, 4 * MIN];
  it('drops the first snapshot, diffs the rest, handles gaps and resets', () => {
    const s: HistSeries = {
      labels: { a: '1' },
      values: [h([1], [1, 0], 1), h([1], [3, 0], 3), null, h([1], [6, 1], 9), h([1], [1, 0], 1)],
      seconds: [60, 60, null, 60, 60],
    };
    const [out] = cumulativeToDelta([s], grid);
    expect(out.values[0]).toBeNull();
    expect(out.values[1]).toEqual(h([1], [2, 0], 2));
    expect(out.values[2]).toBeNull();
    // gap: delta since minute 1, covers 120 s
    expect(out.values[3]).toEqual(h([1], [3, 1], 6));
    expect(out.seconds[3]).toBe(120);
    // reset at minute 4
    expect(out.values[4]).toEqual(h([1], [1, 0], 1));
    expect(out.seconds[4]).toBe(60);
    expect(out.labels).toEqual({ a: '1' });
  });
});

describe('mergeHistograms', () => {
  it('adds counts, sums and counts with equal bounds', () => {
    expect(mergeHistograms([h([1, 2], [1, 2, 3], 5), h([1, 2], [1, 1, 1], 4)])).toEqual(h([1, 2], [2, 3, 4], 9));
  });

  it('merges different bounds into the union by upper bound', () => {
    const merged = mergeHistograms([h([1, 5], [1, 2, 3], 10), h([2, 5, 10], [4, 5, 6, 7], 20)])!;
    expect(merged.bounds).toEqual([1, 2, 5, 10]);
    // a: <=1:1 -> [0], <=5:2 -> [2], inf:3 -> [4]; b: <=2:4 -> [1], <=5:5 -> [2], <=10:6 -> [3], inf:7 -> [4]
    expect(merged.counts).toEqual([1, 4, 7, 6, 10]);
    expect(merged.sum).toBe(30);
    expect(merged.count).toBe(28);
  });

  it('ignores nulls and returns null for nothing', () => {
    expect(mergeHistograms([null, undefined])).toBeNull();
    const one = h([1], [1, 1], 2);
    const copy = mergeHistograms([null, one])!;
    expect(copy).toEqual(one);
    expect(copy).not.toBe(one);
  });

  it('a percentile of the merge reflects both inputs', () => {
    // 10 fast requests (<=0.1) on one host, 10 slow ones (0.5, 1] on another
    const merged = mergeHistograms([h([0.1, 0.5, 1], [10, 0, 0, 0]), h([0.1, 0.5, 1], [0, 0, 10, 0])])!;
    expect(histogramQuantile(merged, 0.5)).toBeCloseTo(0.1);
    expect(histogramQuantile(merged, 0.75)).toBeCloseTo(0.75);
  });
});

describe('normalizeHistogram and histBucketsToSeries', () => {
  it('rejects malformed histograms', () => {
    expect(normalizeHistogram(undefined)).toBeNull();
    expect(normalizeHistogram({ bounds: [1], counts: [1], sum: 0, count: 1 })).toBeNull();
    expect(normalizeHistogram({ bounds: [2, 1], counts: [1, 1, 1], sum: 0, count: 3 })).toBeNull();
    expect(normalizeHistogram({ bounds: [NaN], counts: [1, 1], sum: 0, count: 2 })).toBeNull();
  });

  it('cleans counts and fills a missing count', () => {
    expect(normalizeHistogram({ bounds: [1], counts: [2, -1], sum: NaN, count: NaN as never })).toEqual(h([1], [2, 0], 0, 2));
  });

  it('places histograms on the grid per label set', () => {
    const grid = [0, MIN, 2 * MIN];
    const series = histBucketsToSeries(
      [
        { bucket: new Date(0), value: 2, labels: { x: 'a' }, histogram: h([1], [1, 1]) },
        { bucket: new Date(MIN), value: 2, labels: { x: 'a' }, histogram: h([1], [2, 0]) },
        { bucket: new Date(MIN), value: 1, labels: { x: 'b' } },
        { bucket: new Date(10 * MIN), value: 1, labels: { x: 'b' }, histogram: h([1], [1, 0]) },
      ],
      grid,
      MIN,
    );
    expect(series).toHaveLength(2);
    expect(series[0].values).toEqual([h([1], [1, 1]), h([1], [2, 0]), null]);
    expect(series[0].seconds).toEqual([60, 60, null]);
    expect(series[1].values).toEqual([null, null, null]);
  });

  it('applies the compare shift', () => {
    const series = histBucketsToSeries([{ bucket: new Date(0), value: 1, histogram: h([1], [1, 0]) }], [MIN], MIN, MIN);
    expect(series[0].values[0]).toEqual(h([1], [1, 0]));
  });
});

describe('series level helpers', () => {
  const grid = [0, MIN, 2 * MIN];
  const s = (labels: Record<string, string>, values: Array<Histogram | null>): HistSeries => ({
    labels,
    values,
    seconds: values.map((v) => (v ? 60 : null)),
  });

  it('dropOpenBuckets removes buckets ending after openAfter', () => {
    const [out] = dropOpenBuckets([s({}, [h([1], [1, 0]), h([1], [1, 0]), h([1], [1, 0])])], grid, MIN, 2 * MIN);
    expect(out.values.map((v) => v !== null)).toEqual([true, true, false]);
    expect(out.seconds).toEqual([60, 60, null]);
  });

  it('histSeriesToScalar computes per-series rates', () => {
    const [out] = histSeriesToScalar([s({ a: '1' }, [h([1], [30, 30]), null, null])], 'rate');
    expect(out.values).toEqual([1, null, null]);
  });

  it('mergeHistSeries merges members of the same group', () => {
    const out = mergeHistSeries(
      [
        s({ host: 'a', cpu: '0' }, [h([1], [1, 0]), null, null]),
        s({ host: 'a', cpu: '1' }, [h([1], [0, 1]), h([1], [1, 0]), null]),
        s({ host: 'b', cpu: '0' }, [h([1], [5, 0]), null, null]),
      ],
      ['host'],
      3,
    );
    expect(out).toHaveLength(2);
    expect(out[0].labels).toEqual({ host: 'a' });
    expect(out[0].values[0]).toEqual(h([1], [1, 1]));
    expect(out[0].values[1]).toEqual(h([1], [1, 0]));
    expect(out[0].values[2]).toBeNull();
    expect(out[1].values[0]).toEqual(h([1], [5, 0]));
  });

  it('foldTopNHistograms keeps the highest groups and merges the rest before the percentile', () => {
    const groups = [
      s({ route: '/a' }, [h([1, 10], [10, 0, 0]), null, null]), // p50 0.5
      s({ route: '/b' }, [h([1, 10], [0, 10, 0]), null, null]), // p50 5.5
      s({ route: '/c' }, [h([1, 10], [0, 0, 10]), null, null]), // p50 10 (+Inf)
    ];
    const res = foldTopNHistograms(groups, 1, 'p50', 3);
    expect(res.seriesTotal).toBe(3);
    expect(res.seriesShown).toBe(1);
    expect(res.series[0].labels).toEqual({ route: '/c' });
    expect(res.series[0].values[0]).toBe(10);
    expect(res.series[1].labels).toEqual({ __other__: 'true' });
    // merged /a + /b: 20 values, rank 10 ends the first bucket -> 1
    expect(res.series[1].values[0]).toBeCloseTo(1);

    const all = foldTopNHistograms(groups, 5, 'count', 3);
    expect(all.series.map((g) => g.values[0])).toEqual([10, 10, 10]);
    expect(all.seriesShown).toBe(3);
  });
});

describe('temporality and units', () => {
  it('effectiveTemporality', () => {
    expect(effectiveTemporality(undefined)).toBeNull();
    expect(effectiveTemporality({ unit: null, type: 'sum', temporality: 'delta', isMonotonic: true })).toBe('delta');
    expect(effectiveTemporality({ unit: null, type: 'sum', isMonotonic: true })).toBe('cumulative');
    // Without a temporality only an explicit delta is delta (fix item 14).
    expect(effectiveTemporality({ unit: null, type: 'sum', isMonotonic: false })).toBe('cumulative');
    expect(effectiveTemporality({ unit: null, type: 'sum', isMonotonic: null })).toBe('cumulative');
    expect(effectiveTemporality({ unit: null, type: 'histogram' })).toBe('cumulative');
    expect(effectiveTemporality({ unit: null, type: 'exp_histogram', temporality: 'delta' })).toBe('delta');
    expect(effectiveTemporality({ unit: null, type: 'gauge' })).toBeNull();
  });

  it('queryResultUnit', () => {
    const dur = { unit: 's', type: 'histogram' };
    expect(queryResultUnit(dur, 'p95')).toBe('s');
    expect(queryResultUnit(dur, 'avg')).toBe('s');
    expect(queryResultUnit(dur, 'count')).toBeNull();
    expect(queryResultUnit(dur, 'rate')).toBe('{count}/s');
    expect(queryResultUnit({ unit: 'By', type: 'sum' }, 'rate')).toBe('By');
    expect(queryResultUnit(undefined, 'avg')).toBeNull();
    expect(isHistogramType('exp_histogram')).toBe(true);
    expect(isHistogramType('summary')).toBe(false);
  });

  it('applyDeltaRate divides bucket sums by the bucket seconds and drops open buckets', () => {
    const out = applyDeltaRate([{ labels: {}, values: [120, null, 60] }], [0, MIN, 2 * MIN], MIN, 2 * MIN);
    expect(out[0].values).toEqual([2, null, null]);
  });
});
