/**
 * Reads the evaluator input of every host of ONE project with one query set
 * (never one query per host), through reservoir only so it works on every
 * storage engine:
 *  - latest: raw `hw.*` points of the last HARDWARE_LATEST_WINDOW_MS, newest
 *    first, paged and capped at MAX_LATEST_POINTS (when capped, the oldest
 *    points are the ones dropped, and the evaluator keeps the newest point per
 *    series anyway);
 *  - history: min and max over 24 h and 7 d of every series listed in
 *    HARDWARE_HISTORY_SERIES, grouped by host.name plus that metric's keys
 *    (aggregateMetrics with a 1 d interval; buckets are merged here, so the
 *    windows are exact to the second).
 * Points are split per host in memory by the `host.name` attribute (resource
 * attribute as a fallback).
 */
import {
  HARDWARE_HISTORY_SERIES,
  HARDWARE_LATEST_WINDOW_MS,
  HARDWARE_METRIC_NAMES,
  HARDWARE_WINDOW_24H_MS,
  HARDWARE_WINDOW_7D_MS,
} from '@logtide/shared';
import type { MetricAggregationFn } from '@logtide/reservoir';
import { reservoir } from '../../database/reservoir.js';
import type { HardwareHistoryEntry, HardwareLatestPoint } from './evaluator.js';

export const LATEST_PAGE_SIZE = 5_000;
export const MAX_LATEST_POINTS = 100_000;

export interface HostHardwareData {
  latest: HardwareLatestPoint[];
  history: HardwareHistoryEntry[];
}

export interface ProjectHardwareData {
  hosts: Map<string, HostHardwareData>;
  /** True when the latest window had more points than MAX_LATEST_POINTS. */
  truncated: boolean;
}

function hostOf(attributes: Record<string, unknown> | undefined, resource?: Record<string, unknown>): string | null {
  const v = attributes?.['host.name'] ?? resource?.['host.name'];
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function bucketFor(map: Map<string, HostHardwareData>, host: string): HostHardwareData {
  let entry = map.get(host);
  if (!entry) {
    entry = { latest: [], history: [] };
    map.set(host, entry);
  }
  return entry;
}

async function loadLatest(
  projectId: string,
  organizationId: string,
  hostNames: ReadonlySet<string>,
  now: Date,
  out: Map<string, HostHardwareData>
): Promise<boolean> {
  const from = new Date(now.getTime() - HARDWARE_LATEST_WINDOW_MS);
  let offset = 0;
  for (;;) {
    const page = await reservoir.queryMetrics({
      projectId,
      organizationId,
      metricName: [...HARDWARE_METRIC_NAMES],
      from,
      to: now,
      sortOrder: 'desc',
      limit: LATEST_PAGE_SIZE,
      offset,
    });
    for (const m of page.metrics) {
      const host = hostOf(m.attributes, m.resourceAttributes);
      if (!host || !hostNames.has(host)) continue;
      bucketFor(out, host).latest.push({
        metric: m.metricName,
        attributes: (m.attributes ?? {}) as HardwareLatestPoint['attributes'],
        value: m.value,
        time: m.time instanceof Date ? m.time : new Date(m.time),
      });
    }
    offset += page.metrics.length;
    if (!page.hasMore || page.metrics.length === 0) return false;
    if (offset >= MAX_LATEST_POINTS) return true;
  }
}

type Window = '24h' | '7d';

async function aggregateSeries(
  projectId: string,
  organizationId: string,
  metric: string,
  keys: readonly string[],
  window: Window,
  fn: Extract<MetricAggregationFn, 'min' | 'max'>,
  now: Date
): Promise<Map<string, { labels: Record<string, string>; value: number }>> {
  const span = window === '24h' ? HARDWARE_WINDOW_24H_MS : HARDWARE_WINDOW_7D_MS;
  const groupBy = ['host.name', ...keys];
  const result = await reservoir.aggregateMetrics({
    projectId,
    organizationId,
    metricName: metric,
    from: new Date(now.getTime() - span),
    to: now,
    interval: '1d',
    aggregation: fn,
    groupBy,
  });
  // Several day buckets per series: merge them into one value for the window.
  const merged = new Map<string, { labels: Record<string, string>; value: number }>();
  for (const b of result.timeseries) {
    if (!Number.isFinite(b.value)) continue;
    const labels = b.labels ?? {};
    const k = groupBy.map((g) => labels[g] ?? '').join('\u0001');
    const cur = merged.get(k);
    if (!cur) merged.set(k, { labels, value: b.value });
    else cur.value = fn === 'min' ? Math.min(cur.value, b.value) : Math.max(cur.value, b.value);
  }
  return merged;
}

async function loadHistory(
  projectId: string,
  organizationId: string,
  hostNames: ReadonlySet<string>,
  now: Date,
  out: Map<string, HostHardwareData>
): Promise<void> {
  // Sequential per metric (four aggregate calls in parallel each) to keep
  // the pass gentle on the database.
  for (const [metric, keys] of Object.entries(HARDWARE_HISTORY_SERIES)) {
    const [min24, max24, min7, max7] = await Promise.all([
      aggregateSeries(projectId, organizationId, metric, keys, '24h', 'min', now),
      aggregateSeries(projectId, organizationId, metric, keys, '24h', 'max', now),
      aggregateSeries(projectId, organizationId, metric, keys, '7d', 'min', now),
      aggregateSeries(projectId, organizationId, metric, keys, '7d', 'max', now),
    ]);
    const seriesKeys = new Set([...min24.keys(), ...max24.keys(), ...min7.keys(), ...max7.keys()]);
    for (const k of seriesKeys) {
      const labels = (min7.get(k) ?? max7.get(k) ?? min24.get(k) ?? max24.get(k))!.labels;
      const host = labels['host.name'];
      if (!host || !hostNames.has(host)) continue;
      bucketFor(out, host).history.push({
        metric,
        attributes: labels,
        min24h: min24.get(k)?.value ?? null,
        max24h: max24.get(k)?.value ?? null,
        min7d: min7.get(k)?.value ?? null,
        max7d: max7.get(k)?.value ?? null,
      });
    }
  }
}

/** Evaluator inputs of the given hosts of one project. Hosts without data get an empty entry. */
export async function loadProjectHardwareData(
  projectId: string,
  organizationId: string,
  hostNames: ReadonlySet<string>,
  now: Date
): Promise<ProjectHardwareData> {
  const hosts = new Map<string, HostHardwareData>();
  for (const name of hostNames) hosts.set(name, { latest: [], history: [] });
  if (hostNames.size === 0) return { hosts, truncated: false };
  const truncated = await loadLatest(projectId, organizationId, hostNames, now, hosts);
  await loadHistory(projectId, organizationId, hostNames, now, hosts);
  return { hosts, truncated };
}
