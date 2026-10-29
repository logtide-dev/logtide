import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';

const { goto, getAuthConfig, createUpgradeHandoff, fakeExtensions } = vi.hoisted(() => ({
  goto: vi.fn(),
  getAuthConfig: vi.fn(),
  createUpgradeHandoff: vi.fn(),
  fakeExtensions: [] as unknown[],
}));

vi.mock('$app/navigation', () => ({ goto }));
vi.mock('$lib/api/auth', () => ({ authAPI: { getAuthConfig } }));
vi.mock('$lib/api/organizations', () => ({ organizationsAPI: { createUpgradeHandoff } }));
vi.mock('$lib/extensions', () => ({ extensions: fakeExtensions }));
vi.mock('$lib/api/usage', () => ({
  getUsage: vi.fn().mockResolvedValue({ usage: [] }),
  getUsageBreakdown: vi.fn().mockResolvedValue(null),
  getStorageUsage: vi.fn().mockResolvedValue(null),
  getCapabilityUsage: vi.fn().mockResolvedValue({ capabilities: [] }),
}));

import Page from './+page.svelte';
import { organizationStore } from '$lib/stores/organization';

const org = (role: 'owner' | 'admin' | 'member') => ({
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Acme',
  slug: 'acme',
  ownerId: 'u1',
  role,
  retentionDays: 30,
  createdAt: new Date(),
  updatedAt: new Date(),
});

function useOrg(role: 'owner' | 'admin' | 'member') {
  const o = org(role);
  organizationStore.setOrganizations([o as never]);
  organizationStore.setCurrentOrganization(o.id);
}

beforeEach(() => {
  vi.clearAllMocks();
  fakeExtensions.length = 0;
  fakeExtensions.push({
    name: 'fx',
    isEnabled: (cfg: { extensions?: Record<string, unknown> }) => Boolean(cfg.extensions?.fx),
    upgradeTarget: { href: '/dashboard/ext/fx/plans' },
  });
  useOrg('admin');
});

describe('usage page with an extension upgrade target', () => {
  it('shows Upgrade and Manage billing and navigates instead of calling the handoff', async () => {
    getAuthConfig.mockResolvedValue({ extensions: { fx: {} } });
    render(Page);
    await fireEvent.click(await screen.findByRole('button', { name: 'Upgrade' }));
    expect(goto).toHaveBeenCalledWith('/dashboard/ext/fx/plans');
    await fireEvent.click(screen.getByRole('button', { name: 'Manage billing' }));
    expect(goto).toHaveBeenCalledTimes(2);
    expect(goto).toHaveBeenLastCalledWith('/dashboard/ext/fx/plans');
    expect(createUpgradeHandoff).not.toHaveBeenCalled();
  });

  it('prefers the extension target over the upgrade handoff', async () => {
    getAuthConfig.mockResolvedValue({ upgradeEnabled: true, extensions: { fx: {} } });
    render(Page);
    await fireEvent.click(await screen.findByRole('button', { name: 'Upgrade' }));
    expect(goto).toHaveBeenCalledWith('/dashboard/ext/fx/plans');
    expect(createUpgradeHandoff).not.toHaveBeenCalled();
  });

  it('hides the buttons from plain members', async () => {
    useOrg('member');
    getAuthConfig.mockResolvedValue({ extensions: { fx: {} } });
    render(Page);
    await waitFor(() => expect(getAuthConfig).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: 'Upgrade' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Manage billing' })).toBeNull();
  });

  it('hides the buttons when the extension is not enabled and there is no handoff', async () => {
    getAuthConfig.mockResolvedValue({});
    render(Page);
    await waitFor(() => expect(getAuthConfig).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: 'Upgrade' })).toBeNull();
  });

  it('without an extension Upgrade still uses the handoff', async () => {
    getAuthConfig.mockResolvedValue({ upgradeEnabled: true });
    createUpgradeHandoff.mockRejectedValue(new Error('nope'));
    render(Page);
    await fireEvent.click(await screen.findByRole('button', { name: 'Upgrade' }));
    await waitFor(() => expect(createUpgradeHandoff).toHaveBeenCalledWith(org('admin').id, 'upgrade'));
    expect(goto).not.toHaveBeenCalled();
  });
});
