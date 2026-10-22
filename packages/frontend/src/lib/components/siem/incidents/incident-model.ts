import { quoteFieldValue } from '@logtide/shared';
import type {
  DetectionEvent,
  IncidentComment,
  IncidentHistoryEntry,
  IncidentListItem,
  IncidentSourceEvent,
  IncidentStatus,
  Severity,
} from '@logtide/shared';
import { readScopeFromUrl, writeScopeToUrl } from '$lib/stores/scope-url';
import type { IncidentDetail, IncidentSource, InboxFilters } from '$lib/api/incidents';

export const INCIDENT_STATUS_LABEL: Record<IncidentStatus, string> = {
  open: 'Open',
  investigating: 'Acknowledged',
  resolved: 'Resolved',
  false_positive: 'False positive',
};

export type IncidentStateKey = 'open' | 'acknowledged' | 'resolved' | 'false_positive';

export function incidentStateKey(status: IncidentStatus): IncidentStateKey {
  return status === 'investigating' ? 'acknowledged' : status;
}

export const INCIDENT_SOURCE_LABEL: Record<IncidentSource, string> = {
  sigma: 'Security',
  alert: 'Alert',
  monitor: 'Uptime',
  manual: 'Manual',
};

export const DEFAULT_STATUS_FILTER: IncidentStatus[] = ['open', 'investigating'];

const ALL_STATUSES: IncidentStatus[] = ['open', 'investigating', 'resolved', 'false_positive'];
const ALL_SEVERITIES: Severity[] = ['critical', 'high', 'medium', 'low', 'informational'];
const ALL_SOURCES: IncidentSource[] = ['sigma', 'alert', 'monitor', 'manual'];

export interface IncidentActions {
  acknowledge: boolean;
  resolve: boolean;
  reopen: boolean;
  falsePositive: boolean;
  publishToStatusPage: boolean;
  exportPdf: boolean;
}

export function availableActions(
  incident: Pick<IncidentListItem, 'status' | 'source'>
): IncidentActions {
  const { status, source } = incident;
  const active = status === 'open' || status === 'investigating';
  return {
    acknowledge: status === 'open',
    resolve: active,
    reopen: status === 'resolved' || status === 'false_positive',
    falsePositive: active && source === 'sigma',
    publishToStatusPage: source === 'monitor',
    exportPdf: source === 'sigma',
  };
}

// ---------------------------------------------------------------------------
// Inbox URL state
// ---------------------------------------------------------------------------

export type InboxAssignee = 'me' | 'unassigned' | 'anyone';

export interface InboxUrlState {
  projectIds: string[];
  status: IncidentStatus[] | 'all';
  severity: Severity[];
  source: IncidentSource[];
  assignee: InboxAssignee;
  service?: string;
  technique?: string;
  ruleId?: string;
  page: number;
}

function listParam<T extends string>(url: URL, key: string, allowed: readonly T[]): T[] {
  const out: T[] = [];
  for (const raw of url.searchParams.getAll(key)) {
    for (const part of raw.split(',')) {
      const v = part.trim() as T;
      if (v && allowed.includes(v) && !out.includes(v)) out.push(v);
    }
  }
  return out;
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((x) => b.includes(x));
}

export function parseInboxUrl(url: URL, currentUserId: string | null): InboxUrlState {
  const p = url.searchParams;
  const statusRaw = p.getAll('status').flatMap((v) => v.split(',').map((s) => s.trim()));
  let status: IncidentStatus[] | 'all' = [...DEFAULT_STATUS_FILTER];
  if (statusRaw.includes('all')) {
    status = 'all';
  } else {
    const parsed = listParam(url, 'status', ALL_STATUSES);
    if (parsed.length > 0) status = parsed;
  }

  const assigneeRaw = p.get('assignee');
  let assignee: InboxAssignee = 'anyone';
  if (assigneeRaw === 'me' || (currentUserId && assigneeRaw === currentUserId)) assignee = 'me';
  else if (assigneeRaw === 'unassigned') assignee = 'unassigned';

  const pageNum = Number.parseInt(p.get('page') ?? '', 10);
  const state: InboxUrlState = {
    projectIds: readScopeFromUrl(url).projectIds ?? [],
    status,
    severity: listParam(url, 'severity', ALL_SEVERITIES),
    source: listParam(url, 'source', ALL_SOURCES),
    assignee,
    page: Number.isFinite(pageNum) && pageNum >= 1 ? pageNum : 1,
  };
  const service = p.get('service');
  const technique = p.get('technique');
  const ruleId = p.get('ruleId');
  if (service) state.service = service;
  if (technique) state.technique = technique;
  if (ruleId) state.ruleId = ruleId;
  return state;
}

export function serializeInboxUrl(state: InboxUrlState, base: URL): URL {
  const next = new URL(base.href);
  for (const key of [
    'project',
    'projectId',
    'status',
    'severity',
    'source',
    'assignee',
    'service',
    'technique',
    'ruleId',
    'page',
  ]) {
    next.searchParams.delete(key);
  }
  const p = next.searchParams;
  if (state.projectIds.length > 0) p.set('project', state.projectIds.join(','));
  if (state.status === 'all') p.set('status', 'all');
  else if (!sameSet(state.status, DEFAULT_STATUS_FILTER)) p.set('status', state.status.join(','));
  if (state.severity.length > 0) p.set('severity', state.severity.join(','));
  if (state.source.length > 0) p.set('source', state.source.join(','));
  if (state.assignee !== 'anyone') p.set('assignee', state.assignee);
  if (state.service) p.set('service', state.service);
  if (state.technique) p.set('technique', state.technique);
  if (state.ruleId) p.set('ruleId', state.ruleId);
  if (state.page > 1) p.set('page', String(state.page));
  return next;
}

