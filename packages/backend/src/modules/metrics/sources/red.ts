// Pure helpers for service RED (requests, errors, duration): the percentile
// of a span latency histogram and the shaping of HTTP server metric series.

import type { MetricSeries, SourceSignalValue } from '@logtide/shared';

/** HTTP server duration histograms, newest semconv first. */
export const HTTP_SERVER_METRICS = [
  { metricName: 'http.server.request.duration', statusKey: 'http.response.status_code', defaultUnit: 's' },
  { metricName: 'http.server.duration', statusKey: 'http.status_code', defaultUnit: 'ms' },
] as const;

export type HttpServerMetric = (typeof HTTP_SERVER_METRICS)[number];

/**
 * Percentile of an upper-inclusive histogram (`counts.length === bounds.length + 1`,
 * the last bucket is +Inf). Linear interpolation inside the bucket that holds
 * the rank; the first bucket starts at 0 and the +Inf bucket reports the last
 * finite bound. null for an empty histogram.
 */
export function histogramPercentile(bounds: number[], counts: number[], q: number): number | null {
  const total = counts.reduce((a, b) => a + b, 0);
  if (total <= 0 || bounds.length === 0) return null;
  const rank = q * total;
  let seen = 0;
  for (let i = 0; i < counts.length; i++) {
    const c = counts[i];
    if (c > 0 && seen + c >= rank) {
      if (i >= bounds.length) return bounds[bounds.length - 1];
      const lower = i === 0 ? 0 : bounds[i - 1];
      return lower + ((rank - seen) / c) * (bounds[i] - lower);
    }
    seen += c;
  }
  return bounds[bounds.length - 1];
}

/** Factor that turns a duration in `unit` into milliseconds. */
export function msFactor(unit: string | null, fallback: 's' | 'ms'): number {
  const u = unit ?? fallback;
  if (u === 's') return 1000;
  if (u === 'ms') return 1;
  if (u === 'us') return 0.001;
  if (u === 'ns') return 0.000001;
  return fallback === 's' ? 1000 : 1;
}

export interface MetricRed {
  requestRate: SourceSignalValue;
  errorRate: SourceSignalValue;
  p95: SourceSignalValue;
}

export const SERVICE_LABEL = 'resource.service.name';

/** Series of one service for one query id (comparison copies ignored). */
export function seriesOf(series: MetricSeries[], queryId: string, service: string): MetricSeries | undefined {
  return series.find((s) => s.queryId === queryId && !s.comparison && s.labels[SERVICE_LABEL] === service);
}

/**
 * RED of one service from the A (total rate), B (5xx rate) and C (p95) series.
 * Error % is 5xx rate over total rate; zero traffic gives null. p95 is the mean
 * of the per-bucket p95 values (percentiles do not add up over a window),
 * converted to ms. null when the service has no total-rate series.
 */
export function redFromSeries(series: MetricSeries[], service: string, defaultUnit: 's' | 'ms'): MetricRed | null {
  const total = seriesOf(series, 'A', service);
  if (!total) return null;
  const errors = seriesOf(series, 'B', service);
  const dur = seriesOf(series, 'C', service);

  const errByTime = new Map((errors?.points ?? []).map((p) => [p.t, p.v]));
  const errSpark = total.points.map((p) =>
    p.v !== null && p.v > 0 ? ((errByTime.get(p.t) ?? 0) / p.v) * 100 : null,
  );
  const avgTotal = total.stats.avg;
  const errPct = avgTotal !== null && avgTotal > 0 ? ((errors?.stats.avg ?? 0) / avgTotal) * 100 : null;

  const factor = msFactor(dur?.unit ?? null, defaultUnit);
  const scale = (v: number | null): number | null => (v === null ? null : v * factor);

  return {
    requestRate: { value: total.stats.avg, unit: 'req/s', spark: total.points.map((p) => p.v) },
    errorRate: { value: errPct, unit: '%', spark: errSpark },
    p95: { value: scale(dur?.stats.avg ?? null), unit: 'ms', spark: (dur?.points ?? []).map((p) => scale(p.v)) },
  };
}

/** Per-operation latency summary as the engines report it (ms). */
export interface OperationLatency {
  count: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
}

/** Share of the mixture that lies below `x` for one operation (piecewise linear through its known quantiles). */
function operationCdf(op: OperationLatency, x: number): number {
  const p50 = Math.max(0, op.p50Ms);
  const p95 = Math.max(p50, op.p95Ms);
  const p99 = Math.max(p95, op.p99Ms);
  // The tail above p99 is unknown: assume it is as long as p95 -> p99 (at least 1 ms).
  const top = p99 + Math.max(p99 - p95, 1);
  const knots: Array<[number, number]> = [
    [0, 0],
    [p50, 0.5],
    [p95, 0.95],
    [p99, 0.99],
    [top, 1],
  ];
  if (x <= 0) return 0;
  if (x >= top) return 1;
  for (let i = 1; i < knots.length; i++) {
    const [x1, y1] = knots[i];
    if (x <= x1) {
      const [x0, y0] = knots[i - 1];
      return x1 === x0 ? y1 : y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
    }
  }
  return 1;
}

/**
 * Percentile of the spans of several operations when only each operation's
 * p50/p95/p99 is known (the batched stats call cannot give one histogram per
 * service). Every operation is modeled as a piecewise linear distribution
 * through its quantiles and the call-weighted mixture is inverted by
 * bisection. Exact for a single operation at p50/p95/p99, an approximation
 * for mixtures. null without calls.
 */
export function mixturePercentile(ops: OperationLatency[], q: number): number | null {
  const used = ops.filter((o) => o.count > 0 && Number.isFinite(o.p95Ms));
  const total = used.reduce((a, o) => a + o.count, 0);
  if (total <= 0) return null;
  if (used.length === 1) {
    const o = used[0];
    if (q === 0.95) return o.p95Ms;
  }
  const cdf = (x: number): number => used.reduce((a, o) => a + (o.count / total) * operationCdf(o, x), 0);
  let lo = 0;
  let hi = Math.max(...used.map((o) => Math.max(o.p99Ms, o.p95Ms) * 2 + 1));
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    if (cdf(mid) < q) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** `count` equal, non overlapping slices of [from, to] (ms). The last slice ends exactly at `to`. */
export function sliceWindow(from: number, to: number, count: number): Array<{ from: number; to: number }> {
  const n = Math.max(1, count);
  const step = (to - from) / n;
  return Array.from({ length: n }, (_, i) => ({
    from: Math.round(from + i * step),
    // Engines filter inclusively on both ends: stop 1 ms before the next slice.
    to: i === n - 1 ? to : Math.round(from + (i + 1) * step) - 1,
  }));
}
