// Series arithmetic of the query service: engine buckets onto the time grid,
// counter rates, space aggregation, top-N fold and per-series stats. Every
// series here is aligned to one grid (values[i] belongs to grid[i]).

import type { MetricSeriesStats, MetricSpaceAggregation } from '@logtide/shared';
import type { MetricTimeBucket } from '@logtide/reservoir';
import { bucketStart } from './interval.js';

export interface GridSeries {
  labels: Record<string, string>;
  values: Array<number | null>;
}

export const OTHER_LABEL = '__other__';

/** Stable key of a label set (sorted pairs). */
export function labelKey(labels: Record<string, string>): string {
  return Object.keys(labels)
    .sort()
    .map((k) => `${k}=${labels[k]}`)
    .join(',');
}

/**
 * Group engine buckets by their full label set and place them on the grid.
 * `shiftMs` moves the bucket times first (compareTo copies land on the current
 * window); a bucket outside the grid is dropped.
 */
export function bucketsToSeries(
  buckets: MetricTimeBucket[],
  grid: number[],
  stepMs: number,
  shiftMs = 0,
): GridSeries[] {
  const index = new Map<number, number>();
  grid.forEach((t, i) => index.set(t, i));
  const series = new Map<string, GridSeries>();
  for (const b of buckets) {
    const value = typeof b.value === 'number' && Number.isFinite(b.value) ? b.value : null;
    const i = index.get(bucketStart(new Date(b.bucket).getTime() + shiftMs, stepMs));
    if (i === undefined) continue;
    const labels = b.labels ?? {};
    const key = labelKey(labels);
    let s = series.get(key);
    if (!s) {
      s = { labels: { ...labels }, values: new Array(grid.length).fill(null) };
      series.set(key, s);
    }
    s.values[i] = value;
  }
  return [...series.values()];
}

/**
 * Turn per-bucket `last` values of a cumulative counter into per-second rates,
 * per series: (v - previous) / seconds between the two points. A negative
 * delta is a counter reset and yields v / seconds. The first point of a series
 * has no rate, and a bucket still open at `openAfterMs` (bucket end later than
 * it) is partial and dropped.
 */
export function applyRate(series: GridSeries[], grid: number[], stepMs: number, openAfterMs: number): GridSeries[] {
  return series.map((s) => {
    const out: Array<number | null> = new Array(grid.length).fill(null);
    let prevIndex = -1;
    for (let i = 0; i < grid.length; i++) {
      const v = s.values[i];
      if (v === null) continue;
      if (prevIndex >= 0 && grid[i] + stepMs <= openAfterMs) {
        const prev = s.values[prevIndex] as number;
        const seconds = (grid[i] - grid[prevIndex]) / 1000;
        const delta = v - prev;
        out[i] = (delta < 0 ? v : delta) / seconds;
      }
      prevIndex = i;
    }
    return { labels: s.labels, values: out };
  });
}

/**
 * Rates of a delta counter: the engine `sum` of each bucket divided by the
 * bucket length in seconds. A bucket still open at `openAfterMs` is partial
 * and dropped.
 */
export function applyDeltaRate(series: GridSeries[], grid: number[], stepMs: number, openAfterMs: number): GridSeries[] {
  const seconds = stepMs / 1000;
  return series.map((s) => ({
    labels: s.labels,
    values: s.values.map((v, i) => (v === null || grid[i] + stepMs > openAfterMs ? null : v / seconds)),
  }));
}

/** Combine values with a space aggregation; null when there is nothing to combine. */
export function combine(values: number[], agg: MetricSpaceAggregation): number | null {
  if (values.length === 0) return null;
  switch (agg) {
    case 'sum':
      return values.reduce((a, b) => a + b, 0);
    case 'min':
      return Math.min(...values);
    case 'max':
      return Math.max(...values);
    default:
      return values.reduce((a, b) => a + b, 0) / values.length;
  }
}

export function combineSeries(members: GridSeries[], labels: Record<string, string>, agg: MetricSpaceAggregation, length: number): GridSeries {
  const values: Array<number | null> = new Array(length).fill(null);
  for (let i = 0; i < length; i++) {
    const present: number[] = [];
    for (const m of members) {
      const v = m.values[i];
      if (v !== null) present.push(v);
    }
    values[i] = combine(present, agg);
  }
  return { labels, values };
}

