import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';

const gotoMock = vi.fn();
vi.mock('$app/navigation', () => ({ goto: (...a: unknown[]) => gotoMock(...a) }));

const switchMock = vi.fn();
const resetMock = vi.fn();
vi.mock('$lib/components/shell/org-switch', () => ({
  switchOrganization: (...a: unknown[]) => switchMock(...a),
  resetOrgScopedState: () => resetMock(),
}));

vi.mock('$lib/stores/checklist', () => ({ checklistStore: { completeItem: vi.fn() } }));

const createOrganization = vi.fn();
vi.mock('$lib/api/organizations', () => ({
  OrganizationsAPI: class {
    createOrganization(...a: unknown[]) {
      return createOrganization(...a);
    }
  },
}));

const toastSuccess = vi.fn();
vi.mock('$lib/stores/toast', () => ({
  toastStore: { success: (...a: unknown[]) => toastSuccess(...a), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

import OrganizationSwitcher from './OrganizationSwitcher.svelte';
import { organizationStore } from '$lib/stores/organization';
import { authStore } from '$lib/stores/auth';

const org = (id: string, name: string) =>
  ({ id, name, slug: id, role: 'owner' }) as unknown as Parameters<typeof organizationStore.addOrganization>[0];

// jsdom lacks these, bits-ui popover and command use them.
Element.prototype.scrollIntoView = vi.fn();
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

beforeEach(() => {
  gotoMock.mockReset();
  switchMock.mockReset();
  resetMock.mockReset();
  toastSuccess.mockReset();
  createOrganization.mockReset();
  authStore.setAuth({ id: 'u1', email: 'a@b.c', name: 'Ann' } as never, 'tok');
  organizationStore.setOrganizations([org('org-a', 'Alpha'), org('org-b', 'Beta')]);
  organizationStore.setCurrentOrganization('org-a');
});

afterEach(() => {
  authStore.clearAuth();
  organizationStore.setCurrentOrganization(null);
});

async function openSwitcher() {
  await fireEvent.click(screen.getByRole('combobox', { name: 'Switch organization' }));
}

describe('OrganizationSwitcher', () => {
  it('uses sentence case labels', async () => {
    render(OrganizationSwitcher);
    await openSwitcher();
    expect(await screen.findByText('Your organizations')).toBeInTheDocument();
    expect(screen.getByText('Create organization')).toBeInTheDocument();
    expect(screen.queryByText('Your Organizations')).toBeNull();
    expect(screen.queryByText('Create Organization')).toBeNull();
  });

  it('truncates a long name in the breadcrumb variant and keeps the full name in the title', () => {
    organizationStore.updateOrganization('org-a', { name: 'A very long organization name that overflows' });
    render(OrganizationSwitcher, { props: { variant: 'breadcrumb' } });
    const trigger = screen.getByRole('combobox', { name: 'Switch organization' });
    expect(trigger.className).toContain('max-w-[10rem]');
    expect(trigger.querySelector('.truncate')).not.toBeNull();
    expect(trigger).toHaveAttribute('title', 'A very long organization name that overflows');
  });

  it('selecting an organization calls switchOrganization and toasts', async () => {
    render(OrganizationSwitcher);
    await openSwitcher();
    await fireEvent.click(await screen.findByText('Beta'));
    expect(switchMock).toHaveBeenCalledTimes(1);
    expect((switchMock.mock.calls[0][0] as { id: string }).id).toBe('org-b');
    expect(toastSuccess).toHaveBeenCalledWith('Switched to Beta');
  });

  it('creating an organization navigates to the projects page with create=1', async () => {
    createOrganization.mockResolvedValue({ organization: { id: 'org-c', name: 'Gamma', slug: 'gamma' } });
    render(OrganizationSwitcher);
    await openSwitcher();
    await fireEvent.click(await screen.findByText('Create organization'));
    const nameInput = await screen.findByLabelText(/organization name/i);
    await fireEvent.input(nameInput, { target: { value: 'Gamma' } });
    await fireEvent.click(screen.getByRole('button', { name: /^create/i }));
    await waitFor(() => expect(gotoMock).toHaveBeenCalledWith('/dashboard/projects?create=1'));
    expect(toastSuccess).toHaveBeenCalledWith('Organization "Gamma" created');
    expect(resetMock).toHaveBeenCalled();
    for (const call of toastSuccess.mock.calls) {
      expect(String(call[0])).not.toMatch(/successfully|!$/);
    }
  });
});
