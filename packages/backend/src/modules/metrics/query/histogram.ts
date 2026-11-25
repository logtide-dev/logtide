// Histogram math of the query service (1.8). The engines return one
// histogram per bucket and series (hist_last for cumulative temporality,
// hist_sum for delta); this module turns cumulative snapshots into per-bucket
// deltas, merges histograms across series, and reduces a histogram to the
// scalar the query asked for (percentile, avg, count, rate, sum).
//
// Layout (OTLP explicit buckets): counts has bounds.length + 1 entries, bucket
// i holds (bounds[i-1], bounds[i]], the last one is (bounds[n-1], +Inf).

import type { MetricTimeAggregation } from '@logtide/shared';
import type { MetricHistogramValue, MetricTimeBucket } from '@logtide/reservoir';
import { histogramGridBounds } from '../../otlp/exp-histogram-grid.js';
import { bucketStart } from './interval.js';
import { labelKey, OTHER_LABEL, seriesMean, type GridSeries } from './series-fold.js';

export type Histogram = MetricHistogramValue;

export interface HistSeries {
  labels: Record<string, string>;
  values: Array<Histogram | null>;
  /** Seconds each value covers (rate denominator); null where there is no value. */
  seconds: Array<number | null>;
}

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/**
 * The explicit bounds of an engine histogram: a grid id (points stored on a
 * canonical grid, exp-histogram-grid.ts) expands to the grid's bounds, else
 * the bounds the engine returned. An unknown grid id has no bounds (null).
 */
function boundsOf(h: MetricHistogramValue): readonly number[] | null {
  if (typeof h.grid === 'string' && h.grid !== '') return histogramGridBounds(h.grid) ?? null;
  return Array.isArray(h.bounds) ? h.bounds : null;
}

/**
 * A well-formed copy of an engine histogram with explicit bounds (grid ids
 * expanded, so every later step only sees bounds), or null.
 */
export function normalizeHistogram(h: MetricHistogramValue | null | undefined): Histogram | null {
  if (!h || !Array.isArray(h.counts)) return null;
  const bounds = boundsOf(h);
  if (!bounds) return null;
  if (h.counts.length !== bounds.length + 1) return null;
  if (!bounds.every(finite)) return null;
  for (let i = 1; i < bounds.length; i++) if (bounds[i] <= bounds[i - 1]) return null;
  const counts = h.counts.map((c) => (finite(c) && c > 0 ? c : 0));
  const total = counts.reduce((a, b) => a + b, 0);
  return {
    bounds: [...bounds],
    counts,
    sum: finite(h.sum) ? h.sum : 0,
    count: finite(h.count) && h.count >= 0 ? h.count : total,
  };
}

/** Engine histogram buckets onto the grid, one series per label set. */
export function histBucketsToSeries(
  buckets: MetricTimeBucket[],
  grid: number[],
  stepMs: number,
  shiftMs = 0,
): HistSeries[] {
  const index = new Map<number, number>();
  grid.forEach((t, i) => index.set(t, i));
  const series = new Map<string, HistSeries>();
  const stepSeconds = stepMs / 1000;
  for (const b of buckets) {
    const i = index.get(bucketStart(new Date(b.bucket).getTime() + shiftMs, stepMs));
    if (i === undefined) continue;
    const h = normalizeHistogram(b.histogram);
    const labels = b.labels ?? {};
    const key = labelKey(labels);
    let s = series.get(key);
    if (!s) {
      s = { labels: { ...labels }, values: new Array(grid.length).fill(null), seconds: new Array(grid.length).fill(null) };
      series.set(key, s);
    }
    s.values[i] = h;
    s.seconds[i] = h ? stepSeconds : null;
  }
  return [...series.values()];
}

