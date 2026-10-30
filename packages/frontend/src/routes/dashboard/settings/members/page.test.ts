import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';

const api = vi.hoisted(() => ({
  getOrganizationMembers: vi.fn(),
  getOrganizations: vi.fn(),
  transferOwnership: vi.fn(),
  updateMemberRole: vi.fn(),
  removeMember: vi.fn(),
  leaveOrganization: vi.fn(),
  getPendingInvitations: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$lib/api/organizations', () => ({
  OrganizationsAPI: class {
    getOrganizationMembers = api.getOrganizationMembers;
    getOrganizations = api.getOrganizations;
    transferOwnership = api.transferOwnership;
    updateMemberRole = api.updateMemberRole;
    removeMember = api.removeMember;
    leaveOrganization = api.leaveOrganization;
  },
}));
vi.mock('$lib/api/invitations', () => ({
  InvitationsAPI: class {
    getPendingInvitations = api.getPendingInvitations;
  },
}));
vi.mock('$lib/stores/toast', () => ({ toastStore: api.toast }));

import Page from './+page.svelte';
import { authStore } from '$lib/stores/auth';
import { organizationStore } from '$lib/stores/organization';

const stamp = new Date('2026-03-04T10:00:00.000Z');

const member = (id: string, userId: string, name: string, role: 'owner' | 'admin' | 'member') => ({
  id,
  organizationId: 'org-1',
  userId,
  role,
  createdAt: stamp,
  user: { id: userId, name, email: `${name.toLowerCase().replace(/ /g, '.')}@example.com` },
});

const MEMBERS = [
  member('m1', 'u-owner', 'Olive Owner', 'owner'),
  member('m2', 'u-admin', 'Adam Admin', 'admin'),
  member('m3', 'u-member', 'Mia Member', 'member'),
];

function setOrg(role: 'owner' | 'admin' | 'member') {
  organizationStore.clear();
  organizationStore.setCurrentOrganization({
    id: 'org-1',
    name: 'Acme',
    slug: 'acme',
    ownerId: 'u-owner',
    role,
    createdAt: stamp,
    updatedAt: stamp,
  } as never);
}

function loginAs(userId: string) {
  authStore.setAuth({ id: userId, email: 'v@example.com', name: 'Viewer' } as never, 'tok');
}

async function openMenu(name: string) {
  const trigger = await screen.findByRole('button', { name: `Member actions for ${name}` });
  await fireEvent.keyDown(trigger, { key: 'ArrowDown' });
}

async function renderPage(role: 'owner' | 'admin' | 'member', userId: string) {
  loginAs(userId);
  setOrg(role);
  render(Page);
  await screen.findByText('Olive Owner');
}

