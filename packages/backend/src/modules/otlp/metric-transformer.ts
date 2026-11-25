/**
 * OTLP Metric Transformer
 *
 * Transforms OpenTelemetry Metric messages to LogTide MetricRecord format.
 * Supports gauge, sum, histogram, exponential histogram, and summary metric types.
 *
 * @see https://opentelemetry.io/docs/specs/otel/metrics/data-model/
 */

import type { MetricRecord, HistogramData, MetricExemplar } from '@logtide/reservoir';
import { attributesToRecord, sanitizeForPostgres, extractServiceName, nanosToIso, type OtlpKeyValue } from './transformer.js';
import { isGzipCompressed, decompressGzip } from './parser.js';
import { createRequire } from 'module';

// Import the generated protobuf definitions from @opentelemetry/otlp-transformer
const require = createRequire(import.meta.url);
const $root = require('@opentelemetry/otlp-transformer/build/esm/generated/root.js');

// Get the ExportMetricsServiceRequest message type for decoding protobuf messages
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ExportMetricsServiceRequest: any = $root.opentelemetry?.proto?.collector?.metrics?.v1?.ExportMetricsServiceRequest;

// ============================================================================
// OTLP Metric Type Definitions (based on OpenTelemetry proto)
// ============================================================================

/**
 * OTLP exemplar attached to a data point for trace correlation
 */
export interface OtlpExemplar {
  filteredAttributes?: OtlpKeyValue[];
  timeUnixNano?: string | bigint;
  asDouble?: number;
  asInt?: string | number;
  spanId?: string;
  traceId?: string;
}

/**
 * OTLP NumberDataPoint - used by gauge and sum metrics
 */
export interface OtlpNumberDataPoint {
  attributes?: OtlpKeyValue[];
  startTimeUnixNano?: string | bigint;
  timeUnixNano?: string | bigint;
  asDouble?: number;
  asInt?: string | number;
  exemplars?: OtlpExemplar[];
  flags?: number;
}

/**
 * OTLP HistogramDataPoint - explicit bucket histogram
 */
export interface OtlpHistogramDataPoint {
  attributes?: OtlpKeyValue[];
  startTimeUnixNano?: string | bigint;
  timeUnixNano?: string | bigint;
  count?: string | number;
  sum?: number;
  bucketCounts?: (string | number)[];
  explicitBounds?: number[];
  exemplars?: OtlpExemplar[];
  flags?: number;
  min?: number;
  max?: number;
}

/**
 * OTLP ExponentialHistogramDataPoint - base-2 exponential bucket histogram
 */
export interface OtlpExponentialHistogramDataPoint {
  attributes?: OtlpKeyValue[];
  startTimeUnixNano?: string | bigint;
  timeUnixNano?: string | bigint;
  count?: string | number;
  sum?: number;
  scale?: number;
  zeroCount?: string | number;
  positive?: {
    offset?: number;
    bucketCounts?: (string | number)[];
  };
  negative?: {
    offset?: number;
    bucketCounts?: (string | number)[];
  };
  flags?: number;
  exemplars?: OtlpExemplar[];
  min?: number;
  max?: number;
  zeroThreshold?: number;
}

/**
 * OTLP SummaryDataPoint - pre-computed quantile summary
 */
export interface OtlpSummaryDataPoint {
  attributes?: OtlpKeyValue[];
  startTimeUnixNano?: string | bigint;
  timeUnixNano?: string | bigint;
  count?: string | number;
  sum?: number;
  quantileValues?: Array<{
    quantile?: number;
    value?: number;
  }>;
  flags?: number;
}

/**
 * OTLP Gauge metric - instantaneous measurement
 */
export interface OtlpGauge {
  dataPoints?: OtlpNumberDataPoint[];
}

/**
 * OTLP Sum metric - cumulative or delta counter
 */
export interface OtlpSum {
  dataPoints?: OtlpNumberDataPoint[];
  aggregationTemporality?: number;
  isMonotonic?: boolean;
}

/**
 * OTLP Histogram metric - explicit bucket histogram
 */
export interface OtlpHistogram {
  dataPoints?: OtlpHistogramDataPoint[];
  aggregationTemporality?: number;
}

/**
 * OTLP ExponentialHistogram metric - base-2 exponential bucket histogram
 */
export interface OtlpExponentialHistogram {
  dataPoints?: OtlpExponentialHistogramDataPoint[];
  aggregationTemporality?: number;
}

/**
 * OTLP Summary metric - pre-computed quantile summary
 */
export interface OtlpSummary {
  dataPoints?: OtlpSummaryDataPoint[];
}

/**
 * OTLP Metric - a single named metric with one of gauge/sum/histogram/expHistogram/summary
 */
export interface OtlpMetric {
  name?: string;
  description?: string;
  unit?: string;
  gauge?: OtlpGauge;
  sum?: OtlpSum;
  histogram?: OtlpHistogram;
  exponentialHistogram?: OtlpExponentialHistogram;
  summary?: OtlpSummary;
}

