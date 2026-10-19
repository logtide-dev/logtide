import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRequire } from 'module';
import {
  transformOtlpToMetrics,
  parseOtlpMetricsJson,
  parseOtlpMetricsProtobuf,
  type OtlpExportMetricsRequest,
} from '../../../modules/otlp/metric-transformer.js';

// Same CJS module instance the transformer loads, so spies on it are visible there.
const require = createRequire(import.meta.url);
const $root = require('@opentelemetry/otlp-transformer/build/esm/generated/root.js');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ExportMetricsServiceRequest: any = $root.opentelemetry.proto.collector.metrics.v1.ExportMetricsServiceRequest;

const FIXED_NANOS = '1705312200000000000';
const FIXED_DATE = new Date(1705312200000);

function encodeMetrics(payload: Record<string, unknown>): Buffer {
  const message = ExportMetricsServiceRequest.fromObject(payload);
  return Buffer.from(ExportMetricsServiceRequest.encode(message).finish());
}

function wrapMetric(metric: Record<string, unknown>): OtlpExportMetricsRequest {
  return {
    resourceMetrics: [
      {
        resource: { attributes: [{ key: 'service.name', value: { stringValue: 'edge-svc' } }] },
        scopeMetrics: [{ metrics: [metric as never] }],
      },
    ],
  };
}

