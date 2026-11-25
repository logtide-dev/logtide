import {
  METRIC_ALERT_WINDOW_MINUTES,
  formatMetricAlertLabels,
  formatMetricValue,
  metricAlertTarget,
  metricDisplayScale,
  metricUnitLabel,
  type MetricAlertConfig,
  type MetricAlertCondition,
  type MetricExplorerQuery,
  type MetricQueryResponse,
} from '@logtide/shared';
import { encodeExplorerQuery, EXPLORER_URL_PARAM } from '$lib/utils/metrics-explorer-url';

// Pure helpers of the metric alert dialog and the metric rows of the Alerts
// page. No component imports so everything is unit tested without rendering.

export interface MetricAlertTargetOption {
  /** Query or formula id ("A", "F1"). */
  id: string;
  kind: 'query' | 'formula';
  /** "A: system.cpu.utilization" or "F1: A / B * 100" */
  label: string;
  /** Metric name of a query (used for unit display), null for a formula. */
  metricName: string | null;
}

const QUERY_REF_RE = /\b([A-F])\b/g;

/** Query ids referenced by a formula expression ("A / B * 100" -> ["A", "B"]). */
export function formulaQueryRefs(expression: string): string[] {
  return [...new Set([...expression.matchAll(QUERY_REF_RE)].map((m) => m[1]))];
}

/**
 * Items of an explorer query an alert can watch: every query with a metric,
 * then every formula, in order. Hidden items count too (the user may have
 * hidden a query only to declutter the chart).
 */
export function alertTargetOptions(query: Pick<MetricExplorerQuery, 'queries' | 'formulas'>): MetricAlertTargetOption[] {
  const queries = query.queries
    .filter((q) => q.metricName !== '')
    .map((q) => ({
      id: q.id,
      kind: 'query' as const,
      label: `${q.id}: ${q.label || q.metricName}`,
      metricName: q.metricName,
    }));
  const known = new Set(queries.map((q) => q.id));
  const formulas = (query.formulas ?? [])
    .filter((f) => f.expression.trim() !== '' && formulaQueryRefs(f.expression).every((id) => known.has(id)))
    .map((f) => ({
      id: f.id,
      kind: 'formula' as const,
      label: `${f.id}: ${f.label || f.expression}`,
      metricName: null,
    }));
  return [...queries, ...formulas];
}

/** First visible item, else the first option: what the dialog preselects. */
export function defaultAlertTarget(query: Pick<MetricExplorerQuery, 'queries' | 'formulas'>): string | null {
  const options = alertTargetOptions(query);
  const visibleFormula = (query.formulas ?? []).find((f) => !f.hidden && options.some((o) => o.id === f.id));
  if (visibleFormula) return visibleFormula.id;
  const visibleQuery = query.queries.find((q) => !q.hidden && options.some((o) => o.id === q.id));
  return visibleQuery?.id ?? options[0]?.id ?? null;
}

/**
 * The query an alert stores: only the watched item is visible. A query
 * target keeps that query alone; a formula keeps itself plus its operand
 * queries, hidden. Display options are reset (the evaluator ignores them).
 */
export function buildMetricAlertQuery(query: MetricExplorerQuery, targetId: string): MetricExplorerQuery {
  const formula = (query.formulas ?? []).find((f) => f.id === targetId);
  const base = { projectIds: query.projectIds, interval: 'auto' as const, compareTo: 'none' as const, display: 'lines' as const };
  if (formula) {
    const refs = new Set(formulaQueryRefs(formula.expression));
    return {
      ...base,
      queries: query.queries.filter((q) => refs.has(q.id)).map((q) => ({ ...q, hidden: true })),
      formulas: [{ ...formula, hidden: false }],
    };
  }
  const target = query.queries.find((q) => q.id === targetId);
  return {
    ...base,
    queries: target ? [{ ...target, hidden: false }] : [],
    formulas: [],
  };
}

/** Metric name used for unit display of the watched item (null for a formula). */
export function targetMetricName(query: Pick<MetricExplorerQuery, 'queries' | 'formulas'>): string | null {
  const target = metricAlertTarget(query);
  if (!target || target.kind === 'formula') return null;
  return query.queries.find((q) => q.id === target.id)?.metricName ?? null;
}

