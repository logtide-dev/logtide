import { describe, it, expect, vi } from 'vitest';
import Box from '@lucide/svelte/icons/box';
import type { AuthConfig } from '$lib/api/auth';
import { visibleSettingsGroups, visibleSettingsItems } from '$lib/components/settings/settings-nav';
import { settingsPages } from '$lib/components/shell/settings-pages';
import {
  activeExtensions,
  adminNavGroups,
  adminOrgPanels,
  adminPaletteItems,
  extensionUpgradeTarget,
  type AdminNavGroup,
} from './registry';
import { extensions } from './index';
import type { ExtensionAdminOrgPanel, FrontendExtension } from './types';

const base: AuthConfig = { authMode: 'standard', signupEnabled: true };
const enabledCfg: AuthConfig = { ...base, extensions: { fx: { enabled: true } } };

const fx: FrontendExtension = {
  name: 'fx',
  isEnabled: (c) => c.extensions?.fx?.enabled === true,
  settingsNav: [
    {
      id: 'fx-page',
      label: 'Fx page',
      href: '/dashboard/ext/fx',
      icon: Box,
      group: 'Organization',
      after: 'members',
      adminOnly: true,
      appliesTo: 'organization',
      keywords: ['fx-keyword'],
    },
  ],
  upgradeTarget: { href: '/dashboard/ext/fx' },
};

describe('public build registry', () => {
  it('ships empty', () => {
    expect(extensions).toEqual([]);
  });

  it('empty list leaves the nav as the core one', () => {
    const withList = visibleSettingsGroups({ role: 'owner', authConfig: base, extensionList: [] });
    const withDefault = visibleSettingsGroups({ role: 'owner', authConfig: base });
    expect(withList).toEqual(withDefault);
    const ids = withList.flatMap((g) => g.items.map((i) => i.id));
    expect(ids).not.toContain('billing');
    expect(ids).toContain('audit-log');
  });
});

describe('extension registry', () => {
  it('activeExtensions respects isEnabled and null config', () => {
    expect(activeExtensions(null, [fx])).toEqual([]);
    expect(activeExtensions(base, [fx])).toEqual([]);
    expect(activeExtensions(enabledCfg, [fx])).toEqual([fx]);
  });

  it('extensionUpgradeTarget only returns with the config enabled', () => {
    expect(extensionUpgradeTarget(enabledCfg, [fx])).toEqual({ href: '/dashboard/ext/fx' });
    expect(extensionUpgradeTarget(base, [fx])).toBeNull();
    expect(extensionUpgradeTarget(null, [fx])).toBeNull();
  });

  it('inserts the item right after its anchor for admins', () => {
    const groups = visibleSettingsGroups({ role: 'admin', authConfig: enabledCfg, extensionList: [fx] });
    const order = groups.find((g) => g.label === 'Organization')!.items.map((i) => i.id);
    expect(order[order.indexOf('members') + 1]).toBe('fx-page');
  });

  it('appends to the group when no anchor is given or the anchor is unknown', () => {
    const item = fx.settingsNav![0];
    const tail: FrontendExtension = {
      ...fx,
      settingsNav: [
        { ...item, id: 'no-anchor', after: undefined },
        { ...item, id: 'bad-anchor', after: 'nope' },
      ],
    };
    const groups = visibleSettingsGroups({ role: 'admin', authConfig: enabledCfg, extensionList: [tail] });
    const order = groups.find((g) => g.label === 'Organization')!.items.map((i) => i.id);
    expect(order.slice(-2)).toEqual(['no-anchor', 'bad-anchor']);
  });

  it('hides the admin-only item from members', () => {
    const items = visibleSettingsItems({ role: 'member', authConfig: enabledCfg, extensionList: [fx] });
    expect(items.map((i) => i.id)).not.toContain('fx-page');
  });

  it('hides the item when the extension is not enabled', () => {
    const items = visibleSettingsItems({ role: 'admin', authConfig: base, extensionList: [fx] });
    expect(items.map((i) => i.id)).not.toContain('fx-page');
  });

  it('palette pages carry the extension keywords', () => {
    const pages = settingsPages({ role: 'admin', authConfig: enabledCfg, extensionList: [fx] });
    const page = pages.find((p) => p.href === '/dashboard/ext/fx')!;
    expect(page.label).toBe('Fx page');
    expect(page.keywords).toContain('fx-keyword');
    expect(page.keywords).toContain('organization');
  });
});

