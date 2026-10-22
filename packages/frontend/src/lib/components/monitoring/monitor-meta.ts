import type { MonitorType } from '$lib/api/monitoring';
import { stateTone, type Tone } from '$lib/utils/severity';

export const MONITOR_TYPE_OPTIONS: { value: MonitorType; label: string; description: string }[] = [
  { value: 'http', label: 'HTTP(S)', description: 'Request a URL and check the status code and body' },
  { value: 'tcp', label: 'TCP port', description: 'Open a connection to a host and port' },
  {
    value: 'heartbeat',
    label: 'Heartbeat (push)',
    description: 'Your service sends a request on a schedule',
  },
  {
    value: 'log_heartbeat',
    label: 'Log heartbeat',
    description: 'Down when a service stops sending logs',
  },
  {
    value: 'ssl',
    label: 'SSL certificate',
    description: 'Check that the certificate is valid and not about to expire',
  },
  {
    value: 'dns',
    label: 'DNS record',
    description: 'Resolve a record and compare it to an expected value',
  },
];

export function monitorTypeLabel(type: MonitorType): string {
  return MONITOR_TYPE_OPTIONS.find((o) => o.value === type)?.label ?? type;
}

const ERROR_CODE_LABELS: Record<string, string> = {
  timeout: 'Timed out',
  dns_error: 'DNS lookup failed',
  connection_refused: 'Connection refused',
  ssl_error: 'Certificate error',
  http_error: 'Unexpected response',
  no_heartbeat: 'No heartbeat received',
  blocked: 'Target not allowed',
  cert_expiring: 'Certificate expires soon',
  cert_expired: 'Certificate expired',
  dns_mismatch: 'DNS record does not match',
  dns_no_records: 'No DNS records found',
  unexpected: 'Unexpected error',
};

export function errorCodeLabel(code: string | null | undefined): string {
  if (!code) return '-';
  if (Object.prototype.hasOwnProperty.call(ERROR_CODE_LABELS, code)) return ERROR_CODE_LABELS[code];
  const text = code.replace(/_/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function monitorStateTone(status: 'up' | 'down' | 'unknown', enabled: boolean): Tone {
  if (!enabled) return stateTone('disabled');
  if (status === 'up') return stateTone('up');
  if (status === 'down') return stateTone('down');
  return stateTone('disabled');
}

export function monitorStateLabel(
  status: 'up' | 'down' | 'unknown' | undefined,
  enabled: boolean
): string {
  if (!enabled) return 'Paused';
  if (status === 'up') return 'Up';
  if (status === 'down') return 'Down';
  return 'Unknown';
}

export function formatResponseTime(ms: number | null | undefined): string {
  if (ms == null) return '-';
  if (ms < 1000) return `${ms.toLocaleString('en-US')} ms`;
  return `${(ms / 1000).toLocaleString('en-US', { maximumFractionDigits: 1 })} s`;
}

/** Public name of a monitor: the display name when set, else the real name. */
export function monitorTitle(m: { name: string; displayName?: string | null }): string {
  return m.displayName?.trim() ? m.displayName : m.name;
}

export interface MonitorSummary {
  total: number;
  up: number;
  down: number;
  paused: number;
  unknown: number;
}

type FilterableMonitor = {
  name: string;
  displayName?: string | null;
  groupName?: string | null;
  target: string | null;
  type: MonitorType;
  enabled: boolean;
  status?: { status: 'up' | 'down' | 'unknown' } | null;
};

export type MonitorStatusFilter = 'all' | 'up' | 'down' | 'paused' | 'unknown';

export function summarizeMonitors(monitors: FilterableMonitor[]): MonitorSummary {
  const s: MonitorSummary = { total: monitors.length, up: 0, down: 0, paused: 0, unknown: 0 };
  for (const m of monitors) {
    if (!m.enabled) s.paused++;
    else if (m.status?.status === 'up') s.up++;
    else if (m.status?.status === 'down') s.down++;
    else s.unknown++;
  }
  return s;
}

export function filterMonitors<T extends FilterableMonitor>(
  monitors: T[],
  status: MonitorStatusFilter,
  query: string
): T[] {
  const q = query.trim().toLowerCase();
  return monitors.filter((m) => {
    if (
      q &&
      !(
        m.name.toLowerCase().includes(q) ||
        (m.displayName ?? '').toLowerCase().includes(q) ||
        (m.groupName ?? '').toLowerCase().includes(q) ||
        (m.target ?? '').toLowerCase().includes(q) ||
        monitorTypeLabel(m.type).toLowerCase().includes(q)
      )
    ) {
      return false;
    }
    if (status === 'all') return true;
    if (status === 'paused') return !m.enabled;
    if (!m.enabled) return false;
    const s = m.status?.status ?? 'unknown';
    if (status === 'unknown') return s !== 'up' && s !== 'down';
    return s === status;
  });
}
