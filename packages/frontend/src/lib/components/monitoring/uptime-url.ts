export type UptimeTab = 'monitors' | 'status-updates' | 'maintenance' | 'status-page';
export type MonitorStatusFilter = 'all' | 'up' | 'down' | 'paused' | 'unknown';
export type StatusSeverity = 'minor' | 'major' | 'critical';

export interface StatusUpdatePrefill {
  title: string;
  severity: StatusSeverity;
  message: string;
  monitorIds: string[];
  sourceIncidentId: string | null;
}

export interface UptimeUrlState {
  tab: UptimeTab;
  create: boolean;
  status: MonitorStatusFilter;
  q: string;
  prefill: StatusUpdatePrefill | null;
}

const TABS: UptimeTab[] = ['monitors', 'status-updates', 'maintenance', 'status-page'];
const STATUSES: MonitorStatusFilter[] = ['all', 'up', 'down', 'paused', 'unknown'];
const PREFILL_PARAMS = ['title', 'severity', 'message', 'monitorIds', 'sourceIncidentId'];
const MAX_MONITOR_IDS = 50;

export function normalizeStatusSeverity(raw: string): StatusSeverity {
  const v = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (v === 'critical') return 'critical';
  if (v === 'high' || v === 'major') return 'major';
  return 'minor';
}

export function parseUptimeUrl(url: URL): UptimeUrlState {
  const p = url.searchParams;
  const rawTab = p.get('tab') ?? '';
  const tab = (TABS as string[]).includes(rawTab) ? (rawTab as UptimeTab) : 'monitors';
  const rawStatus = p.get('status') ?? '';
  const status = (STATUSES as string[]).includes(rawStatus)
    ? (rawStatus as MonitorStatusFilter)
    : 'all';
  const create = p.get('create') === '1';

  let prefill: StatusUpdatePrefill | null = null;
  if (create && tab === 'status-updates') {
    const title = (p.get('title') ?? '').slice(0, 255);
    const message = (p.get('message') ?? '').slice(0, 5000);
    const monitorIds = (p.get('monitorIds') ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, MAX_MONITOR_IDS);
    const sourceIncidentId = (p.get('sourceIncidentId') ?? '').trim() || null;
    if (title || message || monitorIds.length > 0 || sourceIncidentId || p.has('severity')) {
      prefill = {
        title,
        severity: normalizeStatusSeverity(p.get('severity') ?? ''),
        message,
        monitorIds,
        sourceIncidentId,
      };
    }
  }

  return { tab, create, status, q: p.get('q') ?? '', prefill };
}

export interface UptimeUrlPatch {
  tab?: UptimeTab;
  create?: boolean;
  status?: MonitorStatusFilter;
  q?: string;
}

/** Returns a copy of the URL with the patch applied; defaults are dropped from the query. */
export function writeUptimeUrl(url: URL, patch: UptimeUrlPatch): URL {
  const next = new URL(url.toString());
  const p = next.searchParams;

  if (patch.tab !== undefined) {
    if (patch.tab === 'monitors') p.delete('tab');
    else p.set('tab', patch.tab);
    // Switching tab closes any open dialog.
    if (patch.create === undefined) p.delete('create');
  }
  if (patch.create !== undefined) {
    if (patch.create) p.set('create', '1');
    else p.delete('create');
  }
  if (p.get('create') !== '1') {
    for (const key of PREFILL_PARAMS) p.delete(key);
  }
  if (patch.status !== undefined) {
    if (patch.status === 'all') p.delete('status');
    else p.set('status', patch.status);
  }
  if (patch.q !== undefined) {
    if (patch.q === '') p.delete('q');
    else p.set('q', patch.q);
  }
  return next;
}