function sameBounds(a: number[], b: number[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Sorted, de-duplicated union of bound sets. */
function unionBounds(sets: number[][]): number[] {
  return [...new Set(sets.flat())].sort((a, b) => a - b);
}

/**
 * Counts of `h` re-bucketed onto `bounds` (a superset of h.bounds): each
 * source bucket lands in the target bucket with the same upper bound (+Inf
 * with +Inf), so the cumulative count at every original bound is kept and the
 * target buckets that split a source bucket get its count in the top one.
 */
function rebucket(h: Histogram, bounds: number[]): number[] {
  const position = new Map<number, number>();
  bounds.forEach((b, i) => position.set(b, i));
  const counts = new Array<number>(bounds.length + 1).fill(0);
  for (let i = 0; i < h.counts.length; i++) {
    const target = i < h.bounds.length ? (position.get(h.bounds[i]) as number) : bounds.length;
    counts[target] += h.counts[i];
  }
  return counts;
}

/**
 * Delta between two cumulative snapshots.
 *
 * Same bounds: bucket by bucket; a lower count or any lower bucket is a reset
 * and the new snapshot is the delta.
 *
 * Different bounds (a series whose bucket layout changed): not a reset by
 * itself. Both snapshots are re-bucketed onto the union of the bounds. Only
 * the bounds present in BOTH snapshots split the range into intervals where
 * both counts are exact (segments); inside a segment the earlier snapshot's
 * mass is unknown in detail. Per segment:
 * - the delta total (new minus old) is exact; a negative one is a reset (the
 *   new snapshot, with its own bounds, is the delta), as is a lower count;
 * - the old mass is taken out of the new snapshot's union buckets from the
 *   top down (consistent with re-bucketing, which puts a source bucket's
 *   count at its upper bound), so every delta bucket is >= 0 and the segment
 *   adds up to the exact delta.
 * The result carries the union bounds; sum and count are the plain
 * differences.
 */
export function diffHistogram(prev: Histogram, cur: Histogram): Histogram {
  if (cur.count < prev.count) return cur;
  if (sameBounds(prev.bounds, cur.bounds)) {
    const counts = new Array<number>(cur.counts.length);
    for (let i = 0; i < cur.counts.length; i++) {
      const d = cur.counts[i] - prev.counts[i];
      if (d < 0) return cur;
      counts[i] = d;
    }
    return { bounds: cur.bounds, counts, sum: cur.sum - prev.sum, count: cur.count - prev.count };
  }

  const bounds = unionBounds([prev.bounds, cur.bounds]);
  const p = rebucket(prev, bounds);
  const c = rebucket(cur, bounds);
  const inCur = new Set(cur.bounds);
  const common = new Set(prev.bounds.filter((b) => inCur.has(b)));
  const counts = new Array<number>(bounds.length + 1).fill(0);
  let start = 0;
  for (let i = 0; i <= bounds.length; i++) {
    // A segment ends at a common bound or at +Inf.
    if (i < bounds.length && !common.has(bounds[i])) continue;
    let remaining = 0;
    let total = 0;
    for (let j = start; j <= i; j++) {
      remaining += p[j];
      total += c[j];
    }
    if (total < remaining) return cur;
    for (let j = i; j >= start; j--) {
      const take = Math.min(c[j], remaining);
      counts[j] = c[j] - take;
      remaining -= take;
    }
    start = i + 1;
  }
  return { bounds, counts, sum: cur.sum - prev.sum, count: cur.count - prev.count };
}

/**
 * Cumulative snapshots (hist_last per bucket) to per-bucket deltas, per
 * series. The first snapshot of a series has nothing to diff against and is
 * dropped; a delta covers the time since the previous snapshot (gaps
 * included), which `seconds` records.
 */
export function cumulativeToDelta(series: HistSeries[], grid: number[]): HistSeries[] {
  return series.map((s) => {
    const values: Array<Histogram | null> = new Array(grid.length).fill(null);
    const seconds: Array<number | null> = new Array(grid.length).fill(null);
    let prev = -1;
    for (let i = 0; i < grid.length; i++) {
      const cur = s.values[i];
      if (!cur) continue;
      if (prev >= 0) {
        values[i] = diffHistogram(s.values[prev] as Histogram, cur);
        seconds[i] = (grid[i] - grid[prev]) / 1000;
      }
      prev = i;
    }
    return { labels: s.labels, values, seconds };
  });
}

/**
 * Merge histograms (space aggregation): bucket counts are added into the union
 * of the bounds, each source bucket landing in the target bucket with the same
 * upper bound (+Inf with +Inf). sum and count add up.
 */
export function mergeHistograms(list: Array<Histogram | null | undefined>): Histogram | null {
  const present = list.filter((h): h is Histogram => !!h);
  if (present.length === 0) return null;
  if (present.length === 1) return { ...present[0], bounds: [...present[0].bounds], counts: [...present[0].counts] };
  const first = present[0];
  const bounds = present.every((h) => sameBounds(h.bounds, first.bounds))
    ? [...first.bounds]
    : unionBounds(present.map((h) => h.bounds));
  const counts = new Array<number>(bounds.length + 1).fill(0);
  let sum = 0;
  let count = 0;
  for (const h of present) {
    rebucket(h, bounds).forEach((c, i) => {
      counts[i] += c;
    });
    sum += h.sum;
    count += h.count;
  }
  return { bounds, counts, sum, count };
}

/**
 * Quantile q (0..1) by linear interpolation inside the bucket holding the
 * rank q * total. The first bucket's lower edge is 0 when its bound is
 * positive (else the bound itself is returned); the +Inf bucket returns the
 * last finite bound. A histogram without bounds falls back to the mean.
 */
export function histogramQuantile(h: Histogram, q: number): number | null {
  const total = h.counts.reduce((a, b) => a + b, 0);
  if (total <= 0) return null;
  const n = h.bounds.length;
  if (n === 0) return h.count > 0 ? h.sum / h.count : null;
  const rank = Math.min(Math.max(q, 0), 1) * total;
  let cumulative = 0;
  for (let i = 0; i <= n; i++) {
    const c = h.counts[i];
    if (c <= 0) continue;
    if (cumulative + c >= rank || i === n) {
      if (i === n) return h.bounds[n - 1];
      const upper = h.bounds[i];
      let lower: number;
      if (i === 0) {
        if (upper <= 0) return upper;
        lower = 0;
      } else {
        lower = h.bounds[i - 1];
      }
      return lower + (upper - lower) * ((rank - cumulative) / c);
    }
    cumulative += c;
  }
  return h.bounds[n - 1];
}

const QUANTILES: Partial<Record<MetricTimeAggregation, number>> = { p50: 0.5, p95: 0.95, p99: 0.99 };

/**
 * Reduce a (delta) histogram to the requested aggregation: p50/p95/p99 =
 * interpolated quantile, avg = sum / count, count, sum, rate = count /
 * seconds; min / max / last fall back to avg.
 */
export function histogramScalar(h: Histogram | null, agg: MetricTimeAggregation, seconds: number | null = null): number | null {
  if (!h) return null;
  const q = QUANTILES[agg];
  if (q !== undefined) return histogramQuantile(h, q);
  switch (agg) {
    case 'count':
      return h.count;
    case 'sum':
      return h.sum;
    case 'rate':
      return seconds !== null && seconds > 0 ? h.count / seconds : null;
    default:
      return h.count > 0 ? h.sum / h.count : null;
  }
}

/** Drop values whose bucket is still open at `openAfterMs` (partial). */
export function dropOpenBuckets(series: HistSeries[], grid: number[], stepMs: number, openAfterMs: number): HistSeries[] {
  return series.map((s) => ({
    labels: s.labels,
    values: s.values.map((v, i) => (grid[i] + stepMs <= openAfterMs ? v : null)),
    seconds: s.seconds.map((v, i) => (grid[i] + stepMs <= openAfterMs ? v : null)),
  }));
}

/** Per-series scalar (used by rate, which is summed across series afterwards). */
export function histSeriesToScalar(series: HistSeries[], agg: MetricTimeAggregation): GridSeries[] {
  return series.map((s) => ({
    labels: s.labels,
    values: s.values.map((h, i) => histogramScalar(h, agg, s.seconds[i])),
  }));
}

/** Pick only `keys` from labels ('' when a key is missing). */
function pick(labels: Record<string, string>, keys: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of keys) out[k] = labels[k] ?? '';
  return out;
}

function mergeMembers(members: HistSeries[], labels: Record<string, string>, length: number): HistSeries {
  const values: Array<Histogram | null> = new Array(length).fill(null);
  const seconds: Array<number | null> = new Array(length).fill(null);
  for (let i = 0; i < length; i++) {
    values[i] = mergeHistograms(members.map((m) => m.values[i]));
    const secs = members.map((m) => m.seconds[i]).filter((x): x is number => x !== null);
    seconds[i] = secs.length > 0 ? Math.max(...secs) : null;
  }
  return { labels, values, seconds };
}

/** Space aggregation of histograms: merge the series sharing the group keys. */
export function mergeHistSeries(series: HistSeries[], groupKeys: string[], length: number): HistSeries[] {
  const groups = new Map<string, { labels: Record<string, string>; members: HistSeries[] }>();
  for (const s of series) {
    const labels = pick(s.labels, groupKeys);
    const key = labelKey(labels);
    const g = groups.get(key);
    if (g) g.members.push(s);
    else groups.set(key, { labels, members: [s] });
  }
  return [...groups.values()].map((g) => mergeMembers(g.members, g.labels, length));
}

/**
 * Top-N over merged histogram groups: rank by the mean of the scalar series,
 * keep `limit`, merge the histograms of the rest into one
 * { __other__: 'true' } series (a percentile of the rest, not a sum of
 * percentiles).
 */
export function foldTopNHistograms(
  groups: HistSeries[],
  limit: number,
  agg: MetricTimeAggregation,
  length: number,
): { series: GridSeries[]; seriesTotal: number; seriesShown: number } {
  const scalar = (g: HistSeries): GridSeries => ({
    labels: g.labels,
    values: g.values.map((h, i) => histogramScalar(h, agg, g.seconds[i])),
  });
  const seriesTotal = groups.length;
  if (seriesTotal <= limit) return { series: groups.map(scalar), seriesTotal, seriesShown: seriesTotal };
  const ranked = groups
    .map((g) => {
      const s = scalar(g);
      return { g, s, mean: seriesMean(s.values), key: labelKey(g.labels) };
    })
    .sort((a, b) => {
      const am = a.mean ?? -Infinity;
      const bm = b.mean ?? -Infinity;
      if (am !== bm) return bm - am;
      return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
    });
  const kept = ranked.slice(0, limit).map((r) => r.s);
  const rest = mergeMembers(
    ranked.slice(limit).map((r) => r.g),
    { [OTHER_LABEL]: 'true' },
    length,
  );
  return { series: [...kept, scalar(rest)], seriesTotal, seriesShown: kept.length };
}
