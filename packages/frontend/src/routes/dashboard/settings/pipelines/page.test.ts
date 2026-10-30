import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/svelte';

const h = vi.hoisted(() => ({
  goto: vi.fn(),
  getProjects: vi.fn(),
  list: vi.fn(),
}));

vi.mock('$app/navigation', () => ({ goto: h.goto }));
vi.mock('$lib/api/projects', () => ({ projectsAPI: { getProjects: h.getProjects } }));
vi.mock('$lib/api/log-pipeline', () => ({
  logPipelineAPI: { list: h.list, delete: vi.fn(), update: vi.fn() },
}));

import Page from './+page.svelte';
import { authStore } from '$lib/stores/auth';
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

const pipe = (over: Record<string, unknown>) => ({
  id: 'a',
  organizationId: 'org-1',
  projectId: null,
  name: 'Nginx',
  description: null,
  enabled: true,
  steps: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...over,
});

describe('pipelines list page', () => {
  beforeEach(() => {
    localStorage.clear();
    h.getProjects.mockReset();
    h.list.mockReset();
    h.getProjects.mockResolvedValue({ projects: [{ id: 'p1', name: 'Checkout' }] });
    h.list.mockResolvedValue([
      pipe({ id: 'a', name: 'Org pipe' }),
      pipe({ id: 'b', name: 'Proj pipe', projectId: 'p1' }),
    ]);
    authStore.setAuth({ id: 'user-1', email: 'a@b.c', name: 'Test User' }, 'token-1');
    organizationStore.clear();
    organizationStore.setCurrentOrganization(org('owner') as never);
  });

  it('list badge shows the project name', async () => {
    render(Page);
    await screen.findByText('Proj pipe');
    await waitFor(() => {
      const badges = screen.getAllByTestId('pipeline-scope').map((b) => b.textContent?.trim());
      expect(badges).toEqual(['All projects', 'Checkout']);
    });
  });

  it('precedence note is rendered', async () => {
    render(Page);
    const note = await screen.findByTestId('pipeline-precedence');
    expect(note.textContent).toContain(
      'A project pipeline runs instead of the organization-wide pipeline for that project. They are not chained.'
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Pipelines' })).toBeInTheDocument();
  });

  it('member cannot see New pipeline', async () => {
    organizationStore.setCurrentOrganization(org('member') as never);
    render(Page);
    await screen.findByText('Org pipe');
    expect(screen.queryByRole('button', { name: /New pipeline/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete Org pipe' })).toBeNull();
    expect(screen.getByTestId('read-only-notice').textContent).toContain('log pipelines');
  });

  it('member can open a pipeline to view its steps', async () => {
    organizationStore.setCurrentOrganization(org('member') as never);
    render(Page);
    await screen.findByText('Org pipe');
    expect(screen.queryByRole('button', { name: 'Edit Org pipe' })).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: 'View Org pipe' }));
    expect(h.goto).toHaveBeenCalledWith('/dashboard/settings/pipelines/a');
  });

  it('owner has no View button, only Edit', async () => {
    render(Page);
    await screen.findByText('Org pipe');
    expect(screen.queryByRole('button', { name: 'View Org pipe' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Edit Org pipe' })).toBeInTheDocument();
  });

  it('owner sees New pipeline and delete asks for confirmation', async () => {
    render(Page);
    await screen.findByText('Org pipe');
    expect(screen.getByRole('button', { name: /New pipeline/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete Org pipe' })).toBeInTheDocument();
  });
});
