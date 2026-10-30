import { describe, it, expect } from 'vitest';
import { NAV_SECTIONS, flatNavItems, isNavItemActive, ADMIN_NAV_ITEM } from './nav-items';

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
    expect(ids('monitor')).toEqual(['incidents', 'alerts', 'uptime']);
    expect(ids('security')).toEqual(['security-overview', 'security-rules']);
    expect(ids('manage')).toEqual(['projects', 'settings']);
  });

  it('uses the canonical names', () => {
    expect(flatNavItems().map((i) => i.label)).toEqual([
      'Dashboards',
      'Logs',
      'Traces',
      'Metrics',
      'Errors',
      'Sessions',
      'Web vitals',
      'Incidents',
      'Alerts',
      'Uptime',
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

  it('registers the twelve spec shortcuts', () => {
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

  it('never marks external links active', () => {
    const docs = flatNavItems().find((i) => i.id === 'docs')!;
    expect(isNavItemActive(docs, '/dashboard')).toBe(false);
  });
});
