import { describe, it, expect } from 'vitest';
import { NAV_SECTIONS, flatNavItems, isNavItemActive, isInNavGroup, isNavGroupActive, ADMIN_NAV_ITEM } from './nav-items';

describe('nav-items', () => {
  it('lists the sidebar sections in the 5.1 order', () => {
    expect(NAV_SECTIONS.map((s) => s.id)).toEqual([
      'home',
      'explore',
      'monitor',
      'security',
      'manage',
      'help',
    ]);
    const ids = (section: string) =>
      NAV_SECTIONS.find((s) => s.id === section)!.items.map((i) => i.id);
    expect(ids('explore')).toEqual(['logs', 'traces', 'metrics', 'errors', 'sessions', 'web-vitals']);
    expect(ids('monitor')).toEqual(['incidents', 'alerts', 'uptime', 'hardware']);
    expect(ids('security')).toEqual(['security-overview', 'security-rules']);
    expect(ids('manage')).toEqual(['projects', 'settings']);
  });

  it('uses the canonical names', () => {
    expect(flatNavItems().map((i) => i.label)).toEqual([
      'Dashboards',
      'Logs',
      'Traces',
      'Hosts & services',
      'Explore',
      'Catalog',
      'Errors',
      'Sessions',
      'Web vitals',
      'Incidents',
      'Alerts',
      'Uptime',
      'Hardware',
      'Overview',
      'Rules',
      'Projects',
      'Settings',
      'Docs',
      'GitHub',
    ]);
    expect(ADMIN_NAV_ITEM.label).toBe('Instance admin');
  });

  it('has no duplicate hrefs, ids or shortcuts', () => {
    const items = flatNavItems();
    const hrefs = items.map((i) => i.href);
    const ids = items.map((i) => i.id);
    const shortcuts = items.map((i) => i.shortcut).filter(Boolean);
    expect(new Set(hrefs).size).toBe(hrefs.length);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(shortcuts).size).toBe(shortcuts.length);
  });

  it('registers the spec shortcuts', () => {
    const expected: Record<string, string> = {
      d: '/dashboard',
      l: '/dashboard/logs',
      t: '/dashboard/traces',
      m: '/dashboard/metrics',
      e: '/dashboard/errors',
      s: '/dashboard/sessions',
      w: '/dashboard/web-vitals',
      i: '/dashboard/incidents',
      a: '/dashboard/alerts',
      u: '/dashboard/uptime',
      h: '/dashboard/hardware',
      r: '/dashboard/security',
      p: '/dashboard/projects',
    };
    const byShortcut = new Map(flatNavItems().map((i) => [i.shortcut, i.href]));
    for (const [key, href] of Object.entries(expected)) {
      expect(byShortcut.get(`g ${key}`)).toBe(href);
    }
  });

  it('marks active items', () => {
    const items = flatNavItems();
    const activeIds = (pathname: string) =>
      items.filter((i) => isNavItemActive(i, pathname)).map((i) => i.id);

    expect(activeIds('/dashboard/logs')).toEqual(['logs']);
    expect(activeIds('/dashboard/security/rules/abc')).toEqual(['security-rules']);
    expect(activeIds('/dashboard/security')).toEqual(['security-overview']);
    expect(activeIds('/dashboard')).toEqual(['dashboards']);
    expect(activeIds('/dashboard/projects/1/overview')).toEqual(['projects']);
    expect(activeIds('/dashboard/settings/members')).toEqual(['settings']);
  });

  it('links Settings straight to a client route and keeps the whole section active (UI-5)', () => {
    const settings = flatNavItems().find((i) => i.id === 'settings')!;
    // /dashboard/settings is a server-only redirect: navigating to it reloads the SPA
    expect(settings.href).toBe('/dashboard/settings/general');
    expect(flatNavItems().find((i) => i.shortcut === 'g x')!.href).toBe(settings.href);
    for (const path of [
      '/dashboard/settings/general',
      '/dashboard/settings/members',
      '/dashboard/settings/account/profile',
    ]) {
      expect(isNavItemActive(settings, path)).toBe(true);
    }
    expect(isNavItemActive(settings, '/dashboard/projects')).toBe(false);
  });

  it('marks the Metrics children: hosts and services on the list and the source pages, explore, catalog', () => {
    const items = flatNavItems();
    const activeIds = (pathname: string, search = '') =>
      items.filter((i) => isNavItemActive(i, pathname, search)).map((i) => i.id);
    expect(activeIds('/dashboard/metrics')).toEqual(['metrics-sources']);
    expect(activeIds('/dashboard/metrics', '?kind=host')).toEqual(['metrics-sources']);
    expect(activeIds('/dashboard/metrics/hosts/vps-app')).toEqual(['metrics-sources']);
    expect(activeIds('/dashboard/metrics/hosts/vps-app', '?tab=resources')).toEqual(['metrics-sources']);
    expect(activeIds('/dashboard/metrics/services/api')).toEqual(['metrics-sources']);
    expect(activeIds('/dashboard/metrics/explore')).toEqual(['metrics-explore']);
    expect(activeIds('/dashboard/metrics/catalog')).toEqual(['metrics-catalog']);
  });

  it('a group covers its area and is current through its children', () => {
    const metrics = NAV_SECTIONS.find((s) => s.id === 'explore')!.items.find((i) => i.id === 'metrics')!;
    expect(metrics.children?.map((c) => c.label)).toEqual(['Hosts & services', 'Explore', 'Catalog']);
    expect(isInNavGroup(metrics, '/dashboard/metrics')).toBe(true);
    expect(isInNavGroup(metrics, '/dashboard/metrics/catalog')).toBe(true);
    expect(isInNavGroup(metrics, '/dashboard/metricsx')).toBe(false);
    expect(isInNavGroup(metrics, '/dashboard/logs')).toBe(false);
    expect(isNavGroupActive(metrics, '/dashboard/metrics/explore')).toBe(true);
    // the Hardware tab of a host belongs to Hardware
    expect(isNavGroupActive(metrics, '/dashboard/metrics/hosts/a', '?tab=hardware')).toBe(false);
  });

  it('marks Hardware active on its page and on the Hardware tab of a host, never both', () => {
    const items = flatNavItems();
    const activeIds = (pathname: string, search = '') =>
      items.filter((i) => isNavItemActive(i, pathname, search)).map((i) => i.id);
    expect(activeIds('/dashboard/hardware')).toEqual(['hardware']);
    expect(activeIds('/dashboard/hardware/h1')).toEqual(['hardware']);
    expect(activeIds('/dashboard/metrics/hosts/vps-app', '?tab=hardware&hw=h1')).toEqual(['hardware']);
    expect(activeIds('/dashboard/metrics/hosts/vps-app', 'tab=hardware')).toEqual(['hardware']);
    // Only host pages have a Hardware tab.
    expect(activeIds('/dashboard/metrics/services/api', '?tab=hardware')).toEqual(['metrics-sources']);
  });

  it('never marks external links active', () => {
    const docs = flatNavItems().find((i) => i.id === 'docs')!;
    expect(isNavItemActive(docs, '/dashboard')).toBe(false);
  });
});
