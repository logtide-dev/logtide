import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
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

import { goto } from '$app/navigation';
import { authAPI } from '$lib/api/auth';
import RequireOrganization from './RequireOrganization.svelte';
import { page } from '$app/state';
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
    (page as { url: URL }).url = new URL('http://localhost/dashboard/logs');
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

    await waitFor(() => expect(screen.queryByTestId('shell-skeleton')).toBeNull());
    expect(get(currentOrganization)?.id).toBe('org-1');
  });

  it('still fetches before rendering when no organization is selected', async () => {
    getOrganizations.mockResolvedValue({ organizations: [freshOrg] });

    render(RequireOrganization);

    await waitFor(() => expect(get(currentOrganization)?.id).toBe('org-1'));
    expect(get(currentOrganization)?.retentionDays).toBe(365);
  });

  it('renders the skeleton while organizations load', async () => {
    getOrganizations.mockReturnValue(new Promise(() => {}));

    render(RequireOrganization);

    expect(await screen.findByTestId('shell-skeleton')).toBeInTheDocument();
  });

  it('shows an error state with Retry when the organization list fails', async () => {
    getOrganizations.mockRejectedValueOnce(new Error('boom'));
    getOrganizations.mockResolvedValueOnce({ organizations: [freshOrg] });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(RequireOrganization, {
      props: { children: createRawSnippet(() => ({ render: () => '<p>page content</p>' })) },
    });

    const retry = await screen.findByRole('button', { name: 'Retry' });
    expect(screen.getByRole('alert')).toBeInTheDocument();
    await fireEvent.click(retry);

    await waitFor(() => expect(getOrganizations).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('page content')).toBeInTheDocument();
    consoleError.mockRestore();
  });

  it('renders admin pages for an instance admin with no organization', async () => {
    (page as { url: URL }).url = new URL('http://localhost/dashboard/admin/users');
    getOrganizations.mockResolvedValue({ organizations: [] });

    render(RequireOrganization, {
      props: { children: createRawSnippet(() => ({ render: () => '<p>admin content</p>' })) },
    });

    expect(await screen.findByText('admin content')).toBeInTheDocument();
    expect(goto).not.toHaveBeenCalledWith('/onboarding');
    expect(screen.queryByText('Create your first organization')).toBeNull();
  });

  it('still sends a user with no organization to onboarding outside admin', async () => {
    getOrganizations.mockResolvedValue({ organizations: [] });
    render(RequireOrganization);
    await waitFor(() => expect(goto).toHaveBeenCalledWith('/onboarding'));
  });
  it('keeps the session when the token check fails on the network', async () => {
    vi.mocked(authAPI.getMe).mockRejectedValueOnce(new TypeError('Failed to fetch'));
    getOrganizations.mockResolvedValue({ organizations: [freshOrg] });

    render(RequireOrganization, {
      props: { children: createRawSnippet(() => ({ render: () => '<p>page content</p>' })) },
    });

    expect(await screen.findByText('page content')).toBeInTheDocument();
    expect(goto).not.toHaveBeenCalledWith('/login');
    expect(get(authStore).token).toBe('token-1');
    expect(localStorage.getItem('logtide_auth')).not.toBeNull();
  });

  it('signs out and goes to login when the backend rejects the token', async () => {
    vi.mocked(authAPI.getMe).mockRejectedValueOnce(
      Object.assign(new Error('Invalid or expired session'), { status: 401 })
    );

    render(RequireOrganization);

    await waitFor(() => expect(goto).toHaveBeenCalledWith('/login'));
    expect(get(authStore).token).toBeNull();
  });
});
