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
    getProjectSummary: (...a: unknown[]) => getSummary(...a),
    restoreProject: (...a: unknown[]) => restoreProject(...a),
  },
}));

const { getSummary, getHealth } = vi.hoisted(() => ({ getSummary: vi.fn(), getHealth: vi.fn() }));
vi.mock('$lib/api/project-health', () => ({
  projectHealthAPI: { getProjectHealth: (...a: unknown[]) => getHealth(...a) },
}));
vi.mock('$lib/api/notification-routing', () => ({
  notificationRoutingAPI: { preview: vi.fn().mockResolvedValue({ destinations: [], fallback: null }) },
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

function setRoute(id: string, path = `/dashboard/projects/${id}`) {
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
  getSummary.mockReset();
  getHealth.mockReset();
  getSummary.mockResolvedValue({ logs24h: 1200, openErrorGroups: 2, tracesP95Ms: 340, uptime30dPct: 99.9, monitorCount: 1, openIncidents: 0 });
  getHealth.mockResolvedValue({
    status: 'warning',
    lastEventAt: new Date(Date.now() - 120000).toISOString(),
    issues: [
      { id: 'i1', checkKey: 'timestamp_skew_logs', severity: 'warning', openedAt: new Date().toISOString(), lastSeenAt: new Date().toISOString(), resolvedAt: null, details: {}, mute: null },
    ],
    checks: { receiving: true, piiRejected24h: 0, skew: {}, revokedKey24h: 0 },
    settings: { silentMinutes: 60, healthChannelIds: [] },
  });
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

  it('renders the extra quick links not covered by the tiles', async () => {
    getProjects.mockResolvedValue({ projects: [project('p-1', 'Alpha')] });
    render(ProjectLayout, { props: { children } });
    const row = await screen.findByTestId('project-quick-links');
    const links = Array.from(row.querySelectorAll('a'));
    expect(links.map((a) => a.textContent?.trim())).toEqual(['Metrics', 'Sessions', 'Web vitals']);
    expect(links[2]).toHaveAttribute('href', '/dashboard/web-vitals?project=p-1');
  });

  it('shows the health pill, last event, tiles and the side nav instead of tabs', async () => {
    getProjects.mockResolvedValue({ projects: [project('p-1', 'Alpha')] });
    render(ProjectLayout, { props: { children } });
    expect(await screen.findByTestId('health-pill')).toHaveTextContent('1 warning');
    await waitFor(() => expect(screen.getByTestId('project-last-event')).toHaveTextContent('Last event 2 minutes ago'));
    await waitFor(() => expect(screen.getByTestId('summary-tile-logs')).toHaveTextContent('1,200'));
    expect(screen.getByTestId('project-nav-badge')).toHaveTextContent('1');
    expect(screen.queryAllByRole('tab')).toHaveLength(0);
    expect(getSummary).toHaveBeenCalledWith('p-1');
    expect(getHealth).toHaveBeenCalledWith('p-1');
    expect(getProjectCapabilities).not.toHaveBeenCalled();
  });

  it('one failing source keeps the page up with dashes', async () => {
    getProjects.mockResolvedValue({ projects: [project('p-1', 'Alpha')] });
    getSummary.mockRejectedValue(new Error('boom'));
    render(ProjectLayout, { props: { children } });
    await screen.findByTestId('health-pill');
    await waitFor(() =>
      expect(screen.getAllByTestId('summary-tile-value').map((v) => v.textContent?.trim())).toEqual(['-', '-', '-', '-', '-'])
    );
    expect(screen.getByTestId('child')).toBeInTheDocument();
  });

  it('shows Health only for a soft-deleted project and shows the read-only banner with the purge date', async () => {
    getProjects.mockResolvedValue({
      projects: [project('p-1', 'Alpha', { deletedAt: '2026-10-01T10:00:00.000Z' })],
    });
    render(ProjectLayout, { props: { children } });
    expect(await screen.findByText('This project is deleted (read-only)')).toBeInTheDocument();
    expect(screen.getByText(/permanently deleted on Oct 31, 2026/)).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /Health|General|Connect|Danger zone/ }).map((a) => a.textContent?.trim())).toEqual(['Health']);
    expect(screen.queryByTestId('project-summary-tiles')).toBeNull();
    expect(screen.queryByTestId('health-pill')).toBeNull();
    expect(getHealth).not.toHaveBeenCalled();
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
