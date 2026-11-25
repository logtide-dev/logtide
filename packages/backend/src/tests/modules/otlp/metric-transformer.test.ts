import { describe, it, expect } from 'vitest';
import { gzipSync } from 'zlib';
import {
  transformOtlpToMetrics,
  parseOtlpMetricsJson,
  parseOtlpMetricsProtobuf,
  type OtlpExportMetricsRequest,
} from '../../../modules/otlp/metric-transformer.js';

// ============================================================================
// Helper: build a minimal OTLP metrics request
// ============================================================================

function makeRequest(
  overrides: Partial<{
    serviceName: string;
    resourceAttrs: Array<{ key: string; value?: Record<string, unknown> }>;
    metrics: Array<Record<string, unknown>>;
    scopeMetrics: unknown[];
  }> = {}
): OtlpExportMetricsRequest {
  const resourceAttributes = overrides.resourceAttrs ?? (overrides.serviceName
    ? [{ key: 'service.name', value: { stringValue: overrides.serviceName } }]
    : []);

  return {
    resourceMetrics: [
      {
        resource: { attributes: resourceAttributes },
        scopeMetrics: overrides.scopeMetrics as OtlpExportMetricsRequest['resourceMetrics'] extends (infer U)[] ? U extends { scopeMetrics?: infer S } ? S : never : never ?? [
          {
            metrics: overrides.metrics ?? [],
          },
        ],
      },
    ],
  };
}

/**
 * Shorthand to build a well-formed request with a single metric and avoid the
 * type gymnastics of makeRequest for most tests.
 */
function singleMetricRequest(
  metric: Record<string, unknown>,
  serviceName = 'my-service',
  extraResourceAttrs: Array<{ key: string; value?: Record<string, unknown> }> = []
): OtlpExportMetricsRequest {
  return {
    resourceMetrics: [
      {
        resource: {
          attributes: [
            { key: 'service.name', value: { stringValue: serviceName } },
            ...extraResourceAttrs,
          ],
        },
        scopeMetrics: [
          {
            metrics: [metric as never],
          },
        ],
      },
    ],
  };
}

// A fixed timestamp in nanoseconds: 2024-01-15T09:50:00.000Z
const FIXED_NANOS = '1705312200000000000';
const FIXED_DATE = new Date(1705312200000);

// ============================================================================
// transformOtlpToMetrics
// ============================================================================

