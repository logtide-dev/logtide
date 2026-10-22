import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';

const gotoMock = vi.fn();
vi.mock('$app/navigation', () => ({ goto: (...a: unknown[]) => gotoMock(...a) }));

const { getProjects, getProjectCapabilities, restoreProject } = vi.hoisted(() => ({
  getProjects: vi.fn(),
  getProjectCapabilities: vi.fn(),
  restoreProject: vi.fn(),
}));
vi.mock('$lib/api/projects', () => ({
  projectsAPI: {
    getProjects: (...a: unknown[]) => getProjects(...a),
    getProjectCapabilities: (...a: unknown[]) => getProjectCapabilities(...a),
    restoreProject: (...a: unknown[]) => restoreProject(...a),
  },
}));

const toastError = vi.fn();
const toastSuccess = vi.fn();
vi.mock('$lib/stores/toast', () => ({
  toastStore: {
    success: (...a: unknown[]) => toastSuccess(...a),
    error: (...a: unknown[]) => toastError(...a),
    info: vi.fn(),
    warning: vi.fn(),
  },
}));

import ProjectLayout from './+layout.svelte';
import { organizationStore } from '$lib/stores/organization';
import { page } from '$app/state';

const org = (id: string) =>
  ({ id, name: `Org ${id}`, slug: id, role: 'owner' }) as unknown as Parameters<
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

const children = createRawSnippet(() => ({ render: () => '<div data-testid="child">child</div>' }));

function setRoute(id: string, path = `/dashboard/projects/${id}/overview`) {
  (page as unknown as { params: { id: string }; url: URL }).params = { id };
  (page as unknown as { url: URL }).url = new URL(`http://localhost${path}`);
}

beforeEach(() => {
  gotoMock.mockReset();
  toastError.mockReset();
  toastSuccess.mockReset();
  getProjects.mockReset();
  getProjectCapabilities.mockReset();
  restoreProject.mockReset();
  setRoute('p-1');
  organizationStore.setCurrentOrganization(org('org-1'));
});

afterEach(() => organizationStore.setCurrentOrganization(null));

describe('project layout', () => {
  it('shows breadcrumb Projects / <name>', async () => {
    getProjects.mockResolvedValue({ projects: [project('p-1', 'Alpha')] });
    render(ProjectLayout, { props: { children } });
    const nav = await screen.findByRole('navigation', { name: 'Breadcrumb' });
    expect(nav).toHaveTextContent('Projects');
    expect(nav).toHaveTextContent('Alpha');
    expect(screen.getByRole('link', { name: 'Projects' })).toHaveAttribute('href', '/dashboard/projects');
    expect(screen.getByRole('heading', { level: 1, name: 'Alpha' })).toBeInTheDocument();
  });

  it('renders the quick links row', async () => {
    getProjects.mockResolvedValue({ projects: [project('p-1', 'Alpha')] });
    render(ProjectLayout, { props: { children } });
    const row = await screen.findByTestId('project-quick-links');
    const links = Array.from(row.querySelectorAll('a'));
    expect(links.map((a) => a.textContent?.trim())).toEqual([
      'Logs',
      'Traces',
      'Errors',
      'Metrics',
      'Sessions',
      'Web vitals',
      'Uptime',
    ]);
    expect(links[0]).toHaveAttribute('href', '/dashboard/logs?project=p-1');
    expect(links[5]).toHaveAttribute('href', '/dashboard/web-vitals?project=p-1');
  });

  it('tabs are Overview, Alerts and Settings and never depend on capabilities', async () => {
    getProjects.mockResolvedValue({ projects: [project('p-1', 'Alpha')] });
    render(ProjectLayout, { props: { children } });
    await screen.findByTestId('project-quick-links');
    const tabs = screen.getAllByRole('tab').map((t) => t.textContent?.trim());
    expect(tabs).toEqual(['Overview', 'Alerts', 'Settings']);
    expect(getProjectCapabilities).not.toHaveBeenCalled();
  });

  it('hides Settings for a soft-deleted project and shows the read-only banner with the purge date', async () => {
    getProjects.mockResolvedValue({
      projects: [project('p-1', 'Alpha', { deletedAt: '2026-10-01T10:00:00.000Z' })],
    });
    render(ProjectLayout, { props: { children } });
    expect(await screen.findByText('This project is deleted (read-only)')).toBeInTheDocument();
    expect(screen.getByText(/permanently deleted on Oct 31, 2026/)).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Settings' })).toBeNull();
  });

  it('restoring a project toasts "Project restored"', async () => {
    getProjects.mockResolvedValue({
      projects: [project('p-1', 'Alpha', { deletedAt: '2026-10-01T10:00:00.000Z' })],
    });
    restoreProject.mockResolvedValue({ project: project('p-1', 'Alpha') });
    render(ProjectLayout, { props: { children } });
    await fireEvent.click(await screen.findByRole('button', { name: /Restore/ }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Project restored'));
  });

  it('unknown project id redirects to the projects list with an error toast', async () => {
    getProjects.mockResolvedValue({ projects: [project('p-2', 'Other')] });
    render(ProjectLayout, { props: { children } });
    await waitFor(() => expect(gotoMock).toHaveBeenCalledWith('/dashboard/projects'));
    expect(gotoMock).toHaveBeenCalledTimes(1);
    expect(toastError).toHaveBeenCalledWith('Project not found');
    expect(toastError).toHaveBeenCalledTimes(1);
  });

  it('project not belonging to the active organization after a switch falls back to the list without crashing', async () => {
    getProjects.mockImplementation(async (orgId: string) => ({
      projects: orgId === 'org-1' ? [project('p-1', 'Alpha')] : [],
    }));
    render(ProjectLayout, { props: { children } });
    expect(await screen.findByRole('heading', { level: 1, name: 'Alpha' })).toBeInTheDocument();

    organizationStore.setCurrentOrganization(org('org-2'));
    await waitFor(() => expect(gotoMock).toHaveBeenCalledWith('/dashboard/projects'));
    expect(gotoMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('heading', { level: 1, name: 'Alpha' })).toBeNull();
  });

  it('uses PageHeader with appliesTo project', async () => {
    getProjects.mockResolvedValue({ projects: [project('p-1', 'Alpha')] });
    render(ProjectLayout, { props: { children } });
    expect(await screen.findByText('Applies to: Project')).toBeInTheDocument();
  });

  it('offers Retry when the load fails', async () => {
    getProjects.mockRejectedValueOnce(new Error('boom'));
    getProjects.mockResolvedValue({ projects: [project('p-1', 'Alpha')] });
    render(ProjectLayout, { props: { children } });
    await fireEvent.click(await screen.findByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Alpha' })).toBeInTheDocument();
  });
});
