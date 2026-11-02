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
