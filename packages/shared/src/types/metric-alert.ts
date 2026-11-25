// Metric alert rules (1.8): the `metric` alert rule kind. The rule watches one
// visible query or formula of an explorer query; when the query is grouped,
// every group is its own alert instance.

import type { MetricExplorerQuery } from '../metrics/query.js';
import type { Severity } from '../constants/siem-constants.js';

export type MetricAlertCondition = 'above' | 'below';
export const METRIC_ALERT_CONDITIONS: readonly MetricAlertCondition[] = ['above', 'below'];

export type MetricAlertWindow = '1m' | '5m' | '15m' | '1h';
export const METRIC_ALERT_WINDOWS: readonly MetricAlertWindow[] = ['1m', '5m', '15m', '1h'];
export const METRIC_ALERT_WINDOW_MINUTES: Record<MetricAlertWindow, number> = {
  '1m': 1,
  '5m': 5,
  '15m': 15,
  '1h': 60,
};
export const METRIC_ALERT_WINDOW_LABELS: Record<MetricAlertWindow, string> = {
  '1m': 'Last 1 minute',
  '5m': 'Last 5 minutes',
  '15m': 'Last 15 minutes',
  '1h': 'Last 1 hour',
};

export const METRIC_ALERT_MIN_EVALUATIONS = 1;
export const METRIC_ALERT_MAX_EVALUATIONS = 10;

/** At most this many groups are evaluated per rule (the query's top N cap). */
export const METRIC_ALERT_MAX_GROUPS = 50;

export interface MetricAlertConfig {
  /**
   * Explorer query with exactly one visible item (one query or one formula);
   * the other queries must be hidden (formula operands). compareTo, display
   * and interval are ignored by the evaluation.
   */
  query: MetricExplorerQuery;
  condition: MetricAlertCondition;
  threshold: number;
  window: MetricAlertWindow;
  /** Consecutive breaching evaluations before the instance fires (1..10). */
  forEvaluations: number;
  severity: Severity;
  /**
   * Unit of the watched item when the rule was saved (display only: the UI
   * shows the threshold in display units, e.g. percent for 0-1 ratios). The
   * evaluation always compares raw values.
   */
  unit?: string | null;
}

/** Payload of one metric alert instance in notifications and webhooks. */
export interface MetricAlertInstancePayload {
  /** Query or formula id watched by the rule ("A", "F1"). */
  query_id: string;
  /** Metric name of a query, expression of a formula. */
  source: string;
  condition: MetricAlertCondition;
  threshold: number;
  /** Window aggregated value; null when the group has no data (resolve only). */
  value: number | null;
  unit: string | null;
  window: MetricAlertWindow;
  for_evaluations: number;
  /** Group labels keyed by metric attribute label; {} when ungrouped. */
  labels: Record<string, string>;
  /** Stable instance key ('' when ungrouped). */
  group_key: string;
}

/** The single visible item of a metric alert query, or null when there is not exactly one. */
export function metricAlertTarget(
  query: Pick<MetricExplorerQuery, 'queries' | 'formulas'>
): { kind: 'query' | 'formula'; id: string } | null {
  const queries = (query.queries ?? []).filter((q) => !q.hidden);
  const formulas = (query.formulas ?? []).filter((f) => !f.hidden);
  if (queries.length + formulas.length !== 1) return null;
  return queries.length === 1
    ? { kind: 'query', id: queries[0].id }
    : { kind: 'formula', id: formulas[0].id };
}

/** Stable key of a group: sorted "key=value" pairs joined with a newline ('' when ungrouped). */
export function metricAlertGroupKey(labels: Record<string, string>): string {
  return Object.keys(labels)
    .sort()
    .map((k) => `${k}=${labels[k]}`)
    .join('\n');
}

/** "host.name=web-1, service.name=api" ('' when ungrouped). */
export function formatMetricAlertLabels(labels: Record<string, string>): string {
  return Object.keys(labels)
    .sort()
    .map((k) => `${k}=${labels[k]}`)
    .join(', ');
}

export function metricAlertBreaches(condition: MetricAlertCondition, value: number, threshold: number): boolean {
  return condition === 'above' ? value > threshold : value < threshold;
}
