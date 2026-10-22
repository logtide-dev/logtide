import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';

const { getAuthConfig } = vi.hoisted(() => ({ getAuthConfig: vi.fn() }));

vi.mock('$lib/api/auth', () => ({ authAPI: { getAuthConfig } }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

import Layout from './+layout.svelte';
import { organizationStore } from '$lib/stores/organization';

const org = (role: 'owner' | 'admin' | 'member') => ({
  id: 'org-1',
  name: 'Acme',
  slug: 'acme',
  ownerId: 'user-1',
  role,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
});

async function renderAs(role: 'owner' | 'admin' | 'member') {
  organizationStore.setCurrentOrganization(org(role) as never);
  render(Layout);
  await waitFor(() => expect(getAuthConfig).toHaveBeenCalledTimes(1));
  await tick();
  await tick();
}

const billingLinks = () => screen.queryAllByRole('link', { name: 'Billing' });

describe('settings nav billing entry', () => {
  beforeEach(() => {
    localStorage.clear();
    organizationStore.clear();
    getAuthConfig.mockReset();
  });

  it('is hidden when the instance has no in-app billing', async () => {
    getAuthConfig.mockResolvedValue({ authMode: 'standard', signupEnabled: true });
    await renderAs('owner');
    expect(billingLinks()).toHaveLength(0);
    expect(screen.getAllByRole('link', { name: 'Usage' }).length).toBeGreaterThan(0);
  });

  it('shows for owners and admins when billing is enabled', async () => {
    getAuthConfig.mockResolvedValue({ authMode: 'standard', signupEnabled: true, billingEnabled: true });
    await renderAs('admin');
    const links = billingLinks();
    // desktop sidebar + mobile pills
    expect(links).toHaveLength(2);
    for (const link of links) expect(link.getAttribute('href')).toBe('/dashboard/settings/billing');
  });

  it('never shows for members', async () => {
    getAuthConfig.mockResolvedValue({ authMode: 'standard', signupEnabled: true, billingEnabled: true });
    await renderAs('member');
    expect(billingLinks()).toHaveLength(0);
  });

  it('stays hidden when the auth config cannot be loaded', async () => {
    getAuthConfig.mockRejectedValue(new Error('offline'));
    await renderAs('owner');
    expect(billingLinks()).toHaveLength(0);
  });
});

describe('settings shell groups', () => {
  beforeEach(() => {
    localStorage.clear();
    organizationStore.clear();
    getAuthConfig.mockReset();
  });

  it('renders the five group labels for an owner', async () => {
    getAuthConfig.mockResolvedValue({ authMode: 'standard', signupEnabled: true, billingEnabled: true });
    await renderAs('owner');
    for (const label of ['Account', 'Organization', 'Data', 'Notifications', 'Projects']) {
      expect(screen.getByText(label, { selector: 'p' })).toBeTruthy();
    }
    expect(screen.getAllByRole('link', { name: 'Audit log' }).length).toBeGreaterThan(0);
  });

  it('hides Audit log from members', async () => {
    getAuthConfig.mockResolvedValue({ authMode: 'standard', signupEnabled: true });
    await renderAs('member');
    expect(screen.queryAllByRole('link', { name: 'Audit log' })).toHaveLength(0);
  });

  it('keeps rendering the rest when the auth config fails', async () => {
    getAuthConfig.mockRejectedValue(new Error('offline'));
    await renderAs('owner');
    expect(billingLinks()).toHaveLength(0);
    expect(screen.getAllByRole('link', { name: 'Members' }).length).toBeGreaterThan(0);
  });

  it('does not render its own page header', async () => {
    getAuthConfig.mockResolvedValue({});
    await renderAs('owner');
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
  });
});
