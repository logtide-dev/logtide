import { describe, it, expect } from 'vitest';
import {
  transformOtlpToMetrics,
  parseOtlpMetricsJson,
  expToCanonicalBuckets,
  ExpHistogramTooLargeError,
  EXP_MAX_BUCKETS_PER_SIDE,
  EXP_CANONICAL_BOUNDS,
  EXP_GRID_ID,
  EXP_CANONICAL_SCALE,
  EXP_GRID_MIN_INDEX,
  EXP_GRID_MAX_INDEX,
  toTemporality,
  type OtlpExportMetricsRequest,
} from '../../../modules/otlp/metric-transformer.js';
import { histogramQuantile, normalizeHistogram } from '../../../modules/metrics/query/histogram.js';
import { histogramGridBounds } from '../../../modules/otlp/exp-histogram-grid.js';

const NANOS = '1705312200000000000';

function req(metric: Record<string, unknown>): OtlpExportMetricsRequest {
  return {
    resourceMetrics: [
      {
        resource: { attributes: [{ key: 'service.name', value: { stringValue: 'svc' } }] },
        scopeMetrics: [{ metrics: [metric as never] }],
      },
    ],
  };
}

describe('toTemporality', () => {
  it('maps OTLP enum values', () => {
    expect(toTemporality(1)).toBe('delta');
    expect(toTemporality(2)).toBe('cumulative');
    expect(toTemporality('AGGREGATION_TEMPORALITY_DELTA')).toBe('delta');
    expect(toTemporality('AGGREGATION_TEMPORALITY_CUMULATIVE')).toBe('cumulative');
    expect(toTemporality(0)).toBeUndefined();
    expect(toTemporality(undefined)).toBeUndefined();
    expect(toTemporality(7)).toBeUndefined();
  });
});

describe('temporality on records', () => {
  it('sums carry delta / cumulative / nothing', () => {
    for (const [t, expected] of [
      [1, 'delta'],
      [2, 'cumulative'],
      [0, undefined],
    ] as const) {
      const [r] = transformOtlpToMetrics(
        req({ name: 's', sum: { aggregationTemporality: t, isMonotonic: true, dataPoints: [{ timeUnixNano: NANOS, asInt: '3' }] } })
      );
      expect(r.temporality).toBe(expected);
    }
  });

  it('histograms and exponential histograms carry temporality', () => {
    const [h] = transformOtlpToMetrics(
      req({
        name: 'h',
        histogram: {
          aggregationTemporality: 1,
          dataPoints: [{ timeUnixNano: NANOS, count: '2', sum: 3, bucketCounts: ['1', '1'], explicitBounds: [1] }],
        },
      })
    );
    expect(h.temporality).toBe('delta');
    const [e] = transformOtlpToMetrics(
      req({
        name: 'e',
        exponentialHistogram: {
          aggregationTemporality: 2,
          dataPoints: [{ timeUnixNano: NANOS, count: '1', sum: 1, scale: 0, positive: { offset: 0, bucketCounts: ['1'] } }],
        },
      })
    );
    expect(e.temporality).toBe('cumulative');
  });

  it('gauges and summaries have no temporality', () => {
    const [g] = transformOtlpToMetrics(req({ name: 'g', gauge: { dataPoints: [{ timeUnixNano: NANOS, asDouble: 1 }] } }));
    expect(g.temporality).toBeUndefined();
    const [s] = transformOtlpToMetrics(req({ name: 's', summary: { dataPoints: [{ timeUnixNano: NANOS, count: '1', sum: 1 }] } }));
    expect(s.temporality).toBeUndefined();
  });

  it('snake_case JSON keeps the temporality', () => {
    const parsed = parseOtlpMetricsJson({
      resource_metrics: [
        {
          scope_metrics: [
            {
              metrics: [
                {
                  name: 'h',
                  histogram: {
                    aggregation_temporality: 2,
                    data_points: [{ time_unix_nano: NANOS, count: 1, sum: 1, bucket_counts: [1, 0], explicit_bounds: [5] }],
                  },
                },
                {
                  name: 'e',
                  exponential_histogram: {
                    aggregation_temporality: 1,
                    data_points: [{ time_unix_nano: NANOS, count: 1, sum: 1, scale: 0, positive: { offset: 0, bucket_counts: [1] } }],
                  },
                },
              ],
            },
          ],
        },
      ],
    });
    const records = transformOtlpToMetrics(parsed);
    expect(records.map((r) => r.temporality)).toEqual(['cumulative', 'delta']);
    expect(records[1].histogramData?.grid).toBe(EXP_GRID_ID);
    expect(records[1].histogramData?.explicit_bounds).toBeUndefined();
  });
});

