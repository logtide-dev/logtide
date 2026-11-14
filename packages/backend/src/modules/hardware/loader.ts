/**
 * Reads the evaluator input of every host of ONE project with one query set
 * (never one query per host in the normal case), through reservoir only so it
 * works on every storage engine:
 *  - latest: raw `hw.*` points of the last HARDWARE_LATEST_WINDOW_MS, newest
 *    first, paged with a time keyset cursor (never OFFSET over the window) and
 *    capped at MAX_LATEST_POINTS. When the cap is hit every host is marked
 *    `partial` (its oldest points may be missing) and each host that got no
 *    point at all gets one small query of its own, so the cap never drops a
 *    whole host;
 *  - history: min and max over 24 h and 7 d of every series listed in
 *    HARDWARE_HISTORY_SERIES, grouped by host.name plus that metric's keys.
 *    One hourly aggregate per metric and per function over 7 d; the 24 h
 *    values come from the buckets that start inside the last 24 h. History
 *    is cached per project for HISTORY_CACHE_TTL_MS (the latest points are
 *    read on every pass).
 * Points are split per host in memory by the `host.name` attribute (resource
 * attribute as a fallback), matched exactly as registered.
 */
import {
  HARDWARE_HISTORY_SERIES,
  HARDWARE_LATEST_WINDOW_MS,
  HARDWARE_METRIC_NAMES,
  HARDWARE_WINDOW_24H_MS,
  HARDWARE_WINDOW_7D_MS,
} from '@logtide/shared';
import { hub } from '@logtide/core';
import type { MetricAggregationFn, StoredMetricRecord } from '@logtide/reservoir';
import { reservoir } from '../../database/reservoir.js';
import { isInternalLoggingEnabled } from '../../utils/internal-logger.js';
import type { HardwareHistoryEntry, HardwareLatestPoint } from './evaluator.js';

export const LATEST_PAGE_SIZE = 5_000;
export const MAX_LATEST_POINTS = 100_000;
/** Newest points read for a host that got none before the cap was hit. */
export const FALLBACK_POINTS_PER_HOST = 2_000;
export const HISTORY_CACHE_TTL_MS = 15 * 60_000;
const HISTORY_CACHE_MAX_PROJECTS = 1_000;

export interface HostHardwareData {
  latest: HardwareLatestPoint[];
  history: HardwareHistoryEntry[];
  /** True when some of the latest points of the window may be missing. */
  partial: boolean;
}

export interface ProjectHardwareData {
  hosts: Map<string, HostHardwareData>;
  /** True when the latest window had more points than the cap. */
  truncated: boolean;
}

export interface LoaderLimits {
  pageSize?: number;
  maxPoints?: number;
}

function hostOf(attributes: Record<string, unknown> | undefined, resource?: Record<string, unknown>): string | null {
  const v = attributes?.['host.name'] ?? resource?.['host.name'];
  return typeof v === 'string' && v.length > 0 ? v : null;
}

const timeOf = (m: StoredMetricRecord): Date => (m.time instanceof Date ? m.time : new Date(m.time));

function toLatest(m: StoredMetricRecord): HardwareLatestPoint {
  return {
    metric: m.metricName,
    attributes: (m.attributes ?? {}) as HardwareLatestPoint['attributes'],
    value: m.value,
    time: timeOf(m),
  };
}

function logCap(projectId: string, organizationId: string, maxPoints: number, fallbackHosts: number): void {
  const message = `[Hardware] latest window over ${maxPoints.toLocaleString('en-US')} points, oldest points skipped`;
  console.warn(`${message} (project ${projectId}, ${fallbackHosts.toLocaleString('en-US')} host(s) read one by one)`);
  if (isInternalLoggingEnabled()) {
    hub.captureLog('warn', message, { projectId, organizationId, maxPoints, fallbackHosts });
  }
}

