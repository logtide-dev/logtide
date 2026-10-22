import {
  PANEL_TIME_RANGES,
  timeRangePresetToMs,
  type MetricChartConfig,
  type MetricInterval,
  type TimeRangePreset,
} from '@logtide/shared';
import type { MetricAggregationFn } from '$lib/api/metrics';

// Pure model of the metrics explorer query: URL codec, unit inference and
// the mapping to a dashboard panel. No DOM and no store imports.

export type AggregationInterval = '1m' | '5m' | '15m' | '1h' | '6h' | '1d' | '1w';
export type MetricsTab = 'overview' | 'explorer' | 'golden';

export interface MetricQueryState {
  metric: string | null;
  aggregation: MetricAggregationFn;
  /** Label filters; several values for one key mean one series per value. */
  where: Record<string, string[]>;
  /** At most 2 label keys. */
  groupBy: string[];
  interval: 'auto' | AggregationInterval;
  service: string | null;
  tab: MetricsTab;
}

export const MAX_GROUP_BY = 2;

export const DEFAULT_QUERY: MetricQueryState = {
  metric: null,
  aggregation: 'avg',
  where: {},
  groupBy: [],
  interval: 'auto',
  service: null,
  tab: 'overview',
};

export const METRIC_AGGREGATIONS: readonly MetricAggregationFn[] = [
  'avg',
  'sum',
  'min',
  'max',
  'count',
  'last',
  'rate',
  'p50',
  'p95',
  'p99',
];

export const METRIC_INTERVALS: readonly AggregationInterval[] = ['1m', '5m', '15m', '1h', '6h', '1d', '1w'];

const TABS: readonly MetricsTab[] = ['overview', 'explorer', 'golden'];

export function cloneQuery(q: MetricQueryState): MetricQueryState {
  return {
    ...q,
    where: Object.fromEntries(Object.entries(q.where).map(([k, v]) => [k, [...v]])),
    groupBy: [...q.groupBy],
  };
}

// ─── URL codec ──────────────────────────────────────────────────────────────

const QUERY_KEYS = ['tab', 'metric', 'agg', 'by', 'interval', 'service', 'w'] as const;

function safeDecode(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export function parseMetricsUrl(params: URLSearchParams): MetricQueryState {
  const state = cloneQuery(DEFAULT_QUERY);

  const tab = params.get('tab');
  if (tab && (TABS as readonly string[]).includes(tab)) state.tab = tab as MetricsTab;

  const metric = params.get('metric');
  if (metric && metric.trim() !== '') state.metric = metric;

  const agg = params.get('agg');
  if (agg && (METRIC_AGGREGATIONS as readonly string[]).includes(agg)) {
    state.aggregation = agg as MetricAggregationFn;
  }

  const by = params.get('by');
  if (by) {
    const keys = by
      .split(',')
      .map((k) => safeDecode(k).trim())
      .filter((k) => k !== '');
    state.groupBy = [...new Set(keys)].slice(0, MAX_GROUP_BY);
  }

  const interval = params.get('interval');
  if (interval && (METRIC_INTERVALS as readonly string[]).includes(interval)) {
    state.interval = interval as AggregationInterval;
  }

  const service = params.get('service');
  if (service && service.trim() !== '') state.service = service;

  for (const raw of params.getAll('w')) {
    const eq = raw.indexOf('=');
    if (eq <= 0) continue; // no separator, or empty key
    const key = raw.slice(0, eq);
    const value = raw.slice(eq + 1);
    const list = state.where[key] ?? (state.where[key] = []);
    if (!list.includes(value)) list.push(value);
  }

  return state;
}

/** Returns a copy of `params` with the explorer keys replaced by `state`. */
export function writeMetricsUrl(params: URLSearchParams, state: MetricQueryState): URLSearchParams {
  const next = new URLSearchParams(params);
  for (const key of QUERY_KEYS) next.delete(key);

  next.set('tab', state.tab);
  if (state.metric) next.set('metric', state.metric);
  if (state.aggregation !== DEFAULT_QUERY.aggregation) next.set('agg', state.aggregation);
  if (state.groupBy.length > 0) {
    next.set('by', state.groupBy.slice(0, MAX_GROUP_BY).map(encodeURIComponent).join(','));
  }
  if (state.interval !== 'auto') next.set('interval', state.interval);
  if (state.service) next.set('service', state.service);
  for (const [key, values] of Object.entries(state.where)) {
    for (const value of values) next.append('w', `${key}=${value}`);
  }
  return next;
}

// ─── Units ──────────────────────────────────────────────────────────────────

export type MetricUnit =
  | 'bytes'
  | 'seconds'
  | 'milliseconds'
  | 'percent'
  | 'count'
  | 'bytes_per_second'
  | 'per_second'
  | null;

const SEP = '(?:^|[._\\-/])';
const END = '(?:$|[._\\-/])';
const BYTES_RE = new RegExp(`${SEP}bytes?${END}`);
const MS_RE = new RegExp(`${SEP}(?:ms|milliseconds?)${END}`);
const SECONDS_RE = new RegExp(`${SEP}(?:seconds?|secs?)${END}`);
const DURATION_RE = new RegExp(`${SEP}(?:duration|latency)${END}`);
const PERCENT_RE = new RegExp(`${SEP}(?:percent|percentage|utili[sz]ation|ratio|pct)${END}`);

export function inferMetricUnit(metricName: string, aggregation: MetricAggregationFn): MetricUnit {
  if (aggregation === 'count') return 'count';

  const name = metricName.toLowerCase();
  let base: MetricUnit = null;
  if (BYTES_RE.test(name)) base = 'bytes';
  else if (MS_RE.test(name)) base = 'milliseconds';
  else if (SECONDS_RE.test(name)) base = 'seconds';
  else if (DURATION_RE.test(name)) base = 'seconds';
  else if (PERCENT_RE.test(name)) base = 'percent';

  if (aggregation === 'rate') return base === 'bytes' ? 'bytes_per_second' : 'per_second';
  return base;
}

const BYTE_UNITS = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];

