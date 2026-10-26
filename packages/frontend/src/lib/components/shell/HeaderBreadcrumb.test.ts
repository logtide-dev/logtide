import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';

const { orgProjects, load, gotoMock } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { writable } = require('svelte/store') as typeof import('svelte/store');
  return {
    orgProjects: writable({
      orgId: 'org-1' as string | null,
      projects: [
        { id: 'p-1', name: 'Alpha API' },
        { id: 'p-2', name: 'Beta web' },
      ] as { id: string; name: string }[],
    }),
    load: vi.fn(async () => {}),
    gotoMock: vi.fn(async (_url: string) => {}),
  };
});
vi.mock('$app/navigation', () => ({ goto: (url: string) => gotoMock(url) }));
vi.mock('$lib/stores/org-projects', () => ({
  orgProjectsStore: {
    subscribe: orgProjects.subscribe,
    load: (...a: unknown[]) => load(...(a as [])),
    reset: vi.fn(),
    projectName: vi.fn(),
  },
}));
vi.mock('$lib/components/OrganizationSwitcher.svelte', async () => ({
  default: (await import('./__stubs__/SwitcherStub.svelte')).default,
}));

import HeaderBreadcrumb from './HeaderBreadcrumb.svelte';
import { organizationStore } from '$lib/stores/organization';
import { page } from '$app/state';
import { scopeStore } from '$lib/stores/scope';
import { activeScopeBar } from '$lib/stores/scope-bar';

const org = (id: string, name: string) =>
  ({ id, name, slug: id, role: 'owner' }) as unknown as Parameters<typeof organizationStore.setCurrentOrganization>[0];

function at(url: string) {
  (page as { url: URL }).url = new URL('http://localhost' + url);
}

// jsdom has no scrollIntoView; the command list calls it on the highlighted item.
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};

beforeEach(() => {
  load.mockClear();
  gotoMock.mockClear();
  scopeStore.reset();
  activeScopeBar.set(null);
  orgProjects.set({
    orgId: 'org-1',
    projects: [
      { id: 'p-1', name: 'Alpha API' },
      { id: 'p-2', name: 'Beta web' },
    ],
  });
  organizationStore.setCurrentOrganization(org('org-1', 'Acme'));
});

afterEach(() => {
  organizationStore.setCurrentOrganization(null);
});

