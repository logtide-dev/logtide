import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';

const gotoMock = vi.fn();
vi.mock('$app/navigation', () => ({ goto: (...a: unknown[]) => gotoMock(...a) }));

const { getProjects, createProject, restoreProject, orgLoad, orgState } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { writable } = require('svelte/store') as typeof import('svelte/store');
  return {
    getProjects: vi.fn(),
    createProject: vi.fn(),
    restoreProject: vi.fn(),
    orgLoad: vi.fn(async () => {}),
    orgState: writable({
      orgId: 'org-1' as string | null,
      projects: [] as unknown[],
      lastEventAt: {} as Record<string, string | null>,
      receiving: new Set<string>(),
      withTraces: new Set<string>(),
      loading: false,
      error: null as string | null,
    }),
  };
});

vi.mock('$lib/api/projects', () => ({
  projectsAPI: {
    getProjects: (...a: unknown[]) => getProjects(...a),
    createProject: (...a: unknown[]) => createProject(...a),
    restoreProject: (...a: unknown[]) => restoreProject(...a),
  },
}));
vi.mock('$lib/stores/org-projects', () => ({
  orgProjectsStore: {
    subscribe: orgState.subscribe,
    load: (...a: unknown[]) => orgLoad(...(a as [])),
    reset: vi.fn(),
    projectName: vi.fn(),
  },
}));
vi.mock('$lib/stores/checklist', () => ({ checklistStore: { completeItem: vi.fn() } }));

const toastSuccess = vi.fn();
vi.mock('$lib/stores/toast', () => ({
  toastStore: { success: (...a: unknown[]) => toastSuccess(...a), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

import ProjectsPage from './+page.svelte';
import { organizationStore } from '$lib/stores/organization';
import { page } from '$app/state';

const org = { id: 'org-1', name: 'Acme', slug: 'acme', role: 'owner' } as unknown as Parameters<
  typeof organizationStore.setCurrentOrganization
>[0];

const project = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  id,
  organizationId: 'org-1',
  name,
  description: `${name} description`,
  slug: id,
  createdAt: '2026-09-01T10:00:00.000Z',
  updatedAt: '2026-09-01T10:00:00.000Z',
  ...extra,
});

beforeEach(() => {
  gotoMock.mockReset();
  toastSuccess.mockReset();
  getProjects.mockReset();
  createProject.mockReset();
  restoreProject.mockReset();
  orgLoad.mockClear();
  orgState.set({
    orgId: 'org-1',
    projects: [],
    lastEventAt: {},
    receiving: new Set(),
    withTraces: new Set(),
    loading: false,
    error: null,
  });
  (page as { url: URL }).url = new URL('http://localhost/dashboard/projects');
  organizationStore.setCurrentOrganization(org);
});

afterEach(() => organizationStore.setCurrentOrganization(null));

describe('projects page', () => {
  it('page heading is Projects with the org name in the description', async () => {
    getProjects.mockResolvedValue({ projects: [project('p-1', 'Alpha'), project('p-2', 'Beta')] });
    render(ProjectsPage);
    expect(await screen.findByRole('heading', { level: 1, name: 'Projects' })).toBeInTheDocument();
    expect(await screen.findByText('Acme - 2 projects')).toBeInTheDocument();
    expect(orgLoad).toHaveBeenCalledWith('org-1');
  });

  it('opens the create dialog when ?create=1', async () => {
    getProjects.mockResolvedValue({ projects: [project('p-1', 'Alpha')] });
    (page as { url: URL }).url = new URL('http://localhost/dashboard/projects?create=1');
    render(ProjectsPage);
    expect(await screen.findByRole('heading', { name: 'Create project' })).toBeInTheDocument();
    expect(gotoMock).toHaveBeenCalledWith('/dashboard/projects', { replaceState: true });
  });

  it('shows Create your first project when the organization has none', async () => {
    getProjects.mockResolvedValue({ projects: [] });
    render(ProjectsPage);
    expect(await screen.findByText('Create your first project')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/search projects/i)).toBeNull();
  });

  it('creating a project navigates to its Connect section', async () => {
    getProjects.mockResolvedValue({ projects: [] });
    createProject.mockResolvedValue({ project: project('new-id', 'Gamma') });
    render(ProjectsPage);
    await fireEvent.click(await screen.findByRole('button', { name: 'New project' }));
    await fireEvent.input(await screen.findByLabelText('Project name'), { target: { value: 'Gamma' } });
    const submit = screen.getAllByRole('button', { name: 'Create project' }).find((b) => b.getAttribute('type') === 'submit')!;
    await fireEvent.click(submit);
    await waitFor(() => expect(gotoMock).toHaveBeenCalledWith('/dashboard/projects/new-id/settings#connect'));
    expect(toastSuccess).toHaveBeenCalledWith('Project "Gamma" created');
  });

  it('deleted projects keep Restore and show the purge date', async () => {
    getProjects.mockResolvedValue({
      projects: [project('p-9', 'Old one', { deletedAt: '2026-10-01T10:00:00.000Z' })],
    });
    restoreProject.mockResolvedValue({ project: project('p-9', 'Old one') });
    render(ProjectsPage);
    expect(await screen.findByText('Deleted projects')).toBeInTheDocument();
    expect(screen.getByTestId('purge-date')).toHaveTextContent('Permanently deleted on Oct 31, 2026');
    await fireEvent.click(screen.getByRole('button', { name: /Restore/ }));
    await waitFor(() => expect(restoreProject).toHaveBeenCalledWith('org-1', 'p-9'));
    expect(toastSuccess).toHaveBeenCalledWith('Project restored');
  });

  it('has no delete controls on the cards', async () => {
    getProjects.mockResolvedValue({ projects: [project('p-1', 'Alpha')] });
    render(ProjectsPage);
    await screen.findByTestId('project-card');
    expect(screen.queryByRole('button', { name: /delete|trash/i })).toBeNull();
  });

  it('shows the Connect call to action for a project that is waiting for data', async () => {
    getProjects.mockResolvedValue({ projects: [project('p-1', 'Alpha'), project('p-2', 'Beta')] });
    orgState.update((s) => ({ ...s, receiving: new Set(['p-2']) }));
    render(ProjectsPage);
    await screen.findAllByTestId('project-card');
    const connect = screen.getAllByRole('link', { name: 'Connect' });
    expect(connect).toHaveLength(1);
    expect(connect[0]).toHaveAttribute('href', '/dashboard/projects/p-1/settings#connect');
  });

  it('search shows the no-results EmptyState with a Clear action', async () => {
    getProjects.mockResolvedValue({ projects: [project('p-1', 'Alpha')] });
    render(ProjectsPage);
    const search = await screen.findByPlaceholderText(/search projects/i);
    await fireEvent.input(search, { target: { value: 'zzz' } });
    expect(await screen.findByText('No projects found')).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(await screen.findByTestId('project-card')).toBeInTheDocument();
  });
});
