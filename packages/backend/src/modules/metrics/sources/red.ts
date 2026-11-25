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
