import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';

const pending = () => new Promise<never>(() => {});

const h = vi.hoisted(() => ({
  getOrganizations: vi.fn(),
  getUsers: vi.fn(),
  getProjects: vi.fn(),
}));

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$lib/api/admin', () => ({
  adminAPI: new Proxy(
    {},
    {
      get: (_t, prop) => {
        if (prop === 'getOrganizations') return h.getOrganizations;
        if (prop === 'getUsers') return h.getUsers;
        if (prop === 'getProjects') return h.getProjects;
        return () => pending();
      },
    },
  ),
}));
vi.mock('$lib/api/users', () => ({
  UsersAPI: class {
    getCurrentUser = () => pending();
  },
}));

import { authStore } from '$lib/stores/auth';
import Organizations from './organizations/+page.svelte';
import Users from './users/+page.svelte';
import Projects from './projects/+page.svelte';

const failing = (message: string) => vi.fn().mockRejectedValue(new Error(message));
const empty = (key: 'organizations' | 'users' | 'projects') =>
  vi.fn().mockResolvedValue({ [key]: [], total: 0, totalPages: 1 });

describe('admin list pages: EmptyState with Retry on failed fetch', () => {
  beforeEach(() => {
    localStorage.clear();
    authStore.setAuth({ id: 'u1', email: 'a@b.c', name: 'A', is_admin: true }, 'token');
    h.getOrganizations.mockReset();
    h.getUsers.mockReset();
    h.getProjects.mockReset();
  });

  it('organizations: failed fetch shows an error state and Retry refetches', async () => {
    h.getOrganizations = failing('network down') as never;
    render(Organizations as never);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Could not load organizations');
    expect(alert).toHaveTextContent('network down');
    const retry = screen.getByRole('button', { name: 'Retry' });
    h.getOrganizations = vi.fn().mockResolvedValue({ organizations: [], total: 0, totalPages: 1 }) as never;
    await fireEvent.click(retry);
    expect(await screen.findByText('No organizations found')).toBeInTheDocument();
  });

  it('organizations: empty list uses the no-results EmptyState', async () => {
    h.getOrganizations = empty('organizations') as never;
    render(Organizations as never);
    expect(await screen.findByText('No organizations found')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('No organizations found');
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  it('users: failed fetch shows an error state and Retry refetches', async () => {
    h.getUsers = failing('boom') as never;
    render(Users as never);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Could not load users');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('users: empty list uses the no-results EmptyState', async () => {
    h.getUsers = empty('users') as never;
    render(Users as never);
    expect(await screen.findByText('No users found')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('No users found');
  });

  it('projects: failed fetch shows an error state with Retry', async () => {
    h.getProjects = failing('timeout') as never;
    render(Projects as never);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Could not load projects');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('projects: empty list uses the no-results EmptyState', async () => {
    h.getProjects = empty('projects') as never;
    render(Projects as never);
    expect(await screen.findByText('No projects found')).toBeInTheDocument();
    expect(screen.getByText('No projects have been created yet')).toBeInTheDocument();
  });
});