function trimNumber(value: number, digits: number): string {
  return Number(value.toFixed(digits)).toLocaleString('en-US', { maximumFractionDigits: digits });
}

function formatBytes(value: number): string {
  const sign = value < 0 ? '-' : '';
  let v = Math.abs(value);
  let i = 0;
  while (v >= 1024 && i < BYTE_UNITS.length - 1) {
    v /= 1024;
    i++;
  }
  return `${sign}${trimNumber(v, i === 0 ? 0 : 1)} ${BYTE_UNITS[i]}`;
}

function formatMilliseconds(ms: number): string {
  const abs = Math.abs(ms);
  if (abs >= 60_000) return `${trimNumber(ms / 60_000, 1)} min`;
  if (abs >= 1000) return `${trimNumber(ms / 1000, 1)} s`;
  if (abs >= 1 || abs === 0) return `${trimNumber(ms, abs >= 100 ? 0 : 1)} ms`;
  if (abs >= 0.001) return `${trimNumber(ms * 1000, 0)} µs`;
  return `${trimNumber(ms, 4)} ms`;
}

export function formatMetricValue(value: number, unit: MetricUnit): string {
  if (!Number.isFinite(value)) return String(value);
  switch (unit) {
    case 'bytes':
      return formatBytes(value);
    case 'bytes_per_second':
      return `${formatBytes(value)}/s`;
    case 'milliseconds':
      return formatMilliseconds(value);
    case 'seconds':
      return formatMilliseconds(value * 1000);
    case 'percent':
      return `${trimNumber(value, 1)}%`;
    case 'per_second':
      return `${trimNumber(value, Math.abs(value) >= 100 ? 0 : 2)}/s`;
    case 'count':
      return Math.round(value).toLocaleString('en-US');
    default:
      return trimNumber(value, Math.abs(value) >= 100 ? 0 : 3);
  }
}

// ─── Dashboard panel mapping ────────────────────────────────────────────────

/** Mirrors the backend `pickAutoInterval` ladder. */
export function pickAutoInterval(spanMs: number): AggregationInterval {
  const s = Math.max(0, spanMs) / 1000;
  if (s <= 3600) return '1m';
  if (s <= 6 * 3600) return '5m';
  if (s <= 86400) return '15m';
  if (s <= 7 * 86400) return '1h';
  if (s <= 90 * 86400) return '1d';
  return '1w';
}

/** Smallest dashboard preset that covers the span; the largest when none does. */
export function presetCoveringRange(spanMs: number): TimeRangePreset {
  for (const preset of PANEL_TIME_RANGES) {
    if (timeRangePresetToMs(preset) >= spanMs) return preset;
  }
  return PANEL_TIME_RANGES[PANEL_TIME_RANGES.length - 1];
}

export type PanelRangeInput = TimeRangePreset | { from: Date; to: Date } | null;

export function toMetricPanelConfig(
  state: MetricQueryState,
  projectId: string,
  range: PanelRangeInput
): { config: MetricChartConfig; dropped: string[] } {
  const dropped: string[] = [];

  let timeRange: TimeRangePreset;
  let spanMs: number;
  if (range === null) {
    timeRange = '24h';
    spanMs = timeRangePresetToMs(timeRange);
  } else if (typeof range === 'string') {
    timeRange = range;
    spanMs = timeRangePresetToMs(range);
  } else {
    spanMs = Math.max(0, range.to.getTime() - range.from.getTime());
    timeRange = presetCoveringRange(spanMs);
  }

  let aggregation = state.aggregation;
  if (aggregation === 'rate') {
    aggregation = 'avg';
    dropped.push('rate');
  }
  if (Object.values(state.where).some((v) => v.length > 0)) dropped.push('filters');
  if (state.groupBy.length > 0) dropped.push('group by');

  const resolved: AggregationInterval = state.interval === 'auto' ? pickAutoInterval(spanMs) : state.interval;
  const interval: MetricInterval = resolved === '1w' ? '1d' : resolved;

  return {
    config: {
      type: 'metric_chart',
      title: state.metric ?? 'Metric',
      source: 'metrics',
      projectId,
      metricName: state.metric ?? '',
      aggregation: aggregation as MetricChartConfig['aggregation'],
      interval,
      timeRange,
      serviceName: state.service,
    },
    dropped,
  };
}