/**
 * OTLP InstrumentationScope
 */
export interface OtlpMetricInstrumentationScope {
  name?: string;
  version?: string;
  attributes?: OtlpKeyValue[];
}

/**
 * OTLP ScopeMetrics - metrics from a single instrumentation scope
 */
export interface OtlpScopeMetrics {
  scope?: OtlpMetricInstrumentationScope;
  metrics?: OtlpMetric[];
  schemaUrl?: string;
}

/**
 * OTLP Resource (same structure as logs/traces)
 */
export interface OtlpMetricResource {
  attributes?: OtlpKeyValue[];
  droppedAttributesCount?: number;
}

/**
 * OTLP ResourceMetrics - metrics from a single resource
 */
export interface OtlpResourceMetrics {
  resource?: OtlpMetricResource;
  scopeMetrics?: OtlpScopeMetrics[];
  schemaUrl?: string;
}

/**
 * OTLP ExportMetricsServiceRequest - top-level request message
 */
export interface OtlpExportMetricsRequest {
  resourceMetrics?: OtlpResourceMetrics[];
}

// ============================================================================
// Transformation Functions
// ============================================================================

/**
 * Transform OTLP ExportMetricsServiceRequest to LogTide MetricRecord[].
 *
 * Iterates through resourceMetrics -> scopeMetrics -> metrics,
 * extracting the service name from resource attributes and dispatching
 * each metric to its type-specific handler.
 *
 * Note: organizationId and projectId are left as empty strings here;
 * they are filled in by the route handler.
 *
 * @param request - Parsed OTLP export metrics request
 * @returns Array of MetricRecord ready for ingestion
 */
export function transformOtlpToMetrics(
  request: OtlpExportMetricsRequest
): MetricRecord[] {
  const records: MetricRecord[] = [];

  for (const resourceMetric of request.resourceMetrics ?? []) {
    const serviceName = extractServiceName(resourceMetric.resource?.attributes);
    const resourceAttributes = attributesToRecord(resourceMetric.resource?.attributes);

    for (const scopeMetric of resourceMetric.scopeMetrics ?? []) {
      for (const metric of scopeMetric.metrics ?? []) {
        const metricName = sanitizeForPostgres(metric.name || 'unknown');
        const firstIndex = records.length;

        if (metric.gauge) {
          records.push(
            ...transformGaugeDataPoints(metric.gauge, metricName, serviceName, resourceAttributes)
          );
        } else if (metric.sum) {
          records.push(
            ...transformSumDataPoints(metric.sum, metricName, serviceName, resourceAttributes)
          );
        } else if (metric.histogram) {
          records.push(
            ...transformHistogramDataPoints(metric.histogram, metricName, serviceName, resourceAttributes)
          );
        } else if (metric.exponentialHistogram) {
          records.push(
            ...transformExpHistogramDataPoints(metric.exponentialHistogram, metricName, serviceName, resourceAttributes)
          );
        } else if (metric.summary) {
          records.push(
            ...transformSummaryDataPoints(metric.summary, metricName, serviceName, resourceAttributes)
          );
        }

        // 1.8 catalog: carry the metric unit and description on every record
        const unit = typeof metric.unit === 'string' && metric.unit !== '' ? sanitizeForPostgres(metric.unit) : undefined;
        const description =
          typeof metric.description === 'string' && metric.description !== ''
            ? sanitizeForPostgres(metric.description)
            : undefined;
        if (unit !== undefined || description !== undefined) {
          for (let i = firstIndex; i < records.length; i++) {
            if (unit !== undefined) records[i].unit = unit;
            if (description !== undefined) records[i].description = description;
          }
        }
      }
    }
  }

  return records;
}

// ============================================================================
// Type-specific handlers
// ============================================================================

/**
 * Transform gauge data points to MetricRecord[].
 */
function transformGaugeDataPoints(
  gauge: OtlpGauge,
  metricName: string,
  serviceName: string,
  resourceAttributes: Record<string, unknown>
): MetricRecord[] {
  return (gauge.dataPoints ?? []).map((dp) => ({
    time: nanosToDate(dp.timeUnixNano),
    organizationId: '',
    projectId: '',
    metricName,
    metricType: 'gauge' as const,
    value: extractScalarValue(dp),
    serviceName,
    attributes: attributesToRecord(dp.attributes),
    resourceAttributes,
    exemplars: extractExemplars(dp.exemplars),
  }));
}

/**
 * Transform sum data points to MetricRecord[].
 */
function transformSumDataPoints(
  sum: OtlpSum,
  metricName: string,
  serviceName: string,
  resourceAttributes: Record<string, unknown>
): MetricRecord[] {
  return (sum.dataPoints ?? []).map((dp) => ({
    time: nanosToDate(dp.timeUnixNano),
    organizationId: '',
    projectId: '',
    metricName,
    metricType: 'sum' as const,
    value: extractScalarValue(dp),
    isMonotonic: sum.isMonotonic,
    temporality: toTemporality(sum.aggregationTemporality),
    serviceName,
    attributes: attributesToRecord(dp.attributes),
    resourceAttributes,
    exemplars: extractExemplars(dp.exemplars),
  }));
}

