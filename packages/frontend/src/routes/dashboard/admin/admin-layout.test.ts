import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const { goto, getCurrentUser, pageState } = vi.hoisted(() => ({
  goto: vi.fn(),
  getCurrentUser: vi.fn(),
  pageState: { url: { pathname: '/dashboard/admin' } },
}));

vi.mock('$app/navigation', () => ({ goto }));
vi.mock('$app/state', () => ({ page: pageState }));
vi.mock('$lib/api/users', () => ({
  UsersAPI: class {
    getCurrentUser = getCurrentUser;
  },
}));

import Layout from './+layout.svelte';
import { authStore } from '$lib/stores/auth';

const child = createRawSnippet(() => ({ render: () => '<div data-testid="child">child</div>' }));

function setAuth(token: string | null, isAdmin?: boolean) {
  if (!token) {
    authStore.clearAuth();
    return;
  }
  authStore.setAuth(
    { id: 'u1', email: 'a@b.c', name: 'A', ...(isAdmin === undefined ? {} : { is_admin: isAdmin }) },
    token,
  );
}

describe('admin layout guard', () => {
  beforeEach(() => {
    goto.mockReset();
    getCurrentUser.mockReset();
    pageState.url.pathname = '/dashboard/admin';
    localStorage.clear();
  });

  it('non-admin user is redirected to /dashboard and children never render', async () => {
    setAuth('t', false);
    render(Layout, { children: child });
    await waitFor(() => expect(goto).toHaveBeenCalledWith('/dashboard'));
    expect(screen.queryByTestId('child')).toBeNull();
  });

  it('no token redirects to /login', async () => {
    setAuth(null);
    render(Layout, { children: child });
    await waitFor(() => expect(goto).toHaveBeenCalledWith('/login'));
    expect(screen.queryByTestId('child')).toBeNull();
  });

  it('is_admin undefined resolves via getCurrentUser then renders', async () => {
    setAuth('t');
    getCurrentUser.mockResolvedValue({ user: { id: 'u1', is_admin: true } });
    render(Layout, { children: child });
    await waitFor(() => expect(screen.getByTestId('child')).toBeTruthy());
    expect(getCurrentUser).toHaveBeenCalledTimes(1);
  });

  it('is_admin undefined and resolved false redirects without rendering', async () => {
    setAuth('t');
    getCurrentUser.mockResolvedValue({ user: { id: 'u1', is_admin: false } });
    render(Layout, { children: child });
    await waitFor(() => expect(goto).toHaveBeenCalledWith('/dashboard'));
    expect(screen.queryByTestId('child')).toBeNull();
  });

  it('admin sees eight labelled links with the exact labels', async () => {
    setAuth('t', true);
    render(Layout, { children: child });
    await waitFor(() => expect(screen.getByTestId('child')).toBeTruthy());
    const expected: Record<string, string> = {
      'Instance overview': '/dashboard/admin',
      'System health': '/dashboard/admin/system-health',
      'Instance usage': '/dashboard/admin/usage',
      'Instance settings': '/dashboard/admin/settings',
      'All organizations': '/dashboard/admin/organizations',
      'All projects': '/dashboard/admin/projects',
      'All users': '/dashboard/admin/users',
      'Auth providers': '/dashboard/admin/auth-providers',
    };
    for (const [label, href] of Object.entries(expected)) {
      const links = screen.getAllByRole('link', { name: label });
      expect(links.length).toBeGreaterThan(0);
      for (const l of links) expect(l.getAttribute('href')).toBe(href);
    }
    expect(screen.queryByText('Back to Dashboard')).toBeNull();
    expect(screen.getByText('Instance admin')).toBeTruthy();
  });

  it('Instance overview is active only on the exact path', async () => {
    pageState.url.pathname = '/dashboard/admin/users';
    setAuth('t', true);
    render(Layout, { children: child });
    await waitFor(() => expect(screen.getByTestId('child')).toBeTruthy());
    for (const l of screen.getAllByRole('link', { name: 'Instance overview' })) {
      expect(l.getAttribute('aria-current')).toBeNull();
    }
    for (const l of screen.getAllByRole('link', { name: 'All users' })) {
      expect(l.getAttribute('aria-current')).toBe('page');
    }
  });

  it('the file named +layout@.svelte no longer exists', () => {
    expect(existsSync(resolve(__dirname, '+layout@.svelte'))).toBe(false);
    expect(existsSync(resolve(__dirname, '+layout.svelte'))).toBe(true);
  });
});
