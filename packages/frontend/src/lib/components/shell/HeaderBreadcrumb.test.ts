import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/svelte';

const { orgProjects, load } = vi.hoisted(() => {
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
  };
});
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

const org = (id: string, name: string) =>
  ({ id, name, slug: id, role: 'owner' }) as unknown as Parameters<typeof organizationStore.setCurrentOrganization>[0];

function at(url: string) {
  (page as { url: URL }).url = new URL('http://localhost' + url);
}

beforeEach(() => {
  load.mockClear();
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
  it('shows Org only on non-project pages', () => {
    at('/dashboard/logs');
    const { container } = render(HeaderBreadcrumb);
    expect(screen.getByTestId('org-switcher')).toBeInTheDocument();
    expect(container.querySelector('[data-breadcrumb-project]')).toBeNull();
  });

  it('shows Org / Project on project pages using the route id', () => {
    at('/dashboard/projects/p-1/overview');
    const { container } = render(HeaderBreadcrumb);
    const project = container.querySelector('[data-breadcrumb-project]')!;
    expect(project.textContent).toContain('Alpha API');
    expect(project.getAttribute('href')).toBe('/dashboard/projects/p-1/overview');
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

  it('shows no project when the URL scopes two', () => {
    at('/dashboard/logs?project=p-1,p-2');
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
});
