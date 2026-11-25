import {
  METRIC_MAX_FILTERS,
  PANEL_TIME_RANGES,
  PANEL_TIME_RANGE_MS,
  timeRangePresetToMs,
  type MetricAttrFilter,
  type MetricAttrRef,
  type MetricCatalogEntry,
  type MetricExplorerQuery,
  type MetricSeries,
  type MetricTimeAggregation,
  type PanelTimeRange,
} from '@logtide/shared';
import type { TimeRangeValue } from '$lib/stores/scope-url';
import { defaultDisplayForQuery, emptyQuerySpec, writeExplorerQuery } from '$lib/utils/metrics-explorer-url';

/** The scope's project list as a query scope: an empty scope means every project (null). */
export function scopeProjectIds(projectIds: string[]): string[] | null {
  return projectIds.length > 0 ? [...projectIds] : null;
}

/** Span of a scope range in ms. */
export function rangeSpanMs(range: TimeRangeValue): number {
  if (range.kind === 'preset') return timeRangePresetToMs(range.preset);
  const span = new Date(range.to).getTime() - new Date(range.from).getTime();
  return Number.isFinite(span) && span > 0 ? span : PANEL_TIME_RANGE_MS['24h'];
}

/** The dashboard panel preset closest to the scope range (nearest on a log scale). */
export function panelTimeRangeFor(range: TimeRangeValue): PanelTimeRange {
  const span = rangeSpanMs(range);
  let best: PanelTimeRange = PANEL_TIME_RANGES[0];
  let bestDistance = Infinity;
  for (const preset of PANEL_TIME_RANGES) {
    const distance = Math.abs(Math.log(PANEL_TIME_RANGE_MS[preset] / span));
    if (distance < bestDistance) {
      best = preset;
      bestDistance = distance;
    }
  }
  return best;
}

/** Default panel title: label or metric of the first visible query. */
export function defaultPanelTitle(query: MetricExplorerQuery): string {
  const first = query.queries.find((q) => !q.hidden && (q.label || q.metricName)) ?? query.queries[0];
  return first?.label || first?.metricName || 'Metrics';
}

/** Label key of a series ("resource.host.name") back to an attribute ref. */
export function refFromLabelKey(key: string): MetricAttrRef {
  return key.startsWith('resource.')
    ? { scope: 'resource', key: key.slice('resource.'.length) }
    : { scope: 'metric', key };
}

/**
 * Drill down on a series: every label of the series becomes an `eq` filter on
 * the query that produced it (every query for a formula series). An existing
 * filter on the same attribute is replaced.
 */
export function drillDownQuery(query: MetricExplorerQuery, series: MetricSeries): MetricExplorerQuery {
  const entries = Object.entries(series.labels).filter(([key]) => key !== '__other__');
  if (entries.length === 0) return query;
  const direct = query.queries.some((q) => q.id === series.queryId);
  const next: MetricExplorerQuery = JSON.parse(JSON.stringify(query));
  for (const spec of next.queries) {
    if (direct && spec.id !== series.queryId) continue;
    let filters: MetricAttrFilter[] = spec.filters;
    for (const [labelKey, value] of entries) {
      const ref = refFromLabelKey(labelKey);
      filters = filters.filter((f) => !(f.scope === ref.scope && f.key === ref.key));
      filters.push({ ...ref, op: 'eq', values: [value] });
    }
    spec.filters = filters.slice(-METRIC_MAX_FILTERS);
  }
  return next;
}

/** Adds a group by to the first query, moving the display to the default rule when it still follows it. */
export function withGroupBy(query: MetricExplorerQuery, ref: MetricAttrRef): MetricExplorerQuery {
  const next: MetricExplorerQuery = JSON.parse(JSON.stringify(query));
  const first = next.queries[0];
  if (!first || first.groupBy.some((g) => g.scope === ref.scope && g.key === ref.key)) return query;
  const followedDefault = query.display === defaultDisplayForQuery(query);
  first.groupBy = [...first.groupBy, ref];
  if (followedDefault) next.display = defaultDisplayForQuery(next);
  return next;
}

/** rate for monotonic sums, avg for gauges and other sums, p95 for histograms. */
export function defaultAggregationFor(entry: Pick<MetricCatalogEntry, 'type' | 'isMonotonic'>): MetricTimeAggregation {
  if (entry.type === 'sum') return entry.isMonotonic ? 'rate' : 'avg';
  if (entry.type === 'histogram' || entry.type === 'exp_histogram') return 'p95';
  return 'avg';
}

/** Only the scope params (project and time range) of a query string. */
export function scopeParamsOf(current: URLSearchParams): URLSearchParams {
  const params = new URLSearchParams();
  for (const key of ['project', 'projectId', 'range', 'from', 'to']) {
    const v = current.get(key);
    if (v !== null) params.set(key, v);
  }
  return params;
}

/** Explorer URL for a catalog metric, carrying the scope params of `current`. */
export function exploreHrefForMetric(
  entry: Pick<MetricCatalogEntry, 'name' | 'type' | 'isMonotonic'>,
  current: URLSearchParams,
): string {
  const query: MetricExplorerQuery = {
    projectIds: null,
    queries: [{ ...emptyQuerySpec('A'), metricName: entry.name, aggregation: defaultAggregationFor(entry) }],
    formulas: [],
    interval: 'auto',
    compareTo: 'none',
    display: 'lines',
  };
  return `/dashboard/metrics/explore?${writeExplorerQuery(scopeParamsOf(current), query).toString()}`;
}

/** First dot segment of a metric name; "other" when it has none. */
export function catalogPrefixOf(name: string): string {
  const i = name.indexOf('.');
  return i > 0 ? name.slice(0, i) : 'other';
}
