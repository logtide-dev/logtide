import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/svelte';
import { get } from 'svelte/store';

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

const { getOrganizations } = vi.hoisted(() => ({
  getOrganizations: vi.fn(),
}));

vi.mock('$lib/api/organizations', () => ({
  OrganizationsAPI: class {
    getOrganizations = getOrganizations;
  },
}));

vi.mock('$lib/api/auth', () => ({
  authAPI: {
    getAuthConfig: vi.fn().mockResolvedValue({ authMode: 'local' }),
    getMe: vi
      .fn()
      .mockResolvedValue({ user: { id: 'user-1', email: 'a@b.c', name: 'Test User' } }),
    getCurrentUserAuthFree: vi.fn(),
  },
}));

import RequireOrganization from './RequireOrganization.svelte';
import { authStore } from '$lib/stores/auth';
import { organizationStore, currentOrganization } from '$lib/stores/organization';

const cachedOrg = {
  id: 'org-1',
  name: 'Acme',
  slug: 'acme',
  ownerId: 'user-1',
  role: 'owner' as const,
  retentionDays: 90,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
};

// Same org as returned fresh by the API after an admin retention change.
const freshOrg = { ...cachedOrg, retentionDays: 365 };

describe('RequireOrganization', () => {
  beforeEach(() => {
    localStorage.clear();
    getOrganizations.mockReset();
    authStore.setAuth({ id: 'user-1', email: 'a@b.c', name: 'Test User' }, 'token-1');
    organizationStore.clear();
  });

  // Regression for #288: the org object cached in localStorage was never
  // re-fetched once present, so fields updated elsewhere (admin retention
  // change) stayed stale forever within a persisted session.
  it('revalidates the cached organization from the API when one is already selected', async () => {
    organizationStore.setCurrentOrganization(cachedOrg);
    getOrganizations.mockResolvedValue({ organizations: [freshOrg] });

    render(RequireOrganization);

    await waitFor(() => expect(getOrganizations).toHaveBeenCalled());
    await waitFor(() => expect(get(currentOrganization)?.retentionDays).toBe(365));
  });

  it('does not block rendering on the background refresh', async () => {
    organizationStore.setCurrentOrganization(cachedOrg);
    // Never resolves: the page must still leave the loading state.
    getOrganizations.mockReturnValue(new Promise(() => {}));

    render(RequireOrganization);

    await waitFor(() =>
      expect(screen.queryByText('Loading organization...')).toBeNull()
    );
    expect(get(currentOrganization)?.id).toBe('org-1');
  });

  it('still fetches before rendering when no organization is selected', async () => {
    getOrganizations.mockResolvedValue({ organizations: [freshOrg] });

    render(RequireOrganization);

    await waitFor(() => expect(get(currentOrganization)?.id).toBe('org-1'));
    expect(get(currentOrganization)?.retentionDays).toBe(365);
  });
});