describe('HeaderBreadcrumb', () => {
  it('shows All projects when nothing narrows the scope', () => {
    at('/dashboard/logs');
    const { container } = render(HeaderBreadcrumb);
    expect(screen.getByTestId('org-switcher')).toBeInTheDocument();
    expect(container.querySelector('[data-breadcrumb-project]')!.textContent).toContain('All projects');
  });

  it('shows the remembered project on pages without a project picker', () => {
    scopeStore.setProjects(['p-2']);
    at('/dashboard/settings/general');
    const { container } = render(HeaderBreadcrumb);
    expect(container.querySelector('[data-breadcrumb-project]')!.textContent).toContain('Beta web');
  });

  it('shows Org / Project on project pages using the route id', () => {
    at('/dashboard/projects/p-1/overview');
    const { container } = render(HeaderBreadcrumb);
    const project = container.querySelector('[data-breadcrumb-project]')!;
    expect(project.textContent).toContain('Alpha API');
    expect(project).toHaveAttribute('role', 'combobox');
    expect(project).toHaveAttribute('aria-label', 'Switch project');
  });

  it('lists the organization projects and marks the current one', async () => {
    at('/dashboard/projects/p-1/overview');
    render(HeaderBreadcrumb);
    await fireEvent.click(screen.getByRole('combobox', { name: 'Switch project' }));
    const current = document.querySelector('[data-project-option="p-1"]')!;
    expect(current.textContent).toContain('Alpha API');
    expect(current.querySelector('svg:last-child')).not.toBeNull();
    expect(document.querySelector('[data-project-option="p-2"]')!.textContent).toContain('Beta web');
  });

  it('switches to the same sub-page of another project on project pages', async () => {
    at('/dashboard/projects/p-1/settings?tab=keys');
    render(HeaderBreadcrumb);
    await fireEvent.click(screen.getByRole('combobox', { name: 'Switch project' }));
    await fireEvent.click(await screen.findByText('Beta web'));
    await waitFor(() => expect(gotoMock).toHaveBeenCalledWith('/dashboard/projects/p-2/settings?tab=keys'));
  });

  it('rescopes the current page and remembers the pick on scoped pages', async () => {
    activeScopeBar.set({ mode: 'multi' });
    const setProjects = vi.spyOn(scopeStore, 'setProjects');
    at('/dashboard/errors?project=p-1&range=24h');
    render(HeaderBreadcrumb);
    await fireEvent.click(screen.getByRole('combobox', { name: 'Switch project' }));
    await fireEvent.click(await screen.findByText('Beta web'));
    await waitFor(() => expect(gotoMock).toHaveBeenCalledTimes(1));
    expect(setProjects).toHaveBeenCalledWith(['p-2']);
    const target = new URL('http://localhost' + gotoMock.mock.calls[0][0]);
    expect(target.pathname).toBe('/dashboard/errors');
    expect(target.searchParams.get('project')).toBe('p-2');
    expect(target.searchParams.get('range')).toBe('24h');
    setProjects.mockRestore();
  });

  it('does not navigate when the current project is picked again', async () => {
    at('/dashboard/projects/p-1/overview');
    render(HeaderBreadcrumb);
    await fireEvent.click(screen.getByRole('combobox', { name: 'Switch project' }));
    await fireEvent.click(document.querySelector('[data-project-option="p-1"]')!);
    expect(gotoMock).not.toHaveBeenCalled();
  });

  it('keeps a readable minimum width for the project on narrow screens', () => {
    at('/dashboard/projects/p-1/overview');
    const { container } = render(HeaderBreadcrumb);
    const cls = container.querySelector('[data-breadcrumb-project]')!.getAttribute('class')!;
    expect(cls).toContain('min-w-[4rem]');
    expect(cls).not.toContain('min-w-0');
  });

  it('shows Org / Project when the URL scopes exactly one project', () => {
    at('/dashboard/traces/abc?project=p-2');
    const { container } = render(HeaderBreadcrumb);
    expect(container.querySelector('[data-breadcrumb-project]')!.textContent).toContain('Beta web');
  });

  it('shows the count when the URL scopes two projects', () => {
    at('/dashboard/logs?project=p-1,p-2');
    const { container } = render(HeaderBreadcrumb);
    expect(container.querySelector('[data-breadcrumb-project]')!.textContent).toContain('2 projects');
  });

  it('hides the project part while the organization has no projects', () => {
    orgProjects.set({ orgId: 'org-1', projects: [] });
    at('/dashboard/logs');
    const { container } = render(HeaderBreadcrumb);
    expect(container.querySelector('[data-breadcrumb-project]')).toBeNull();
  });

  it('falls back to the org only when the project id is unknown to the active organization', () => {
    at('/dashboard/projects/other-org-project/overview');
    const { container } = render(HeaderBreadcrumb);
    expect(screen.getByTestId('org-switcher')).toBeInTheDocument();
    expect(container.querySelector('[data-breadcrumb-project]')).toBeNull();
  });

  it('truncates a long project name and keeps the full name in the title', () => {
    orgProjects.set({ orgId: 'org-1', projects: [{ id: 'p-9', name: 'A project with a very long name indeed' }] });
    at('/dashboard/logs?project=p-9');
    const { container } = render(HeaderBreadcrumb);
    const project = container.querySelector('[data-breadcrumb-project]')!;
    expect(project.querySelector('.truncate')).not.toBeNull();
    expect(project).toHaveAttribute('title', 'A project with a very long name indeed');
  });

  it('loads the organization projects when they are not loaded yet', () => {
    orgProjects.set({ orgId: null, projects: [] });
    at('/dashboard/logs');
    render(HeaderBreadcrumb);
    expect(load).toHaveBeenCalledWith('org-1');
  });

  it('only remembers the pick on pages without a project picker', async () => {
    at('/dashboard/alerts');
    render(HeaderBreadcrumb);
    await fireEvent.click(screen.getByRole('combobox', { name: 'Switch project' }));
    await fireEvent.click(await screen.findByText('Alpha API'));
    await waitFor(() => expect(scopeStore.get().projectIds).toEqual(['p-1']));
    expect(gotoMock).not.toHaveBeenCalled();
  });

  it('offers All projects on multi-project pages and writes project=all', async () => {
    activeScopeBar.set({ mode: 'multi' });
    at('/dashboard/errors?project=p-1');
    render(HeaderBreadcrumb);
    await fireEvent.click(screen.getByRole('combobox', { name: 'Switch project' }));
    await fireEvent.click(document.querySelector('[data-project-option="all"]')!);
    await waitFor(() => expect(gotoMock).toHaveBeenCalledTimes(1));
    expect(new URL('http://localhost' + gotoMock.mock.calls[0][0]).searchParams.get('project')).toBe('all');
    expect(scopeStore.get().projectIds).toEqual([]);
  });

  it('does not offer All projects on single-project pages or project pages', async () => {
    activeScopeBar.set({ mode: 'single' });
    at('/dashboard/uptime?project=p-1');
    const first = render(HeaderBreadcrumb);
    await fireEvent.click(screen.getByRole('combobox', { name: 'Switch project' }));
    expect(document.querySelector('[data-project-option="all"]')).toBeNull();
    first.unmount();

    activeScopeBar.set(null);
    at('/dashboard/projects/p-1/overview');
    render(HeaderBreadcrumb);
    await fireEvent.click(screen.getByRole('combobox', { name: 'Switch project' }));
    expect(document.querySelector('[data-project-option="all"]')).toBeNull();
  });
});