/**
 * Transform histogram data points to MetricRecord[].
 */
function transformHistogramDataPoints(
  histogram: OtlpHistogram,
  metricName: string,
  serviceName: string,
  resourceAttributes: Record<string, unknown>
): MetricRecord[] {
  return (histogram.dataPoints ?? []).map((dp) => {
    const histogramData: HistogramData = {
      sum: dp.sum,
      count: toNumber(dp.count),
      min: dp.min,
      max: dp.max,
      bucket_counts: dp.bucketCounts?.map(toNumber),
      explicit_bounds: dp.explicitBounds,
    };

    // Use sum as the representative value, fallback to 0
    const value = dp.sum ?? 0;

    return {
      time: nanosToDate(dp.timeUnixNano),
      organizationId: '',
      projectId: '',
      metricName,
      metricType: 'histogram' as const,
      value,
      temporality: toTemporality(histogram.aggregationTemporality),
      serviceName,
      attributes: attributesToRecord(dp.attributes),
      resourceAttributes,
      histogramData,
      exemplars: extractExemplars(dp.exemplars),
    };
  });
}

/**
 * Transform exponential histogram data points to MetricRecord[].
 */
function transformExpHistogramDataPoints(
  expHistogram: OtlpExponentialHistogram,
  metricName: string,
  serviceName: string,
  resourceAttributes: Record<string, unknown>
): MetricRecord[] {
  return (expHistogram.dataPoints ?? []).map((dp) => {
    const histogramData: HistogramData = {
      sum: dp.sum,
      count: toNumber(dp.count),
      min: dp.min,
      max: dp.max,
      // Explicit buckets on the fixed canonical grid (EXP_CANONICAL_BOUNDS), so
      // the histogram aggregations (hist_last / hist_sum) read every histogram
      // the same way and every point of a series has identical bounds.
      ...expToExplicitBuckets(dp),
      scale: dp.scale,
      zero_count: toNumber(dp.zeroCount),
      positive: dp.positive ? {
        offset: dp.positive.offset ?? 0,
        bucket_counts: dp.positive.bucketCounts?.map(toNumber) ?? [],
      } : undefined,
      negative: dp.negative ? {
        offset: dp.negative.offset ?? 0,
        bucket_counts: dp.negative.bucketCounts?.map(toNumber) ?? [],
      } : undefined,
    };

    const value = dp.sum ?? 0;

    return {
      time: nanosToDate(dp.timeUnixNano),
      organizationId: '',
      projectId: '',
      metricName,
      metricType: 'exp_histogram' as const,
      value,
      temporality: toTemporality(expHistogram.aggregationTemporality),
      serviceName,
      attributes: attributesToRecord(dp.attributes),
      resourceAttributes,
      histogramData,
      exemplars: extractExemplars(dp.exemplars),
    };
  });
}

/**
 * Transform summary data points to MetricRecord[].
 */
