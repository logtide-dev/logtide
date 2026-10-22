import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';

const h = vi.hoisted(() => ({
  goto: vi.fn(),
  deleteOrganization: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock('$app/navigation', () => ({ goto: h.goto }));
vi.mock('$lib/api/organizations', () => ({
  OrganizationsAPI: class {
    deleteOrganization = h.deleteOrganization;
    updateOrganization = vi.fn();
  },
}));
vi.mock('$lib/stores/toast', () => ({ toastStore: h.toast }));

import Page from './+page.svelte';
import { authStore } from '$lib/stores/auth';
import { organizationStore } from '$lib/stores/organization';

const baseOrg = {
  id: 'org-1',
  name: 'Acme',
  slug: 'acme',
  ownerId: 'user-1',
  role: 'owner' as const,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
};

describe('organization settings retention display', () => {
  beforeEach(() => {
    localStorage.clear();
    authStore.setAuth({ id: 'user-1', email: 'a@b.c', name: 'Test User' }, 'token-1');
    organizationStore.clear();
  });

  it('shows the organization retention value', () => {
    organizationStore.setCurrentOrganization({ ...baseOrg, retentionDays: 365 });

    render(Page);

    expect(screen.getByText('365 days')).toBeInTheDocument();
  });

  // Regression for #288: a cached org object without retentionDays must not
  // silently render as a 90 day policy.
  it('does not fall back to 90 days when retentionDays is missing', () => {
    organizationStore.setCurrentOrganization({ ...baseOrg } as never);

    const { container } = render(Page);

    expect(container.textContent).not.toMatch(/90 days/);
  });
});

describe('general page', () => {
  beforeEach(() => {
    localStorage.clear();
    h.goto.mockReset();
    h.deleteOrganization.mockReset();
    h.toast.success.mockReset();
    h.toast.error.mockReset();
    authStore.setAuth({ id: 'user-1', email: 'a@b.c', name: 'Test User' }, 'token-1');
    organizationStore.clear();
  });

  it('has the General header scoped to the organization', () => {
    organizationStore.setCurrentOrganization({ ...baseOrg, retentionDays: 30 });
    render(Page);
    expect(screen.getByRole('heading', { level: 1, name: 'General' })).toBeInTheDocument();
    expect(screen.getByText('Applies to: Organization')).toBeInTheDocument();
  });

  it('has no Display card', () => {
    organizationStore.setCurrentOrganization({ ...baseOrg, retentionDays: 30 });
    const { container } = render(Page);
    expect(screen.queryByText('Display')).toBeNull();
    expect(container.textContent).not.toContain('Time format');
    expect(container.textContent).not.toContain('Applies to dashboard panels');
  });

  it('admin sees the owner-only notice and disabled fields', () => {
    organizationStore.setCurrentOrganization({ ...baseOrg, role: 'admin', retentionDays: 30 });
    render(Page);
    expect(screen.getByTestId('read-only-notice').textContent).toContain(
      'Only the organization owner can change the organization name, URL slug and description.'
    );
    expect(screen.getByLabelText('Organization name')).toBeDisabled();
    expect(screen.getByLabelText('URL slug')).toBeDisabled();
    expect(screen.getByLabelText('Description')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Delete organization' })).toBeNull();
  });

  it('owner sees enabled fields, no notice, and the transfer pointer', () => {
    organizationStore.setCurrentOrganization({ ...baseOrg, retentionDays: 30 });
    render(Page);
    expect(screen.queryByTestId('read-only-notice')).toBeNull();
    expect(screen.getByLabelText('Organization name')).not.toBeDisabled();
    const link = screen.getByRole('link', { name: 'Members page' });
    expect(link.getAttribute('href')).toBe('/dashboard/settings/members');
  });

  it('owner delete requires typing the exact name', async () => {
    organizationStore.setCurrentOrganization({ ...baseOrg, retentionDays: 30 });
    render(Page);
    await fireEvent.click(screen.getByRole('button', { name: 'Delete organization' }));

    const dialog = await screen.findByRole('alertdialog');
    const confirm = Array.from(dialog.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Delete organization'
    ) as HTMLButtonElement;
    const input = dialog.querySelector('input') as HTMLInputElement;
    expect(confirm.disabled).toBe(true);
    await fireEvent.input(input, { target: { value: 'acme' } });
    expect(confirm.disabled).toBe(true);
    await fireEvent.input(input, { target: { value: 'Acme' } });
    expect(confirm.disabled).toBe(false);
  });

  it('delete success removes the org from the store and navigates to /dashboard', async () => {
    h.deleteOrganization.mockResolvedValue(undefined);
    organizationStore.setOrganizations([{ ...baseOrg, retentionDays: 30 }]);
    organizationStore.setCurrentOrganization({ ...baseOrg, retentionDays: 30 });
    render(Page);
    await fireEvent.click(screen.getByRole('button', { name: 'Delete organization' }));
    const dialog = await screen.findByRole('alertdialog');
    await fireEvent.input(dialog.querySelector('input') as HTMLInputElement, { target: { value: 'Acme' } });
    const confirm = Array.from(dialog.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Delete organization'
    ) as HTMLButtonElement;
    await fireEvent.click(confirm);

    await waitFor(() => expect(h.deleteOrganization).toHaveBeenCalledWith('org-1'));
    await waitFor(() => expect(h.goto).toHaveBeenCalledWith('/dashboard'));
    let ids: string[] = [];
    organizationStore.subscribe((s) => (ids = s.organizations.map((o) => o.id)))();
    expect(ids).not.toContain('org-1');
  });
});
