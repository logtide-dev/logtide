import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import { page } from '$app/state';

const h = vi.hoisted(() => ({
  getSummary: vi.fn(),
  getProjects: vi.fn(),
}));
vi.mock('$lib/api/project-health', () => ({
  projectHealthAPI: { getSummary: h.getSummary },
}));
vi.mock('$lib/api/projects', () => ({
  projectsAPI: {
    getProjects: h.getProjects,
    getProjectDataAvailability: vi.fn(async () => ({ logs: [], traces: [], metrics: [] })),
  },
}));
vi.mock('$lib/api/first-signal', () => ({
  projectLastEventsAPI: { get: vi.fn(async () => ({})) },
}));

import ProjectHealthBanner from './ProjectHealthBanner.svelte';
import { orgProjectsStore } from '$lib/stores/org-projects';
import { projectHealthStore } from '$lib/stores/project-health';

const proj = (id: string, name: string, deletedAt: string | null = null) => ({ id, name, deletedAt });
const issue = (checkKey: string, muted = false) => ({ checkKey, severity: 'warning', muted });

function setup(projects: unknown[], byProject: Record<string, unknown>) {
  h.getProjects.mockResolvedValue({ projects });
  h.getSummary.mockResolvedValue({ projects: byProject });
}

function go(path: string) {
  (page as { url: URL }).url = new URL(`http://localhost${path}`);
}

const settle = () => new Promise((r) => setTimeout(r, 30));

describe('ProjectHealthBanner', () => {
  beforeEach(() => {
    h.getSummary.mockReset();
    h.getProjects.mockReset();
    orgProjectsStore.reset();
    projectHealthStore.reset();
    try {
      sessionStorage.clear();
    } catch {
      // ignore
    }
    go('/dashboard/logs');
  });

  it('is hidden on non data pages', async () => {
    go('/dashboard/alerts');
    setup([proj('p1', 'Api')], { p1: { status: 'critical', openIssues: [issue('silent')] } });
    render(ProjectHealthBanner, { organizationId: 'o1' });
    await settle();
    expect(screen.queryByTestId('project-health-banner')).toBeNull();
  });

  it('shows the single project copy with a link to the project', async () => {
    setup([proj('p1', 'Api')], {
      p1: { status: 'critical', openIssues: [issue('silent'), issue('revoked_key')] },
    });
    render(ProjectHealthBanner, { organizationId: 'o1' });
    expect(
      await screen.findByText(/Api has 2 health issues: Project stopped sending data, Data sent with a revoked API key/),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Details' })).toHaveAttribute('href', '/dashboard/projects/p1');
  });

  it('uses the singular for one issue', async () => {
    setup([proj('p1', 'Api')], { p1: { status: 'critical', openIssues: [issue('silent')] } });
    render(ProjectHealthBanner, { organizationId: 'o1' });
    expect(
      await screen.findByText(/Api has 1 health issue: Project stopped sending data/),
    ).toBeInTheDocument();
  });

  it('shows the multi project copy linking to the projects table', async () => {
    setup([proj('p1', 'Api'), proj('p2', 'Web')], {
      p1: { status: 'critical', openIssues: [issue('silent')] },
      p2: { status: 'warning', openIssues: [issue('revoked_key')] },
    });
    render(ProjectHealthBanner, { organizationId: 'o1' });
    expect(await screen.findByText(/2 projects have health issues: Api, Web/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Details' })).toHaveAttribute('href', '/dashboard/projects');
  });

  it('respects the project scope in the URL', async () => {
    go('/dashboard/metrics?project=p2');
    setup([proj('p1', 'Api'), proj('p2', 'Web')], {
      p1: { status: 'critical', openIssues: [issue('silent')] },
      p2: { status: 'warning', openIssues: [issue('revoked_key')] },
    });
    render(ProjectHealthBanner, { organizationId: 'o1' });
    expect(
      await screen.findByText(/Web has 1 health issue: Data sent with a revoked API key/),
    ).toBeInTheDocument();
  });

  it('ignores muted issues and deleted projects', async () => {
    setup([proj('p1', 'Api'), proj('p2', 'Old', '2026-01-01T00:00:00Z')], {
      p1: { status: 'warning', openIssues: [issue('silent', true)] },
      p2: { status: 'critical', openIssues: [issue('silent')] },
    });
    render(ProjectHealthBanner, { organizationId: 'o1' });
    await settle();
    expect(screen.queryByTestId('project-health-banner')).toBeNull();
  });

  it('dismiss hides it until the issue set changes', async () => {
    setup([proj('p1', 'Api')], { p1: { status: 'critical', openIssues: [issue('silent')] } });
    const first = render(ProjectHealthBanner, { organizationId: 'o1' });
    await screen.findByTestId('project-health-banner');
    await fireEvent.click(screen.getByRole('button', { name: 'Dismiss health banner' }));
    expect(screen.queryByTestId('project-health-banner')).toBeNull();
    first.unmount();

    // Same issues: stays dismissed.
    render(ProjectHealthBanner, { organizationId: 'o1' });
    await settle();
    expect(screen.queryByTestId('project-health-banner')).toBeNull();
  });

  it('comes back when the signature changes', async () => {
    setup([proj('p1', 'Api')], { p1: { status: 'critical', openIssues: [issue('silent')] } });
    const first = render(ProjectHealthBanner, { organizationId: 'o1' });
    await screen.findByTestId('project-health-banner');
    await fireEvent.click(screen.getByRole('button', { name: 'Dismiss health banner' }));
    first.unmount();

    setup([proj('p1', 'Api')], {
      p1: { status: 'critical', openIssues: [issue('silent'), issue('pii_rejected')] },
    });
    render(ProjectHealthBanner, { organizationId: 'o1' });
    expect(await screen.findByTestId('project-health-banner')).toBeInTheDocument();
  });
});
