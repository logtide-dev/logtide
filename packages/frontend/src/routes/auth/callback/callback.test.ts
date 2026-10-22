import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor } from '@testing-library/svelte';

const { getMe, fetchOrganizations, goto } = vi.hoisted(() => ({
  getMe: vi.fn(),
  fetchOrganizations: vi.fn(),
  goto: vi.fn(),
}));

vi.mock('$lib/api/auth', () => ({ authAPI: { getMe } }));
vi.mock('$lib/stores/organization', () => ({ organizationStore: { fetchOrganizations } }));
vi.mock('$app/navigation', () => ({ goto }));

import CallbackPage from './+page.svelte';
import { page } from '../../../test-stubs/app-state';
import { authStore } from '$lib/stores/auth';

describe('/auth/callback page', () => {
  beforeEach(() => {
    localStorage.clear();
    authStore.clearAuth();
    getMe.mockReset();
    fetchOrganizations.mockReset();
    goto.mockReset();
    getMe.mockResolvedValue({ user: { id: 'u1', email: 'a@b.c', name: 'A' } });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('removes the token from the url before any await (FRONTEND-BUGS #5)', async () => {
    page.url = new URL('http://localhost/auth/callback?token=secret-token&expires=1');
    const order: string[] = [];
    const replace = vi.spyOn(history, 'replaceState').mockImplementation(() => {
      order.push('replace');
    });
    getMe.mockImplementation(async () => {
      order.push('getMe');
      return { user: { id: 'u1', email: 'a@b.c', name: 'A' } };
    });
    fetchOrganizations.mockResolvedValue([{ id: 'o1' }]);
    render(CallbackPage);
    await waitFor(() => expect(goto).toHaveBeenCalled());
    expect(replace).toHaveBeenCalledWith(null, '', '/auth/callback');
    expect(order[0]).toBe('replace');
    expect(order.indexOf('replace')).toBeLessThan(order.indexOf('getMe'));
    expect(getMe).toHaveBeenCalledWith('secret-token');
  });

  it('goes to /onboarding with zero organizations', async () => {
    page.url = new URL('http://localhost/auth/callback?token=t');
    fetchOrganizations.mockResolvedValue([]);
    render(CallbackPage);
    await waitFor(() => expect(goto).toHaveBeenCalledWith('/onboarding'));
  });

  it('goes to /dashboard when the user has organizations', async () => {
    page.url = new URL('http://localhost/auth/callback?token=t');
    fetchOrganizations.mockResolvedValue([{ id: 'o1' }]);
    render(CallbackPage);
    await waitFor(() => expect(goto).toHaveBeenCalledWith('/dashboard'));
  });
});