export function toInboxFilters(
  state: InboxUrlState,
  organizationId: string,
  pageSize: number
): InboxFilters {
  const filters: InboxFilters = {
    organizationId,
    status: state.status === 'all' ? undefined : state.status,
    limit: pageSize,
    offset: (Math.max(1, state.page) - 1) * pageSize,
  };
  if (state.projectIds.length > 0) filters.projectIds = state.projectIds;
  if (state.severity.length > 0) filters.severity = state.severity;
  if (state.source.length > 0) filters.source = state.source;
  if (state.assignee === 'me') filters.assignee = { kind: 'me' };
  else if (state.assignee === 'unassigned') filters.assignee = { kind: 'unassigned' };
  if (state.service) filters.service = state.service;
  if (state.technique) filters.technique = state.technique;
  if (state.ruleId) filters.ruleId = state.ruleId;
  return filters;
}

export function incidentLastEventAt(
  i: Partial<Pick<IncidentListItem, 'lastEventAt' | 'timeWindowEnd' | 'updatedAt'>>
): string | Date {
  return (i.lastEventAt ?? i.timeWindowEnd ?? i.updatedAt) as string | Date;
}

// ---------------------------------------------------------------------------
// Merged timeline
// ---------------------------------------------------------------------------

export type TimelineEntry =
  | { kind: 'detection'; id: string; time: string | Date; detection: DetectionEvent }
  | { kind: 'alert_trigger' | 'monitor_check'; id: string; time: string | Date; event: IncidentSourceEvent }
  | { kind: 'comment'; id: string; time: string | Date; comment: IncidentComment }
  | { kind: 'history'; id: string; time: string | Date; entry: IncidentHistoryEntry };

const ts = (v: string | Date): number => new Date(v).getTime() || 0;

export function buildMergedTimeline(
  detail: Pick<IncidentDetail, 'detections' | 'comments' | 'history'> &
    Partial<Pick<IncidentDetail, 'sourceEvents' | 'incident'>>
): TimelineEntry[] {
  const sourceEvents = detail.sourceEvents ?? [];
  const entries: TimelineEntry[] = [];
  for (const d of detail.detections ?? []) {
    entries.push({ kind: 'detection', id: `d-${d.id}`, time: d.time, detection: d });
  }
  for (const e of sourceEvents) {
    entries.push({ kind: e.kind, id: `s-${e.id}`, time: e.time, event: e });
  }
  for (const c of detail.comments ?? []) {
    entries.push({ kind: 'comment', id: `c-${c.id}`, time: c.createdAt, comment: c });
  }
  const derived = sourceEvents.length > 0;
  for (const h of detail.history ?? []) {
    // source_event (and the created row of alert/monitor incidents) are already
    // represented by sourceEvents.
    if (h.action === 'source_event') continue;
    if (h.action === 'created' && derived) continue;
    entries.push({ kind: 'history', id: `h-${h.id}`, time: h.createdAt, entry: h });
  }
  return entries.sort((a, b) => ts(b.time) - ts(a.time));
}

// ---------------------------------------------------------------------------
// Link builders
// ---------------------------------------------------------------------------

const THIRTY_MIN = 30 * 60 * 1000;

export function buildIncidentLogsUrl(
  incident: Pick<
    IncidentListItem,
    'projectId' | 'traceId' | 'affectedServices' | 'timeWindowStart' | 'timeWindowEnd' | 'createdAt'
  >,
  now: Date = new Date()
): string {
  let start: Date | null = null;
  let end: Date | null = null;
  if (incident.timeWindowStart && incident.timeWindowEnd) {
    start = new Date(incident.timeWindowStart);
    end = new Date(incident.timeWindowEnd);
  }
  if (!start || !end || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start >= end) {
    const created = new Date(incident.createdAt);
    const center = Number.isNaN(created.getTime()) ? now : created;
    start = new Date(center.getTime() - THIRTY_MIN);
    end = new Date(center.getTime() + THIRTY_MIN);
  }

  const clauses: string[] = [];
  if (incident.traceId) clauses.push(`trace:${quoteFieldValue(incident.traceId)}`);
  const services = incident.affectedServices ?? [];
  if (services.length === 1) clauses.push(`service:${quoteFieldValue(services[0])}`);
  else if (services.length > 1) {
    clauses.push(`service:(${services.map(quoteFieldValue).join(' OR ')})`);
  }

  const url = writeScopeToUrl(new URL('http://x/dashboard/logs'), {
    projectIds: incident.projectId ? [incident.projectId] : [],
    range: { kind: 'custom', from: start.toISOString(), to: end.toISOString() },
  });
  if (clauses.length > 0) url.searchParams.set('q', clauses.join(' '));
  return `/dashboard/logs?${url.searchParams.toString()}`;
}

export function buildTraceUrl(traceId: string, projectId: string | null): string {
  const base = `/dashboard/traces/${encodeURIComponent(traceId)}`;
  return projectId ? `${base}?project=${encodeURIComponent(projectId)}` : base;
}

export function buildPublishToStatusPageUrl(
  incident: Pick<
    IncidentListItem,
    'id' | 'projectId' | 'title' | 'severity' | 'description' | 'monitorId'
  >
): string {
  const severity =
    incident.severity === 'critical' ? 'critical' : incident.severity === 'high' ? 'major' : 'minor';
  const p = new URLSearchParams();
  p.set('tab', 'status-updates');
  p.set('create', '1');
  if (incident.projectId) p.set('project', incident.projectId);
  p.set('title', incident.title);
  p.set('severity', severity);
  p.set('message', incident.description ?? '');
  if (incident.monitorId) p.set('monitorIds', incident.monitorId);
  p.set('sourceIncidentId', incident.id);
  return `/dashboard/uptime?${p.toString()}`;
}