function transformSummaryDataPoints(
  summary: OtlpSummary,
  metricName: string,
  serviceName: string,
  resourceAttributes: Record<string, unknown>
): MetricRecord[] {
  return (summary.dataPoints ?? []).map((dp) => {
    const histogramData: HistogramData = {
      sum: dp.sum,
      count: toNumber(dp.count),
      quantile_values: dp.quantileValues?.map((qv) => ({
        quantile: qv.quantile ?? 0,
        value: qv.value ?? 0,
      })),
    };

    const value = dp.sum ?? 0;

    return {
      time: nanosToDate(dp.timeUnixNano),
      organizationId: '',
      projectId: '',
      metricName,
      metricType: 'summary' as const,
      value,
      serviceName,
      attributes: attributesToRecord(dp.attributes),
      resourceAttributes,
      histogramData,
      exemplars: undefined,
    };
  });
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Extract the numeric value from a NumberDataPoint.
 * Prefers asDouble, falls back to asInt, then 0.
 */
function extractScalarValue(dp: OtlpNumberDataPoint): number {
  if (dp.asDouble !== undefined) {
    return dp.asDouble;
  }
  if (dp.asInt !== undefined) {
    return toNumber(dp.asInt);
  }
  return 0;
}

/**
 * OTLP AggregationTemporality: 1 = DELTA, 2 = CUMULATIVE, 0 / missing = unspecified.
 * Protobuf decoders may also hand back the enum name.
 */
export function toTemporality(v: unknown): 'cumulative' | 'delta' | undefined {
  if (v === 1 || v === 'AGGREGATION_TEMPORALITY_DELTA') return 'delta';
  if (v === 2 || v === 'AGGREGATION_TEMPORALITY_CUMULATIVE') return 'cumulative';
  return undefined;
}

/**
 * Canonical grid for exponential histograms converted to explicit buckets.
 *
 * Every exponential histogram point is re-bucketed onto ONE fixed set of
 * explicit bounds, whatever its scale, offset or populated range, so every
 * point of a series (and every series of a metric) carries identical bounds:
 * the histogram aggregations merge only points with identical bounds, and a
 * cumulative series diffs cleanly snapshot to snapshot. Nothing is trimmed.
 *
 * Grid (OTLP explicit layout: counts has bounds.length + 1 entries, bucket i
 * holds (bounds[i-1], bounds[i]], the last one is +Inf):
 * - scale EXP_CANONICAL_SCALE = 2, base = 2^(2^-2) = 2^(1/4) ~ 1.1892;
 * - canonical bucket index i holds (base^i, base^(i+1)], for i from
 *   EXP_GRID_MIN_INDEX (-80) to EXP_GRID_MAX_INDEX (159): positive values
 *   from 2^-20 (~9.5e-7) to 2^40 (~1.1e12), 60 octaves of 4 buckets;
 * - bounds = [0, base^-80, base^-79, ..., base^160] (242 bounds, 243 counts):
 *   counts[0] = (-Inf, 0] holds zero_count and the negative buckets (folded
 *   for simplicity: percentiles read negative values as 0), counts[1] =
 *   (0, 2^-20] the positive values below the grid, then one count per
 *   canonical bucket, and the last one (2^40, +Inf) the values above it.
 *
 * Precision: neighbouring bounds differ by a factor 2^(1/4), so a bucket is
 * ~18.9% wide relative to its lower edge and a percentile interpolated inside
 * it is off by less than that (usually far less). Values outside
 * [2^-20, 2^40] only keep their side (underflow / overflow bucket).
 *
 * Conversion of a source point at scale s (clamped to the OTLP range -10..20):
 * - s >= 2: source bucket j lies entirely inside canonical bucket
 *   floor(j / 2^(s - 2)) (the OTLP downscale), so the counts are exact;
 * - s < 2: source bucket j spans the n = 2^(2 - s) canonical buckets
 *   j * n .. (j + 1) * n - 1 and its count c is split evenly across them:
 *   sub-bucket k gets ceil((c - k) / n), which adds up to c and never
 *   decreases when c grows, so a cumulative series never looks like a reset
 *   because of the split.
 */
export const EXP_CANONICAL_SCALE = 2;
export const EXP_GRID_MIN_INDEX = -80;
export const EXP_GRID_MAX_INDEX = 159;

/** base^i at the canonical scale, i.e. 2^(i / 4) (exact for multiples of 4). */
function canonicalBound(index: number): number {
  return Math.pow(2, index / Math.pow(2, EXP_CANONICAL_SCALE));
}

/** The canonical explicit bounds (always the same doubles). */
export const EXP_CANONICAL_BOUNDS: readonly number[] = Object.freeze([
  0,
  ...Array.from(
    { length: EXP_GRID_MAX_INDEX - EXP_GRID_MIN_INDEX + 2 },
    (_, k) => canonicalBound(EXP_GRID_MIN_INDEX + k),
  ),
]);

/** Position in bucket_counts of canonical bucket index i (clamped to underflow / overflow). */
function canonicalSlot(index: number): number {
  if (index < EXP_GRID_MIN_INDEX) return 1;
  if (index > EXP_GRID_MAX_INDEX) return EXP_CANONICAL_BOUNDS.length;
  return 2 + index - EXP_GRID_MIN_INDEX;
}

/**
 * Convert an exponential histogram data point to explicit buckets on the
 * canonical grid: explicit_bounds is always EXP_CANONICAL_BOUNDS, bucket_counts
 * its counts (see the grid comment above).
 */
export function expToExplicitBuckets(
  dp: Pick<OtlpExponentialHistogramDataPoint, 'scale' | 'zeroCount' | 'positive' | 'negative'>
): { explicit_bounds: number[]; bucket_counts: number[] } {
  const rawScale = typeof dp.scale === 'number' && Number.isFinite(dp.scale) ? Math.trunc(dp.scale) : 0;
  const scale = Math.min(Math.max(rawScale, -10), 20);
  const rawOffset = dp.positive?.offset;
  const offset = typeof rawOffset === 'number' && Number.isFinite(rawOffset) ? Math.trunc(rawOffset) : 0;
  const positive = (dp.positive?.bucketCounts ?? []).map(toNumber);
  const negativeTotal = (dp.negative?.bucketCounts ?? []).map(toNumber).reduce((a, b) => a + b, 0);

  const counts = new Array<number>(EXP_CANONICAL_BOUNDS.length + 1).fill(0);
  counts[0] = toNumber(dp.zeroCount) + negativeTotal;

  if (scale >= EXP_CANONICAL_SCALE) {
    const width = Math.pow(2, scale - EXP_CANONICAL_SCALE);
    for (let j = 0; j < positive.length; j++) {
      if (positive[j] === 0) continue;
      counts[canonicalSlot(Math.floor((offset + j) / width))] += positive[j];
    }
  } else {
    const n = Math.pow(2, EXP_CANONICAL_SCALE - scale);
    for (let j = 0; j < positive.length; j++) {
      const c = positive[j];
      if (c === 0) continue;
      const first = (offset + j) * n;
      for (let k = 0; k < n; k++) {
        const part = Number.isInteger(c) ? Math.max(Math.ceil((c - k) / n), 0) : c / n;
        if (part !== 0) counts[canonicalSlot(first + k)] += part;
      }
    }
  }
  return { explicit_bounds: [...EXP_CANONICAL_BOUNDS], bucket_counts: counts };
}

/**
 * Convert a value that may be a string (int64 from JSON/protobuf) to a number.
 */
function toNumber(v: string | number | undefined): number {
  if (v === undefined || v === null) return 0;
  if (typeof v === 'number') return v;
  const parsed = Number(v);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * Convert nanoseconds timestamp to Date object.
 */
function nanosToDate(nanos?: string | bigint): Date {
  const iso = nanosToIso(nanos);
  return new Date(iso);
}

/**
 * Extract exemplars from OTLP data points into MetricExemplar[].
 * Returns undefined if no exemplars are present.
 */
function extractExemplars(exemplars?: OtlpExemplar[]): MetricExemplar[] | undefined {
  if (!exemplars || exemplars.length === 0) {
    return undefined;
  }

  return exemplars.map((ex) => {
    const value = ex.asDouble !== undefined
      ? ex.asDouble
      : toNumber(ex.asInt);

    return {
      exemplarValue: value,
      exemplarTime: ex.timeUnixNano ? nanosToDate(ex.timeUnixNano) : undefined,
      traceId: normalizeHexId(ex.traceId),
      spanId: normalizeHexId(ex.spanId),
      attributes: ex.filteredAttributes
        ? attributesToRecord(ex.filteredAttributes)
        : undefined,
    };
  });
}

/**
 * Normalize a hex-encoded ID (traceId/spanId).
 * Returns undefined for empty/all-zero IDs.
 * Handles base64 encoded values from protobuf.
 */
function normalizeHexId(id?: string): string | undefined {
  if (!id) return undefined;

  // Check if all zeros (invalid per OTLP spec)
  if (/^0+$/.test(id)) return undefined;

  // Check if it's base64 encoded (from protobuf toObject with bytes: String)
  // Base64 strings are multiples of 4 and contain only valid base64 characters
  const isBase64 = id.length > 0 && 
                  id.length % 4 === 0 && 
                  /^[A-Za-z0-9+/]+={0,2}$/.test(id) &&
                  !/^[0-9a-fA-F]+$/.test(id);

  if (isBase64) {
    try {
      const buffer = Buffer.from(id, 'base64');
      const hex = buffer.toString('hex');
      if (/^0+$/.test(hex)) return undefined;
      return hex;
    } catch {
      return undefined;
    }
  }

  // If it's not hex, it's invalid
  if (!/^[0-9a-fA-F]+$/.test(id)) {
    return undefined;
  }

  return id;
}

// ============================================================================
// JSON Parser
// ============================================================================

/**
 * Parse OTLP JSON metrics request body.
 * Handles both camelCase and snake_case field names since some OTLP
 * exporters use snake_case instead of the canonical camelCase.
 *
 * @param body - Raw request body (string or object)
 * @returns Parsed OTLP metrics request
 * @throws Error if parsing fails
 */
export function parseOtlpMetricsJson(body: unknown): OtlpExportMetricsRequest {
  if (!body) {
    return { resourceMetrics: [] };
  }

  if (typeof body === 'object') {
    return normalizeMetricsRequest(body as Record<string, unknown>);
  }

  if (typeof body === 'string') {
    try {
      const parsed = JSON.parse(body);
      return normalizeMetricsRequest(parsed);
    } catch (error) {
      throw new Error(`Invalid OTLP Metrics JSON: ${(error as Error).message}`);
    }
  }

  throw new Error('Invalid OTLP metrics request body type');
}

/**
 * Normalize metrics request handling both camelCase and snake_case.
 */
function normalizeMetricsRequest(data: Record<string, unknown>): OtlpExportMetricsRequest {
  const resourceMetrics = (data.resourceMetrics ?? data.resource_metrics) as unknown[];

  if (!Array.isArray(resourceMetrics)) {
    return { resourceMetrics: [] };
  }

  return {
    resourceMetrics: resourceMetrics.map(normalizeResourceMetrics),
  };
}

function normalizeResourceMetrics(rm: unknown): OtlpResourceMetrics {
  if (!rm || typeof rm !== 'object') return {};

  const data = rm as Record<string, unknown>;

  return {
    resource: data.resource as OtlpMetricResource | undefined,
    scopeMetrics: normalizeScopeMetrics(data.scopeMetrics ?? data.scope_metrics),
    schemaUrl: (data.schemaUrl ?? data.schema_url) as string | undefined,
  };
}

function normalizeScopeMetrics(sm: unknown): OtlpScopeMetrics[] | undefined {
  if (!Array.isArray(sm)) return undefined;

  return sm.map((s) => {
    if (!s || typeof s !== 'object') return {};
    const data = s as Record<string, unknown>;

    return {
      scope: data.scope as OtlpMetricInstrumentationScope | undefined,
      metrics: normalizeMetrics(data.metrics),
      schemaUrl: (data.schemaUrl ?? data.schema_url) as string | undefined,
    };
  });
}

function normalizeMetrics(metrics: unknown): OtlpMetric[] | undefined {
  if (!Array.isArray(metrics)) return undefined;

  return metrics.map((m) => {
    if (!m || typeof m !== 'object') return {};
    const data = m as Record<string, unknown>;

    return {
      name: data.name as string | undefined,
      description: data.description as string | undefined,
      unit: data.unit as string | undefined,
      gauge: data.gauge ? normalizeGauge(data.gauge) : undefined,
      sum: data.sum ? normalizeSum(data.sum) : undefined,
      histogram: data.histogram ? normalizeHistogram(data.histogram) : undefined,
      exponentialHistogram: normalizeExpHistogramField(
        data.exponentialHistogram ?? data.exponential_histogram
      ),
      summary: data.summary ? normalizeSummary(data.summary) : undefined,
    };
  });
}

function normalizeGauge(gauge: unknown): OtlpGauge | undefined {
  if (!gauge || typeof gauge !== 'object') return undefined;
  const data = gauge as Record<string, unknown>;

  return {
    dataPoints: normalizeNumberDataPoints(data.dataPoints ?? data.data_points),
  };
}

function normalizeSum(sum: unknown): OtlpSum | undefined {
  if (!sum || typeof sum !== 'object') return undefined;
  const data = sum as Record<string, unknown>;

  return {
    dataPoints: normalizeNumberDataPoints(data.dataPoints ?? data.data_points),
    aggregationTemporality: (data.aggregationTemporality ?? data.aggregation_temporality) as number | undefined,
    isMonotonic: (data.isMonotonic ?? data.is_monotonic) as boolean | undefined,
  };
}

function normalizeHistogram(histogram: unknown): OtlpHistogram | undefined {
  if (!histogram || typeof histogram !== 'object') return undefined;
  const data = histogram as Record<string, unknown>;

  return {
    dataPoints: normalizeHistogramDataPoints(data.dataPoints ?? data.data_points),
    aggregationTemporality: (data.aggregationTemporality ?? data.aggregation_temporality) as number | undefined,
  };
}

function normalizeExpHistogramField(expHist: unknown): OtlpExponentialHistogram | undefined {
  if (!expHist || typeof expHist !== 'object') return undefined;
  const data = expHist as Record<string, unknown>;

  return {
    dataPoints: normalizeExpHistogramDataPoints(data.dataPoints ?? data.data_points),
    aggregationTemporality: (data.aggregationTemporality ?? data.aggregation_temporality) as number | undefined,
  };
}

function normalizeSummary(summary: unknown): OtlpSummary | undefined {
  if (!summary || typeof summary !== 'object') return undefined;
  const data = summary as Record<string, unknown>;

  return {
    dataPoints: normalizeSummaryDataPoints(data.dataPoints ?? data.data_points),
  };
}

// ============================================================================
// Data point normalization (snake_case -> camelCase)
// ============================================================================

function normalizeNumberDataPoints(dps: unknown): OtlpNumberDataPoint[] | undefined {
  if (!Array.isArray(dps)) return undefined;

  return dps.map((dp) => {
    if (!dp || typeof dp !== 'object') return {};
    const data = dp as Record<string, unknown>;

    return {
      attributes: data.attributes as OtlpKeyValue[] | undefined,
      startTimeUnixNano: (data.startTimeUnixNano ?? data.start_time_unix_nano) as string | bigint | undefined,
      timeUnixNano: (data.timeUnixNano ?? data.time_unix_nano) as string | bigint | undefined,
      asDouble: (data.asDouble ?? data.as_double) as number | undefined,
      asInt: (data.asInt ?? data.as_int) as string | number | undefined,
      exemplars: normalizeExemplars(data.exemplars),
      flags: data.flags as number | undefined,
    };
  });
}

function normalizeHistogramDataPoints(dps: unknown): OtlpHistogramDataPoint[] | undefined {
  if (!Array.isArray(dps)) return undefined;

  return dps.map((dp) => {
    if (!dp || typeof dp !== 'object') return {};
    const data = dp as Record<string, unknown>;

    return {
      attributes: data.attributes as OtlpKeyValue[] | undefined,
      startTimeUnixNano: (data.startTimeUnixNano ?? data.start_time_unix_nano) as string | bigint | undefined,
      timeUnixNano: (data.timeUnixNano ?? data.time_unix_nano) as string | bigint | undefined,
      count: data.count as string | number | undefined,
      sum: data.sum as number | undefined,
      bucketCounts: (data.bucketCounts ?? data.bucket_counts) as (string | number)[] | undefined,
      explicitBounds: (data.explicitBounds ?? data.explicit_bounds) as number[] | undefined,
      exemplars: normalizeExemplars(data.exemplars),
      flags: data.flags as number | undefined,
      min: data.min as number | undefined,
      max: data.max as number | undefined,
    };
  });
}

function normalizeExpHistogramDataPoints(dps: unknown): OtlpExponentialHistogramDataPoint[] | undefined {
  if (!Array.isArray(dps)) return undefined;

  return dps.map((dp) => {
    if (!dp || typeof dp !== 'object') return {};
    const data = dp as Record<string, unknown>;

    const positive = data.positive as Record<string, unknown> | undefined;
    const negative = data.negative as Record<string, unknown> | undefined;

    return {
      attributes: data.attributes as OtlpKeyValue[] | undefined,
      startTimeUnixNano: (data.startTimeUnixNano ?? data.start_time_unix_nano) as string | bigint | undefined,
      timeUnixNano: (data.timeUnixNano ?? data.time_unix_nano) as string | bigint | undefined,
      count: data.count as string | number | undefined,
      sum: data.sum as number | undefined,
      scale: data.scale as number | undefined,
      zeroCount: (data.zeroCount ?? data.zero_count) as string | number | undefined,
      positive: positive ? {
        offset: positive.offset as number | undefined,
        bucketCounts: (positive.bucketCounts ?? positive.bucket_counts) as (string | number)[] | undefined,
      } : undefined,
      negative: negative ? {
        offset: negative.offset as number | undefined,
        bucketCounts: (negative.bucketCounts ?? negative.bucket_counts) as (string | number)[] | undefined,
      } : undefined,
      flags: data.flags as number | undefined,
      exemplars: normalizeExemplars(data.exemplars),
      min: data.min as number | undefined,
      max: data.max as number | undefined,
      zeroThreshold: (data.zeroThreshold ?? data.zero_threshold) as number | undefined,
    };
  });
}

function normalizeSummaryDataPoints(dps: unknown): OtlpSummaryDataPoint[] | undefined {
  if (!Array.isArray(dps)) return undefined;

  return dps.map((dp) => {
    if (!dp || typeof dp !== 'object') return {};
    const data = dp as Record<string, unknown>;

    const rawQuantiles = (data.quantileValues ?? data.quantile_values) as unknown[] | undefined;

    return {
      attributes: data.attributes as OtlpKeyValue[] | undefined,
      startTimeUnixNano: (data.startTimeUnixNano ?? data.start_time_unix_nano) as string | bigint | undefined,
      timeUnixNano: (data.timeUnixNano ?? data.time_unix_nano) as string | bigint | undefined,
      count: data.count as string | number | undefined,
      sum: data.sum as number | undefined,
      quantileValues: rawQuantiles?.map((qv) => {
        if (!qv || typeof qv !== 'object') return { quantile: 0, value: 0 };
        const q = qv as Record<string, unknown>;
        return {
          quantile: q.quantile as number | undefined,
          value: q.value as number | undefined,
        };
      }),
      flags: data.flags as number | undefined,
    };
  });
}

function normalizeExemplars(exemplars: unknown): OtlpExemplar[] | undefined {
  if (!Array.isArray(exemplars)) return undefined;

  return exemplars.map((ex) => {
    if (!ex || typeof ex !== 'object') return {};
    const data = ex as Record<string, unknown>;

    return {
      filteredAttributes: (data.filteredAttributes ?? data.filtered_attributes) as OtlpKeyValue[] | undefined,
      timeUnixNano: (data.timeUnixNano ?? data.time_unix_nano) as string | bigint | undefined,
      asDouble: (data.asDouble ?? data.as_double) as number | undefined,
      asInt: (data.asInt ?? data.as_int) as string | number | undefined,
      spanId: (data.spanId ?? data.span_id) as string | undefined,
      traceId: (data.traceId ?? data.trace_id) as string | undefined,
    };
  });
}

// ============================================================================
// Protobuf Parser
// ============================================================================

/**
 * Parse OTLP Protobuf metrics request body.
 *
 * Uses the OpenTelemetry proto definitions from @opentelemetry/otlp-transformer
 * to properly decode binary protobuf messages.
 *
 * Automatically detects and decompresses gzip-compressed data by checking
 * for gzip magic bytes (0x1f 0x8b), regardless of Content-Encoding header.
 *
 * @param buffer - Raw protobuf buffer (may be gzip compressed)
 * @returns Parsed OTLP metrics request
 * @throws Error if parsing fails
 */
export async function parseOtlpMetricsProtobuf(buffer: Buffer): Promise<OtlpExportMetricsRequest> {
  // Auto-detect gzip compression by magic bytes (0x1f 0x8b)
  if (isGzipCompressed(buffer)) {
    try {
      buffer = await decompressGzip(buffer);
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : 'Unknown error';
      console.error('[OTLP Metrics] Gzip decompression failed:', errMsg);
      throw new Error(`Failed to decompress gzip data: ${errMsg}`);
    }
  }

  // First, try to parse as JSON (some clients send JSON with protobuf content-type)
  try {
    const jsonString = buffer.toString('utf-8');
    if (jsonString.startsWith('{') || jsonString.startsWith('[')) {
      return parseOtlpMetricsJson(jsonString);
    }
  } catch {
    // Not JSON, continue to protobuf parsing
  }

  // Verify ExportMetricsServiceRequest is available
  if (!ExportMetricsServiceRequest) {
    throw new Error(
      'OTLP protobuf support not available. The OpenTelemetry proto definitions could not be loaded. ' +
      'Please use application/json content-type.'
    );
  }

  // Decode the protobuf message using OpenTelemetry proto definitions
  try {
    const decoded = ExportMetricsServiceRequest.decode(buffer);

    // Convert to plain JavaScript object for processing
    const message = ExportMetricsServiceRequest.toObject(decoded, {
      longs: String,  // Convert Long to string for JSON compatibility
      bytes: String,  // Convert bytes to base64 string
      defaults: false, // Don't include default values
      arrays: true,   // Always return arrays even if empty
      objects: true,  // Always return nested objects
    });

    // Normalize the decoded message to match our OtlpExportMetricsRequest interface
    return normalizeDecodedMetricsProtobuf(message);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[OTLP Metrics] Failed to decode protobuf:', errorMessage);
    throw new Error(`Failed to decode OTLP metrics protobuf: ${errorMessage}`);
  }
}

/**
 * Normalize decoded protobuf message to OtlpExportMetricsRequest format.
 */
function normalizeDecodedMetricsProtobuf(message: Record<string, unknown>): OtlpExportMetricsRequest {
  const resourceMetrics = message.resourceMetrics as unknown[] | undefined;

  if (!Array.isArray(resourceMetrics)) {
    return { resourceMetrics: [] };
  }

  return {
    resourceMetrics: resourceMetrics.map(normalizeResourceMetricsFromProtobuf),
  };
}

/**
 * Normalize ResourceMetrics from protobuf format.
 */
function normalizeResourceMetricsFromProtobuf(rm: unknown): OtlpResourceMetrics {
  if (!rm || typeof rm !== 'object') return {};

  const data = rm as Record<string, unknown>;

  return {
    resource: data.resource as OtlpMetricResource | undefined,
    scopeMetrics: normalizeScopeMetricsFromProtobuf(data.scopeMetrics),
    schemaUrl: data.schemaUrl as string | undefined,
  };
}

/**
 * Normalize ScopeMetrics from protobuf format.
 */
function normalizeScopeMetricsFromProtobuf(sm: unknown): OtlpScopeMetrics[] | undefined {
  if (!Array.isArray(sm)) return undefined;

  return sm.map((s) => {
    if (!s || typeof s !== 'object') return {};
    const data = s as Record<string, unknown>;

    return {
      scope: data.scope as OtlpMetricInstrumentationScope | undefined,
      metrics: normalizeMetricsFromProtobuf(data.metrics),
      schemaUrl: data.schemaUrl as string | undefined,
    };
  });
}

/**
 * Normalize individual metrics from protobuf format.
 */
function normalizeMetricsFromProtobuf(metrics: unknown): OtlpMetric[] | undefined {
  if (!Array.isArray(metrics)) return undefined;

  return metrics.map((m) => {
    if (!m || typeof m !== 'object') return {};
    const data = m as Record<string, unknown>;

    return {
      name: data.name as string | undefined,
      description: data.description as string | undefined,
      unit: data.unit as string | undefined,
      gauge: data.gauge as OtlpGauge | undefined,
      sum: data.sum ? normalizeProtobufSum(data.sum) : undefined,
      histogram: data.histogram as OtlpHistogram | undefined,
      exponentialHistogram: data.exponentialHistogram as OtlpExponentialHistogram | undefined,
      summary: data.summary as OtlpSummary | undefined,
    };
  });
}

/**
 * Normalize sum from protobuf to ensure isMonotonic is properly read.
 */
function normalizeProtobufSum(sum: unknown): OtlpSum | undefined {
  if (!sum || typeof sum !== 'object') return undefined;
  const data = sum as Record<string, unknown>;

  return {
    dataPoints: data.dataPoints as OtlpNumberDataPoint[] | undefined,
    aggregationTemporality: data.aggregationTemporality as number | undefined,
    isMonotonic: data.isMonotonic as boolean | undefined,
  };
}