describe('OTLP Metric Transformer - edge cases', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('transformOtlpToMetrics structural fallbacks', () => {
    it('should return no records for a request without resourceMetrics', () => {
      expect(transformOtlpToMetrics({})).toEqual([]);
    });

    it('should skip resources without scopeMetrics and scopes without metrics', () => {
      const records = transformOtlpToMetrics({
        resourceMetrics: [
          { resource: { attributes: [] } },
          { scopeMetrics: [{}] },
        ],
      });
      expect(records).toEqual([]);
    });

    it('should ignore metrics that carry no known data type', () => {
      const records = transformOtlpToMetrics(wrapMetric({ name: 'typeless' }));
      expect(records).toEqual([]);
    });

    it('should name metrics without a name "unknown"', () => {
      const records = transformOtlpToMetrics(
        wrapMetric({ gauge: { dataPoints: [{ timeUnixNano: FIXED_NANOS, asDouble: 1 }] } })
      );
      expect(records).toHaveLength(1);
      expect(records[0].metricName).toBe('unknown');
    });

    it('should yield no records for every metric type when dataPoints is missing', () => {
      for (const type of ['gauge', 'sum', 'histogram', 'exponentialHistogram', 'summary']) {
        const records = transformOtlpToMetrics(wrapMetric({ name: `m.${type}`, [type]: {} }));
        expect(records).toEqual([]);
      }
    });
  });

  describe('scalar value extraction', () => {
    it('should default the value to 0 when neither asDouble nor asInt is set', () => {
      const records = transformOtlpToMetrics(
        wrapMetric({ name: 'g', gauge: { dataPoints: [{ timeUnixNano: FIXED_NANOS }] } })
      );
      expect(records[0].value).toBe(0);
      expect(records[0].time).toEqual(FIXED_DATE);
    });

    it('should map a non-numeric asInt string to 0', () => {
      const records = transformOtlpToMetrics(
        wrapMetric({ name: 's', sum: { dataPoints: [{ timeUnixNano: FIXED_NANOS, asInt: 'not-a-number' }] } })
      );
      expect(records[0].value).toBe(0);
    });

    it('should map a null asInt to 0', () => {
      const records = transformOtlpToMetrics(
        wrapMetric({ name: 's', sum: { dataPoints: [{ timeUnixNano: FIXED_NANOS, asInt: null }] } })
      );
      expect(records[0].value).toBe(0);
    });
  });

  describe('histogram family defaults', () => {
    it('should default exponential histogram bucket offsets to 0 and value to 0 without sum', () => {
      const records = transformOtlpToMetrics(
        wrapMetric({
          name: 'eh',
          exponentialHistogram: {
            dataPoints: [
              {
                timeUnixNano: FIXED_NANOS,
                count: '3',
                scale: 2,
                positive: { bucketCounts: ['1', '2'] },
                negative: {},
              },
            ],
          },
        })
      );
      expect(records).toHaveLength(1);
      expect(records[0].value).toBe(0);
      expect(records[0].histogramData?.count).toBe(3);
      expect(records[0].histogramData?.positive).toEqual({ offset: 0, bucket_counts: [1, 2] });
      expect(records[0].histogramData?.negative).toEqual({ offset: 0, bucket_counts: [] });
      expect(records[0].histogramData?.zero_count).toBe(0);
    });

    it('should default positive bucket counts to an empty list when absent', () => {
      const records = transformOtlpToMetrics(
        wrapMetric({
          name: 'eh2',
          exponentialHistogram: {
            dataPoints: [{ timeUnixNano: FIXED_NANOS, sum: 2.5, positive: { offset: 3 } }],
          },
        })
      );
      expect(records[0].value).toBe(2.5);
      expect(records[0].histogramData?.positive).toEqual({ offset: 3, bucket_counts: [] });
      expect(records[0].histogramData?.negative).toBeUndefined();
    });

    it('should default summary value and quantile fields to 0', () => {
      const records = transformOtlpToMetrics(
        wrapMetric({
          name: 'sm',
          summary: {
            dataPoints: [
              { timeUnixNano: FIXED_NANOS, count: 2, quantileValues: [{}, { quantile: 0.5, value: 9 }] },
            ],
          },
        })
      );
      expect(records[0].value).toBe(0);
      expect(records[0].histogramData?.quantile_values).toEqual([
        { quantile: 0, value: 0 },
        { quantile: 0.5, value: 9 },
      ]);
    });
  });

  describe('parseOtlpMetricsJson malformed input', () => {
    it('should replace non-object entries at every level with empty objects', () => {
      const result = parseOtlpMetricsJson({
        resourceMetrics: [
          null,
          'junk',
          {
            scopeMetrics: [
              null,
              { metrics: [null, 42] },
            ],
          },
        ],
      });

      expect(result.resourceMetrics).toHaveLength(3);
      expect(result.resourceMetrics![0]).toEqual({});
      expect(result.resourceMetrics![1]).toEqual({});
      const scopes = result.resourceMetrics![2].scopeMetrics!;
      expect(scopes[0]).toEqual({});
      expect(scopes[1].metrics).toEqual([{}, {}]);
      expect(transformOtlpToMetrics(result)).toEqual([]);
    });

    it('should leave scopeMetrics and metrics undefined when they are not arrays', () => {
      const result = parseOtlpMetricsJson({
        resourceMetrics: [
          { scopeMetrics: 'nope' },
          { scopeMetrics: [{ metrics: { not: 'an array' } }] },
        ],
      });
      expect(result.resourceMetrics![0].scopeMetrics).toBeUndefined();
      expect(result.resourceMetrics![1].scopeMetrics![0].metrics).toBeUndefined();
    });

    it('should drop metric type payloads that are truthy but not objects', () => {
      const result = parseOtlpMetricsJson({
        resourceMetrics: [{
          scopeMetrics: [{
            metrics: [
              { name: 'g', gauge: 'bad' },
              { name: 's', sum: 7 },
              { name: 'h', histogram: true },
              { name: 'e', exponentialHistogram: 'bad' },
              { name: 'q', summary: 1 },
            ],
          }],
        }],
      });

      const metrics = result.resourceMetrics![0].scopeMetrics![0].metrics!;
      expect(metrics[0].gauge).toBeUndefined();
      expect(metrics[1].sum).toBeUndefined();
      expect(metrics[2].histogram).toBeUndefined();
      expect(metrics[3].exponentialHistogram).toBeUndefined();
      expect(metrics[4].summary).toBeUndefined();
      expect(transformOtlpToMetrics(result)).toEqual([]);
    });

    it('should leave dataPoints undefined when they are not arrays', () => {
      const result = parseOtlpMetricsJson({
        resourceMetrics: [{
          scopeMetrics: [{
            metrics: [
              { name: 'g', gauge: { dataPoints: 'x' } },
              { name: 'h', histogram: { dataPoints: 'x' } },
              { name: 'e', exponentialHistogram: { dataPoints: 'x' } },
              { name: 'q', summary: { dataPoints: 'x' } },
            ],
          }],
        }],
      });
      const metrics = result.resourceMetrics![0].scopeMetrics![0].metrics!;
      expect(metrics[0].gauge!.dataPoints).toBeUndefined();
      expect(metrics[1].histogram!.dataPoints).toBeUndefined();
      expect(metrics[2].exponentialHistogram!.dataPoints).toBeUndefined();
      expect(metrics[3].summary!.dataPoints).toBeUndefined();
    });

    it('should normalize non-object data points and exemplars to empty objects', () => {
      const result = parseOtlpMetricsJson({
        resourceMetrics: [{
          scopeMetrics: [{
            metrics: [
              { name: 'g', gauge: { dataPoints: [null, { asDouble: 1, timeUnixNano: FIXED_NANOS, exemplars: [null] }] } },
              { name: 'h', histogram: { dataPoints: [null] } },
              { name: 'e', exponentialHistogram: { dataPoints: [null] } },
              { name: 'q', summary: { dataPoints: [null] } },
            ],
          }],
        }],
      });

      const metrics = result.resourceMetrics![0].scopeMetrics![0].metrics!;
      expect(metrics[0].gauge!.dataPoints![0]).toEqual({});
      expect(metrics[0].gauge!.dataPoints![1].exemplars).toEqual([{}]);
      expect(metrics[1].histogram!.dataPoints).toEqual([{}]);
      expect(metrics[2].exponentialHistogram!.dataPoints).toEqual([{}]);
      expect(metrics[3].summary!.dataPoints).toEqual([{}]);

      // Empty data points still produce records with zero values.
      const records = transformOtlpToMetrics(result);
      expect(records).toHaveLength(5);
      expect(records.every((r) => r.value === 0 || r.value === 1)).toBe(true);
      // An empty exemplar maps to value 0 with no ids.
      expect(records[1].exemplars).toEqual([
        { exemplarValue: 0, exemplarTime: undefined, traceId: undefined, spanId: undefined, attributes: undefined },
      ]);
    });

    it('should leave positive/negative undefined in exp histogram points that omit them', () => {
      const result = parseOtlpMetricsJson({
        resourceMetrics: [{
          scopeMetrics: [{
            metrics: [{ name: 'e', exponential_histogram: { data_points: [{ sum: 4, count: 1 }] } }],
          }],
        }],
      });
      const dp = result.resourceMetrics![0].scopeMetrics![0].metrics![0].exponentialHistogram!.dataPoints![0];
      expect(dp.positive).toBeUndefined();
      expect(dp.negative).toBeUndefined();
      const records = transformOtlpToMetrics(result);
      expect(records[0].histogramData?.positive).toBeUndefined();
      expect(records[0].histogramData?.negative).toBeUndefined();
      expect(records[0].value).toBe(4);
    });

    it('should handle summary points without quantiles and with non-object quantiles', () => {
      const result = parseOtlpMetricsJson({
        resourceMetrics: [{
          scopeMetrics: [{
            metrics: [{
              name: 'q',
              summary: {
                dataPoints: [
                  { sum: 1, count: 1 },
                  { sum: 2, count: 1, quantile_values: [null, { quantile: 0.99, value: 5 }] },
                ],
              },
            }],
          }],
        }],
      });
      const dps = result.resourceMetrics![0].scopeMetrics![0].metrics![0].summary!.dataPoints!;
      expect(dps[0].quantileValues).toBeUndefined();
      expect(dps[1].quantileValues).toEqual([
        { quantile: 0, value: 0 },
        { quantile: 0.99, value: 5 },
      ]);
    });
  });

  describe('parseOtlpMetricsProtobuf with real protobuf encoding', () => {
    it('should decode a binary request with sum, gauge and histogram metrics', async () => {
      const buffer = encodeMetrics({
        resourceMetrics: [{
          resource: { attributes: [{ key: 'service.name', value: { stringValue: 'pb-svc' } }] },
          scopeMetrics: [{
            scope: { name: 'pb-scope' },
            metrics: [
              {
                name: 'pb.counter',
                sum: {
                  isMonotonic: true,
                  aggregationTemporality: 2,
                  dataPoints: [{ timeUnixNano: FIXED_NANOS, asInt: 12 }],
                },
              },
              {
                name: 'pb.gauge',
                gauge: { dataPoints: [{ timeUnixNano: FIXED_NANOS, asDouble: 3.5 }] },
              },
              {
                name: 'pb.hist',
                histogram: {
                  dataPoints: [{
                    timeUnixNano: FIXED_NANOS,
                    count: 4,
                    sum: 10,
                    bucketCounts: [1, 3],
                    explicitBounds: [5],
                  }],
                },
              },
            ],
          }],
        }],
      });

      const result = await parseOtlpMetricsProtobuf(buffer);
      const metrics = result.resourceMetrics![0].scopeMetrics![0].metrics!;
      expect(metrics.map((m) => m.name)).toEqual(['pb.counter', 'pb.gauge', 'pb.hist']);
      expect(metrics[0].sum!.isMonotonic).toBe(true);
      expect(metrics[1].sum).toBeUndefined();

      const records = transformOtlpToMetrics(result);
      expect(records).toHaveLength(3);
      expect(records[0]).toMatchObject({
        metricName: 'pb.counter',
        metricType: 'sum',
        value: 12,
        isMonotonic: true,
        serviceName: 'pb-svc',
        time: FIXED_DATE,
      });
      expect(records[1]).toMatchObject({ metricName: 'pb.gauge', metricType: 'gauge', value: 3.5 });
      expect(records[2]).toMatchObject({ metricName: 'pb.hist', metricType: 'histogram', value: 10 });
      expect(records[2].histogramData?.count).toBe(4);
      expect(records[2].histogramData?.bucket_counts).toEqual([1, 3]);
    });

    it('should return no resourceMetrics for an empty binary message', async () => {
      const result = await parseOtlpMetricsProtobuf(Buffer.alloc(0));
      expect(result.resourceMetrics).toEqual([]);
    });
  });

  describe('parseOtlpMetricsProtobuf decoded-shape normalization', () => {
    it('should return empty resourceMetrics when the decoded message has no array', async () => {
      vi.spyOn(ExportMetricsServiceRequest, 'toObject').mockReturnValue({});
      const result = await parseOtlpMetricsProtobuf(Buffer.alloc(0));
      expect(result).toEqual({ resourceMetrics: [] });
    });

    it('should tolerate malformed entries in the decoded structure', async () => {
      vi.spyOn(ExportMetricsServiceRequest, 'toObject').mockReturnValue({
        resourceMetrics: [
          null,
          { scopeMetrics: 'not-an-array' },
          {
            scopeMetrics: [
              null,
              { metrics: 'not-an-array' },
              {
                metrics: [
                  null,
                  { name: 'bad.sum', sum: 'not-an-object' },
                  { name: 'ok.sum', sum: { dataPoints: [{ asDouble: 2, timeUnixNano: FIXED_NANOS }], isMonotonic: false } },
                ],
              },
            ],
          },
        ],
      });

      const result = await parseOtlpMetricsProtobuf(Buffer.alloc(0));
      const rms = result.resourceMetrics!;
      expect(rms[0]).toEqual({});
      expect(rms[1].scopeMetrics).toBeUndefined();
      expect(rms[2].scopeMetrics![0]).toEqual({});
      expect(rms[2].scopeMetrics![1].metrics).toBeUndefined();
      const metrics = rms[2].scopeMetrics![2].metrics!;
      expect(metrics[0]).toEqual({});
      expect(metrics[1].sum).toBeUndefined();
      expect(metrics[2].sum).toEqual({
        dataPoints: [{ asDouble: 2, timeUnixNano: FIXED_NANOS }],
        aggregationTemporality: undefined,
        isMonotonic: false,
      });

      const records = transformOtlpToMetrics(result);
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({ metricName: 'ok.sum', value: 2, isMonotonic: false });
    });

    it('should report "Unknown error" when decoding throws a non-Error value', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.spyOn(ExportMetricsServiceRequest, 'toObject').mockImplementation(() => {
        throw 'boom';
      });
      await expect(parseOtlpMetricsProtobuf(Buffer.alloc(0))).rejects.toThrow(
        'Failed to decode OTLP metrics protobuf: Unknown error'
      );
    });
  });
});
