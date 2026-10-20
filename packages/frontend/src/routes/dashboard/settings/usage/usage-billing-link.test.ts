import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';

const { goto, getAuthConfig, createUpgradeHandoff } = vi.hoisted(() => ({
  goto: vi.fn(),
  getAuthConfig: vi.fn(),
  createUpgradeHandoff: vi.fn(),
}));

vi.mock('$app/navigation', () => ({ goto }));
vi.mock('$lib/api/auth', () => ({ authAPI: { getAuthConfig } }));
vi.mock('$lib/api/organizations', () => ({ organizationsAPI: { createUpgradeHandoff } }));
vi.mock('$lib/api/usage', () => ({
  getUsage: vi.fn().mockResolvedValue({ usage: [] }),
  getUsageBreakdown: vi.fn().mockResolvedValue(null),
  getStorageUsage: vi.fn().mockResolvedValue(null),
  getCapabilityUsage: vi.fn().mockResolvedValue({ capabilities: [] }),
}));

import Page from './+page.svelte';
import { organizationStore } from '$lib/stores/organization';

const org = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Acme',
  slug: 'acme',
  ownerId: 'u1',
  role: 'owner' as const,
  retentionDays: 30,
  createdAt: new Date(),
  updatedAt: new Date(),
};

beforeEach(() => {
  vi.clearAllMocks();
  organizationStore.setOrganizations([org as never]);
  organizationStore.setCurrentOrganization(org.id);
});

describe('usage page upgrade links', () => {
  it('with billingEnabled Upgrade links to the billing page and does not call the handoff', async () => {
    getAuthConfig.mockResolvedValue({ upgradeEnabled: true, billingEnabled: true });
    render(Page);
    const upgrade = await screen.findByRole('button', { name: 'Upgrade' });
    await fireEvent.click(upgrade);
    expect(goto).toHaveBeenCalledWith('/dashboard/settings/billing');
    expect(createUpgradeHandoff).not.toHaveBeenCalled();
    await fireEvent.click(screen.getByRole('button', { name: 'Manage billing' }));
    expect(goto).toHaveBeenCalledTimes(2);
    expect(createUpgradeHandoff).not.toHaveBeenCalled();
  });

  it('without billingEnabled Upgrade still uses the handoff', async () => {
    getAuthConfig.mockResolvedValue({ upgradeEnabled: true });
    createUpgradeHandoff.mockRejectedValue(new Error('nope'));
    render(Page);
    await fireEvent.click(await screen.findByRole('button', { name: 'Upgrade' }));
    await waitFor(() => expect(createUpgradeHandoff).toHaveBeenCalledWith(org.id, 'upgrade'));
    expect(goto).not.toHaveBeenCalled();
  });
});