/** Unit of the watched item from a query response (null when unknown). */
export function targetUnit(response: MetricQueryResponse | null, targetId: string): string | null {
  return response?.queries.find((q) => q.id === targetId)?.unit ?? null;
}

/**
 * Stored values are raw ("1" utilization ratios are 0..1); the dialog shows
 * thresholds in display units (percent for those ratios).
 */
export function thresholdToDisplay(stored: number, unit: string | null, metricName: string | null): number {
  return roundForInput(stored * metricDisplayScale(unit, metricName));
}

export function thresholdFromDisplay(display: number, unit: string | null, metricName: string | null): number {
  return display / metricDisplayScale(unit, metricName);
}

/** Unit suffix next to the threshold input ("%", "bytes", "/s"), or null. */
export function thresholdUnitLabel(unit: string | null, metricName: string | null): string | null {
  return metricUnitLabel(unit, metricName);
}

function roundForInput(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const abs = Math.abs(value);
  const digits = abs >= 100 ? 0 : abs >= 1 ? 2 : 4;
  return Number(value.toFixed(digits));
}

/**
 * A starting threshold from the current data: the highest value of the
 * watched item in the response (display units), or null without data.
 */
export function suggestThreshold(
  response: MetricQueryResponse | null,
  targetId: string,
  condition: MetricAlertCondition,
  metricName: string | null
): number | null {
  const series = (response?.series ?? []).filter((s) => s.queryId === targetId && !s.comparison);
  const values = series
    .map((s) => (condition === 'above' ? s.stats.max : s.stats.min))
    .filter((v): v is number => v !== null && Number.isFinite(v));
  if (values.length === 0) return null;
  const extreme = condition === 'above' ? Math.max(...values) : Math.min(...values);
  return thresholdToDisplay(extreme, series[0]?.unit ?? null, metricName);
}

/** "system.cpu.utilization above 90% (avg over 5 minutes, 3 checks)" */
export function summarizeMetricRule(config: MetricAlertConfig): string {
  const metricName = targetMetricName(config.query);
  const target = metricAlertTarget(config.query);
  const source =
    target?.kind === 'formula'
      ? (config.query.formulas.find((f) => f.id === target.id)?.expression ?? target.id)
      : (metricName ?? 'metric');
  const minutes = METRIC_ALERT_WINDOW_MINUTES[config.window] ?? 0;
  const thresholdText = formatMetricValue(config.threshold, config.unit ?? null, metricName);
  const checks = config.forEvaluations === 1 ? '1 check' : `${config.forEvaluations} checks`;
  return `${source} ${config.condition} ${thresholdText} (avg over ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}, ${checks})`;
}

/** Group labels of a metric instance for tables ("host.name=web-1"), '' when ungrouped. */
export function instanceLabels(labels: Record<string, string> | null | undefined): string {
  return labels ? formatMetricAlertLabels(labels) : '';
}

/**
 * Explorer link of a metric rule's query. The rule's projects travel as the
 * explicit `project` scope param (`all` when the rule reads every project), so
 * the explorer shows what the rule evaluates instead of the viewer's
 * remembered scope. With `range`, the link opens on that custom time range.
 */
export function metricAlertExploreHref(
  query: MetricExplorerQuery,
  range?: { from: Date | string; to: Date | string } | null,
): string {
  const params = new URLSearchParams();
  const ids = query.projectIds ?? [];
  params.set('project', ids.length > 0 ? ids.join(',') : 'all');
  if (range) {
    const from = new Date(range.from);
    const to = new Date(range.to);
    if (Number.isFinite(from.getTime()) && Number.isFinite(to.getTime()) && from < to) {
      params.set('from', from.toISOString());
      params.set('to', to.toISOString());
    }
  }
  params.set(EXPLORER_URL_PARAM, encodeExplorerQuery(query));
  return `/dashboard/metrics/explore?${params.toString()}`;
}

/**
 * Time range around one alert evaluation: the hour before it (never less than
 * four rule windows) and a quarter of an hour after, capped at `now`.
 */
export function metricAlertRangeAround(
  at: Date | string,
  windowMinutes: number,
  now: Date = new Date(),
): { from: Date; to: Date } {
  const t = new Date(at).getTime();
  const before = Math.max(60, windowMinutes * 4) * 60_000;
  const to = Math.max(Math.min(t + 15 * 60_000, now.getTime()), t);
  return { from: new Date(t - before), to: new Date(to) };
}
