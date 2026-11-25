// Pure helpers of the metrics panel.
import type { MetricsPanelConfig } from '@logtide/shared';

/** queryId -> metric name, so ratio metrics can render as percentages. */
export function metricNamesOf(config: MetricsPanelConfig): Record<string, string> {
  const out: Record<string, string> = {};
  for (const q of config.query.queries) {
    if (q.metricName) out[q.id] = q.metricName;
  }
  return out;
}

/** A measured size of 0 means "not measured yet" and never counts as compact. */
export function isCompactSize(width: number, height: number): boolean {
  return (height > 0 && height < 200) || (width > 0 && width < 280);
}

const DEFAULT_CHART_HEIGHT = 320;
const MIN_CHART_HEIGHT = 80;

/** Chart height that fits the panel body; the default until it is measured. */
export function chartHeightFor(panelHeight: number): number {
  if (panelHeight <= 0) return DEFAULT_CHART_HEIGHT;
  return Math.max(MIN_CHART_HEIGHT, Math.min(DEFAULT_CHART_HEIGHT, panelHeight - 24));
}
