// ============================================================================
// Metrics explorer query model (1.8)
// ============================================================================
//
// One query model for the Metrics explorer, the metrics dashboard panel and
// the source views (host/service). The backend evaluates it in
// modules/metrics/query (POST /api/v1/metrics/query and the panel fetchers),
// the frontend builds it with the query builder.

/** Which attribute map a key lives in: data point attributes or resource attributes. */
export type MetricAttrScope = 'metric' | 'resource';

/** One attribute of a data point (metric scope) or of the resource that sent it. */
export interface MetricAttrRef {
  scope: MetricAttrScope;
  /** Literal key, dots included ("host.name" is one key, never a path). */
  key: string;
}

/**
 * eq/neq take one value, in/nin one or more, exists/notExists none, gte/lt
 * one numeric value. neq/nin also match data points without the key.
 */
export type MetricAttrFilterOp = 'eq' | 'neq' | 'in' | 'nin' | 'exists' | 'notExists' | 'gte' | 'lt';

export const METRIC_ATTR_FILTER_OPS: readonly MetricAttrFilterOp[] = [
  'eq',
  'neq',
  'in',
  'nin',
  'exists',
  'notExists',
  'gte',
  'lt',
];

export interface MetricAttrFilter extends MetricAttrRef {
  op: MetricAttrFilterOp;
  /**
   * Filter values. A value of the form "$name" refers to a dashboard
   * variable: it is replaced by the variable's current value, and the whole
   * filter is dropped when the variable is unset ("All").
   */
  values?: string[];
}

/** Label key of a grouped attribute in series labels ("resource." prefix for resource keys). */
export function metricAttrLabel(ref: MetricAttrRef): string {
  return ref.scope === 'resource' ? `resource.${ref.key}` : ref.key;
}

/**
 * Time aggregation: how the points of ONE series are combined inside a time
 * bucket. "rate" turns a cumulative counter into a per-second rate.
 */
export type MetricTimeAggregation = 'avg' | 'sum' | 'min' | 'max' | 'count' | 'last' | 'rate' | 'p50' | 'p95' | 'p99';

export const METRIC_TIME_AGGREGATIONS: readonly MetricTimeAggregation[] = [
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

/**
 * Space aggregation: how the series that end up in the same group (same
 * groupBy labels) are combined per bucket, e.g. the network rate of a host is
 * the SUM of its interfaces, the fullest disk is the MAX of its mountpoints.
 */
export type MetricSpaceAggregation = 'avg' | 'sum' | 'min' | 'max';

export const METRIC_SPACE_AGGREGATIONS: readonly MetricSpaceAggregation[] = ['avg', 'sum', 'min', 'max'];

/** Default space aggregation for a time aggregation. */
export function defaultSpaceAggregation(time: MetricTimeAggregation): MetricSpaceAggregation {
  switch (time) {
    case 'sum':
    case 'count':
    case 'rate':
      return 'sum';
    case 'min':
      return 'min';
    case 'max':
    case 'p50':
    case 'p95':
    case 'p99':
      return 'max';
    default:
      return 'avg';
  }
}

export const METRIC_QUERY_IDS = ['A', 'B', 'C', 'D', 'E', 'F'] as const;
export const METRIC_MAX_QUERIES = 6;
export const METRIC_MAX_FORMULAS = 4;
export const METRIC_MAX_GROUP_BY = 3;
export const METRIC_MAX_FILTERS = 10;
export const METRIC_DEFAULT_SERIES_LIMIT = 10;
export const METRIC_MAX_SERIES_LIMIT = 50;

export interface MetricQuerySpec {
  /** "A".."F", unique in the request. */
  id: string;
  metricName: string;
  aggregation: MetricTimeAggregation;
  /** Defaults to defaultSpaceAggregation(aggregation). */
  spaceAggregation?: MetricSpaceAggregation;
  filters: MetricAttrFilter[];
  /** At most METRIC_MAX_GROUP_BY refs. Empty: one series for the whole query. */
  groupBy: MetricAttrRef[];
  /**
   * Top-N series (by average value, descending) when grouped; the rest are
   * folded into one series labelled { __other__: 'true' } with the space
   * aggregation. Default METRIC_DEFAULT_SERIES_LIMIT, max METRIC_MAX_SERIES_LIMIT.
   */
  limit?: number;
  /** Computed (usable in formulas) but not returned. */
  hidden?: boolean;
  /** Display name; defaults to the metric name. */
  label?: string;
}

/**
 * Formula over query ids: numbers, A..F, + - * / and parentheses, e.g.
 * "A / B * 100". Series are joined on identical labels; a single ungrouped
 * operand is broadcast to every series of the other. Division by zero and any
 * missing operand give null.
 */
export interface MetricFormulaSpec {
  /** "F1".."F4", unique in the request. */
  id: string;
  expression: string;
  label?: string;
  hidden?: boolean;
}

export type MetricCompareTo = 'none' | '1h' | '1d' | '1w';

/**
 * lines/area/bars: one chart with every series; split: one small chart per
 * series (shared y axis); stat: one number per series (last value); table:
 * one row per series with min/avg/max/last.
 */
export type MetricDisplay = 'lines' | 'area' | 'bars' | 'split' | 'stat' | 'table';

export type MetricQueryInterval = 'auto' | '1m' | '5m' | '15m' | '1h' | '6h' | '1d';

/** The persisted/shareable part of a query: what the explorer URL and a metrics panel store. */
export interface MetricExplorerQuery {
  /** null = every project of the organization the user can read. */
  projectIds: string[] | null;
  queries: MetricQuerySpec[];
  formulas: MetricFormulaSpec[];
  interval: MetricQueryInterval;
  compareTo: MetricCompareTo;
  display: MetricDisplay;
  /** Overrides the unit from the catalog for every returned series. */
  unitOverride?: string | null;
}

/** POST /api/v1/metrics/query */
export interface MetricQueryRequest extends MetricExplorerQuery {
  organizationId: string;
  /** ISO timestamps. */
  from: string;
  to: string;
  /** Dashboard variable values by name; null = All (filters using it are dropped). */
  variables?: Record<string, string | null>;
}

export interface MetricSeriesPoint {
  /** ISO bucket start. */
  t: string;
  v: number | null;
}

export interface MetricSeriesStats {
  min: number | null;
  avg: number | null;
  max: number | null;
  last: number | null;
}

export interface MetricSeries {
  /** Stable id: `${queryId}|${sorted label pairs}` plus "|cmp" for comparison copies. */
  id: string;
  /** Query or formula id ("A", "F1"). */
  queryId: string;
  /** Group labels keyed by metricAttrLabel; {} when ungrouped; { __other__: 'true' } for the folded rest. */
  labels: Record<string, string>;
  /** Display name: label values joined with " · ", or the query label / metric name when ungrouped. */
  name: string;
  /** Resolved unit (override, then catalog; formulas keep a unit only when every operand shares it). */
  unit: string | null;
  /** True for the compareTo copy; its timestamps are already shifted onto the current window. */
  comparison: boolean;
  points: MetricSeriesPoint[];
  stats: MetricSeriesStats;
}

export interface MetricQueryInfo {
  id: string;
  /** Series before the top-N cut. */
  seriesTotal: number;
  seriesShown: number;
  metricType: string | null;
  unit: string | null;
  /** Per-query failure (unknown metric, bad formula); the other queries still return. */
  error?: string;
}

export interface MetricQueryResponse {
  series: MetricSeries[];
  /** Resolved bucket interval. */
  interval: Exclude<MetricQueryInterval, 'auto'>;
  queries: MetricQueryInfo[];
  warnings: string[];
}
