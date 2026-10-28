import { get } from 'svelte/store';
import type { Component } from 'svelte';
import Plus from '@lucide/svelte/icons/plus';
import Building2 from '@lucide/svelte/icons/building-2';
import Moon from '@lucide/svelte/icons/moon';
import PanelLeftClose from '@lucide/svelte/icons/panel-left-close';
import RefreshCw from '@lucide/svelte/icons/refresh-cw';
import Keyboard from '@lucide/svelte/icons/keyboard';
import FolderKanban from '@lucide/svelte/icons/folder-kanban';
import LayoutDashboard from '@lucide/svelte/icons/layout-dashboard';
import Activity from '@lucide/svelte/icons/activity';
import AlertTriangle from '@lucide/svelte/icons/alert-triangle';
import Settings from '@lucide/svelte/icons/settings';
import Bookmark from '@lucide/svelte/icons/bookmark';
import ShieldAlert from '@lucide/svelte/icons/shield-alert';
import { ADMIN_NAV_ITEM, flatNavItems } from '$lib/nav/nav-items';
import { navIcon } from '$lib/nav/nav-icons';
import { shortcutsStore } from '$lib/stores/shortcuts';
import { layoutStore } from '$lib/stores/layout';
import { themeStore } from '$lib/stores/theme';
import { authStore } from '$lib/stores/auth';
import { projectsAPI } from '$lib/api/projects';
import { customDashboardsAPI } from '$lib/api/custom-dashboards';
import { listMonitors } from '$lib/api/monitoring';
import { alertsAPI } from '$lib/api/alerts';
import { savedSearchesAPI } from '$lib/api/saved-searches';
import { incidentsAPI } from '$lib/api/incidents';
import { savedSearchUrl } from '$lib/components/search/explorer-url';
import { INCIDENT_ACTIVE_STATUSES } from '@logtide/shared';
import { settingsPages } from '../settings-pages';
import { organizationStore } from '$lib/stores/organization';
import { authAPI } from '$lib/api/auth';
import { OPEN_ORG_SWITCHER_EVENT } from '../events';
import { registerPaletteProvider } from './registry';
import type { PaletteItem } from './types';

const icon = (c: unknown) => c as Component<any>;

function registeredCombos(): Set<string> {
  return new Set(get(shortcutsStore.shortcuts).map((s) => s.combo));
}

function navigationItems(): PaletteItem[] {
  const combos = registeredCombos();
  const items = flatNavItems().filter((i) => !i.external);
  const isAdmin = !!get(authStore).user?.is_admin;
  if (isAdmin) items.push(ADMIN_NAV_ITEM);

  return items.map((item) => ({
    id: `nav:${item.id}`,
    label: item.paletteLabel ?? item.label,
    icon: navIcon(item.id),
    href: item.href,
    // Only advertise a shortcut that is registered right now.
    shortcut: item.shortcut && combos.has(item.shortcut) ? item.shortcut : undefined,
  }));
}

function actionItems(): PaletteItem[] {
  return [
    { id: 'action:create-project', label: 'Create project', icon: icon(Plus), href: '/dashboard/projects?create=1' },
    { id: 'action:create-alert', label: 'Create alert', icon: icon(AlertTriangle), href: '/dashboard/alerts?create=1' },
    { id: 'action:create-monitor', label: 'Create monitor', icon: icon(Activity), href: '/dashboard/uptime?create=1' },
    { id: 'action:create-dashboard', label: 'Create dashboard', icon: icon(LayoutDashboard), href: '/dashboard?create=1' },
    {
      id: 'action:switch-organization',
      label: 'Switch organization',
      icon: icon(Building2),
      keywords: ['org', 'workspace'],
      onSelect: () => {
        // Let the palette close first, then ask the header breadcrumb to open its menu.
        setTimeout(() => window.dispatchEvent(new CustomEvent(OPEN_ORG_SWITCHER_EVENT)), 100);
      },
    },
    {
      id: 'action:toggle-theme',
      label: 'Toggle theme',
      icon: icon(Moon),
      keywords: ['dark', 'light', 'mode'],
      onSelect: () => themeStore.toggle(),
    },
    {
      id: 'action:toggle-sidebar',
      label: 'Toggle sidebar',
      icon: icon(PanelLeftClose),
      onSelect: () => layoutStore.toggleSidebar(),
    },
    {
      id: 'action:reload',
      label: 'Reload page',
      icon: icon(RefreshCw),
      onSelect: () => window.location.reload(),
    },
    {
      id: 'action:shortcuts-help',
      label: 'Keyboard shortcuts',
      icon: icon(Keyboard),
      shortcut: '?',
      keywords: ['help'],
      onSelect: () => {
        // Small delay so the palette closes before the help modal opens.
        setTimeout(() => shortcutsStore.openHelpModal(), 100);
      },
    },
  ];
}

