import type { ErrorGroup } from '@logtide/shared';

const FIVE_MINUTES_MS = 5 * 60 * 1000;

function withProject(path: string, projectId: string | null): string {
  return projectId ? `${path}?project=${encodeURIComponent(projectId)}` : path;
}

/** Prefilled "create alert" link for an error group. */
export function buildCreateAlertHref(group: ErrorGroup): string {
  const type = group.exceptionType.replace(/"/g, '').trim();
  const params = new URLSearchParams();
  params.set('create', '1');
  if (group.projectId) params.set('projectId', group.projectId);
  params.set('name', `${type} errors`);
  params.set('levels', 'error,critical');
  params.set('query', `"${type}"`);
  const service = (group.affectedServices ?? []).find((s) => s && s !== 'unknown');
  if (service) params.set('service', service);
  return `/dashboard/alerts?${params.toString()}`;
}

/** Logs explorer link centred on a moment: five minutes on each side. */
export function buildLogsWindowHref(a: {
  projectId: string | null;
  time: string | Date;
  logId?: string;
}): string {
  const at = new Date(a.time).getTime();
  const params = new URLSearchParams();
  if (a.projectId) params.set('project', a.projectId);
  params.set('from', new Date(at - FIVE_MINUTES_MS).toISOString());
  params.set('to', new Date(at + FIVE_MINUTES_MS).toISOString());
  if (a.logId) params.set('logId', a.logId);
  return `/dashboard/logs?${params.toString()}`;
}

export function buildTraceHref(traceId: string, projectId: string | null): string {
  return withProject(`/dashboard/traces/${encodeURIComponent(traceId)}`, projectId);
}

/** Session detail link (the sessions page contract). */
export function buildSessionHref(sessionId: string, projectId: string | null): string {
  return withProject(`/dashboard/sessions/${encodeURIComponent(sessionId)}`, projectId);
}

/** Detail page link that keeps the current scope params. */
export function buildErrorDetailHref(groupId: string, scopeSearch: string): string {
  const base = `/dashboard/errors/${encodeURIComponent(groupId)}`;
  if (!scopeSearch) return base;
  return `${base}${scopeSearch.startsWith('?') ? scopeSearch : `?${scopeSearch}`}`;
}
