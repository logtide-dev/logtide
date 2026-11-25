import { describe, it, expect } from 'vitest';
import {
  transformOtlpToMetrics,
  parseOtlpMetricsJson,
  expToExplicitBuckets,
  toTemporality,
  type OtlpExportMetricsRequest,
} from '../../../modules/otlp/metric-transformer.js';

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
    expect(records[1].histogramData?.explicit_bounds).toEqual([1, 2]);
  });
});

describe('expToExplicitBuckets', () => {
  it('scale 0: bounds are powers of 2 starting at base^offset', () => {
    // offset 1: buckets (2,4], (4,8], (8,16]
    expect(expToExplicitBuckets({ scale: 0, positive: { offset: 1, bucketCounts: [1, 2, 3] } })).toEqual({
      explicit_bounds: [2, 4, 8, 16],
      bucket_counts: [0, 1, 2, 3, 0],
    });
  });

  it('counts has bounds.length + 1 entries and sums to the total', () => {
    const r = expToExplicitBuckets({ scale: 2, zeroCount: '4', positive: { offset: -3, bucketCounts: ['1', '0', '7'] } });
    expect(r.bucket_counts).toHaveLength(r.explicit_bounds.length + 1);
    expect(r.bucket_counts.reduce((a, b) => a + b, 0)).toBe(12);
  });

  it('scale 2 uses base 2^(1/4) and negative offsets', () => {
    const r = expToExplicitBuckets({ scale: 2, positive: { offset: -2, bucketCounts: [5] } });
    expect(r.explicit_bounds[0]).toBeCloseTo(2 ** (-2 / 4), 12);
    expect(r.explicit_bounds[1]).toBeCloseTo(2 ** (-1 / 4), 12);
    expect(r.bucket_counts).toEqual([0, 5, 0]);
  });

  it('negative scale widens the buckets', () => {
    // scale -1: base 4
    expect(expToExplicitBuckets({ scale: -1, positive: { offset: 0, bucketCounts: [1, 1] } }).explicit_bounds).toEqual([1, 4, 16]);
  });

  it('zero_count prepends bound 0', () => {
    expect(expToExplicitBuckets({ scale: 0, zeroCount: 3, positive: { offset: 0, bucketCounts: [2] } })).toEqual({
      explicit_bounds: [0, 1, 2],
      bucket_counts: [3, 0, 2, 0],
    });
  });

  it('negative buckets fold into the (-Inf, 0] bucket', () => {
    expect(
      expToExplicitBuckets({ scale: 0, negative: { offset: 0, bucketCounts: [4, 1] }, positive: { offset: 0, bucketCounts: [2] } })
    ).toEqual({ explicit_bounds: [0, 1, 2], bucket_counts: [5, 0, 2, 0] });
  });

  it('only zero / negative values: one bucket at 0', () => {
    expect(expToExplicitBuckets({ scale: 3, zeroCount: 6 })).toEqual({ explicit_bounds: [0], bucket_counts: [6, 0] });
  });

  it('empty histogram: single empty bucket', () => {
    expect(expToExplicitBuckets({ scale: 3 })).toEqual({ explicit_bounds: [], bucket_counts: [0] });
  });

  it('trailing empty positive buckets are dropped', () => {
    expect(expToExplicitBuckets({ scale: 0, positive: { offset: 0, bucketCounts: [1, 0, 0] } })).toEqual({
      explicit_bounds: [1, 2],
      bucket_counts: [0, 1, 0],
    });
  });

  it('missing scale defaults to 0 and string counts are parsed', () => {
    expect(expToExplicitBuckets({ positive: { bucketCounts: ['2'] } })).toEqual({ explicit_bounds: [1, 2], bucket_counts: [0, 2, 0] });
  });

  it('the transformer keeps the exponential fields next to the explicit buckets', () => {
    const [r] = transformOtlpToMetrics(
      req({
        name: 'e',
        exponentialHistogram: {
          dataPoints: [{ timeUnixNano: NANOS, count: '3', sum: 6, scale: 0, zeroCount: '1', positive: { offset: 1, bucketCounts: ['2'] } }],
        },
      })
    );
    expect(r.histogramData).toMatchObject({
      explicit_bounds: [0, 2, 4],
      bucket_counts: [1, 0, 2, 0],
      scale: 0,
      zero_count: 1,
      positive: { offset: 1, bucket_counts: [2] },
    });
  });
});
