import type { AggregationInterval, MetricTimeBucket } from '@logtide/reservoir';

const MINUTE = 60;
const HOUR = 3600;
const DAY = 86400;

const INTERVAL_SECONDS: Record<AggregationInterval, number> = {
  '1m': MINUTE,
  '5m': 5 * MINUTE,
  '15m': 15 * MINUTE,
  '1h': HOUR,
  '6h': 6 * HOUR,
  '1d': DAY,
  '1w': 7 * DAY,
};

/**
 * Range ladder for `interval=auto`. Each step is the largest range (in seconds)
 * that still uses the given interval; longer ranges fall through to `1w`.
 * The buckets per range stay between roughly 30 and 170, which keeps charts
 * readable without hundreds of points.
 */
const AUTO_LADDER: Array<[maxRangeSeconds: number, interval: AggregationInterval]> = [
  [HOUR, '1m'],
  [6 * HOUR, '5m'],
  [DAY, '15m'],
  [7 * DAY, '1h'],
  [90 * DAY, '1d'],
];

export function intervalSeconds(interval: AggregationInterval): number {
  return INTERVAL_SECONDS[interval];
}

export function pickAutoInterval(from: Date, to: Date): AggregationInterval {
  const rangeSeconds = Math.max(0, (to.getTime() - from.getTime()) / 1000);
  for (const [max, interval] of AUTO_LADDER) {
    if (rangeSeconds <= max) return interval;
  }
  return '1w';
}

function groupKey(labels: Record<string, string> | undefined): string {
  if (!labels) return '';
  const keys = Object.keys(labels).sort();
  return JSON.stringify(keys.map((k) => [k, labels[k]]));
}

/**
 * Convert `last` values of a cumulative counter into per-second rates.
 * Per label group: rate = (last - previousLast) / bucketSeconds. A negative
 * delta is a counter reset and yields `last / bucketSeconds`. The first bucket
 * of each group has no previous value and is omitted.
 */
export function toRateSeries(points: MetricTimeBucket[], bucketSeconds: number): MetricTimeBucket[] {
  const groups = new Map<string, MetricTimeBucket[]>();
  for (const p of points) {
    const key = groupKey(p.labels);
    const list = groups.get(key);
    if (list) list.push(p);
    else groups.set(key, [p]);
  }

  const out: MetricTimeBucket[] = [];
  for (const list of groups.values()) {
    list.sort((a, b) => new Date(a.bucket).getTime() - new Date(b.bucket).getTime());
    for (let i = 1; i < list.length; i++) {
      const delta = list[i].value - list[i - 1].value;
      const rate = (delta < 0 ? list[i].value : delta) / bucketSeconds;
      const point: MetricTimeBucket = { bucket: list[i].bucket, value: rate };
      if (list[i].labels) point.labels = list[i].labels;
      out.push(point);
    }
  }
  out.sort((a, b) => new Date(a.bucket).getTime() - new Date(b.bucket).getTime());
  return out;
}

export class TooManyFilterValuesError extends Error {
  constructor(maxCombos: number) {
    super(`Too many filter values (max ${maxCombos} combinations)`);
    this.name = 'TooManyFilterValuesError';
  }
}

/** Cartesian product of the attribute filter values, one record per combination. */
export function expandAttributeFilters(
  attrs: Record<string, string[]>,
  maxCombos = 10,
): Record<string, string>[] {
  const keys = Object.keys(attrs).filter((k) => attrs[k].length > 0);
  let combos: Record<string, string>[] = [{}];
  for (const key of keys) {
    const next: Record<string, string>[] = [];
    for (const combo of combos) {
      for (const value of attrs[key]) {
        next.push({ ...combo, [key]: value });
      }
    }
    if (next.length > maxCombos) throw new TooManyFilterValuesError(maxCombos);
    combos = next;
  }
  return combos;
}

/** Keep the `maxSeries` label groups with the highest peak value. */
export function capSeries(
  points: MetricTimeBucket[],
  maxSeries = 20,
): { points: MetricTimeBucket[]; seriesTotal: number; seriesShown: number } {
  const peaks = new Map<string, number>();
  for (const p of points) {
    const key = groupKey(p.labels);
    const prev = peaks.get(key);
    if (prev === undefined || p.value > prev) peaks.set(key, p.value);
  }
  const seriesTotal = peaks.size;
  if (seriesTotal <= maxSeries) {
    return { points, seriesTotal, seriesShown: seriesTotal };
  }
  const keep = new Set(
    [...peaks.entries()]
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
      .slice(0, maxSeries)
      .map(([key]) => key),
  );
  return {
    points: points.filter((p) => keep.has(groupKey(p.labels))),
    seriesTotal,
    seriesShown: maxSeries,
  };
}
