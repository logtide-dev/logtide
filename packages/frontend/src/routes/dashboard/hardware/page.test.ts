import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/svelte';

const h = vi.hoisted(() => ({
  list: vi.fn(),
  getProjects: vi.fn(),
  error: vi.fn(),
}));

vi.mock('$lib/components/app/ScopeBar.svelte', async () => ({
  default: (await import('../../../test-stubs/ScopeBar.stub.svelte')).default,
}));
vi.mock('$lib/api/hardware', () => ({ listHardwareHosts: h.list }));
vi.mock('$lib/api/projects', () => ({
  ProjectsAPI: class {
    getProjects = h.getProjects;
  },
}));
vi.mock('$lib/stores/toast', () => ({
  toastStore: { success: vi.fn(), warning: vi.fn(), error: h.error, info: vi.fn() },
}));

import Page from './+page.svelte';
import { authStore } from '$lib/stores/auth';
import { organizationStore } from '$lib/stores/organization';
import { scopeStore } from '$lib/stores/scope';
import { hostList } from '$lib/components/hardware/hardware-fixtures';

const org = {
  id: 'org-1',
  name: 'Acme',
  slug: 'acme',
  ownerId: 'user-1',
  role: 'owner' as const,
  retentionDays: 90,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
};

async function renderPage() {
  const view = render(Page);
  await waitFor(() => expect(h.list).toHaveBeenCalled());
  return view;
}

beforeEach(() => {
  Object.values(h).forEach((m) => m.mockReset());
  h.getProjects.mockResolvedValue({ projects: [{ id: 'p1', name: 'Project One' }] });
  h.list.mockResolvedValue({ hosts: hostList });
  scopeStore.reset();
  scopeStore.setProjects(['p1']);
  authStore.setAuth({ id: 'user-1', email: 'a@b.c', name: 'Test User' }, 'token-1');
  organizationStore.clear();
  organizationStore.setCurrentOrganization({ ...org });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('hardware list page', () => {
  it('loads the hosts of the scoped project and renders the tiles', async () => {
    await renderPage();
    expect(h.list).toHaveBeenCalledWith('p1');
    expect(await screen.findByText('db-01')).toBeTruthy();
    expect(screen.getByTestId('summary-all').textContent?.trim()).toBe('4');
    expect(screen.getByTestId('summary-ok').textContent?.trim()).toBe('1');
    expect(screen.getByTestId('summary-warning').textContent?.trim()).toBe('0');
    expect(screen.getByTestId('summary-critical').textContent?.trim()).toBe('1');
    expect(screen.getByTestId('summary-stale').textContent?.trim()).toBe('1');
  });

  it('renders status, links, VM badge, muted icon, chips and findings per host', async () => {
    await renderPage();
    const link = await screen.findByRole('link', { name: 'db-01' });
    expect(link.getAttribute('href')).toBe('/dashboard/hardware/h-crit');

    const row = link.closest('tr') as HTMLElement;
    expect(within(row).getByTestId('hardware-status').textContent).toContain('Critical');
    expect(within(row).getByTestId('chip-disks').getAttribute('data-status')).toBe('critical');
    expect(within(row).getByTestId('chip-disks').getAttribute('title')).toBe('Disks: critical');
    expect(within(row).getByTestId('chip-memory').getAttribute('data-status')).toBe('warning');
    expect(within(row).getByText('3')).toBeTruthy();

    const vmRow = screen.getByRole('link', { name: 'vm-07' }).closest('tr') as HTMLElement;
    expect(within(vmRow).getByText('VM')).toBeTruthy();
    expect(within(vmRow).getByTestId('chip-cpu').getAttribute('data-status')).toBe('unknown');

    const staleRow = screen.getByRole('link', { name: 'old-nas' }).closest('tr') as HTMLElement;
    expect(within(staleRow).getByTestId('hardware-status').textContent).toContain('Stale');
    expect(within(staleRow).getByTestId('muted-icon')).toBeTruthy();
  });

  it('lists the worst hosts first', async () => {
    await renderPage();
    await screen.findByText('db-01');
    const names = screen.getAllByRole('link').map((a) => a.textContent?.trim()).filter((t) => hostList.some((x) => x.hostName === t));
    expect(names).toEqual(['db-01', 'old-nas', 'vm-07', 'web-01']);
  });

  it('filters by the status tile', async () => {
    await renderPage();
    await screen.findByText('db-01');
    await fireEvent.click(screen.getByRole('button', { name: /^Critical/ }));
    expect(screen.queryByText('web-01')).toBeNull();
    expect(screen.getByText('db-01')).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: /^Warning/ }));
    expect(await screen.findByText('No hosts with this status')).toBeTruthy();
  });

  it('shows the setup snippet with the exact docker command when there are no hosts', async () => {
    h.list.mockResolvedValue({ hosts: [] });
    await renderPage();
    const setup = await screen.findByTestId('hardware-setup');
    const code = setup.querySelector('pre code')!.textContent!;
    expect(code.startsWith('docker run -d --name logtide-hw-agent --restart unless-stopped --privileged \\')).toBe(true);
    expect(code).toContain('-e LOGTIDE_URL=');
    expect(code).toContain('-e LOGTIDE_API_KEY=YOUR_API_KEY');
    expect(code).toContain('logtide/hw-agent:latest');
    expect(screen.getByRole('button', { name: 'Copy docker command' })).toBeTruthy();
    const docs = within(setup).getByRole('link', { name: /Hardware Health docs/ });
    expect(docs.getAttribute('href')).toBe('https://logtide.dev/docs/hardware-health');
    expect(screen.queryByTestId('summary-all')).toBeNull();
  });

  it('shows an error state with retry', async () => {
    h.list.mockRejectedValueOnce(new Error('boom'));
    await renderPage();
    expect(await screen.findByText('Could not load hosts')).toBeTruthy();
    expect(screen.getByText('boom')).toBeTruthy();
    h.list.mockResolvedValueOnce({ hosts: hostList });
    await fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('db-01')).toBeTruthy();
  });

  it('asks for a project when none is in scope', async () => {
    scopeStore.reset();
    h.getProjects.mockResolvedValue({ projects: [] });
    render(Page);
    expect(await screen.findByText('Create a project first')).toBeTruthy();
    expect(h.list).not.toHaveBeenCalled();
  });

  it('refreshes every 60 seconds and keeps the data when a refresh fails', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await renderPage();
    await screen.findByText('db-01');
    expect(h.list).toHaveBeenCalledTimes(1);
    h.list.mockRejectedValueOnce(new Error('network down'));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.list).toHaveBeenCalledTimes(2);
    expect(await screen.findByText(/Could not refresh the list: network down/)).toBeTruthy();
    expect(screen.getByText('db-01')).toBeTruthy();
  });
});
