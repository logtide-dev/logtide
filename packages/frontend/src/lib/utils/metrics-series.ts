import {
  HOST_THRESHOLDS,
  metricDisplayScale,
  metricUnitLabel,
  type MetricSeries,
  type SignalThreshold,
} from '@logtide/shared';
import { chartColors } from '$lib/utils/echarts-theme';

// Pure helpers shared by the v2 metric series components.

export const SERIES_PALETTE: readonly string[] = [
  chartColors.series.blue,
  chartColors.series.green,
  chartColors.series.amber,
  chartColors.series.purple,
  chartColors.series.orange,
  chartColors.series.red,
  chartColors.series.yellow,
  chartColors.series.gray,
];

const OTHER_COLOR = '#6b7280';

/** Default meter thresholds for percent signals. */
export const DEFAULT_PERCENT_THRESHOLDS: SignalThreshold = HOST_THRESHOLDS.cpu;

/** Id of the series a comparison copy belongs to (the id without the "|cmp" suffix). */
export function baseSeriesId(series: Pick<MetricSeries, 'id'>): string {
  return series.id.endsWith('|cmp') ? series.id.slice(0, -4) : series.id;
}

/** One color per base series, so a comparison copy reuses the color of its current series. */
export function buildColorMap(series: MetricSeries[]): Map<string, string> {
  const colors = new Map<string, string>();
  let i = 0;
  for (const s of series) {
    const id = baseSeriesId(s);
    if (colors.has(id)) continue;
    colors.set(id, '__other__' in s.labels ? OTHER_COLOR : SERIES_PALETTE[i++ % SERIES_PALETTE.length]);
  }
  return colors;
}

/** Display name of a series; comparison copies read "<name> (previous)". */
export function seriesLabel(series: MetricSeries): string {
  const name = '__other__' in series.labels ? 'Other' : series.name;
  return series.comparison ? `${name} (previous)` : name;
}

/** Highest last value first; series without a value go last, ties keep input order. */
export function sortByLastDesc(series: MetricSeries[]): MetricSeries[] {
  return series
    .map((s, i) => ({ s, i }))
    .sort((a, b) => {
      const av = a.s.stats.last;
      const bv = b.s.stats.last;
      if (av === null && bv === null) return a.i - b.i;
      if (av === null) return 1;
      if (bv === null) return -1;
      return bv - av || a.i - b.i;
    })
    .map((x) => x.s);
}

/** True when the unit shows as "%" (real percent, or a 0-1 utilization ratio). */
export function isPercentSeries(unit: string | null, metricName?: string | null): boolean {
  return metricUnitLabel(unit, metricName) === '%';
}

/** Percent value 0-100 for a meter, or null. */
export function percentOf(value: number | null, unit: string | null, metricName?: string | null): number | null {
  if (value === null || !isPercentSeries(unit, metricName)) return null;
  return value * metricDisplayScale(unit, metricName);
}

export type MeterTone = 'ok' | 'warning' | 'critical';

export function meterTone(percent: number, thresholds: SignalThreshold = DEFAULT_PERCENT_THRESHOLDS): MeterTone {
  if (percent >= thresholds.critical) return 'critical';
  if (percent >= thresholds.warning) return 'warning';
  return 'ok';
}

export const METER_TONE_CLASS: Record<MeterTone, string> = {
  ok: 'bg-success',
  warning: 'bg-warning',
  critical: 'bg-destructive',
};

/** Min and max over every non-null point of the series, or null when there are none. */
export function valueRange(series: MetricSeries[]): { min: number; max: number } | null {
  let min = Infinity;
  let max = -Infinity;
  for (const s of series) {
    for (const p of s.points) {
      if (p.v === null) continue;
      if (p.v < min) min = p.v;
      if (p.v > max) max = p.v;
    }
  }
  return min === Infinity ? null : { min, max };
}

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
