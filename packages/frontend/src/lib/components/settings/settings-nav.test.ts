import { describe, it, expect } from 'vitest';
import { SETTINGS_GROUPS, visibleSettingsItems, visibleSettingsGroups } from './settings-nav';

const labels = (items: { label: string }[]) => items.map((i) => i.label);

describe('settings nav definition', () => {
  it('visibleSettingsItems hides Audit log from members', () => {
    const items = visibleSettingsItems({ role: 'member', authConfig: { authMode: 'standard', signupEnabled: true } });
    expect(labels(items)).not.toContain('Audit log');
  });

  it('shows Audit log to admins and owners', () => {
    for (const role of ['admin', 'owner'] as const) {
      const items = visibleSettingsItems({ role, authConfig: { authMode: 'standard', signupEnabled: true } });
      expect(labels(items)).toContain('Audit log');
    }
  });

  it('has no Billing entry in the core nav', () => {
    const items = visibleSettingsItems({ role: 'owner', authConfig: { authMode: 'standard', signupEnabled: true } });
    expect(labels(items)).not.toContain('Billing');
  });

  it('treats an unknown role as a plain member', () => {
    const items = visibleSettingsItems({ role: null, authConfig: { authMode: 'standard', signupEnabled: true } });
    expect(labels(items)).not.toContain('Audit log');
  });

  it('shows Usage always', () => {
    for (const role of ['owner', 'admin', 'member', null] as const) {
      expect(labels(visibleSettingsItems({ role, authConfig: { authMode: 'standard', signupEnabled: true } }))).toContain('Usage');
    }
  });

  it('every href is unique and starts with /dashboard/', () => {
    const hrefs = SETTINGS_GROUPS.flatMap((g) => g.items.map((i) => i.href));
    expect(new Set(hrefs).size).toBe(hrefs.length);
    for (const h of hrefs) expect(h.startsWith('/dashboard/')).toBe(true);
    const ids = SETTINGS_GROUPS.flatMap((g) => g.items.map((i) => i.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has the five groups in order', () => {
    expect(SETTINGS_GROUPS.map((g) => g.label)).toEqual([
      'Account',
      'Organization',
      'Data',
      'Notifications',
      'Projects',
    ]);
  });

  it('Notifications entries match the four W11 paths exactly', () => {
    const group = SETTINGS_GROUPS.find((g) => g.label === 'Notifications')!;
    expect(group.items.map((i) => [i.label, i.href])).toEqual([
      ['Destinations', '/dashboard/settings/notifications/destinations'],
      ['Routing', '/dashboard/settings/notifications/routing'],
      ['Digests', '/dashboard/settings/notifications/digests'],
      ['Delivery log', '/dashboard/settings/notifications/delivery-log'],
    ]);
  });

  it('Account entries use the settings shell paths and apply to you', () => {
    const group = SETTINGS_GROUPS.find((g) => g.label === 'Account')!;
    expect(group.items.map((i) => i.href)).toEqual([
      '/dashboard/settings/account/profile',
      '/dashboard/settings/account/preferences',
      '/dashboard/settings/account/security',
    ]);
    for (const i of group.items) expect(i.appliesTo).toBe('you');
  });

  it('drops groups that end up empty', () => {
    const groups = visibleSettingsGroups({ role: 'member', authConfig: { authMode: 'standard', signupEnabled: true } });
    for (const g of groups) expect(g.items.length).toBeGreaterThan(0);
  });
});
