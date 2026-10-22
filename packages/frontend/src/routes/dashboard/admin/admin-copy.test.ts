import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/svelte';

const pending = () => new Promise<never>(() => {});

const { orgDetails } = vi.hoisted(() => ({
  orgDetails: {
    id: 'org-1',
    name: 'Acme Corp',
    slug: 'acme',
    retentionDays: 30,
    auditRetentionDays: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    members: [],
    projects: [],
  },
}));

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$app/state', () => ({ page: { params: { id: 'org-1' }, url: { pathname: '/dashboard/admin' } } }));
vi.mock('$lib/api/admin', () => ({
  adminAPI: new Proxy(
    {},
    {
      get: (_t, prop) => {
        if (prop === 'getOrganizationDetails') return () => Promise.resolve(orgDetails);
        if (prop === 'getOrganizationEntitlements') return () => Promise.resolve({ entitlements: {} });
        return () => pending();
      },
    },
  ),
}));
vi.mock('$lib/api/admin-auth', () => ({
  AdminAuthAPI: class {
    getProviders = () => pending();
  },
}));
vi.mock('$lib/api/users', () => ({
  UsersAPI: class {
    getCurrentUser = () => pending();
  },
}));
vi.mock('$lib/api/usage', () => ({
  getUsage: () => pending(),
  getUsageBreakdown: () => pending(),
  getStorageUsage: () => pending(),
}));

import Overview from './+page.svelte';
import SystemHealth from './system-health/+page.svelte';
import Usage from './usage/+page.svelte';
import AdminSettings from './settings/+page.svelte';
import Organizations from './organizations/+page.svelte';
import OrganizationDetail from './organizations/[id]/+page.svelte';
import Projects from './projects/+page.svelte';
import Users from './users/+page.svelte';
import AuthProviders from './auth-providers/+page.svelte';
import { authStore } from '$lib/stores/auth';

const pages: Array<[string, unknown]> = [
  ['Instance overview', Overview],
  ['System health', SystemHealth],
  ['Instance usage', Usage],
  ['Instance settings', AdminSettings],
  ['All organizations', Organizations],
  ['All projects', Projects],
  ['All users', Users],
  ['Auth providers', AuthProviders],
];

describe('admin pages copy', () => {
  beforeEach(() => {
    localStorage.clear();
    authStore.setAuth({ id: 'u1', email: 'a@b.c', name: 'A', is_admin: true }, 'token');
  });

  for (const [title, Component] of pages) {
    it(`${title} renders its Instance-admin title and the instance chip`, () => {
      render(Component as never);
      expect(screen.getByRole('heading', { level: 1, name: title })).toBeTruthy();
      expect(screen.getByText('Applies to: Instance')).toBeTruthy();
    });
  }

  it('auth providers copy says whole instance and never "your organization"', () => {
    const { container } = render(AuthProviders as never);
    expect(container.textContent).toContain('apply to the whole instance');
    expect(container.textContent?.toLowerCase()).not.toContain('your organization');
  });

  it('deleting an organization requires typing its name', async () => {
    render(OrganizationDetail as never);
    const del = await screen.findByRole('button', { name: 'Delete organization' });
    await fireEvent.click(del);
    const dialog = await screen.findByRole('alertdialog');
    const confirm = Array.from(dialog.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Delete organization',
    ) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    const input = dialog.querySelector('input') as HTMLInputElement;
    await fireEvent.input(input, { target: { value: 'Acme Corp' } });
    await waitFor(() => expect(confirm.disabled).toBe(false));
  });
});
