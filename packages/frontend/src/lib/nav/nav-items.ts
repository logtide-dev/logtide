/**
 * The one navigation definition. Sidebar, mobile drawer, command palette and the
 * `g` shortcut registration all read this module, so they cannot drift apart.
 * Plain data plus two pure helpers: no Svelte imports, so stores can import it.
 */

export interface NavItem {
  id: string;
  label: string;
  /** Unambiguous name for the command palette when the sidebar label relies on its section (e.g. Overview) */
  paletteLabel?: string;
  href: string;
  /** Full key sequence, e.g. 'g l' */
  shortcut?: string;
  external?: boolean;
  /** Active only when the pathname equals href */
  exact?: boolean;
  adminOnly?: boolean;
  badge?: {
    id: string;
    type: 'new' | 'updated' | 'beta';
    showUntil?: string;
  };
}

export interface NavSection {
  id: string;
  label?: string;
  items: NavItem[];
}

export const NAV_SECTIONS: NavSection[] = [
  {
    id: 'home',
    items: [{ id: 'dashboards', label: 'Dashboards', href: '/dashboard', shortcut: 'g d', exact: true }],
  },
  {
    id: 'explore',
    label: 'Explore',
    items: [
      { id: 'logs', label: 'Logs', href: '/dashboard/logs', shortcut: 'g l' },
      { id: 'traces', label: 'Traces', href: '/dashboard/traces', shortcut: 'g t' },
      { id: 'metrics', label: 'Metrics', href: '/dashboard/metrics', shortcut: 'g m' },
      { id: 'errors', label: 'Errors', href: '/dashboard/errors', shortcut: 'g e' },
      { id: 'sessions', label: 'Sessions', href: '/dashboard/sessions', shortcut: 'g s' },
      { id: 'web-vitals', label: 'Web vitals', href: '/dashboard/web-vitals', shortcut: 'g w' },
    ],
  },
  {
    id: 'monitor',
    label: 'Monitor',
    items: [
      { id: 'incidents', label: 'Incidents', href: '/dashboard/incidents', shortcut: 'g i' },
      { id: 'alerts', label: 'Alerts', href: '/dashboard/alerts', shortcut: 'g a' },
      { id: 'uptime', label: 'Uptime', href: '/dashboard/uptime', shortcut: 'g u' },
    ],
  },
  {
    id: 'security',
    label: 'Security',
    items: [
      {
        id: 'security-overview',
        label: 'Overview',
        paletteLabel: 'Security overview',
        href: '/dashboard/security',
        shortcut: 'g r',
        exact: true,
      },
      { id: 'security-rules', label: 'Rules', paletteLabel: 'Detection rules', href: '/dashboard/security/rules' },
    ],
  },
  {
    id: 'manage',
    label: 'Manage',
    items: [
      { id: 'projects', label: 'Projects', href: '/dashboard/projects', shortcut: 'g p' },
      { id: 'settings', label: 'Settings', href: '/dashboard/settings', shortcut: 'g x' },
    ],
  },
  {
    id: 'help',
    label: 'Help',
    items: [
      { id: 'docs', label: 'Docs', href: 'https://logtide.dev/docs', external: true },
      {
        id: 'github',
        label: 'GitHub',
        href: 'https://github.com/logtide-dev/logtide',
        external: true,
      },
    ],
  },
];

/** Instance admin entry: rendered between Manage and Help, only for admins. */
export const ADMIN_NAV_ITEM: NavItem = {
  id: 'admin',
  label: 'Instance admin',
  href: '/dashboard/admin',
  adminOnly: true,
};

/** Every regular sidebar item in display order (the admin entry is separate). */
export function flatNavItems(): NavItem[] {
  return NAV_SECTIONS.flatMap((s) => s.items);
}

export function isNavItemActive(item: NavItem, pathname: string): boolean {
  if (item.external) return false;
  if (item.exact) return pathname === item.href;
  return pathname === item.href || pathname.startsWith(item.href + '/');
}
