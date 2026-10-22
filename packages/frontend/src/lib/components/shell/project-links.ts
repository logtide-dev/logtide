import { writeScopeToUrl } from '$lib/stores/scope-url';

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
