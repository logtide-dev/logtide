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
 *
 * `points` must carry one `last` value per FULL series (every attribute key in
 * `labels`), otherwise one bucket's value would come from whichever series
 * wrote last. Per series: rate = (last - previousLast) / elapsed seconds
 * between the two samples (so a missing bucket does not inflate the rate). A
 * negative delta is a counter reset and yields `last / elapsed`. The first
 * bucket of each series has no previous value and is omitted, and so is the
 * still-open last bucket (`bucket + bucketSeconds > now`), which is partial.
 *
 * Rates are then summed per bucket into the `groupBy` groups (all series into
 * one when `groupBy` is empty).
 */
export function toRateSeries(
  points: MetricTimeBucket[],
  bucketSeconds: number,
  options: { groupBy?: string[]; now?: Date } = {},
): MetricTimeBucket[] {
  const nowMs = (options.now ?? new Date()).getTime();
  const groupBy = options.groupBy ?? [];
  const series = new Map<string, MetricTimeBucket[]>();
  for (const p of points) {
    const key = groupKey(p.labels);
    const list = series.get(key);
    if (list) list.push(p);
    else series.set(key, [p]);
  }

  const summed = new Map<string, MetricTimeBucket>();
  for (const list of series.values()) {
    list.sort((a, b) => new Date(a.bucket).getTime() - new Date(b.bucket).getTime());
    for (let i = 1; i < list.length; i++) {
      const bucketMs = new Date(list[i].bucket).getTime();
      if (bucketMs + bucketSeconds * 1000 > nowMs) continue;
      const elapsed = (bucketMs - new Date(list[i - 1].bucket).getTime()) / 1000;
      if (elapsed <= 0) continue;
      const delta = list[i].value - list[i - 1].value;
      const rate = (delta < 0 ? list[i].value : delta) / elapsed;

      let labels: Record<string, string> | undefined;
      if (groupBy.length > 0 && list[i].labels) {
        labels = {};
        for (const k of groupBy) {
          if (list[i].labels![k] !== undefined) labels[k] = list[i].labels![k];
        }
      }
      const key = `${bucketMs}|${groupKey(labels)}`;
      const existing = summed.get(key);
      if (existing) existing.value += rate;
      else {
        const point: MetricTimeBucket = { bucket: list[i].bucket, value: rate };
        if (labels) point.labels = labels;
        summed.set(key, point);
      }
    }
  }
  return [...summed.values()].sort(
    (a, b) => new Date(a.bucket).getTime() - new Date(b.bucket).getTime(),
  );
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
