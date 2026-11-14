/**
 * Read side of the host detail page: 7 day hourly trend lines of the key
 * counters, and the hardware events (logs) of the host. Reservoir only.
 */
import type {
  HardwareComponentKey,
  HardwareComponentSnapshots,
  HardwareEvent,
  HardwareSeries,
} from '@logtide/shared';
import { HARDWARE_WINDOW_7D_MS } from '@logtide/shared';
import type { MetricTimeBucket } from '@logtide/reservoir';
import { reservoir } from '../../database/reservoir.js';

/** Upper bound of trend lines returned for one host. */
export const MAX_SERIES = 30;
export const EVENTS_DEFAULT_LIMIT = 100;
export const EVENTS_MAX_LIMIT = 500;

interface SeriesSpec {
  /** Key prefix, e.g. `memory.corrected`. */
  prefix: string;
  component: HardwareComponentKey;
  metric: string;
  unit: string;
  /** Extra data-point attribute filter (host.name is always added). */
  filter?: Record<string, string>;
  /** Label key the series is split by. */
  splitBy: 'hw.id' | 'hw.type';
  /** Extra group keys summed into one line per split value (e.g. throttle_type). */
  sumOver?: string[];
  label: (id: string, deviceName: string) => string;
}

/** Priority order: when the host has many devices, later specs are cut first. */
const SPECS: SeriesSpec[] = [
  { prefix: 'temperature.max', component: 'cpu', metric: 'hw.temperature', unit: 'Cel', splitBy: 'hw.type', label: (t) => `Max ${t.replace(/_/g, ' ')} temperature` },
  { prefix: 'memory.uncorrected', component: 'memory', metric: 'hw.memory.errors', unit: 'errors', filter: { error_type: 'uncorrected', scope: 'controller' }, splitBy: 'hw.id', label: (id) => `${id} uncorrected errors` },
  { prefix: 'memory.corrected', component: 'memory', metric: 'hw.memory.errors', unit: 'errors', filter: { error_type: 'corrected', scope: 'controller' }, splitBy: 'hw.id', label: (id) => `${id} corrected errors` },
  { prefix: 'cpu.throttle', component: 'cpu', metric: 'hw.cpu.throttle_count', unit: 'events', splitBy: 'hw.id', sumOver: ['throttle_type'], label: (id) => `${id} thermal throttling` },
  { prefix: 'disk.reallocated_sector_count', component: 'disks', metric: 'hw.physical_disk.smart', unit: 'sectors', filter: { smart_attribute: 'reallocated_sector_count' }, splitBy: 'hw.id', label: (_id, d) => `${d} reallocated sectors` },
  { prefix: 'disk.current_pending_sector', component: 'disks', metric: 'hw.physical_disk.smart', unit: 'sectors', filter: { smart_attribute: 'current_pending_sector' }, splitBy: 'hw.id', label: (_id, d) => `${d} pending sectors` },
  { prefix: 'disk.media_errors', component: 'disks', metric: 'hw.physical_disk.media_errors', unit: 'errors', splitBy: 'hw.id', label: (_id, d) => `${d} media errors` },
  { prefix: 'disk.endurance', component: 'disks', metric: 'hw.physical_disk.endurance_utilization', unit: '%', splitBy: 'hw.id', label: (_id, d) => `${d} endurance used` },
];

function diskNames(snapshot: HardwareComponentSnapshots | null): Map<string, string> {
  const names = new Map<string, string>();
  for (const d of snapshot?.disks?.disks ?? []) {
    names.set(d.hwId, d.device || d.hwId);
  }
  return names;
}

async function loadSpec(
  spec: SeriesSpec,
  host: { projectId: string; organizationId: string; hostName: string },
  from: Date,
  to: Date
): Promise<Map<string, MetricTimeBucket[]>> {
  const groupBy = [spec.splitBy, ...(spec.sumOver ?? [])];
  const res = await reservoir.aggregateMetrics({
    projectId: host.projectId,
    organizationId: host.organizationId,
    metricName: spec.metric,
    from,
    to,
    interval: '1h',
    aggregation: 'max',
    groupBy,
    attributes: { 'host.name': host.hostName, ...(spec.filter ?? {}) },
  });
  // split value -> bucket time -> value (summed over sumOver keys)
  const bySplit = new Map<string, Map<number, number>>();
  for (const b of res.timeseries) {
    if (!Number.isFinite(b.value)) continue;
    const id = b.labels?.[spec.splitBy] ?? '';
    if (!id) continue;
    const buckets = bySplit.get(id) ?? new Map<number, number>();
    const t = new Date(b.bucket).getTime();
    buckets.set(t, (buckets.get(t) ?? 0) + b.value);
    bySplit.set(id, buckets);
  }
  const out = new Map<string, MetricTimeBucket[]>();
  for (const [id, buckets] of bySplit) {
    out.set(
      id,
      [...buckets.entries()].sort((a, b) => a[0] - b[0]).map(([t, value]) => ({ bucket: new Date(t), value }))
    );
  }
  return out;
}

/** Trend lines of the detail page, at most MAX_SERIES, in SPECS priority order. */
export async function loadHostSeries(
  host: { projectId: string; organizationId: string; hostName: string },
  snapshot: HardwareComponentSnapshots | null,
  now: Date = new Date()
): Promise<HardwareSeries[]> {
  const from = new Date(now.getTime() - HARDWARE_WINDOW_7D_MS);
  const disks = diskNames(snapshot);
  const loaded = await Promise.all(SPECS.map((spec) => loadSpec(spec, host, from, now)));
  const series: HardwareSeries[] = [];
  SPECS.forEach((spec, i) => {
    const ids = [...loaded[i].keys()].sort();
    for (const id of ids) {
      if (series.length >= MAX_SERIES) return;
      series.push({
        key: `${spec.prefix}:${id}`,
        component: spec.splitBy === 'hw.type' ? componentOfType(id) : spec.component,
        metric: spec.metric,
        hwId: id,
        label: spec.label(id, disks.get(id) ?? id),
        unit: spec.unit,
        points: loaded[i].get(id)!.map((b) => ({ time: new Date(b.bucket).toISOString(), value: b.value })),
      });
    }
  });
  return series;
}

function componentOfType(hwType: string): HardwareComponentKey {
  switch (hwType) {
    case 'physical_disk':
      return 'disks';
    case 'memory':
      return 'memory';
    default:
      return 'cpu';
  }
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/** Hardware events of a host: logs with service `hardware` and the same hostname, last 7 days, newest first. */
export async function loadHostEvents(
  host: { projectId: string; hostName: string },
  limit: number,
  now: Date = new Date()
): Promise<HardwareEvent[]> {
  const res = await reservoir.query({
    projectId: host.projectId,
    service: 'hardware',
    hostname: host.hostName,
    from: new Date(now.getTime() - HARDWARE_WINDOW_7D_MS),
    to: now,
    limit,
    sortOrder: 'desc',
  });
  return res.logs.map((l) => {
    const meta = (l.metadata ?? {}) as Record<string, unknown>;
    return {
      id: l.id,
      time: (l.time instanceof Date ? l.time : new Date(l.time)).toISOString(),
      level: l.level,
      message: l.message,
      eventType: str(meta['hw.event.type']),
      eventSource: str(meta['hw.event.source']),
    };
  });
}