describe('admin slots', () => {
  const core: AdminNavGroup[] = [
    {
      label: 'Instance',
      items: [
        { label: 'Instance overview', href: '/dashboard/admin', icon: Box },
        { label: 'System health', href: '/dashboard/admin/system-health', icon: Box },
      ],
    },
    {
      label: 'Manage',
      items: [
        { label: 'All organizations', href: '/dashboard/admin/organizations', icon: Box },
        { label: 'All users', href: '/dashboard/admin/users', icon: Box },
      ],
    },
  ];
  const coreSnapshot = JSON.stringify(core.map((g) => ({ l: g.label, i: g.items.map((i) => i.href) })));

  const PanelStub = (() => null) as unknown as ExtensionAdminOrgPanel['component'];

  const fxAdmin: FrontendExtension = {
    name: 'fx',
    isEnabled: (c) => c.extensions?.fx?.enabled === true,
    adminNav: [
      { id: 'revenue', label: 'Revenue', href: '/dashboard/admin/ext/fx/revenue', icon: Box, keywords: ['mrr'] },
      {
        id: 'grants',
        label: 'Grants',
        href: '/dashboard/admin/ext/fx/grants',
        icon: Box,
        group: 'Manage',
        after: '/dashboard/admin/organizations',
      },
    ],
    adminOrgPanels: [{ id: 'billing', label: 'Billing', component: PanelStub }],
  };

  it('public build returns the core groups unchanged', () => {
    expect(adminNavGroups(core, base)).toEqual(core);
    expect(adminNavGroups(core, enabledCfg)).toEqual(core);
    expect(adminNavGroups(core, null).map((g) => g.label)).not.toContain('Cloud');
  });

  it('enabled extension adds a Cloud group at the end', () => {
    const groups = adminNavGroups(core, enabledCfg, [fxAdmin]);
    expect(groups.map((g) => g.label)).toEqual(['Instance', 'Manage', 'Cloud']);
    expect(groups[2].items.map((i) => i.href)).toEqual(['/dashboard/admin/ext/fx/revenue']);
  });

  it('item with group Manage and after lands after that core item', () => {
    const manage = adminNavGroups(core, enabledCfg, [fxAdmin]).find((g) => g.label === 'Manage')!;
    expect(manage.items.map((i) => i.href)).toEqual([
      '/dashboard/admin/organizations',
      '/dashboard/admin/ext/fx/grants',
      '/dashboard/admin/users',
    ]);
  });

  it('disabled extension contributes nothing', () => {
    expect(adminNavGroups(core, base, [fxAdmin])).toEqual(core);
    expect(adminPaletteItems(base, [fxAdmin])).toEqual([]);
    expect(adminOrgPanels(base, [fxAdmin])).toEqual([]);
  });

  it('href outside /dashboard/admin/ext/<name> is dropped', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const bad: FrontendExtension = {
      ...fxAdmin,
      adminNav: [
        { id: 'a', label: 'Other ext', href: '/dashboard/admin/ext/other/x', icon: Box },
        { id: 'b', label: 'Core page', href: '/dashboard/admin/users', icon: Box },
        { id: 'c', label: 'Prefix trick', href: '/dashboard/admin/ext/fxy', icon: Box },
      ],
    };
    expect(adminNavGroups(core, enabledCfg, [bad])).toEqual(core);
    expect(adminPaletteItems(enabledCfg, [bad])).toEqual([]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('core array is not mutated', () => {
    adminNavGroups(core, enabledCfg, [fxAdmin]);
    expect(JSON.stringify(core.map((g) => ({ l: g.label, i: g.items.map((i) => i.href) })))).toBe(coreSnapshot);
  });

  it('palette: admin items carry keywords and the group label', () => {
    const items = adminPaletteItems(enabledCfg, [fxAdmin]);
    const revenue = items.find((i) => i.href === '/dashboard/admin/ext/fx/revenue')!;
    expect(revenue.label).toBe('Revenue');
    expect(revenue.keywords).toEqual(expect.arrayContaining(['mrr', 'cloud', 'admin']));
    const grants = items.find((i) => i.href === '/dashboard/admin/ext/fx/grants')!;
    expect(grants.keywords).toContain('manage');
  });

  it('org panels: anchors are prefixed ext-<name>- and disabled extensions are skipped', () => {
    const off: FrontendExtension = { ...fxAdmin, name: 'off', isEnabled: () => false };
    const panels = adminOrgPanels(enabledCfg, [fxAdmin, off]);
    expect(panels).toHaveLength(1);
    expect(panels[0].anchor).toBe('ext-fx-billing');
    expect(panels[0].label).toBe('Billing');
    expect(panels[0].component).toBe(PanelStub);
  });
});