describe('expToCanonicalBuckets (canonical grid)', () => {
  const SLOTS = EXP_CANONICAL_BOUNDS.length + 1;
  /** bucket_counts position of canonical bucket index i. */
  const slot = (i: number) => 2 + i - EXP_GRID_MIN_INDEX;
  /** A full counts array with the given non-zero slots. */
  const countsWith = (entries: Record<number, number>) => {
    const out = new Array<number>(SLOTS).fill(0);
    for (const [k, v] of Object.entries(entries)) out[Number(k)] = v;
    return out;
  };
  const total = (counts: number[]) => counts.reduce((a, b) => a + b, 0);

  it('the grid: 0, then 2^(i/4) from 2^-20 to 2^40, strictly increasing', () => {
    expect(EXP_CANONICAL_SCALE).toBe(2);
    expect(EXP_GRID_MIN_INDEX).toBe(-80);
    expect(EXP_GRID_MAX_INDEX).toBe(159);
    expect(EXP_CANONICAL_BOUNDS).toHaveLength(242);
    expect(EXP_CANONICAL_BOUNDS[0]).toBe(0);
    expect(EXP_CANONICAL_BOUNDS[1]).toBe(2 ** -20);
    expect(EXP_CANONICAL_BOUNDS[EXP_CANONICAL_BOUNDS.length - 1]).toBe(2 ** 40);
    // Bucket index 0 holds (1, 2^(1/4)]: its upper bound sits at slot(0).
    expect(EXP_CANONICAL_BOUNDS[slot(0) - 1]).toBe(1);
    expect(EXP_CANONICAL_BOUNDS[slot(0)]).toBeCloseTo(2 ** 0.25, 15);
    for (let i = 2; i < EXP_CANONICAL_BOUNDS.length; i++) {
      expect(EXP_CANONICAL_BOUNDS[i] / EXP_CANONICAL_BOUNDS[i - 1]).toBeCloseTo(2 ** 0.25, 12);
    }
    // Every 4th bound is an exact power of two.
    for (let k = -20; k <= 40; k++) expect(EXP_CANONICAL_BOUNDS).toContain(2 ** k);
    expect(Object.isFrozen(EXP_CANONICAL_BOUNDS)).toBe(true);
  });

  it('every point gets the same bounds whatever its scale, offset or range', () => {
    const points = [
      {},
      { scale: 0, positive: { offset: 1, bucketCounts: [1, 2, 3] } },
      { scale: 0, positive: { offset: 7, bucketCounts: [4, 0, 0, 0] } },
      { scale: 5, positive: { offset: -40, bucketCounts: [1] } },
      { scale: -3, zeroCount: 2, negative: { offset: 0, bucketCounts: [1] } },
      { scale: 20, positive: { offset: 123456, bucketCounts: [9] } },
    ];
    for (const p of points) {
      const r = expToCanonicalBuckets(p);
      expect(r.grid).toBe(EXP_GRID_ID);
      expect(r).not.toHaveProperty('explicit_bounds');
      expect(r.bucket_counts).toHaveLength(SLOTS);
    }
    // The grid id names exactly these bounds.
    expect(histogramGridBounds(EXP_GRID_ID)).toBe(EXP_CANONICAL_BOUNDS);
    expect(histogramGridBounds('nope')).toBeUndefined();
  });

  it('scale 2 maps index to index', () => {
    expect(expToCanonicalBuckets({ scale: 2, positive: { offset: 1, bucketCounts: [1, 2, 3] } }).bucket_counts).toEqual(
      countsWith({ [slot(1)]: 1, [slot(2)]: 2, [slot(3)]: 3 }),
    );
  });

  it('finer scales downscale exactly (negative indices floor)', () => {
    // scale 4: width 4, indices -5..-1 -> canonical -2, -1, -1, -1, -1
    expect(expToCanonicalBuckets({ scale: 4, positive: { offset: -5, bucketCounts: [1, 1, 1, 1, 1] } }).bucket_counts).toEqual(
      countsWith({ [slot(-2)]: 1, [slot(-1)]: 4 }),
    );
    // scale 3: indices 1, 2, 3 -> canonical 0, 1, 1
    expect(expToCanonicalBuckets({ scale: 3, positive: { offset: 1, bucketCounts: ['10', '20', '30'] } }).bucket_counts).toEqual(
      countsWith({ [slot(0)]: 10, [slot(1)]: 50 }),
    );
  });

  it('a finer source bucket never straddles a canonical bound', () => {
    // scale 6, index 37: (2^(37/64), 2^(38/64)] inside canonical floor(37/16) = 2.
    const r = expToCanonicalBuckets({ scale: 6, positive: { offset: 37, bucketCounts: [5] } });
    expect(r.bucket_counts).toEqual(countsWith({ [slot(2)]: 5 }));
    expect(EXP_CANONICAL_BOUNDS[slot(2) - 1]).toBeLessThanOrEqual(2 ** (37 / 64));
    expect(EXP_CANONICAL_BOUNDS[slot(2)]).toBeGreaterThanOrEqual(2 ** (38 / 64));
  });

  it('coarser scales split a bucket evenly across its canonical sub-buckets', () => {
    // scale 0, index 1 = (2, 4] -> canonical 4..7, 5 split as 2, 1, 1, 1
    expect(expToCanonicalBuckets({ scale: 0, positive: { offset: 1, bucketCounts: [5] } }).bucket_counts).toEqual(
      countsWith({ [slot(4)]: 2, [slot(5)]: 1, [slot(6)]: 1, [slot(7)]: 1 }),
    );
    // scale 1, indices -1, 0 -> canonical -2..-1 and 0..1
    expect(expToCanonicalBuckets({ scale: 1, positive: { offset: -1, bucketCounts: [3, 4] } }).bucket_counts).toEqual(
      countsWith({ [slot(-2)]: 2, [slot(-1)]: 1, [slot(0)]: 2, [slot(1)]: 2 }),
    );
  });

  it('the split adds up to the count and never decreases when the count grows', () => {
    for (const scale of [1, 0, -1]) {
      let prev: number[] | null = null;
      for (let c = 0; c <= 40; c++) {
        const counts = expToCanonicalBuckets({ scale, positive: { offset: 2, bucketCounts: [c] } }).bucket_counts;
        expect(total(counts)).toBe(c);
        if (prev) for (let i = 0; i < counts.length; i++) expect(counts[i]).toBeGreaterThanOrEqual(prev[i]);
        prev = counts;
      }
    }
  });

  it('non-integer counts split as fractions', () => {
    const r = expToCanonicalBuckets({ scale: 1, positive: { offset: 0, bucketCounts: [3] } });
    expect(r.bucket_counts[slot(0)]).toBe(2);
    const f = expToCanonicalBuckets({ scale: 1, positive: { offset: 0, bucketCounts: [2.5] } });
    expect(f.bucket_counts[slot(0)]).toBe(1.25);
    expect(f.bucket_counts[slot(1)]).toBe(1.25);
  });

  it('values below / above the grid land in the underflow / overflow buckets', () => {
    expect(expToCanonicalBuckets({ scale: 2, positive: { offset: -100, bucketCounts: [7] } }).bucket_counts).toEqual(
      countsWith({ 1: 7 }),
    );
    expect(expToCanonicalBuckets({ scale: 2, positive: { offset: 160, bucketCounts: [3] } }).bucket_counts).toEqual(
      countsWith({ [SLOTS - 1]: 3 }),
    );
    // The edges of the grid are still inside it.
    expect(expToCanonicalBuckets({ scale: 2, positive: { offset: -80, bucketCounts: [1] } }).bucket_counts).toEqual(
      countsWith({ [slot(-80)]: 1 }),
    );
    expect(expToCanonicalBuckets({ scale: 2, positive: { offset: 159, bucketCounts: [1] } }).bucket_counts).toEqual(
      countsWith({ [slot(159)]: 1 }),
    );
    // A coarse bucket straddling the top edge: part inside, part overflow.
    // scale 0, index 39 = (2^39, 2^40] -> canonical 156..159 (inside);
    // index 40 -> 160..163 (overflow).
    expect(expToCanonicalBuckets({ scale: 0, positive: { offset: 39, bucketCounts: [4, 4] } }).bucket_counts).toEqual(
      countsWith({ [slot(156)]: 1, [slot(157)]: 1, [slot(158)]: 1, [slot(159)]: 1, [SLOTS - 1]: 4 }),
    );
  });

  it('the coarsest scale (-10) stays bounded and exact in total', () => {
    const r = expToCanonicalBuckets({ scale: -10, positive: { offset: 0, bucketCounts: [1, 3] } });
    // index 0 -> canonical 0..4095: the single observation goes to the first;
    // index 1 -> 4096.. (all above the grid).
    expect(r.bucket_counts).toEqual(countsWith({ [slot(0)]: 1, [SLOTS - 1]: 3 }));
    // Scales outside -10..20 are clamped.
    expect(expToCanonicalBuckets({ scale: -30, positive: { offset: 0, bucketCounts: [1] } }).bucket_counts).toEqual(r.bucket_counts.map((c, i) => (i === SLOTS - 1 ? 0 : c)));
    expect(expToCanonicalBuckets({ scale: 25, positive: { offset: 1 << 18, bucketCounts: [2] } }).bucket_counts).toEqual(
      countsWith({ [slot(1)]: 2 }),
    );
  });

  it('zero_count and the negative buckets fold into (-Inf, 0]', () => {
    expect(
      expToCanonicalBuckets({
        scale: 0,
        zeroCount: '3',
        negative: { offset: 0, bucketCounts: [4, '1'] },
        positive: { offset: 0, bucketCounts: [2] },
      }).bucket_counts,
    ).toEqual(countsWith({ 0: 8, [slot(0)]: 1, [slot(1)]: 1, [slot(2)]: 0, [slot(3)]: 0 }));
    expect(expToCanonicalBuckets({ scale: 3, zeroCount: 6 }).bucket_counts).toEqual(countsWith({ 0: 6 }));
  });

  it('an empty point keeps the full grid with zero counts', () => {
    expect(expToCanonicalBuckets({ scale: 3 })).toEqual({
      grid: EXP_GRID_ID,
      bucket_counts: new Array(SLOTS).fill(0),
    });
  });

  it('missing scale and offset default to 0, string counts are parsed', () => {
    expect(expToCanonicalBuckets({ positive: { bucketCounts: ['2'] } }).bucket_counts).toEqual(
      countsWith({ [slot(0)]: 1, [slot(1)]: 1, [slot(2)]: 0, [slot(3)]: 0 }),
    );
  });

  it('total counts are preserved', () => {
    const r = expToCanonicalBuckets({
      scale: 1,
      zeroCount: 2,
      negative: { offset: -3, bucketCounts: [1, 1] },
      positive: { offset: -50, bucketCounts: [3, 0, 7, 11, 13] },
    });
    expect(total(r.bucket_counts)).toBe(2 + 2 + 3 + 7 + 11 + 13);
  });

  it('percentiles over the converted buckets stay within the grid precision', () => {
    // Deterministic log-spread samples from 0.001 to 1000, recorded into an
    // exponential histogram at scale 5, converted, then read back.
    const values: number[] = [];
    let seed = 7;
    for (let i = 0; i < 5000; i++) {
      seed = (seed * 48271) % 2147483647;
      values.push(10 ** (-3 + 6 * (seed / 2147483647)));
    }
    values.sort((a, b) => a - b);
    const scale = 5;
    const indexOf = (v: number) => Math.ceil(Math.log2(v) * 2 ** scale) - 1;
    const indices = values.map(indexOf);
    const offset = Math.min(...indices);
    const bucketCounts = new Array<number>(Math.max(...indices) - offset + 1).fill(0);
    for (const i of indices) bucketCounts[i - offset]++;
    const { grid, bucket_counts } = expToCanonicalBuckets({ scale, positive: { offset, bucketCounts } });
    // As the engines return it (grid id, no bounds), expanded by the query side.
    const h = normalizeHistogram({ bounds: [], grid, counts: bucket_counts, sum: values.reduce((a, b) => a + b, 0), count: values.length })!;
    expect(h.bounds).toEqual([...EXP_CANONICAL_BOUNDS]);
    for (const q of [0.5, 0.95, 0.99]) {
      const truth = values[Math.ceil(q * values.length) - 1];
      const got = histogramQuantile(h, q) as number;
      expect(Math.abs(got - truth) / truth).toBeLessThan(2 ** 0.25 - 1);
    }
  });

  it('the transformer stores the grid id and counts next to the exponential fields', () => {
    const [r] = transformOtlpToMetrics(
      req({
        name: 'e',
        exponentialHistogram: {
          dataPoints: [{ timeUnixNano: NANOS, count: '3', sum: 6, scale: 2, zeroCount: '1', positive: { offset: 1, bucketCounts: ['2'] } }],
        },
      })
    );
    expect(r.histogramData?.explicit_bounds).toBeUndefined();
    expect(r.histogramData).toMatchObject({
      grid: EXP_GRID_ID,
      bucket_counts: countsWith({ 0: 1, [slot(1)]: 2 }),
      scale: 2,
      zero_count: 1,
      positive: { offset: 1, bucket_counts: [2] },
    });
  });

  it('points of one series share the grid even when their populated range moves', () => {
    const records = transformOtlpToMetrics(
      req({
        name: 'e',
        exponentialHistogram: {
          aggregationTemporality: 2,
          dataPoints: [
            { timeUnixNano: NANOS, count: '1', sum: 1, scale: 3, positive: { offset: 0, bucketCounts: ['1'] } },
            { timeUnixNano: NANOS, count: '3', sum: 90, scale: 3, positive: { offset: 0, bucketCounts: ['1', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0', '2'] } },
            { timeUnixNano: NANOS, count: '4', sum: 91, scale: 2, zeroCount: '1', positive: { offset: 0, bucketCounts: ['1'] } },
          ],
        },
      })
    );
    expect(records.map((r) => r.histogramData?.grid)).toEqual([EXP_GRID_ID, EXP_GRID_ID, EXP_GRID_ID]);
    expect(records.every((r) => r.histogramData?.bucket_counts?.length === SLOTS)).toBe(true);
  });
});

describe('expToCanonicalBuckets bounded work (coarse scales, huge arrays)', () => {
  const SLOTS = EXP_CANONICAL_BOUNDS.length + 1;
  const slotOf = (index: number) =>
    index < EXP_GRID_MIN_INDEX ? 1 : index > EXP_GRID_MAX_INDEX ? EXP_CANONICAL_BOUNDS.length : 2 + index - EXP_GRID_MIN_INDEX;

  /** The plain per-sub-bucket split (the definition), for comparison. */
  function bruteForce(scale: number, offset: number, bucketCounts: number[]): number[] {
    const counts = new Array<number>(SLOTS).fill(0);
    const n = 2 ** (EXP_CANONICAL_SCALE - scale);
    bucketCounts.forEach((c, j) => {
      if (!(c > 0)) return;
      for (let k = 0; k < n; k++) {
        const part = Number.isInteger(c) ? Math.max(Math.ceil((c - k) / n), 0) : c / n;
        if (part !== 0) counts[slotOf((offset + j) * n + k)] += part;
      }
    });
    return counts;
  }

  it('matches the per-sub-bucket split at every coarse scale, edges included', () => {
    let seed = 11;
    const rand = (m: number) => {
      seed = (seed * 48271) % 2147483647;
      return seed % m;
    };
    for (const scale of [1, 0, -1, -3, -6, -10]) {
      const n = 2 ** (EXP_CANONICAL_SCALE - scale);
      // Offsets around both grid edges and inside it.
      const offsets = [
        Math.floor(EXP_GRID_MIN_INDEX / n) - 2,
        Math.floor(EXP_GRID_MIN_INDEX / n),
        Math.floor(EXP_GRID_MAX_INDEX / n) - 1,
        Math.floor(EXP_GRID_MAX_INDEX / n),
        -1,
        0,
      ];
      for (const offset of offsets) {
        const bucketCounts = Array.from({ length: 6 }, () => rand(3 * n + 7));
        bucketCounts.push(2.5, 0);
        const got = expToCanonicalBuckets({ scale, positive: { offset, bucketCounts } }).bucket_counts;
        const want = bruteForce(scale, offset, bucketCounts);
        got.forEach((v, i) => expect(v, `scale ${scale} offset ${offset} slot ${i}`).toBeCloseTo(want[i], 9));
      }
    }
  });

  it('a scale -10 bucket straddling the top edge splits in closed form', () => {
    // index 0 at scale -10 = canonical 0..4095: 160 slots inside, 3936 above.
    const c = 4096 * 3 + 100; // q = 3, r = 100: the first 100 sub-buckets get 4
    const counts = expToCanonicalBuckets({ scale: -10, positive: { offset: 0, bucketCounts: [c] } }).bucket_counts;
    for (let i = 0; i <= EXP_GRID_MAX_INDEX; i++) expect(counts[slotOf(i)]).toBe(i < 100 ? 4 : 3);
    expect(counts[SLOTS - 1]).toBe(c - (100 * 4 + 60 * 3));
    expect(counts.reduce((a, b) => a + b, 0)).toBe(c);
  });

  it('a scale -10 bucket straddling the bottom edge splits in closed form', () => {
    // index -1 at scale -10 = canonical -4096..-1: the last 80 sub-buckets are inside.
    const c = 4096 * 2 + 4050; // q = 2, r = 4050: sub-buckets 0..4049 get 3
    const counts = expToCanonicalBuckets({ scale: -10, positive: { offset: -1, bucketCounts: [c] } }).bucket_counts;
    for (let i = EXP_GRID_MIN_INDEX; i < 0; i++) {
      const k = i + 4096;
      expect(counts[slotOf(i)]).toBe(k < 4050 ? 3 : 2);
    }
    expect(counts.reduce((a, b) => a + b, 0)).toBe(c);
    expect(counts[1]).toBe(c - (34 * 3 + 46 * 2));
  });

  it('scale -10 with the largest accepted bucket arrays stays fast', () => {
    const big = new Array<number>(EXP_MAX_BUCKETS_PER_SIDE).fill(1_000_007);
    const start = performance.now();
    for (const offset of [-EXP_MAX_BUCKETS_PER_SIDE + 1, -EXP_MAX_BUCKETS_PER_SIDE / 2, 0, 2 ** 20]) {
      const r = expToCanonicalBuckets({
        scale: -10,
        positive: { offset, bucketCounts: big },
        negative: { offset: 0, bucketCounts: big },
      });
      expect(r.bucket_counts.reduce((a, b) => a + b, 0)).toBe(2 * EXP_MAX_BUCKETS_PER_SIDE * 1_000_007);
    }
    // Before the closed form this was 4 x 16384 x 4096 sub-buckets (~270M steps).
    expect(performance.now() - start).toBeLessThan(3000);
  });

  it('rejects points with more buckets than the cap, with a clear error', () => {
    const tooMany = new Array<number>(EXP_MAX_BUCKETS_PER_SIDE + 1).fill(1);
    expect(() => expToCanonicalBuckets({ scale: -10, positive: { offset: 0, bucketCounts: tooMany } })).toThrow(ExpHistogramTooLargeError);
    expect(() => expToCanonicalBuckets({ scale: 0, negative: { offset: 0, bucketCounts: tooMany } })).toThrow(
      `exponential histogram data point has ${EXP_MAX_BUCKETS_PER_SIDE + 1} negative buckets (max ${EXP_MAX_BUCKETS_PER_SIDE})`,
    );
    expect(() =>
      transformOtlpToMetrics(
        req({
          name: 'e',
          exponentialHistogram: { dataPoints: [{ timeUnixNano: NANOS, count: '1', scale: -10, positive: { offset: 0, bucketCounts: tooMany } }] },
        })
      )
    ).toThrow(/max 16384/);
    // Exactly at the cap is fine.
    expect(() => expToCanonicalBuckets({ scale: -10, positive: { offset: 0, bucketCounts: tooMany.slice(1) } })).not.toThrow();
  });

  it('non-finite and negative counts are skipped', () => {
    const r = expToCanonicalBuckets({ scale: -2, positive: { offset: 0, bucketCounts: [Infinity, -5, NaN, 16] } });
    // index 3 at scale -2 = canonical 48..63, 16 split as 1 each.
    expect(r.bucket_counts.reduce((a, b) => a + b, 0)).toBe(16);
    for (let i = 48; i < 64; i++) expect(r.bucket_counts[slotOf(i)]).toBe(1);
  });
});
