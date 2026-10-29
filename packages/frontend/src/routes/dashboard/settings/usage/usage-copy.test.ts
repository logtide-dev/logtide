import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/svelte';

const h = vi.hoisted(() => ({
  goto: vi.fn(),
  getAuthConfig: vi.fn(),
  getCapabilityUsage: vi.fn(),
}));

vi.mock('$app/navigation', () => ({ goto: h.goto }));
vi.mock('$lib/api/auth', () => ({ authAPI: { getAuthConfig: h.getAuthConfig } }));
vi.mock('$lib/api/organizations', () => ({ organizationsAPI: { createUpgradeHandoff: vi.fn() } }));
vi.mock('$lib/api/usage', () => ({
  getUsage: vi.fn().mockResolvedValue({ usage: [] }),
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

const cap = (over: Record<string, unknown>) => ({
  capability: 'projects.max',
  kind: 'limit',
  current: 1,
  limit: null,
  description: '',
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  organizationStore.setOrganizations([org as never]);
  organizationStore.setCurrentOrganization(org.id);
});

describe('usage page wording', () => {
  it('no-limit instance shows "This instance has no limits" and no word plan', async () => {
    h.getAuthConfig.mockResolvedValue({});
    h.getCapabilityUsage.mockResolvedValue({ capabilities: [cap({}), cap({ capability: 'apikeys.max' })] });
    const { container } = render(Page);
    expect(await screen.findByText('This instance has no limits.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Usage' })).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/\bplan\b/i);
    expect(container.textContent).not.toContain('unlimited on this plan');
  });

  it('self-hosted instance with limits is called Limits, not Plan limits', async () => {
    h.getAuthConfig.mockResolvedValue({});
    h.getCapabilityUsage.mockResolvedValue({ capabilities: [cap({ limit: 5 })] });
    render(Page);
    await waitFor(() => expect(screen.getByText('Projects')).toBeInTheDocument());
    expect(screen.queryByText('Plan limits')).toBeNull();
    expect(screen.getByText('Limits')).toBeInTheDocument();
  });

  it('cloud instance with limits says Plan limits', async () => {
    h.getAuthConfig.mockResolvedValue({ upgradeEnabled: true });
    h.getCapabilityUsage.mockResolvedValue({ capabilities: [cap({ limit: 5 })] });
    render(Page);
    expect(await screen.findByText('Plan limits')).toBeInTheDocument();
  });

  it('quota in grace shows the reset date in the badge', async () => {
    h.getAuthConfig.mockResolvedValue({ upgradeEnabled: true });
    h.getCapabilityUsage.mockResolvedValue({
      capabilities: [
        cap({
          capability: 'ingestion.max_events_monthly',
          kind: 'quota',
          current: 105,
          limit: 100,
          state: 'grace',
        }),
      ],
    });
    render(Page);
    const badge = await screen.findByTestId('quota-state-grace');
    expect(badge.textContent).toMatch(/^\s*Over limit, grace until [A-Z][a-z]{2} \d{1,2}\s*$/);
  });
});
