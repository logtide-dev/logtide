// Log volume (histogram and count) helpers shared by engines that keep a
// per-minute pre-aggregate (the ClickHouse minute projection) and by the
// backend's TimescaleDB continuous aggregate.

import type { LogFilterParams } from './types.js';

const MINUTE_MS = 60_000;

/**
 * Whether a log filter only constrains projects, the time range, levels and
 * services (included or excluded): the columns a per-minute volume
 * pre-aggregate keeps. Any text, metadata, hostname, trace, session or span
 * condition needs the logs themselves.
 */
export function isVolumeOnlyFilter(filter: LogFilterParams): boolean {
  if (filter.matchNothing) return false;
  if (Array.isArray(filter.projectId) && filter.projectId.length === 0) return false;
  if (filter.hostname !== undefined || filter.traceId !== undefined || filter.sessionId !== undefined || filter.spanId !== undefined) {
    return false;
  }
  if (filter.search !== undefined && filter.search !== '') return false;
  const text = filter.textQuery;
  if (text && (text.all.length > 0 || text.anyOf.length > 0 || text.none.length > 0)) return false;
  if (filter.metadataFilters && filter.metadataFilters.length > 0) return false;
  if (filter.exclude?.hostname && filter.exclude.hostname.length > 0) return false;
  return true;
}

export interface VolumeRange {
  from: Date;
  to: Date;
  fromExclusive?: boolean;
  toExclusive?: boolean;
}

/**
 * The whole minutes inside a range (half-open, minute aligned) and the raw
 * edge ranges around them, which together cover the range exactly. `minutes`
 * is null when the range holds no whole minute.
 */
export function splitWholeMinutes(range: VolumeRange): { minutes: { from: Date; to: Date } | null; edges: VolumeRange[] } {
  const fromMs = range.from.getTime();
  const toMs = range.to.getTime();
  let start = Math.ceil(fromMs / MINUTE_MS) * MINUTE_MS;
  if (range.fromExclusive && start === fromMs) start += MINUTE_MS;
  const end = Math.floor(toMs / MINUTE_MS) * MINUTE_MS;
  if (end - start < MINUTE_MS) return { minutes: null, edges: [range] };
  const edges: VolumeRange[] = [];
  if (start > fromMs) edges.push({ from: range.from, to: new Date(start), fromExclusive: range.fromExclusive, toExclusive: true });
  if (end < toMs || !range.toExclusive) edges.push({ from: new Date(end), to: range.to, fromExclusive: false, toExclusive: range.toExclusive });
  return { minutes: { from: new Date(start), to: new Date(end) }, edges };
}

/** Inclusive [lo, hi] ms spans a pre-aggregate must not answer for (may be +-Infinity). */
export type StaleSpan = [number, number];

/**
 * Splits a range into the whole minutes a pre-aggregate answers and the raw
 * ranges (read as logs) that cover the rest exactly: the partial minutes at
 * the edges and every minute touched by a stale span. Adjacent raw ranges
 * are merged. `aggregate` is empty when no whole minute is left, and `raw`
 * is then the range itself.
 */
export function splitByStaleMinutes(
  range: VolumeRange,
  stale: StaleSpan[],
): { aggregate: { from: Date; to: Date }[]; raw: VolumeRange[] } {
  const floorMinute = (ms: number) => Math.floor(ms / MINUTE_MS) * MINUTE_MS;
  const { minutes, edges } = splitWholeMinutes(range);
  if (!minutes) return { aggregate: [], raw: [range] };
  const start = minutes.from.getTime();
  const end = minutes.to.getTime();

  const holes = stale
    .map(([lo, hi]) => [
      Math.max(start, Number.isFinite(lo) ? floorMinute(lo) : -Infinity),
      Math.min(end, Number.isFinite(hi) ? floorMinute(hi) + MINUTE_MS : Infinity),
    ] as const)
    .filter(([lo, hi]) => lo < hi)
    .sort((x, y) => x[0] - y[0]);
  const aggregate: { from: Date; to: Date }[] = [];
  const middle: VolumeRange[] = [];
  let cursor = start;
  for (const [lo, hi] of holes) {
    if (hi <= cursor) continue;
    if (lo > cursor) aggregate.push({ from: new Date(cursor), to: new Date(lo) });
    middle.push({ from: new Date(Math.max(lo, cursor)), to: new Date(hi), fromExclusive: false, toExclusive: true });
    cursor = hi;
  }
  if (cursor < end) aggregate.push({ from: new Date(cursor), to: new Date(end) });
  if (aggregate.length === 0) return { aggregate: [], raw: [range] };

  const left = edges.filter((e) => e.to.getTime() <= start);
  const right = edges.filter((e) => e.from.getTime() >= end);
  const raw: VolumeRange[] = [];
  for (const r of [...left, ...middle, ...right]) {
    const prev = raw[raw.length - 1];
    if (prev && prev.toExclusive && !r.fromExclusive && prev.to.getTime() === r.from.getTime()) {
      raw[raw.length - 1] = { from: prev.from, to: r.to, fromExclusive: prev.fromExclusive, toExclusive: r.toExclusive };
    } else {
      raw.push(r);
    }
  }
  return { aggregate, raw };
}
