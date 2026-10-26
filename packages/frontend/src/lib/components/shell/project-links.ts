import { stripLegacyProject, writeScopeToUrl } from '$lib/stores/scope-url';

export interface ProjectQuickLink {
  id: string;
  label: string;
  href: string;
}

const LINKS: Array<{ id: string; label: string; path: string }> = [
  { id: 'logs', label: 'Logs', path: '/dashboard/logs' },
  { id: 'traces', label: 'Traces', path: '/dashboard/traces' },
  { id: 'errors', label: 'Errors', path: '/dashboard/errors' },
  { id: 'metrics', label: 'Metrics', path: '/dashboard/metrics' },
  { id: 'sessions', label: 'Sessions', path: '/dashboard/sessions' },
  { id: 'web-vitals', label: 'Web vitals', path: '/dashboard/web-vitals' },
  { id: 'uptime', label: 'Uptime', path: '/dashboard/uptime' },
];

const BASE = 'http://local.invalid';

/** Pre-scoped links to every explore page for one project (canonical `project` param). */
export function projectQuickLinks(projectId: string): ProjectQuickLink[] {
  return LINKS.map(({ id, label, path }) => {
    const url = writeScopeToUrl(new URL(path, BASE), { projectIds: [projectId] });
    return { id, label, href: `${url.pathname}${url.search}` };
  });
}

const PROJECT_ROUTE = /^\/dashboard\/projects\/[^/]+/;

/**
 * Where the header project switcher goes for `projectId`: on a project page the
 * same sub-page of the other project, elsewhere the same page scoped to it.
 */
export function projectSwitchHref(current: URL, projectId: string): string {
  if (PROJECT_ROUTE.test(current.pathname)) {
    const path = current.pathname.replace(PROJECT_ROUTE, `/dashboard/projects/${encodeURIComponent(projectId)}`);
    return `${path}${current.search}`;
  }
  return scopedProjectsHref(current, [projectId]);
}

/** The current page scoped to `projectIds` (empty means all projects), as the scope bar writes it. */
export function scopedProjectsHref(current: URL, projectIds: string[]): string {
  const url = stripLegacyProject(writeScopeToUrl(current, { projectIds }, { explicitAll: true }));
  return `${url.pathname}${url.search}`;
}
