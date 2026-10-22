import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/svelte';

const { getInvitationByToken, acceptInvitation, getOrganizations, goto } = vi.hoisted(() => ({
  getInvitationByToken: vi.fn(),
  acceptInvitation: vi.fn(),
  getOrganizations: vi.fn(),
  goto: vi.fn(),
}));

vi.mock('$lib/api/invitations', () => ({
  InvitationsAPI: class {
    getInvitationByToken = getInvitationByToken;
    acceptInvitation = acceptInvitation;
  },
}));
vi.mock('$lib/api/organizations', () => ({
  OrganizationsAPI: class {
    getOrganizations = getOrganizations;
  },
}));
vi.mock('$app/navigation', () => ({ goto }));
vi.mock('$app/state', () => ({
  page: { params: { token: 'inv-1' }, url: new URL('http://localhost/invite/inv-1') },
}));

import InvitePage from './+page.svelte';
import { authStore } from '$lib/stores/auth';

describe('/invite/[token] page', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    localStorage.clear();
    goto.mockReset();
    authStore.setAuth({ id: 'u1', email: 'invitee@example.com', name: 'I' }, 'session-1');
    getInvitationByToken.mockResolvedValue({
      email: 'invitee@example.com',
      role: 'member',
      organizationName: 'Acme',
      inviterName: 'Boss',
      expiresAt: new Date(Date.now() + 3 * 86400000),
    });
    acceptInvitation.mockResolvedValue({ organizationId: 'o1' });
    getOrganizations.mockResolvedValue({ organizations: [{ id: 'o1', name: 'Acme', slug: 'acme' }] });
  });

  afterEach(() => {
    vi.useRealTimers();
    authStore.clearAuth();
  });

  it('accepting navigates to /dashboard and shows no "successfully"', async () => {
    render(InvitePage);
    const button = await screen.findByRole('button', { name: /Accept invitation/i });
    await fireEvent.click(button);
    await waitFor(() =>
      expect(screen.getByText('You joined the organization. Redirecting you to the dashboard.')).toBeTruthy(),
    );
    expect(document.body.textContent).not.toMatch(/successfully/i);
    await vi.advanceTimersByTimeAsync(2500);
    expect(goto).toHaveBeenCalledWith('/dashboard');
    expect(goto).not.toHaveBeenCalledWith('/onboarding');
  });
});
