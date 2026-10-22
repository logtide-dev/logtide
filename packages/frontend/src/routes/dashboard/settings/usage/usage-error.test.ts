import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';

const h = vi.hoisted(() => ({
  goto: vi.fn(),
  getAuthConfig: vi.fn(),
  getCapabilityUsage: vi.fn(),
  getUsage: vi.fn(),
}));

vi.mock('$app/navigation', () => ({ goto: h.goto }));
vi.mock('$lib/api/auth', () => ({ authAPI: { getAuthConfig: h.getAuthConfig } }));
vi.mock('$lib/api/organizations', () => ({ organizationsAPI: { createUpgradeHandoff: vi.fn() } }));
vi.mock('$lib/api/usage', () => ({
  getUsage: h.getUsage,
  getUsageBreakdown: vi.fn().mockResolvedValue({ breakdown: null }),
  getStorageUsage: vi.fn().mockResolvedValue(null),
  getCapabilityUsage: h.getCapabilityUsage,
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
  h.getAuthConfig.mockResolvedValue({});
  h.getCapabilityUsage.mockResolvedValue({ capabilities: [] });
});

describe('usage page load failure', () => {
  it('shows an error EmptyState with Retry and refetches on Retry', async () => {
    h.getUsage.mockRejectedValue(new Error('upstream 503'));
    render(Page);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Could not load usage');
    expect(alert).toHaveTextContent('upstream 503');

    const callsBefore = h.getUsage.mock.calls.length;
    h.getUsage.mockResolvedValue({ usage: [] });
    await fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await vi.waitFor(() => expect(h.getUsage.mock.calls.length).toBeGreaterThan(callsBefore));
  });
});