/** Pick only `keys` from labels ('' when a key is missing). */
export function pickLabels(labels: Record<string, string>, keys: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of keys) out[k] = labels[k] ?? '';
  return out;
}

/**
 * Space aggregation: series with the same values for `groupKeys` are combined
 * bucket by bucket. With no group keys every series folds into one ({} labels).
 */
export function spaceAggregate(
  series: GridSeries[],
  groupKeys: string[],
  agg: MetricSpaceAggregation,
  length: number,
): GridSeries[] {
  const groups = new Map<string, { labels: Record<string, string>; members: GridSeries[] }>();
  for (const s of series) {
    const labels = pickLabels(s.labels, groupKeys);
    const key = labelKey(labels);
    const g = groups.get(key);
    if (g) g.members.push(s);
    else groups.set(key, { labels, members: [s] });
  }
  return [...groups.values()].map((g) => combineSeries(g.members, g.labels, agg, length));
}

export function seriesMean(values: Array<number | null>): number | null {
  let sum = 0;
  let n = 0;
  for (const v of values) {
    if (v !== null) {
      sum += v;
      n++;
    }
  }
  return n === 0 ? null : sum / n;
}

export interface FoldResult {
  series: GridSeries[];
  seriesTotal: number;
  seriesShown: number;
}

/** Groups ranked by mean value, descending (no value last), ties by labels. */
export function rankByMean(groups: GridSeries[]): GridSeries[] {
  return groups
    .map((g) => ({ g, mean: seriesMean(g.values), key: labelKey(g.labels) }))
    .sort((a, b) => {
      const am = a.mean ?? -Infinity;
      const bm = b.mean ?? -Infinity;
      if (am !== bm) return bm - am;
      return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
    })
    .map((r) => r.g);
}

/**
 * Keep the `limit` groups with the highest mean, fold the rest with
 * `combineRest` (which returns the { __other__: 'true' } series).
 * seriesShown counts the kept groups (the folded rest excluded).
 */
export function foldTopNWith(
  groups: GridSeries[],
  limit: number,
  combineRest: (rest: GridSeries[]) => GridSeries,
): FoldResult {
  const seriesTotal = groups.length;
  if (seriesTotal <= limit) return { series: groups, seriesTotal, seriesShown: seriesTotal };
  const ranked = rankByMean(groups);
  const kept = ranked.slice(0, limit);
  return { series: [...kept, combineRest(ranked.slice(limit))], seriesTotal, seriesShown: kept.length };
}

/**
 * Keep the `limit` groups with the highest mean (descending, ties by labels),
 * fold the rest into one { __other__: 'true' } series with the space
 * aggregation. seriesShown counts the kept groups (the folded rest excluded).
 */
export function foldTopN(
  groups: GridSeries[],
  limit: number,
  agg: MetricSpaceAggregation,
  length: number,
): FoldResult {
  return foldTopNWith(groups, limit, (rest) => combineSeries(rest, { [OTHER_LABEL]: 'true' }, agg, length));
}

/** Last non-null value of a series, or null. */
export function lastValue(values: Array<number | null>): number | null {
  for (let i = values.length - 1; i >= 0; i--) if (values[i] !== null) return values[i];
  return null;
}

/**
 * The `limit` items with the highest recent value (last non-null point,
 * items without one last, ties by labels). Used to cap per-series reads.
 */
export function topByRecent<T extends { labels: Record<string, string> }>(
  items: T[],
  limit: number,
  recent: (item: T) => number | null,
): T[] {
  if (items.length <= limit) return items;
  return items
    .map((item) => ({ item, v: recent(item), key: labelKey(item.labels) }))
    .sort((a, b) => {
      const av = a.v ?? -Infinity;
      const bv = b.v ?? -Infinity;
      if (av !== bv) return bv - av;
      return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
    })
    .slice(0, limit)
    .map((r) => r.item);
}

export function computeStats(values: Array<number | null>): MetricSeriesStats {
  let min: number | null = null;
  let max: number | null = null;
  let last: number | null = null;
  let sum = 0;
  let n = 0;
  for (const v of values) {
    if (v === null) continue;
    min = min === null ? v : Math.min(min, v);
    max = max === null ? v : Math.max(max, v);
    last = v;
    sum += v;
    n++;
  }
  return { min, avg: n === 0 ? null : sum / n, max, last };
}
