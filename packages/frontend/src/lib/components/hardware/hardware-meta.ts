import {
  HARDWARE_COMPONENT_LABELS,
  HARDWARE_THRESHOLDS,
  quoteFieldValue,
  type HardwareComponentKey,
  type HardwareComponentStatus,
  type HardwareCounter,
  type HardwareDisk,
  type HardwareDiskAttribute,
  type HardwareHostSummary,
  type HardwareSeries,
  type HardwareSmartAttribute,
  type HardwareStatus,
} from '@logtide/shared';
import { severityTone, stateTone, type Tone } from '$lib/utils/severity';
import { writeScopeToUrl } from '$lib/stores/scope-url';
import { API_KEY_PLACEHOLDER } from '$lib/components/connect/endpoints';

export const HARDWARE_DOCS_URL = 'https://logtide.dev/docs/hardware-health';

/** The Hardware Health pack is an operational pack, managed from Alerts. */
export const HARDWARE_PACK_URL = '/dashboard/alerts';

const STATUS_LABELS: Record<HardwareStatus, string> = {
  ok: 'OK',
  warning: 'Warning',
  critical: 'Critical',
  unknown: 'Unknown',
  stale: 'Stale',
};

/** A virtual machine that reports no sensors: unknown is expected, not a problem. */
export function isNoSensors(host: { status: string; isVirtual?: boolean }): boolean {
  return host.isVirtual === true && host.status === 'unknown';
}

export const NO_SENSORS_TOOLTIP = 'Virtual machine: hardware sensors are not exposed';

export function hardwareStatusLabel(status: HardwareStatus | string): string {
  return STATUS_LABELS[status as HardwareStatus] ?? 'Unknown';
}

export function hardwareStatusTone(status: HardwareStatus | string): Tone {
  switch (status) {
    case 'ok':
      return stateTone('ok');
    case 'warning':
      return severityTone('medium');
    case 'critical':
      return severityTone('high');
    default:
      // stale and unknown carry no verdict
      return stateTone('disabled');
  }
}

export function componentLabel(key: HardwareComponentKey): string {
  return HARDWARE_COMPONENT_LABELS[key];
}

export function componentTooltip(key: HardwareComponentKey, status: HardwareComponentStatus): string {
  const label = HARDWARE_COMPONENT_LABELS[key];
  if (status === 'unknown') return `${label}: no data reported`;
  return `${label}: ${hardwareStatusLabel(status).toLowerCase()}`;
}

export interface HardwareSummaryCounts {
  total: number;
  ok: number;
  warning: number;
  critical: number;
  stale: number;
}

export function summarizeHosts(hosts: Pick<HardwareHostSummary, 'status'>[]): HardwareSummaryCounts {
  const out: HardwareSummaryCounts = { total: hosts.length, ok: 0, warning: 0, critical: 0, stale: 0 };
  for (const h of hosts) {
    if (h.status === 'ok') out.ok++;
    else if (h.status === 'warning') out.warning++;
    else if (h.status === 'critical') out.critical++;
    else if (h.status === 'stale') out.stale++;
  }
  return out;
}

const HOST_ORDER: Record<HardwareStatus, number> = { critical: 0, warning: 1, stale: 2, unknown: 3, ok: 4 };

/** Worst first, then by name. */
export function sortHosts<T extends Pick<HardwareHostSummary, 'status' | 'hostName'>>(hosts: T[]): T[] {
  return [...hosts].sort(
    (a, b) => HOST_ORDER[a.status] - HOST_ORDER[b.status] || a.hostName.localeCompare(b.hostName)
  );
}

export type HardwareStatusFilter = 'all' | 'ok' | 'warning' | 'critical' | 'stale';

export function filterHosts<T extends Pick<HardwareHostSummary, 'status'>>(
  hosts: T[],
  filter: HardwareStatusFilter
): T[] {
  return filter === 'all' ? hosts : hosts.filter((h) => h.status === filter);
}

// ---------------------------------------------------------------------------
// Setup snippet
// ---------------------------------------------------------------------------

