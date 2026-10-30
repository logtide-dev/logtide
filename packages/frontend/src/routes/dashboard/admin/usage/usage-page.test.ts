import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/svelte';

const h = vi.hoisted(() => ({
  getOrganizations: vi.fn(),
  getOrganizationDetails: vi.fn(),
  getUsage: vi.fn(),
  getUsageBreakdown: vi.fn(),
  getStorageUsage: vi.fn(),
}));

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$lib/api/admin', () => ({
  adminAPI: {
    getOrganizations: h.getOrganizations,
    getOrganizationDetails: h.getOrganizationDetails,
  },
}));
vi.mock('$lib/api/usage', () => ({
  getUsage: h.getUsage,
  getUsageBreakdown: h.getUsageBreakdown,
  getStorageUsage: h.getStorageUsage,
}));

import { page } from '$app/state';
import { authStore } from '$lib/stores/auth';
import Usage from './+page.svelte';

const breakdown = {
  breakdown: {
    byType: [{ type: 'logs.ingested.events', quantity: 1234 }],
    byProject: [],
    byService: [],
    byLevel: [],
  },
};

describe('instance usage page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    authStore.setAuth({ id: 'u1', email: 'a@b.c', name: 'A', is_admin: true }, 'token');
    h.getOrganizations.mockResolvedValue({ organizations: [], total: 0 });
    (page as { url: URL }).url = new URL('http://localhost/dashboard/admin/usage');
  });

  it('does not pick an organization on its own', async () => {
    render(Usage as never);
    expect(await screen.findByRole('status')).toHaveTextContent('Select an organization');
    expect(h.getUsage).not.toHaveBeenCalled();
  });

  it('loads the organization from the URL and shows human metric labels', async () => {
    (page as { url: URL }).url = new URL('http://localhost/dashboard/admin/usage?org=o1');
    h.getOrganizationDetails.mockResolvedValue({ id: 'o1', name: 'Acme', slug: 'acme' });
    h.getUsage.mockResolvedValue({ usage: [{ type: 'logs.ingested.events', project_id: null, bucket: '2026-10-01', quantity: 1234 }] });
    h.getUsageBreakdown.mockResolvedValue(breakdown);
    h.getStorageUsage.mockResolvedValue({ current: 2048, series: [] });

    render(Usage as never);
    expect(await screen.findByText('Log events ingested')).toBeInTheDocument();
    expect(screen.getByText('logs.ingested.events')).toBeInTheDocument();
    expect(screen.getByTestId('usage-storage')).toHaveTextContent('Current snapshot');
    expect(screen.getByTestId('usage-storage')).toHaveTextContent('2.0 KB');
  });

  it('clears stale data and shows a retryable error when loading fails', async () => {
    (page as { url: URL }).url = new URL('http://localhost/dashboard/admin/usage?org=o1');
    h.getOrganizationDetails.mockResolvedValue({ id: 'o1', name: 'Acme', slug: 'acme' });
    h.getUsage.mockRejectedValue(new Error('metering down'));
    h.getUsageBreakdown.mockResolvedValue(breakdown);
    h.getStorageUsage.mockResolvedValue({ current: 1, series: [] });

    render(Usage as never);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('metering down'));
    expect(screen.queryByText('Log events ingested')).toBeNull();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});
