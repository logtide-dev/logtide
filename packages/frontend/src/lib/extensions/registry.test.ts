import { describe, it, expect } from 'vitest';
import Box from '@lucide/svelte/icons/box';
import type { AuthConfig } from '$lib/api/auth';
import { visibleSettingsGroups, visibleSettingsItems } from '$lib/components/settings/settings-nav';
import { settingsPages } from '$lib/components/shell/settings-pages';
import { activeExtensions, extensionUpgradeTarget } from './registry';
import { extensions } from './index';
import type { FrontendExtension } from './types';

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