let defaultsRegistered = false;

export function registerDefaultPaletteProviders(): void {
  if (defaultsRegistered) return;
  defaultsRegistered = true;

  registerPaletteProvider({
    id: 'navigation',
    heading: 'Navigation',
    order: 10,
    ttlMs: 0, // shortcut chips depend on what is registered right now
    items: () => navigationItems(),
  });

  registerPaletteProvider({
    id: 'actions',
    heading: 'Actions',
    order: 20,
    ttlMs: 0,
    items: () => actionItems(),
  });

  registerPaletteProvider({
    id: 'projects',
    heading: 'Projects',
    order: 30,
    needsOrganization: true,
    items: async (ctx) => {
      const { projects } = await projectsAPI.getProjects(ctx.organizationId as string);
      return projects.map((p) => ({
        id: `project:${p.id}`,
        label: p.name,
        description: p.description || undefined,
        icon: icon(FolderKanban),
        href: `/dashboard/projects/${p.id}`,
      }));
    },
  });

  registerPaletteProvider({
    id: 'saved-searches',
    heading: 'Saved searches',
    order: 35,
    needsOrganization: true,
    items: async (ctx) => {
      const searches = await savedSearchesAPI.list(ctx.organizationId as string);
      return searches.map((s) => ({
        id: `saved-search:${s.id}`,
        label: s.name,
        description: s.state.q || undefined,
        icon: icon(Bookmark),
        href: savedSearchUrl(s),
        keywords: ['search', 'query', 'logs'],
      }));
    },
  });

  registerPaletteProvider({
    id: 'dashboards',
    heading: 'Dashboards',
    order: 40,
    needsOrganization: true,
    items: async (ctx) => {
      const dashboards = await customDashboardsAPI.list(ctx.organizationId as string);
      return dashboards.map((d) => ({
        id: `dashboard:${d.id}`,
        label: d.name,
        icon: icon(LayoutDashboard),
        href: `/dashboard?id=${encodeURIComponent(d.id)}`,
      }));
    },
  });

  registerPaletteProvider({
    id: 'incidents',
    heading: 'Incidents',
    order: 45,
    needsOrganization: true,
    items: async (ctx) => {
      const { incidents } = await incidentsAPI.list({
        organizationId: ctx.organizationId as string,
        status: [...INCIDENT_ACTIVE_STATUSES],
        limit: 50,
      });
      return incidents.map((i) => ({
        id: `incident:${i.id}`,
        label: i.title,
        description: i.severity,
        icon: icon(ShieldAlert),
        href: `/dashboard/incidents/${encodeURIComponent(i.id)}`,
      }));
    },
  });

  registerPaletteProvider({
    id: 'monitors',
    heading: 'Monitors',
    order: 50,
    needsOrganization: true,
    items: async (ctx) => {
      const { monitors } = await listMonitors(ctx.organizationId as string);
      return monitors.map((m) => ({
        id: `monitor:${m.id}`,
        label: m.name,
        description: m.target || undefined,
        icon: icon(Activity),
        href: `/dashboard/uptime/${m.id}`,
      }));
    },
  });

  registerPaletteProvider({
    id: 'alert-rules',
    heading: 'Alert rules',
    order: 60,
    needsOrganization: true,
    items: async (ctx) => {
      const { alertRules } = await alertsAPI.getAlertRules(ctx.organizationId as string);
      return alertRules.map((r) => ({
        id: `alert-rule:${r.id}`,
        label: r.name,
        icon: icon(AlertTriangle),
        href: `/dashboard/alerts?edit=${encodeURIComponent(r.id)}`,
      }));
    },
  });

  registerPaletteProvider({
    id: 'settings',
    heading: 'Settings',
    order: 70,
    items: async () => {
      const role = get(organizationStore).currentOrganization?.role ?? null;
      let billingEnabled = false;
      try {
        billingEnabled = (await authAPI.getAuthConfig()).billingEnabled === true;
      } catch {
        billingEnabled = false;
      }
      return settingsPages({ role, billingEnabled }).map((page) => ({
        id: `settings:${page.href}`,
        label: page.label,
        icon: icon(Settings),
        href: page.href,
        keywords: page.keywords,
      }));
    },
  });
}