export function buildAgentRunCommand(apiUrl: string, apiKey: string | null = null): string {
  return [
    'docker run -d --name logtide-hw-agent --restart unless-stopped --privileged \\',
    `  -e LOGTIDE_URL=${apiUrl} -e LOGTIDE_API_KEY=${apiKey ?? API_KEY_PLACEHOLDER} \\`,
    '  -e HOST_ROOT=/host \\',
    '  -v /sys:/host/sys:ro -v /proc:/host/proc:ro -v /etc/hostname:/host/etc/hostname:ro \\',
    '  -v logtide-hw-agent-state:/var/lib/logtide-hw-agent \\',
    '  logtide/hw-agent:latest',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Collectors
// ---------------------------------------------------------------------------

const COLLECTOR_HINTS: Record<string, string> = {
  smart: 'smartctl is missing or cannot open the disks (needs --privileged)',
  edac: 'No EDAC memory controller (virtual machine or unsupported platform)',
  hwmon: 'No hwmon sensors exposed by the kernel',
  ipmi: 'No BMC or ipmitool',
  net: 'Cannot read network interface statistics',
  thermal: 'No thermal zones exposed by the kernel',
  kmsg: 'Cannot read the kernel log (/dev/kmsg)',
  sel: 'No BMC system event log or ipmitool',
};

export function collectorHint(collector: string): string {
  return COLLECTOR_HINTS[collector] ?? 'The collector reported a failure';
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

const num = (n: number, max = 1) => n.toLocaleString('en-US', { maximumFractionDigits: max });

export function formatCounterTotal(n: number): string {
  return num(n, 0);
}

function deltaPart(delta: number | null, window: string): string | null {
  if (delta === null) return null;
  return `${delta > 0 ? '+' : ''}${num(delta, 2)} in ${window}`;
}

/** "+2 in 24 h, +5 in 7 d", "no change" or "no history yet". */
export function counterDeltaText(c: Pick<HardwareCounter, 'delta24h' | 'delta7d'>): string {
  if (c.delta24h === null && c.delta7d === null) return 'no history yet';
  if ((c.delta24h ?? 0) === 0 && (c.delta7d ?? 0) === 0) return 'no change';
  return [deltaPart(c.delta24h, '24 h'), deltaPart(c.delta7d, '7 d')]
    .filter((p): p is string => p !== null)
    .join(', ');
}

export function counterGrew(c: Pick<HardwareCounter, 'delta24h' | 'delta7d'>): boolean {
  return (c.delta24h ?? 0) > 0 || (c.delta7d ?? 0) > 0;
}

export function formatMemorySize(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes)) return '-';
  const gib = bytes / 1024 ** 3;
  if (gib >= 1) return `${num(gib)} GB`;
  return `${num(bytes / 1024 ** 2)} MB`;
}

export function formatLinkSpeed(mbps: number | null): string {
  if (mbps === null || !Number.isFinite(mbps) || mbps <= 0) return '-';
  return mbps >= 1000 ? `${num(mbps / 1000)} Gb/s` : `${num(mbps)} Mb/s`;
}

export function formatCelsius(c: number | null): string {
  return c === null || !Number.isFinite(c) ? '-' : formatUnitValue(c, 'Cel');
}

export function formatPercent(p: number | null): string {
  return p === null || !Number.isFinite(p) ? '-' : `${num(p)}%`;
}

function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  if (Math.abs(bytes) < 1024) return `${num(bytes, 0)} B`;
  let i = 0;
  let v = bytes;
  while (Math.abs(v) >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${num(v)} ${units[i]}`;
}

/**
 * One display formatter for OTLP/UCUM units: Cel -> degrees, By -> human bytes,
 * 1 or empty -> plain count, {errors} -> errors.
 */
export function formatUnitValue(value: number, unit?: string | null): string {
  if (!Number.isFinite(value)) return '-';
  const u = (unit ?? '').trim();
  if (u === '' || u === '1') return num(value, 2);
  if (u === 'Cel') return `${num(value)} °C`;
  if (u === '%') return `${num(value)}%`;
  if (u === 'By') return formatBytes(value);
  const braced = /^{(.*)}$/.exec(u);
  const label = braced ? braced[1].trim() : u;
  return label ? `${num(value, 2)} ${label}` : num(value, 2);
}

export function formatFindingNumbers(value?: number, threshold?: number): string | null {
  if (value === undefined) return null;
  return threshold === undefined
    ? num(value, 2)
    : `${num(value, 2)} (threshold ${num(threshold, 2)})`;
}

// ---------------------------------------------------------------------------
// Disks
// ---------------------------------------------------------------------------

export function diskAttribute(
  disk: Pick<HardwareDisk, 'attributes'>,
  attribute: HardwareSmartAttribute
): HardwareDiskAttribute | undefined {
  return disk.attributes.find((a) => a.attribute === attribute);
}

export function diskTemperatureStatus(
  protocol: string | null,
  temperature: number | null
): HardwareComponentStatus {
  if (temperature === null) return 'unknown';
  const t = HARDWARE_THRESHOLDS.disk.temperature[protocol === 'nvme' ? 'nvme' : 'hdd'];
  if (temperature >= t.criticalAtLeast) return 'critical';
  if (temperature >= t.warningAtLeast) return 'warning';
  return 'ok';
}

export function enduranceStatus(endurance: number | null): HardwareComponentStatus {
  if (endurance === null) return 'unknown';
  if (endurance >= HARDWARE_THRESHOLDS.disk.enduranceCriticalAtLeast) return 'critical';
  if (endurance >= HARDWARE_THRESHOLDS.disk.enduranceWarningAtLeast) return 'warning';
  return 'ok';
}

/** Text color class for a value judged against a status; plain for ok and unknown. */
export function valueTextClass(status: HardwareComponentStatus): string {
  return status === 'warning' || status === 'critical' ? hardwareStatusTone(status).text : '';
}

// ---------------------------------------------------------------------------
// Series
// ---------------------------------------------------------------------------

export function seriesFor(series: HardwareSeries[], component: HardwareComponentKey): HardwareSeries[] {
  return series.filter((s) => s.component === component && s.points.length > 0);
}

export function seriesLatest(s: Pick<HardwareSeries, 'points' | 'unit'>): string {
  const last = s.points[s.points.length - 1];
  if (!last) return '-';
  return formatUnitValue(last.value, s.unit);
}

// ---------------------------------------------------------------------------
// Links
// ---------------------------------------------------------------------------

/** Logs filtered to the hardware service and one host, over the last 7 days. */
export function buildHardwareLogsUrl(
  projectId: string,
  hostName: string,
  now: Date = new Date()
): string {
  const from = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const url = writeScopeToUrl(
    new URL('http://x/dashboard/logs'),
    { projectIds: [projectId], range: { kind: 'custom', from: from.toISOString(), to: now.toISOString() } },
    { explicitAll: true }
  );
  url.searchParams.set('q', `service:hardware host:${quoteFieldValue(hostName)}`);
  return `/dashboard/logs?${url.searchParams.toString()}`;
}
