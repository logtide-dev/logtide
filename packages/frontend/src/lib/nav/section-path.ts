/**
 * Maps the current pathname to the list page of the same section, used after an
 * organization switch: a detail page of the previous organization must not stay
 * open. Settings, admin, account and every list path are returned unchanged.
 */

/** Detail-capable sections: any deeper path collapses to the mapped list path. */
const DETAIL_SECTIONS: Record<string, string> = {
  errors: '/dashboard/errors',
  traces: '/dashboard/traces',
  uptime: '/dashboard/uptime',
  incidents: '/dashboard/incidents',
  sessions: '/dashboard/sessions',
  projects: '/dashboard/projects',
  alerts: '/dashboard/alerts',
  logs: '/dashboard/logs',
  metrics: '/dashboard/metrics',
  'web-vitals': '/dashboard/web-vitals',
};

/** Sections whose paths stay as they are. */
const KEEP_SECTIONS = new Set(['settings', 'admin', 'account']);

export function sectionListPath(pathname: string): string {
  const path = pathname.split(/[?#]/)[0].replace(/\/+$/, '') || '/';
  if (path === '/dashboard' || !path.startsWith('/dashboard/')) return '/dashboard';

  const segments = path.split('/').filter(Boolean); // ['dashboard', section, ...]
  const section = segments[1];

  if (KEEP_SECTIONS.has(section)) return path;

  if (section === 'security') {
    const sub = segments[2];
    if (!sub) return '/dashboard/security';
    if (sub === 'rules') return '/dashboard/security/rules';
    if (sub === 'incidents') return '/dashboard/incidents';
    return '/dashboard/security';
  }

  if (Object.prototype.hasOwnProperty.call(DETAIL_SECTIONS, section)) {
    return DETAIL_SECTIONS[section];
  }

  return '/dashboard';
}