async function loadLatest(
  projectId: string,
  organizationId: string,
  hostNames: ReadonlySet<string>,
  now: Date,
  out: Map<string, HostHardwareData>,
  limits: Required<LoaderLimits>
): Promise<boolean> {
  const from = new Date(now.getTime() - HARDWARE_LATEST_WINDOW_MS);
  const base = { projectId, organizationId, metricName: [...HARDWARE_METRIC_NAMES], from, sortOrder: 'desc' as const };
  let loaded = 0;
  const take = (m: StoredMetricRecord) => {
    loaded++;
    const host = hostOf(m.attributes, m.resourceAttributes);
    if (!host || !hostNames.has(host)) return;
    out.get(host)!.latest.push(toLatest(m));
  };

  // Keyset on time, newest first. Engines return millisecond times while
  // storing finer ones, so the cursor works on whole milliseconds: a page
  // keeps the points newer than its oldest millisecond and the next page
  // starts before the end of that millisecond (reading it again in full).
  let to = now;
  let toExclusive = false;
  let truncated = false;
  for (;;) {
    const page = await reservoir.queryMetrics({ ...base, to, toExclusive, limit: limits.pageSize });
    if (!page.hasMore) {
      page.metrics.forEach(take);
      break;
    }
    const times = page.metrics.map((m) => timeOf(m).getTime());
    const oldest = Math.min(...times);
    if (oldest === Math.max(...times)) {
      // A whole page inside one millisecond: read that millisecond by offset.
      for (let offset = 0; ; ) {
        const group = await reservoir.queryMetrics({
          ...base,
          from: new Date(oldest),
          to: new Date(oldest + 1),
          toExclusive: true,
          limit: limits.pageSize,
          offset,
        });
        group.metrics.forEach(take);
        offset += group.metrics.length;
        if (!group.hasMore || group.metrics.length === 0 || loaded >= limits.maxPoints) break;
      }
      to = new Date(oldest);
    } else {
      page.metrics.forEach((m, i) => {
        if (times[i] > oldest) take(m);
      });
      to = new Date(oldest + 1);
    }
    toExclusive = true;
    if (to.getTime() <= from.getTime()) break;
    if (loaded >= limits.maxPoints) {
      truncated = true;
      break;
    }
  }
  if (!truncated) return false;

  const empty = [...hostNames].filter((h) => out.get(h)!.latest.length === 0);
  logCap(projectId, organizationId, limits.maxPoints, empty.length);
  for (const entry of out.values()) entry.partial = true;
  for (const host of empty) {
    const res = await reservoir.queryMetrics({
      ...base,
      to: now,
      attributes: { 'host.name': host },
      limit: FALLBACK_POINTS_PER_HOST,
    });
    for (const m of res.metrics) out.get(host)!.latest.push(toLatest(m));
  }
  return true;
}

type Buckets = Map<string, { labels: Record<string, string>; buckets: Array<{ t: number; v: number }> }>;

async function hourlySeries(
  projectId: string,
  organizationId: string,
  metric: string,
  groupBy: string[],
  fn: Extract<MetricAggregationFn, 'min' | 'max'>,
  now: Date
): Promise<Buckets> {
  const result = await reservoir.aggregateMetrics({
    projectId,
    organizationId,
    metricName: metric,
    from: new Date(now.getTime() - HARDWARE_WINDOW_7D_MS),
    to: now,
    interval: '1h',
    aggregation: fn,
    groupBy,
  });
  const out: Buckets = new Map();
  for (const b of result.timeseries) {
    if (!Number.isFinite(b.value)) continue;
    const labels = b.labels ?? {};
    const k = groupBy.map((g) => labels[g] ?? '').join('\u0001');
    let series = out.get(k);
    if (!series) {
      series = { labels, buckets: [] };
      out.set(k, series);
    }
    series.buckets.push({ t: new Date(b.bucket).getTime(), v: b.value });
  }
  return out;
}