describe('OTLP Metric Transformer', () => {
  describe('transformOtlpToMetrics', () => {
    it('should return empty array for empty request', () => {
      const result = transformOtlpToMetrics({});
      expect(result).toEqual([]);
    });

    it('should return empty array for empty resourceMetrics', () => {
      const result = transformOtlpToMetrics({ resourceMetrics: [] });
      expect(result).toEqual([]);
    });

    it('should transform a gauge metric', () => {
      const request = singleMetricRequest({
        name: 'cpu.usage',
        gauge: {
          dataPoints: [
            { timeUnixNano: FIXED_NANOS, asDouble: 72.5 },
          ],
        },
      });

      const result = transformOtlpToMetrics(request);

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        metricName: 'cpu.usage',
        metricType: 'gauge',
        value: 72.5,
        serviceName: 'my-service',
        organizationId: '',
        projectId: '',
      });
      expect(result[0].time).toEqual(FIXED_DATE);
    });

    it('should transform a sum metric with isMonotonic', () => {
      const request = singleMetricRequest({
        name: 'http.requests',
        sum: {
          isMonotonic: true,
          aggregationTemporality: 2,
          dataPoints: [
            { timeUnixNano: FIXED_NANOS, asInt: '150' },
          ],
        },
      });

      const result = transformOtlpToMetrics(request);

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        metricName: 'http.requests',
        metricType: 'sum',
        value: 150,
        isMonotonic: true,
        serviceName: 'my-service',
      });
    });

    it('should transform a histogram metric with bucketCounts and explicitBounds', () => {
      const request = singleMetricRequest({
        name: 'http.request.duration',
        histogram: {
          dataPoints: [
            {
              timeUnixNano: FIXED_NANOS,
              count: '100',
              sum: 5432.1,
              min: 1.2,
              max: 987.6,
              bucketCounts: ['10', '30', '40', '15', '5'],
              explicitBounds: [10, 50, 100, 500],
            },
          ],
        },
      });

      const result = transformOtlpToMetrics(request);

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        metricName: 'http.request.duration',
        metricType: 'histogram',
        value: 5432.1,
        serviceName: 'my-service',
      });
      expect(result[0].histogramData).toEqual({
        sum: 5432.1,
        count: 100,
        min: 1.2,
        max: 987.6,
        bucket_counts: [10, 30, 40, 15, 5],
        explicit_bounds: [10, 50, 100, 500],
      });
    });

    it('should transform an exponential histogram metric with scale, zeroCount, positive/negative', () => {
      const request = singleMetricRequest({
        name: 'exp.hist.metric',
        exponentialHistogram: {
          dataPoints: [
            {
              timeUnixNano: FIXED_NANOS,
              count: '200',
              sum: 1000.0,
              min: 0.5,
              max: 100.0,
              scale: 3,
              zeroCount: '5',
              positive: { offset: 1, bucketCounts: ['10', '20', '30'] },
              negative: { offset: 2, bucketCounts: ['5', '15'] },
            },
          ],
        },
      });

      const result = transformOtlpToMetrics(request);

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        metricName: 'exp.hist.metric',
        metricType: 'exp_histogram',
        value: 1000.0,
      });
      expect(result[0].histogramData).toEqual({
        sum: 1000.0,
        count: 200,
        min: 0.5,
        max: 100.0,
        scale: 3,
        zero_count: 5,
        positive: { offset: 1, bucket_counts: [10, 20, 30] },
        negative: { offset: 2, bucket_counts: [5, 15] },
      });
    });

    it('should transform a summary metric with quantileValues', () => {
      const request = singleMetricRequest({
        name: 'rpc.duration',
        summary: {
          dataPoints: [
            {
              timeUnixNano: FIXED_NANOS,
              count: '500',
              sum: 12345.0,
              quantileValues: [
                { quantile: 0.5, value: 20.0 },
                { quantile: 0.99, value: 95.0 },
              ],
            },
          ],
        },
      });

      const result = transformOtlpToMetrics(request);

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        metricName: 'rpc.duration',
        metricType: 'summary',
        value: 12345.0,
      });
      expect(result[0].histogramData).toEqual({
        sum: 12345.0,
        count: 500,
        quantile_values: [
          { quantile: 0.5, value: 20.0 },
          { quantile: 0.99, value: 95.0 },
        ],
      });
      // summary always sets exemplars to undefined
      expect(result[0].exemplars).toBeUndefined();
    });

    it('should extract service name from resource attributes', () => {
      const request = singleMetricRequest(
        {
          name: 'test.metric',
          gauge: { dataPoints: [{ timeUnixNano: FIXED_NANOS, asDouble: 1 }] },
        },
        'payment-service'
      );

      const result = transformOtlpToMetrics(request);
      expect(result[0].serviceName).toBe('payment-service');
    });

    it("should use 'unknown' when no service.name in resource", () => {
      const request: OtlpExportMetricsRequest = {
        resourceMetrics: [
          {
            resource: {
              attributes: [
                { key: 'host.name', value: { stringValue: 'server-01' } },
              ],
            },
            scopeMetrics: [
              {
                metrics: [
                  {
                    name: 'test.metric',
                    gauge: {
                      dataPoints: [{ timeUnixNano: FIXED_NANOS, asDouble: 1 }],
                    },
                  },
                ],
              },
            ],
          },
        ],
      };

      const result = transformOtlpToMetrics(request);
      expect(result[0].serviceName).toBe('unknown');
    });

    it('should handle multiple resources with different services', () => {
      const request: OtlpExportMetricsRequest = {
        resourceMetrics: [
          {
            resource: {
              attributes: [
                { key: 'service.name', value: { stringValue: 'frontend' } },
              ],
            },
            scopeMetrics: [
              {
                metrics: [
                  {
                    name: 'req.count',
                    gauge: {
                      dataPoints: [{ timeUnixNano: FIXED_NANOS, asDouble: 10 }],
                    },
                  },
                ],
              },
            ],
          },
          {
            resource: {
              attributes: [
                { key: 'service.name', value: { stringValue: 'backend' } },
              ],
            },
            scopeMetrics: [
              {
                metrics: [
                  {
                    name: 'req.count',
                    gauge: {
                      dataPoints: [{ timeUnixNano: FIXED_NANOS, asDouble: 20 }],
                    },
                  },
                ],
              },
            ],
          },
        ],
      };

      const result = transformOtlpToMetrics(request);

      expect(result).toHaveLength(2);
      expect(result[0].serviceName).toBe('frontend');
      expect(result[0].value).toBe(10);
      expect(result[1].serviceName).toBe('backend');
      expect(result[1].value).toBe(20);
    });

    it('should handle multiple scopes within a resource', () => {
      const request: OtlpExportMetricsRequest = {
        resourceMetrics: [
          {
            resource: {
              attributes: [
                { key: 'service.name', value: { stringValue: 'svc' } },
              ],
            },
            scopeMetrics: [
              {
                scope: { name: 'scope-a' },
                metrics: [
                  {
                    name: 'metric.a',
                    gauge: {
                      dataPoints: [{ timeUnixNano: FIXED_NANOS, asDouble: 1 }],
                    },
                  },
                ],
              },
              {
                scope: { name: 'scope-b' },
                metrics: [
                  {
                    name: 'metric.b',
                    gauge: {
                      dataPoints: [{ timeUnixNano: FIXED_NANOS, asDouble: 2 }],
                    },
                  },
                ],
              },
            ],
          },
        ],
      };

      const result = transformOtlpToMetrics(request);

      expect(result).toHaveLength(2);
      expect(result[0].metricName).toBe('metric.a');
      expect(result[1].metricName).toBe('metric.b');
    });

    it('should handle multiple metrics within a scope', () => {
      const request = singleMetricRequest({
        name: 'will-be-overridden',
        gauge: { dataPoints: [] },
      });
      // Replace with two metrics in the same scope
      request.resourceMetrics![0].scopeMetrics![0].metrics = [
        {
          name: 'metric.one',
          gauge: {
            dataPoints: [{ timeUnixNano: FIXED_NANOS, asDouble: 100 }],
          },
        },
        {
          name: 'metric.two',
          gauge: {
            dataPoints: [{ timeUnixNano: FIXED_NANOS, asDouble: 200 }],
          },
        },
      ];

      const result = transformOtlpToMetrics(request);

      expect(result).toHaveLength(2);
      expect(result[0].metricName).toBe('metric.one');
      expect(result[1].metricName).toBe('metric.two');
    });

    it("should use 'unknown' for metric name when name is missing", () => {
      const request = singleMetricRequest({
        // name intentionally omitted
        gauge: {
          dataPoints: [{ timeUnixNano: FIXED_NANOS, asDouble: 42 }],
        },
      });

      const result = transformOtlpToMetrics(request);
      expect(result[0].metricName).toBe('unknown');
    });

    it('should include resource attributes in each record', () => {
      const request = singleMetricRequest(
        {
          name: 'test',
          gauge: {
            dataPoints: [{ timeUnixNano: FIXED_NANOS, asDouble: 1 }],
          },
        },
        'svc',
        [{ key: 'deployment.environment', value: { stringValue: 'production' } }]
      );

      const result = transformOtlpToMetrics(request);

      expect(result[0].resourceAttributes).toMatchObject({
        'service.name': 'svc',
        'deployment.environment': 'production',
      });
    });

    it('should include data point attributes', () => {
      const request = singleMetricRequest({
        name: 'http.duration',
        gauge: {
          dataPoints: [
            {
              timeUnixNano: FIXED_NANOS,
              asDouble: 55,
              attributes: [
                { key: 'http.method', value: { stringValue: 'GET' } },
                { key: 'http.status_code', value: { intValue: 200 } },
              ],
            },
          ],
        },
      });

      const result = transformOtlpToMetrics(request);

      expect(result[0].attributes).toEqual({
        'http.method': 'GET',
        'http.status_code': 200,
      });
    });

    it('should set organizationId and projectId to empty strings', () => {
      const request = singleMetricRequest({
        name: 'test',
        gauge: {
          dataPoints: [{ timeUnixNano: FIXED_NANOS, asDouble: 1 }],
        },
      });

      const result = transformOtlpToMetrics(request);

      expect(result[0].organizationId).toBe('');
      expect(result[0].projectId).toBe('');
    });
  });

  // ==========================================================================
  // Gauge data points
  // ==========================================================================

  describe('unit and description (1.8 catalog)', () => {
    it('copies unit and description onto every record of every metric type', () => {
      const dp = { timeUnixNano: FIXED_NANOS, asDouble: 1 };
      const request = singleMetricRequest({
        name: 'system.memory.usage',
        unit: 'By',
        description: 'Memory in use',
        gauge: { dataPoints: [dp, { ...dp, asDouble: 2 }] },
      });
      const records = transformOtlpToMetrics(request);
      expect(records).toHaveLength(2);
      for (const r of records) {
        expect(r.unit).toBe('By');
        expect(r.description).toBe('Memory in use');
      }

      const sum = transformOtlpToMetrics(
        singleMetricRequest({ name: 'c', unit: '1', description: 'd', sum: { isMonotonic: true, dataPoints: [dp] } })
      );
      expect(sum[0].unit).toBe('1');
      const hist = transformOtlpToMetrics(
        singleMetricRequest({ name: 'h', unit: 's', histogram: { dataPoints: [{ timeUnixNano: FIXED_NANOS, sum: 3, count: 1 }] } })
      );
      expect(hist[0].unit).toBe('s');
      expect(hist[0].description).toBeUndefined();
    });

    it('does not leak the unit of one metric onto the next', () => {
      const dp = { timeUnixNano: FIXED_NANOS, asDouble: 1 };
      const request: OtlpExportMetricsRequest = {
        resourceMetrics: [
          {
            resource: { attributes: [] },
            scopeMetrics: [
              {
                metrics: [
                  { name: 'a', unit: 'ms', gauge: { dataPoints: [dp] } },
                  { name: 'b', gauge: { dataPoints: [dp] } },
                ] as never[],
              },
            ],
          },
        ],
      };
      const records = transformOtlpToMetrics(request);
      expect(records.find((r) => r.metricName === 'a')?.unit).toBe('ms');
      expect(records.find((r) => r.metricName === 'b')?.unit).toBeUndefined();
    });

    it('leaves unit and description unset when empty', () => {
      const records = transformOtlpToMetrics(
        singleMetricRequest({ name: 'x', unit: '', description: '', gauge: { dataPoints: [{ timeUnixNano: FIXED_NANOS, asDouble: 1 }] } })
      );
      expect(records[0].unit).toBeUndefined();
      expect(records[0].description).toBeUndefined();
    });
  });

  describe('gauge data points', () => {
    it('should use asDouble for value', () => {
      const request = singleMetricRequest({
        name: 'g',
        gauge: {
          dataPoints: [{ timeUnixNano: FIXED_NANOS, asDouble: 3.14 }],
        },
      });
      const result = transformOtlpToMetrics(request);
      expect(result[0].value).toBe(3.14);
    });

    it('should use asInt when asDouble is undefined', () => {
      const request = singleMetricRequest({
        name: 'g',
        gauge: {
          dataPoints: [{ timeUnixNano: FIXED_NANOS, asInt: 42 }],
        },
      });
      const result = transformOtlpToMetrics(request);
      expect(result[0].value).toBe(42);
    });

    it('should use 0 when both asDouble and asInt are undefined', () => {
      const request = singleMetricRequest({
        name: 'g',
        gauge: {
          dataPoints: [{ timeUnixNano: FIXED_NANOS }],
        },
      });
      const result = transformOtlpToMetrics(request);
      expect(result[0].value).toBe(0);
    });

    it('should handle string asInt (int64 from JSON)', () => {
      const request = singleMetricRequest({
        name: 'g',
        gauge: {
          dataPoints: [{ timeUnixNano: FIXED_NANOS, asInt: '9007199254740991' }],
        },
      });
      const result = transformOtlpToMetrics(request);
      expect(result[0].value).toBe(9007199254740991);
    });

    it('should convert timeUnixNano to Date', () => {
      const request = singleMetricRequest({
        name: 'g',
        gauge: {
          dataPoints: [{ timeUnixNano: '1705312200000000000', asDouble: 1 }],
        },
      });
      const result = transformOtlpToMetrics(request);
      expect(result[0].time).toEqual(FIXED_DATE);
    });
  });

  // ==========================================================================
  // Sum data points
  // ==========================================================================

  describe('sum data points', () => {
    it('should include isMonotonic field from sum', () => {
      const request = singleMetricRequest({
        name: 's',
        sum: {
          isMonotonic: true,
          dataPoints: [{ timeUnixNano: FIXED_NANOS, asDouble: 100 }],
        },
      });
      const result = transformOtlpToMetrics(request);
      expect(result[0].isMonotonic).toBe(true);
    });

    it('should handle sum without isMonotonic', () => {
      const request = singleMetricRequest({
        name: 's',
        sum: {
          dataPoints: [{ timeUnixNano: FIXED_NANOS, asDouble: 50 }],
        },
      });
      const result = transformOtlpToMetrics(request);
      expect(result[0].isMonotonic).toBeUndefined();
    });
  });

  // ==========================================================================
  // Histogram data points
  // ==========================================================================

  describe('histogram data points', () => {
    it('should include histogramData with all fields', () => {
      const request = singleMetricRequest({
        name: 'h',
        histogram: {
          dataPoints: [
            {
              timeUnixNano: FIXED_NANOS,
              count: 50,
              sum: 2500.0,
              min: 5.0,
              max: 200.0,
              bucketCounts: [5, 15, 20, 8, 2],
              explicitBounds: [10, 50, 100, 500],
            },
          ],
        },
      });
      const result = transformOtlpToMetrics(request);

      expect(result[0].histogramData).toEqual({
        sum: 2500.0,
        count: 50,
        min: 5.0,
        max: 200.0,
        bucket_counts: [5, 15, 20, 8, 2],
        explicit_bounds: [10, 50, 100, 500],
      });
    });

    it('should use sum as value, fallback to 0', () => {
      const withSum = singleMetricRequest({
        name: 'h',
        histogram: {
          dataPoints: [
            { timeUnixNano: FIXED_NANOS, sum: 123.4, count: 10 },
          ],
        },
      });
      const withoutSum = singleMetricRequest({
        name: 'h',
        histogram: {
          dataPoints: [
            { timeUnixNano: FIXED_NANOS, count: 10 },
          ],
        },
      });

      expect(transformOtlpToMetrics(withSum)[0].value).toBe(123.4);
      expect(transformOtlpToMetrics(withoutSum)[0].value).toBe(0);
    });

    it('should handle missing optional fields (min, max)', () => {
      const request = singleMetricRequest({
        name: 'h',
        histogram: {
          dataPoints: [
            {
              timeUnixNano: FIXED_NANOS,
              count: 10,
              sum: 100.0,
              bucketCounts: [5, 5],
              explicitBounds: [50],
            },
          ],
        },
      });
      const result = transformOtlpToMetrics(request);

      expect(result[0].histogramData!.min).toBeUndefined();
      expect(result[0].histogramData!.max).toBeUndefined();
    });

    it('should map bucketCounts through toNumber', () => {
      const request = singleMetricRequest({
        name: 'h',
        histogram: {
          dataPoints: [
            {
              timeUnixNano: FIXED_NANOS,
              count: '30',
              sum: 600,
              bucketCounts: ['10', '15', '5'],
              explicitBounds: [100, 500],
            },
          ],
        },
      });
      const result = transformOtlpToMetrics(request);

      expect(result[0].histogramData!.bucket_counts).toEqual([10, 15, 5]);
    });
  });

  // ==========================================================================
  // Exponential histogram data points
  // ==========================================================================

  describe('exponential histogram data points', () => {
    it('should include scale, zeroCount, positive, negative in histogramData', () => {
      const request = singleMetricRequest({
        name: 'eh',
        exponentialHistogram: {
          dataPoints: [
            {
              timeUnixNano: FIXED_NANOS,
              count: '50',
              sum: 1234.5,
              scale: 5,
              zeroCount: '3',
              positive: { offset: 2, bucketCounts: ['10', '20'] },
              negative: { offset: 1, bucketCounts: ['5'] },
            },
          ],
        },
      });
      const result = transformOtlpToMetrics(request);

      expect(result[0].histogramData).toMatchObject({
        scale: 5,
        zero_count: 3,
        positive: { offset: 2, bucket_counts: [10, 20] },
        negative: { offset: 1, bucket_counts: [5] },
      });
    });

    it('should handle missing positive/negative', () => {
      const request = singleMetricRequest({
        name: 'eh',
        exponentialHistogram: {
          dataPoints: [
            {
              timeUnixNano: FIXED_NANOS,
              count: '10',
              sum: 100.0,
              scale: 2,
              zeroCount: '1',
            },
          ],
        },
      });
      const result = transformOtlpToMetrics(request);

      expect(result[0].histogramData!.positive).toBeUndefined();
      expect(result[0].histogramData!.negative).toBeUndefined();
    });

    it('should default positive/negative offset to 0', () => {
      const request = singleMetricRequest({
        name: 'eh',
        exponentialHistogram: {
          dataPoints: [
            {
              timeUnixNano: FIXED_NANOS,
              count: '10',
              sum: 100.0,
              scale: 2,
              zeroCount: '0',
              positive: { bucketCounts: ['5', '5'] },
              negative: { bucketCounts: ['3'] },
            },
          ],
        },
      });
      const result = transformOtlpToMetrics(request);

      expect(result[0].histogramData!.positive!.offset).toBe(0);
      expect(result[0].histogramData!.negative!.offset).toBe(0);
    });
  });

  // ==========================================================================
  // Summary data points
  // ==========================================================================

  describe('summary data points', () => {
    it('should include quantileValues in histogramData', () => {
      const request = singleMetricRequest({
        name: 'sm',
        summary: {
          dataPoints: [
            {
              timeUnixNano: FIXED_NANOS,
              count: '100',
              sum: 5000.0,
              quantileValues: [
                { quantile: 0.5, value: 45.0 },
                { quantile: 0.9, value: 88.0 },
                { quantile: 0.99, value: 99.0 },
              ],
            },
          ],
        },
      });
      const result = transformOtlpToMetrics(request);

      expect(result[0].histogramData!.quantile_values).toEqual([
        { quantile: 0.5, value: 45.0 },
        { quantile: 0.9, value: 88.0 },
        { quantile: 0.99, value: 99.0 },
      ]);
    });

    it('should default quantile/value to 0 when missing', () => {
      const request = singleMetricRequest({
        name: 'sm',
        summary: {
          dataPoints: [
            {
              timeUnixNano: FIXED_NANOS,
              count: '10',
              sum: 100.0,
              quantileValues: [
                { /* quantile and value both omitted */ },
              ],
            },
          ],
        },
      });
      const result = transformOtlpToMetrics(request);

      expect(result[0].histogramData!.quantile_values).toEqual([
        { quantile: 0, value: 0 },
      ]);
    });

    it('should set exemplars to undefined for summary', () => {
      const request = singleMetricRequest({
        name: 'sm',
        summary: {
          dataPoints: [
            {
              timeUnixNano: FIXED_NANOS,
              count: '1',
              sum: 10.0,
              quantileValues: [],
            },
          ],
        },
      });
      const result = transformOtlpToMetrics(request);

      expect(result[0].exemplars).toBeUndefined();
    });
  });

  // ==========================================================================
  // Exemplars
  // ==========================================================================

  describe('exemplars', () => {
    it('should return undefined when no exemplars', () => {
      const request = singleMetricRequest({
        name: 'g',
        gauge: {
          dataPoints: [{ timeUnixNano: FIXED_NANOS, asDouble: 1 }],
        },
      });
      const result = transformOtlpToMetrics(request);
      expect(result[0].exemplars).toBeUndefined();
    });

    it('should return undefined for empty exemplars array', () => {
      const request = singleMetricRequest({
        name: 'g',
        gauge: {
          dataPoints: [{ timeUnixNano: FIXED_NANOS, asDouble: 1, exemplars: [] }],
        },
      });
      const result = transformOtlpToMetrics(request);
      expect(result[0].exemplars).toBeUndefined();
    });

    it('should extract exemplar with all fields (value, time, traceId, spanId, attributes)', () => {
      const request = singleMetricRequest({
        name: 'g',
        gauge: {
          dataPoints: [
            {
              timeUnixNano: FIXED_NANOS,
              asDouble: 1,
              exemplars: [
                {
                  asDouble: 99.9,
                  timeUnixNano: FIXED_NANOS,
                  traceId: 'abcdef0123456789abcdef0123456789',
                  spanId: '0123456789abcdef',
                  filteredAttributes: [
                    { key: 'http.route', value: { stringValue: '/api/v1/users' } },
                  ],
                },
              ],
            },
          ],
        },
      });
      const result = transformOtlpToMetrics(request);

      expect(result[0].exemplars).toHaveLength(1);
      expect(result[0].exemplars![0]).toEqual({
        exemplarValue: 99.9,
        exemplarTime: FIXED_DATE,
        traceId: 'abcdef0123456789abcdef0123456789',
        spanId: '0123456789abcdef',
        attributes: { 'http.route': '/api/v1/users' },
      });
    });

    it('should prefer asDouble over asInt for exemplar value', () => {
      const request = singleMetricRequest({
        name: 'g',
        gauge: {
          dataPoints: [
            {
              timeUnixNano: FIXED_NANOS,
              asDouble: 1,
              exemplars: [
                {
                  asDouble: 77.7,
                  asInt: '100',
                  timeUnixNano: FIXED_NANOS,
                },
              ],
            },
          ],
        },
      });
      const result = transformOtlpToMetrics(request);
      expect(result[0].exemplars![0].exemplarValue).toBe(77.7);
    });

    it('should use toNumber on asInt when asDouble is undefined', () => {
      const request = singleMetricRequest({
        name: 'g',
        gauge: {
          dataPoints: [
            {
              timeUnixNano: FIXED_NANOS,
              asDouble: 1,
              exemplars: [
                {
                  asInt: '42',
                  timeUnixNano: FIXED_NANOS,
                },
              ],
            },
          ],
        },
      });
      const result = transformOtlpToMetrics(request);
      expect(result[0].exemplars![0].exemplarValue).toBe(42);
    });

    it('should normalize traceId and spanId (hex passthrough)', () => {
      const request = singleMetricRequest({
        name: 'g',
        gauge: {
          dataPoints: [
            {
              timeUnixNano: FIXED_NANOS,
              asDouble: 1,
              exemplars: [
                {
                  asDouble: 10,
                  traceId: 'aabbccdd11223344aabbccdd11223344',
                  spanId: 'aabbccdd11223344',
                },
              ],
            },
          ],
        },
      });
      const result = transformOtlpToMetrics(request);
      expect(result[0].exemplars![0].traceId).toBe('aabbccdd11223344aabbccdd11223344');
      expect(result[0].exemplars![0].spanId).toBe('aabbccdd11223344');
    });

    it('should return undefined traceId for all-zeros', () => {
      const request = singleMetricRequest({
        name: 'g',
        gauge: {
          dataPoints: [
            {
              timeUnixNano: FIXED_NANOS,
              asDouble: 1,
              exemplars: [
                {
                  asDouble: 10,
                  traceId: '00000000000000000000000000000000',
                  spanId: '0000000000000000',
                },
              ],
            },
          ],
        },
      });
      const result = transformOtlpToMetrics(request);
      expect(result[0].exemplars![0].traceId).toBeUndefined();
      expect(result[0].exemplars![0].spanId).toBeUndefined();
    });
  });

  // ==========================================================================
  // parseOtlpMetricsJson
  // ==========================================================================

  describe('parseOtlpMetricsJson', () => {
    it('should return empty resourceMetrics for null/undefined body', () => {
      expect(parseOtlpMetricsJson(null)).toEqual({ resourceMetrics: [] });
      expect(parseOtlpMetricsJson(undefined)).toEqual({ resourceMetrics: [] });
    });

    it('should parse object body directly', () => {
      const body = {
        resourceMetrics: [
          {
            resource: {
              attributes: [
                { key: 'service.name', value: { stringValue: 'test' } },
              ],
            },
            scopeMetrics: [
              {
                metrics: [
                  {
                    name: 'cpu',
                    gauge: {
                      dataPoints: [{ timeUnixNano: FIXED_NANOS, asDouble: 50 }],
                    },
                  },
                ],
              },
            ],
          },
        ],
      };

      const result = parseOtlpMetricsJson(body);

      expect(result.resourceMetrics).toHaveLength(1);
      expect(result.resourceMetrics![0].scopeMetrics![0].metrics![0].name).toBe('cpu');
    });

    it('should parse string body as JSON', () => {
      const body = JSON.stringify({
        resourceMetrics: [
          {
            resource: { attributes: [] },
            scopeMetrics: [
              {
                metrics: [
                  { name: 'mem', gauge: { dataPoints: [{ asDouble: 80 }] } },
                ],
              },
            ],
          },
        ],
      });

      const result = parseOtlpMetricsJson(body);
      expect(result.resourceMetrics).toHaveLength(1);
      expect(result.resourceMetrics![0].scopeMetrics![0].metrics![0].name).toBe('mem');
    });

    it('should throw on invalid JSON string', () => {
      expect(() => parseOtlpMetricsJson('{not valid json')).toThrow(
        'Invalid OTLP Metrics JSON'
      );
    });

    it('should throw on non-string, non-object body type', () => {
      expect(() => parseOtlpMetricsJson(12345 as unknown)).toThrow(
        'Invalid OTLP metrics request body type'
      );
    });

    it('should handle camelCase fields (resourceMetrics, scopeMetrics, dataPoints, timeUnixNano, asDouble, asInt)', () => {
      const body = {
        resourceMetrics: [
          {
            resource: { attributes: [] },
            scopeMetrics: [
              {
                metrics: [
                  {
                    name: 'test',
                    gauge: {
                      dataPoints: [
                        { timeUnixNano: FIXED_NANOS, asDouble: 3.14, asInt: '7' },
                      ],
                    },
                  },
                ],
              },
            ],
          },
        ],
      };

      const result = parseOtlpMetricsJson(body);
      const dp = result.resourceMetrics![0].scopeMetrics![0].metrics![0].gauge!.dataPoints![0];

      expect(dp.timeUnixNano).toBe(FIXED_NANOS);
      expect(dp.asDouble).toBe(3.14);
      expect(dp.asInt).toBe('7');
    });

    it('should handle snake_case fields (resource_metrics, scope_metrics, data_points, time_unix_nano, as_double, as_int)', () => {
      const body = {
        resource_metrics: [
          {
            resource: { attributes: [] },
            scope_metrics: [
              {
                metrics: [
                  {
                    name: 'snake_test',
                    gauge: {
                      data_points: [
                        { time_unix_nano: FIXED_NANOS, as_double: 2.71, as_int: '3' },
                      ],
                    },
                  },
                ],
              },
            ],
          },
        ],
      };

      const result = parseOtlpMetricsJson(body);

      expect(result.resourceMetrics).toHaveLength(1);
      const dp = result.resourceMetrics![0].scopeMetrics![0].metrics![0].gauge!.dataPoints![0];
      expect(dp.timeUnixNano).toBe(FIXED_NANOS);
      expect(dp.asDouble).toBe(2.71);
      expect(dp.asInt).toBe('3');
    });

    it('should normalize gauge data_points to dataPoints', () => {
      const body = {
        resourceMetrics: [
          {
            resource: { attributes: [] },
            scopeMetrics: [
              {
                metrics: [
                  {
                    name: 'gauge_test',
                    gauge: {
                      data_points: [
                        { time_unix_nano: FIXED_NANOS, as_double: 10 },
                      ],
                    },
                  },
                ],
              },
            ],
          },
        ],
      };

      const result = parseOtlpMetricsJson(body);
      const gauge = result.resourceMetrics![0].scopeMetrics![0].metrics![0].gauge!;

      expect(gauge.dataPoints).toHaveLength(1);
      expect(gauge.dataPoints![0].asDouble).toBe(10);
    });

    it('should normalize sum with aggregation_temporality and is_monotonic', () => {
      const body = {
        resourceMetrics: [
          {
            resource: { attributes: [] },
            scopeMetrics: [
              {
                metrics: [
                  {
                    name: 'sum_test',
                    sum: {
                      data_points: [
                        { time_unix_nano: FIXED_NANOS, as_double: 100 },
                      ],
                      aggregation_temporality: 2,
                      is_monotonic: true,
                    },
                  },
                ],
              },
            ],
          },
        ],
      };

      const result = parseOtlpMetricsJson(body);
      const sum = result.resourceMetrics![0].scopeMetrics![0].metrics![0].sum!;

      expect(sum.aggregationTemporality).toBe(2);
      expect(sum.isMonotonic).toBe(true);
      expect(sum.dataPoints).toHaveLength(1);
    });

    it('should normalize histogram with bucket_counts and explicit_bounds', () => {
      const body = {
        resourceMetrics: [
          {
            resource: { attributes: [] },
            scopeMetrics: [
              {
                metrics: [
                  {
                    name: 'hist_test',
                    histogram: {
                      data_points: [
                        {
                          time_unix_nano: FIXED_NANOS,
                          count: '20',
                          sum: 500,
                          bucket_counts: ['5', '10', '5'],
                          explicit_bounds: [100, 500],
                          min: 2,
                          max: 450,
                        },
                      ],
                      aggregation_temporality: 1,
                    },
                  },
                ],
              },
            ],
          },
        ],
      };

      const result = parseOtlpMetricsJson(body);
      const dp = result.resourceMetrics![0].scopeMetrics![0].metrics![0].histogram!.dataPoints![0];

      expect(dp.bucketCounts).toEqual(['5', '10', '5']);
      expect(dp.explicitBounds).toEqual([100, 500]);
      expect(dp.min).toBe(2);
      expect(dp.max).toBe(450);
    });

    it('should normalize exponential_histogram with zero_count', () => {
      const body = {
        resourceMetrics: [
          {
            resource: { attributes: [] },
            scopeMetrics: [
              {
                metrics: [
                  {
                    name: 'exp_hist_test',
                    exponential_histogram: {
                      data_points: [
                        {
                          time_unix_nano: FIXED_NANOS,
                          count: '10',
                          sum: 100,
                          scale: 3,
                          zero_count: '2',
                          positive: { offset: 1, bucket_counts: ['4', '6'] },
                          negative: { offset: 0, bucket_counts: ['2'] },
                        },
                      ],
                    },
                  },
                ],
              },
            ],
          },
        ],
      };

      const result = parseOtlpMetricsJson(body);
      const metric = result.resourceMetrics![0].scopeMetrics![0].metrics![0];

      expect(metric.exponentialHistogram).toBeDefined();
      const dp = metric.exponentialHistogram!.dataPoints![0];
      expect(dp.zeroCount).toBe('2');
      expect(dp.scale).toBe(3);
      expect(dp.positive).toEqual({ offset: 1, bucketCounts: ['4', '6'] });
    });

    it('should normalize summary with quantile_values', () => {
      const body = {
        resourceMetrics: [
          {
            resource: { attributes: [] },
            scopeMetrics: [
              {
                metrics: [
                  {
                    name: 'summary_test',
                    summary: {
                      data_points: [
                        {
                          time_unix_nano: FIXED_NANOS,
                          count: '50',
                          sum: 2500,
                          quantile_values: [
                            { quantile: 0.5, value: 45 },
                            { quantile: 0.99, value: 99 },
                          ],
                        },
                      ],
                    },
                  },
                ],
              },
            ],
          },
        ],
      };

      const result = parseOtlpMetricsJson(body);
      const dp = result.resourceMetrics![0].scopeMetrics![0].metrics![0].summary!.dataPoints![0];

      expect(dp.quantileValues).toEqual([
        { quantile: 0.5, value: 45 },
        { quantile: 0.99, value: 99 },
      ]);
    });

    it('should normalize exemplar filtered_attributes, span_id, trace_id', () => {
      const body = {
        resourceMetrics: [
          {
            resource: { attributes: [] },
            scopeMetrics: [
              {
                metrics: [
                  {
                    name: 'exemplar_test',
                    gauge: {
                      data_points: [
                        {
                          time_unix_nano: FIXED_NANOS,
                          as_double: 1,
                          exemplars: [
                            {
                              as_double: 5.5,
                              time_unix_nano: FIXED_NANOS,
                              trace_id: 'aabb',
                              span_id: 'ccdd',
                              filtered_attributes: [
                                { key: 'env', value: { stringValue: 'prod' } },
                              ],
                            },
                          ],
                        },
                      ],
                    },
                  },
                ],
              },
            ],
          },
        ],
      };

      const result = parseOtlpMetricsJson(body);
      const exemplar = result.resourceMetrics![0]
        .scopeMetrics![0]
        .metrics![0]
        .gauge!
        .dataPoints![0]
        .exemplars![0];

      expect(exemplar.traceId).toBe('aabb');
      expect(exemplar.spanId).toBe('ccdd');
      expect(exemplar.asDouble).toBe(5.5);
      expect(exemplar.filteredAttributes).toEqual([
        { key: 'env', value: { stringValue: 'prod' } },
      ]);
    });

    it('should return empty resourceMetrics when field is not array', () => {
      const body = { resourceMetrics: 'not-an-array' };
      const result = parseOtlpMetricsJson(body);
      expect(result.resourceMetrics).toEqual([]);
    });
  });

  // ==========================================================================
  // parseOtlpMetricsProtobuf
  // ==========================================================================

  describe('parseOtlpMetricsProtobuf', () => {
    it('should parse JSON payload sent as protobuf (JSON-in-protobuf fallback)', async () => {
      const jsonPayload = {
        resourceMetrics: [
          {
            resource: {
              attributes: [
                { key: 'service.name', value: { stringValue: 'proto-svc' } },
              ],
            },
            scopeMetrics: [
              {
                metrics: [
                  {
                    name: 'fallback.metric',
                    gauge: {
                      dataPoints: [
                        { timeUnixNano: FIXED_NANOS, asDouble: 42 },
                      ],
                    },
                  },
                ],
              },
            ],
          },
        ],
      };

      const buffer = Buffer.from(JSON.stringify(jsonPayload), 'utf-8');
      const result = await parseOtlpMetricsProtobuf(buffer);

      expect(result.resourceMetrics).toHaveLength(1);
      expect(result.resourceMetrics![0].scopeMetrics![0].metrics![0].name).toBe('fallback.metric');
    });

    it('should handle gzip-compressed JSON (auto-detect by magic bytes)', async () => {
      const jsonPayload = {
        resourceMetrics: [
          {
            resource: {
              attributes: [
                { key: 'service.name', value: { stringValue: 'gzip-svc' } },
              ],
            },
            scopeMetrics: [
              {
                metrics: [
                  {
                    name: 'gzip.metric',
                    gauge: {
                      dataPoints: [
                        { timeUnixNano: FIXED_NANOS, asDouble: 77.7 },
                      ],
                    },
                  },
                ],
              },
            ],
          },
        ],
      };

      const jsonBuffer = Buffer.from(JSON.stringify(jsonPayload), 'utf-8');
      const gzipBuffer = gzipSync(jsonBuffer);

      const result = await parseOtlpMetricsProtobuf(gzipBuffer);

      expect(result.resourceMetrics).toHaveLength(1);
      expect(result.resourceMetrics![0].scopeMetrics![0].metrics![0].name).toBe('gzip.metric');

      // Verify end-to-end: parse then transform
      const records = transformOtlpToMetrics(result);
      expect(records).toHaveLength(1);
      expect(records[0].metricName).toBe('gzip.metric');
      expect(records[0].value).toBe(77.7);
      expect(records[0].serviceName).toBe('gzip-svc');
    });

    it('should throw error on invalid protobuf (not JSON, not Proto)', async () => {
      const buffer = Buffer.from([0, 1, 2, 3, 4, 5]);
      await expect(parseOtlpMetricsProtobuf(buffer)).rejects.toThrow('Failed to decode OTLP metrics protobuf');
    });

    it('should handle decompression failure', async () => {
      const invalidGzip = Buffer.from([0x1f, 0x8b, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xff, 0xff]);
      await expect(parseOtlpMetricsProtobuf(invalidGzip)).rejects.toThrow('Failed to decompress gzip data');
    });
  });

  describe('ID normalization edge cases', () => {
    it('should normalize traceId and spanId from base64 (protobuf format)', () => {
      const traceIdHex = 'abcdef0123456789abcdef0123456789';
      const spanIdHex = '0123456789abcdef';
      const traceIdBase64 = Buffer.from(traceIdHex, 'hex').toString('base64');
      const spanIdBase64 = Buffer.from(spanIdHex, 'hex').toString('base64');

      const request = singleMetricRequest({
        name: 'g',
        gauge: {
          dataPoints: [
            {
              timeUnixNano: FIXED_NANOS,
              asDouble: 1,
              exemplars: [
                {
                  asDouble: 10,
                  traceId: traceIdBase64,
                  spanId: spanIdBase64,
                },
              ],
            },
          ],
        },
      });
      const result = transformOtlpToMetrics(request);
      expect(result[0].exemplars![0].traceId).toBe(traceIdHex);
      expect(result[0].exemplars![0].spanId).toBe(spanIdHex);
    });

    it('should return undefined if traceId contains non-hex chars and is not valid base64', () => {
      const request = singleMetricRequest({
        name: 'g',
        gauge: {
          dataPoints: [
            {
              timeUnixNano: FIXED_NANOS,
              asDouble: 1,
              exemplars: [{ asDouble: 1, traceId: 'not-hex-and-not-base64!!!' }],
            },
          ],
        },
      });
      const result = transformOtlpToMetrics(request);
      expect(result[0].exemplars![0].traceId).toBeUndefined();
    });

    it('should return undefined for all-zeros traceId even if base64 encoded', () => {
      const allZerosBase64 = Buffer.alloc(16, 0).toString('base64');
      const request = singleMetricRequest({
        name: 'g',
        gauge: {
          dataPoints: [
            {
              timeUnixNano: FIXED_NANOS,
              asDouble: 1,
              exemplars: [{ asDouble: 1, traceId: allZerosBase64 }],
            },
          ],
        },
      });
      const result = transformOtlpToMetrics(request);
      expect(result[0].exemplars![0].traceId).toBeUndefined();
    });
  });
});