describe('members page', () => {
  beforeEach(() => {
    localStorage.clear();
    for (const fn of Object.values(api)) {
      if (typeof fn === 'function' && 'mockReset' in fn) (fn as ReturnType<typeof vi.fn>).mockReset();
    }
    api.toast.success.mockReset();
    api.toast.error.mockReset();
    api.getOrganizationMembers.mockResolvedValue({ members: MEMBERS });
    api.getPendingInvitations.mockResolvedValue({ invitations: [] });
    api.getOrganizations.mockResolvedValue({ organizations: [] });
  });

  it('badges read Owner, Admin, Member', async () => {
    await renderPage('owner', 'u-owner');
    const table = screen.getAllByRole('table')[0];
    for (const label of ['Owner', 'Admin', 'Member']) {
      expect(Array.from(table.querySelectorAll('div,span')).some((e) => e.textContent?.trim() === label)).toBe(true);
    }
    expect(table.textContent).not.toMatch(/\bowner\b(?!@)/);
  });

  it('renders the Members header scoped to the organization', async () => {
    await renderPage('owner', 'u-owner');
    expect(screen.getByRole('heading', { level: 1, name: 'Members' })).toBeInTheDocument();
    expect(screen.getByText('Applies to: Organization')).toBeInTheDocument();
  });

  it('owner sees Transfer ownership on admin and member rows, not on the owner row', async () => {
    await renderPage('owner', 'u-owner');
    // The owner row (self) has no actions button at all.
    expect(screen.queryByRole('button', { name: 'Member actions for Olive Owner' })).toBeNull();

    await openMenu('Adam Admin');
    expect(await screen.findByRole('menuitem', { name: 'Transfer ownership' })).toBeInTheDocument();
  });

  it('admin never sees Transfer ownership', async () => {
    await renderPage('admin', 'u-admin');
    // An admin can only act on plain members
    expect(screen.queryByRole('button', { name: 'Member actions for Adam Admin' })).toBeNull();
    await openMenu('Mia Member');
    await screen.findByRole('menuitem', { name: 'Remove from organization' });
    expect(screen.queryByRole('menuitem', { name: 'Transfer ownership' })).toBeNull();
  });

  it('transfer confirm stays disabled until the org name is typed exactly', async () => {
    await renderPage('owner', 'u-owner');
    await openMenu('Mia Member');
    await fireEvent.click(await screen.findByRole('menuitem', { name: 'Transfer ownership' }));

    const dialog = await screen.findByRole('alertdialog');
    expect(dialog.textContent).toContain('You will become an admin.');
    expect(dialog.textContent).toContain('Mia Member becomes the owner');
    const confirm = Array.from(dialog.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Transfer ownership'
    ) as HTMLButtonElement;
    const input = dialog.querySelector('input') as HTMLInputElement;

    expect(confirm.disabled).toBe(true);
    await fireEvent.input(input, { target: { value: 'acme' } });
    expect(confirm.disabled).toBe(true);
    await fireEvent.input(input, { target: { value: 'Acme' } });
    expect(confirm.disabled).toBe(false);
  });

  it('confirming calls transferOwnership(orgId, member.userId) then refreshes orgs', async () => {
    api.transferOwnership.mockResolvedValue({ success: true });
    api.getOrganizations.mockResolvedValue({
      organizations: [
        {
          id: 'org-1',
          name: 'Acme',
          slug: 'acme',
          ownerId: 'u-member',
          role: 'admin',
          createdAt: stamp,
          updatedAt: stamp,
        },
      ],
    });
    await renderPage('owner', 'u-owner');
    await openMenu('Mia Member');
    await fireEvent.click(await screen.findByRole('menuitem', { name: 'Transfer ownership' }));
    const dialog = await screen.findByRole('alertdialog');
    await fireEvent.input(dialog.querySelector('input') as HTMLInputElement, { target: { value: 'Acme' } });
    const confirm = Array.from(dialog.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Transfer ownership'
    ) as HTMLButtonElement;
    await fireEvent.click(confirm);

    await waitFor(() => expect(api.transferOwnership).toHaveBeenCalledWith('org-1', 'u-member'));
    await waitFor(() => expect(api.getOrganizations).toHaveBeenCalled());
    expect(api.toast.success).toHaveBeenCalledWith('Ownership transferred to Mia Member');
    await waitFor(() => {
      let role: string | undefined;
      organizationStore.subscribe((s) => (role = s.currentOrganization?.role))();
      expect(role).toBe('admin');
    });
    expect(api.getOrganizationMembers.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('API error shows an error toast and keeps the dialog open', async () => {
    api.transferOwnership.mockRejectedValue(new Error('The new owner must be a member of this organization'));
    await renderPage('owner', 'u-owner');
    await openMenu('Mia Member');
    await fireEvent.click(await screen.findByRole('menuitem', { name: 'Transfer ownership' }));
    const dialog = await screen.findByRole('alertdialog');
    await fireEvent.input(dialog.querySelector('input') as HTMLInputElement, { target: { value: 'Acme' } });
    const confirm = Array.from(dialog.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Transfer ownership'
    ) as HTMLButtonElement;
    await fireEvent.click(confirm);

    await waitFor(() =>
      expect(api.toast.error).toHaveBeenCalledWith('The new owner must be a member of this organization')
    );
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(api.getOrganizations).not.toHaveBeenCalled();
  });

  it('role table lists eight capabilities', async () => {
    await renderPage('owner', 'u-owner');
    expect(screen.getByText('What each role can do')).toBeInTheDocument();
    expect(screen.getAllByTestId('role-capability-row')).toHaveLength(8);
  });

  it('member viewer sees no Invite button and no actions column', async () => {
    await renderPage('member', 'u-member');
    expect(screen.queryByRole('button', { name: /invite member/i })).toBeNull();
    expect(screen.queryByRole('columnheader', { name: 'Actions' })).toBeNull();
  });

  it('owner sees the Invite member button', async () => {
    await renderPage('owner', 'u-owner');
    expect(screen.getByRole('button', { name: 'Invite member' })).toBeInTheDocument();
  });

  it('the leave button is labelled and uses a confirm dialog', async () => {
    await renderPage('admin', 'u-admin');
    await fireEvent.click(screen.getByRole('button', { name: 'Leave organization' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog.textContent).toContain('Leave organization');
  });
});