/** min or max of the buckets starting at or after `since` (null when none). */
function fold(buckets: Array<{ t: number; v: number }> | undefined, since: number, fn: 'min' | 'max'): number | null {
  let acc: number | null = null;
  for (const b of buckets ?? []) {
    if (b.t < since) continue;
    acc = acc === null ? b.v : fn === 'min' ? Math.min(acc, b.v) : Math.max(acc, b.v);
  }
  return acc;
}

/** History entries of every host of the project, by host name. */
async function loadHistory(projectId: string, organizationId: string, now: Date): Promise<Map<string, HardwareHistoryEntry[]>> {
  const byHost = new Map<string, HardwareHistoryEntry[]>();
  // 24 h = the buckets that start inside the last 24 h (the partial bucket
  // at the edge is left out, never counted twice).
  const since24h = now.getTime() - HARDWARE_WINDOW_24H_MS;
  const since7d = Number.NEGATIVE_INFINITY;
  // Sequential per metric (min and max in parallel) to keep the pass gentle
  // on the database.
  for (const [metric, keys] of Object.entries(HARDWARE_HISTORY_SERIES)) {
    const groupBy = ['host.name', ...keys];
    const [mins, maxs] = await Promise.all([
      hourlySeries(projectId, organizationId, metric, groupBy, 'min', now),
      hourlySeries(projectId, organizationId, metric, groupBy, 'max', now),
    ]);
    for (const k of new Set([...mins.keys(), ...maxs.keys()])) {
      const labels = (mins.get(k) ?? maxs.get(k))!.labels;
      const host = labels['host.name'];
      if (!host) continue;
      const list = byHost.get(host) ?? [];
      list.push({
        metric,
        attributes: labels,
        min24h: fold(mins.get(k)?.buckets, since24h, 'min'),
        max24h: fold(maxs.get(k)?.buckets, since24h, 'max'),
        min7d: fold(mins.get(k)?.buckets, since7d, 'min'),
        max7d: fold(maxs.get(k)?.buckets, since7d, 'max'),
      });
      byHost.set(host, list);
    }
  }
  return byHost;
}

const historyCache = new Map<string, { at: number; byHost: Map<string, HardwareHistoryEntry[]> }>();

/** Test hook: drop every cached project history. */
export function resetHardwareHistoryCache(): void {
  historyCache.clear();
}

async function cachedHistory(
  projectId: string,
  organizationId: string,
  now: Date
): Promise<Map<string, HardwareHistoryEntry[]>> {
  const key = `${organizationId}\u0000${projectId}`;
  const hit = historyCache.get(key);
  const age = hit ? now.getTime() - hit.at : -1;
  if (hit && age >= 0 && age < HISTORY_CACHE_TTL_MS) return hit.byHost;
  const byHost = await loadHistory(projectId, organizationId, now);
  historyCache.delete(key);
  historyCache.set(key, { at: now.getTime(), byHost });
  while (historyCache.size > HISTORY_CACHE_MAX_PROJECTS) {
    const oldest = historyCache.keys().next().value;
    if (oldest === undefined) break;
    historyCache.delete(oldest);
  }
  return byHost;
}

/** Evaluator inputs of the given hosts of one project. Hosts without data get an empty entry. */
export async function loadProjectHardwareData(
  projectId: string,
  organizationId: string,
  hostNames: ReadonlySet<string>,
  now: Date,
  limits: LoaderLimits = {}
): Promise<ProjectHardwareData> {
  const hosts = new Map<string, HostHardwareData>();
  for (const name of hostNames) hosts.set(name, { latest: [], history: [], partial: false });
  if (hostNames.size === 0) return { hosts, truncated: false };
  const truncated = await loadLatest(projectId, organizationId, hostNames, now, hosts, {
    pageSize: limits.pageSize ?? LATEST_PAGE_SIZE,
    maxPoints: limits.maxPoints ?? MAX_LATEST_POINTS,
  });
  const history = await cachedHistory(projectId, organizationId, now);
  for (const [name, entry] of hosts) entry.history = history.get(name) ?? [];
  return { hosts, truncated };
}
