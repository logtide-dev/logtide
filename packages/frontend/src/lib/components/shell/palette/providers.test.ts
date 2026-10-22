import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$lib/api/projects', () => ({
  projectsAPI: {
    getProjects: vi.fn(async () => ({
      projects: [{ id: 'p1', name: 'Backend', description: 'API' }],
    })),
  },
}));
vi.mock('$lib/api/custom-dashboards', () => ({
  customDashboardsAPI: {
    list: vi.fn(async () => [{ id: 'd-uuid-1', name: 'Overview board' }]),
  },
}));
vi.mock('$lib/api/monitoring', () => ({
  listMonitors: vi.fn(async () => ({
    monitors: [{ id: 'm1', name: 'Homepage', target: 'https://example.com' }],
  })),
}));
vi.mock('$lib/api/saved-searches', () => ({
  savedSearchesAPI: {
    list: vi.fn(async () => [
      {
        id: 's1',
        name: 'Checkout errors',
        visibility: 'organization',
        state: { q: 'level:error service:checkout', projectIds: ['p1'], range: '24h' },
      },
    ]),
  },
}));
vi.mock('$lib/api/incidents', () => ({
  incidentsAPI: {
    list: vi.fn(async () => ({
      incidents: [{ id: 'i1', title: 'Brute force on login', severity: 'high', status: 'open' }],
      total: 1,
    })),
  },
}));
vi.mock('$lib/api/alerts', () => ({
  alertsAPI: {
    getAlertRules: vi.fn(async () => ({ alertRules: [{ id: 'r1', name: 'High errors' }] })),
  },
}));

import { registerDefaultPaletteProviders } from './providers';
import { listPaletteProviders, loadPaletteGroups, clearPaletteCache } from './registry';
import { SETTINGS_PAGES } from '../settings-pages';
import { shortcutsStore } from '$lib/stores/shortcuts';
import { themeStore } from '$lib/stores/theme';

function ctx() {
  return { organizationId: 'org-1', projectId: null, signal: new AbortController().signal };
}

async function group(id: string) {
  const groups = await loadPaletteGroups(ctx());
  return groups.find((g) => g.provider === id)!;
}

describe('default palette providers', () => {
  beforeEach(() => {
    registerDefaultPaletteProviders();
    clearPaletteCache();
  });

  afterEach(() => {
    shortcutsStore.uninstall();
    vi.restoreAllMocks();
  });

  it('registers the default providers once, in the reserved order', () => {
    registerDefaultPaletteProviders();
    expect(listPaletteProviders().map((p) => `${p.id}:${p.order}`)).toEqual([
      'navigation:10',
      'actions:20',
      'projects:30',
      'saved-searches:35',
      'dashboards:40',
      'incidents:45',
      'monitors:50',
      'alert-rules:60',
      'settings:70',
    ]);
  });

  it('links entities to their pages', async () => {
    expect((await group('dashboards')).items[0].href).toBe('/dashboard?id=d-uuid-1');
    expect((await group('monitors')).items[0].href).toBe('/dashboard/uptime/m1');
    expect((await group('alert-rules')).items[0].href).toBe('/dashboard/alerts?edit=r1');
    expect((await group('incidents')).items[0].href).toBe('/dashboard/incidents/i1');
    expect((await group('projects')).items[0].href).toBe('/dashboard/projects/p1/overview');
  });

  it('lists the settings pages', async () => {
    const hrefs = (await group('settings')).items.map((i) => i.href);
    for (const href of [
      '/dashboard/settings/general',
      '/dashboard/settings/members',
      '/dashboard/settings/audit-log',
      '/dashboard/settings/pii-masking',
      '/dashboard/settings/pipelines',
      '/dashboard/settings/patterns',
      '/dashboard/settings/notifications/destinations',
      '/dashboard/settings/notifications/routing',
      '/dashboard/settings/notifications/digests',
      '/dashboard/settings/notifications/delivery-log',
      '/dashboard/account',
    ]) {
      expect(hrefs).toContain(href);
    }
    expect(SETTINGS_PAGES.length).toBe(hrefs.length);
  });

  it('toggle theme action calls themeStore.toggle', async () => {
    const spy = vi.spyOn(themeStore, 'toggle');
    const actions = await group('actions');
    actions.items.find((i) => i.id === 'action:toggle-theme')!.onSelect!();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('offers the create and switch actions', async () => {
    const labels = (await group('actions')).items.map((i) => i.label);
    for (const label of [
      'Create project',
      'Create alert',
      'Create monitor',
      'Create dashboard',
      'Switch organization',
      'Toggle theme',
      'Toggle sidebar',
      'Keyboard shortcuts',
    ]) {
      expect(labels).toContain(label);
    }
  });

  it('navigation items show a shortcut only when registered', async () => {
    let nav = await group('navigation');
    expect(nav.items.every((i) => !i.shortcut)).toBe(true);

    shortcutsStore.install();
    nav = await group('navigation');
    expect(nav.items.find((i) => i.id === 'nav:logs')!.shortcut).toBe('g l');
    expect(nav.items.find((i) => i.id === 'nav:security-overview')!.label).toBe('Security overview');
    // Rules has no shortcut at all
    expect(nav.items.find((i) => i.id === 'nav:security-rules')!.shortcut).toBeUndefined();
  });

  it('navigation does not offer external links', async () => {
    const nav = await group('navigation');
    expect(nav.items.every((i) => !i.href!.startsWith('http'))).toBe(true);
  });

  it('lists saved searches that open in the explorer', async () => {
    const { savedSearchesAPI } = await import('$lib/api/saved-searches');
    const g = await group('saved-searches');
    expect(savedSearchesAPI.list).toHaveBeenCalledWith('org-1');
    expect(g.items[0].label).toBe('Checkout errors');
    const href = g.items[0].href!;
    expect(href.startsWith('/dashboard/logs?')).toBe(true);
    expect(href).toContain('saved=s1');
    expect(href).toContain('q=level');
  });

  it('lists open incidents for the organization', async () => {
    const { incidentsAPI } = await import('$lib/api/incidents');
    const g = await group('incidents');
    expect(incidentsAPI.list).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: 'org-1', status: ['open', 'investigating'] }),
    );
    expect(g.items[0].label).toBe('Brute force on login');
  });
});
