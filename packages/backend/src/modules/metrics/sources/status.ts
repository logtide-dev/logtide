// Pure rules of the sources list: status, reasons, intervals and the
// template-to-dashboard layout. No I/O here so every branch is unit tested.

import {
  HOST_THRESHOLDS,
  SERVICE_ERROR_THRESHOLDS,
  SOURCE_STALE_AFTER_MS,
  SOURCE_STATUS_RANK,
  applicableTemplatePanels,
  type MetricQueryInterval,
  type MetricSourceStatus,
  type PanelInstance,
  type SignalThreshold,
  type SourceTemplate,
} from '@logtide/shared';

export interface StatusResult {
  status: MetricSourceStatus;
  reason: string | null;
}

export function worseStatus(a: MetricSourceStatus, b: MetricSourceStatus): MetricSourceStatus {
  return SOURCE_STATUS_RANK[b] > SOURCE_STATUS_RANK[a] ? b : a;
}

/** "14 min", "3 h", "2 d": how long a source has been quiet. */
export function formatQuietFor(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h`;
  return `${Math.round(hours / 24)} d`;
}

function levelOf(value: number | null, t: SignalThreshold): 'ok' | 'warning' | 'critical' | null {
  if (value === null || !Number.isFinite(value)) return null;
  if (value >= t.critical) return 'critical';
  if (value >= t.warning) return 'warning';
  return 'ok';
}

function pct(value: number): string {
  return `${Math.round(value)}%`;
}

export interface HardwareStatusInput {
  status: 'ok' | 'warning' | 'critical' | 'unknown' | 'stale';
  /** Most severe finding message, when available. */
  findingMessage: string | null;
}

export interface HostStatusInput {
  /** Reference time (ms): min(now, window end). */
  now: number;
  /** ms */
  lastSeen: number;
  cpu: number | null;
  memory: number | null;
  disk: number | null;
  hardware: HardwareStatusInput[];
}

export function computeHostStatus(input: HostStatusInput): StatusResult {
  const quiet = input.now - input.lastSeen;
  if (quiet > SOURCE_STALE_AFTER_MS) {
    return { status: 'stale', reason: `No data for ${formatQuietFor(quiet)}` };
  }

  const candidates: StatusResult[] = [];
  const checks: Array<['cpu' | 'memory' | 'disk', string, number | null]> = [
    ['disk', 'Disk', input.disk],
    ['cpu', 'CPU', input.cpu],
    ['memory', 'Memory', input.memory],
  ];
  for (const [key, label, value] of checks) {
    const level = levelOf(value, HOST_THRESHOLDS[key]);
    if (level === 'warning' || level === 'critical') {
      candidates.push({ status: level, reason: `${label} at ${pct(value as number)}` });
    }
  }
  // Stale or unknown hardware never downgrades a fresh host.
  for (const hw of input.hardware) {
    if (hw.status === 'warning' || hw.status === 'critical') {
      candidates.push({ status: hw.status, reason: `Hardware: ${hw.findingMessage ?? hw.status}` });
    }
  }

  let best: StatusResult | null = null;
  for (const c of candidates) {
    if (!best || SOURCE_STATUS_RANK[c.status] > SOURCE_STATUS_RANK[best.status]) best = c;
  }
  if (best) return best;

  const judged =
    input.cpu !== null || input.memory !== null || input.disk !== null || input.hardware.some((h) => h.status === 'ok');
  if (!judged) return { status: 'unknown', reason: 'No CPU, memory or disk metrics' };
  return { status: 'ok', reason: null };
}

export interface ServiceStatusInput {
  now: number;
  lastSeen: number;
  /** Error %, null without traces. */
  errorRate: number | null;
}

export function computeServiceStatus(input: ServiceStatusInput): StatusResult {
  const quiet = input.now - input.lastSeen;
  if (quiet > SOURCE_STALE_AFTER_MS) {
    return { status: 'stale', reason: `No data for ${formatQuietFor(quiet)}` };
  }
  const level = levelOf(input.errorRate, SERVICE_ERROR_THRESHOLDS);
  if (level === 'warning' || level === 'critical') {
    return { status: level, reason: `Error rate at ${(input.errorRate as number).toFixed(1)}%` };
  }
  return { status: 'ok', reason: null };
}

const INTERVAL_MS: Array<[Exclude<MetricQueryInterval, 'auto'>, number]> = [
  ['1m', 60_000],
  ['5m', 300_000],
  ['15m', 900_000],
  ['1h', 3_600_000],
  ['6h', 21_600_000],
  ['1d', 86_400_000],
];

/** The interval that gives the bucket count closest to `points` (in ratio terms). */
export function pickInterval(spanMs: number, points: number): Exclude<MetricQueryInterval, 'auto'> {
  const target = Math.max(1, spanMs) / points;
  let best = INTERVAL_MS[0];
  let bestDist = Infinity;
  for (const entry of INTERVAL_MS) {
    const dist = Math.abs(Math.log(entry[1] / target));
    if (dist < bestDist) {
      best = entry;
      bestDist = dist;
    }
  }
  return best[0];
}

/** Last non-null value of a series. */
export function lastNonNull(values: Array<number | null>): number | null {
  for (let i = values.length - 1; i >= 0; i--) {
    const v = values[i];
    if (v !== null && v !== undefined && Number.isFinite(v)) return v;
  }
  return null;
}

/**
 * Panels of a source template as dashboard panel instances: applicable panels
 * only, laid out in rows (x accumulates by w up to 12, a row is as tall as its
 * tallest panel, every section starts a new row), metrics panels scoped to
 * `projectIds` (null = all), trace panels org-wide.
 */
export function buildDashboardPanels(
  template: SourceTemplate,
  metricNames: Iterable<string>,
  projectIds: string[] | null,
  newId: () => string,
): PanelInstance[] {
  const panels: PanelInstance[] = [];
  let x = 0;
  let y = 0;
  let rowHeight = 0;

  for (const section of applicableTemplatePanels(template, metricNames)) {
    if (x > 0) {
      y += rowHeight;
      x = 0;
      rowHeight = 0;
    }
    for (const p of section.panels) {
      const w = Math.min(12, Math.max(1, p.w));
      if (x + w > 12) {
        y += rowHeight;
        x = 0;
        rowHeight = 0;
      }
      const config = JSON.parse(JSON.stringify(p.config)) as PanelInstance['config'];
      if (config.type === 'metrics') {
        config.query.projectIds = projectIds ? [...projectIds] : null;
      } else if ('projectId' in config) {
        (config as { projectId: string | null }).projectId = null;
      }
      panels.push({ id: newId(), layout: { x, y, w, h: p.h }, config });
      x += w;
      rowHeight = Math.max(rowHeight, p.h);
    }
  }
  return panels;
}
