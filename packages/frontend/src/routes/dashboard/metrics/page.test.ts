import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/svelte';
import type { HostSourceSummary, ServiceSourceSummary, SourceSignalValue } from '@logtide/shared';

const h = vi.hoisted(() => ({
  goto: vi.fn(),
  getSources: vi.fn(),
  getProjects: vi.fn(),
}));

vi.mock('$app/navigation', () => ({ goto: h.goto }));
vi.mock('$lib/components/app/ScopeBar.svelte', async () => ({
  default: (await import('../../../test-stubs/ScopeBar.stub.svelte')).default,
}));
vi.mock('$lib/api/metrics-v2', () => ({ metricsV2API: { getSources: h.getSources } }));
vi.mock('$lib/api/projects', () => ({
  ProjectsAPI: class {
    getProjects = h.getProjects;
  },
}));

import Page from './+page.svelte';
import { page } from '$app/state';
import { authStore } from '$lib/stores/auth';
import { organizationStore } from '$lib/stores/organization';
import { scopeStore } from '$lib/stores/scope';

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

const sig = (value: number | null, unit: string | null = '%'): SourceSignalValue => ({
  value,
  unit,
  spark: value === null ? [] : [value, value + 1, value],
});

function host(name: string, status: HostSourceSummary['status'], cpu: number | null, extra: Partial<HostSourceSummary> = {}): HostSourceSummary {
  return {
    kind: 'host',
    name,
    projectIds: ['p1'],
    lastSeen: new Date().toISOString(),
    status,
    statusReason: status === 'ok' ? null : `${status} reason`,
    cpu: sig(cpu),
    memory: sig(30),
    disk: sig(40),
    network: sig(2048, 'By/s'),
    load: sig(0.5, '1'),
    hardwareStatus: null,
    hardwareHosts: [],
    services: [],
    os: null,
    metricCount: 12,
    ...extra,
  };
}

function service(name: string, status: ServiceSourceSummary['status'], extra: Partial<ServiceSourceSummary> = {}): ServiceSourceSummary {
  return {
    kind: 'service',
    name,
    projectIds: ['p1'],
    lastSeen: new Date().toISOString(),
    status,
    statusReason: null,
    requestRate: sig(12, 'req/s'),
    errorRate: sig(0.4),
    p95: sig(180, 'ms'),
    hosts: ['alpha'],
    metricCount: 3,
    hasTraces: true,
    redSource: 'traces',
    ...extra,
  };
}

const HOSTS = [host('alpha', 'ok', 20), host('bravo', 'critical', 97), host('charlie', 'warning', 88), host('delta', 'ok', 5)];
const SERVICES = [service('api', 'ok'), service('checkout', 'warning')];

function names(section: HTMLElement): string[] {
  return within(section)
    .getAllByRole('link')
    .map((a) => a.textContent?.trim() ?? '');
}

function setUrl(search = '') {
  (page as { url: URL }).url = new URL(`http://localhost/dashboard/metrics${search}`);
}

beforeEach(() => {
  Object.values(h).forEach((m) => m.mockReset());
  setUrl();
  h.getProjects.mockResolvedValue({ projects: [{ id: 'p1', name: 'Project One' }] });
  h.getSources.mockResolvedValue({ hosts: HOSTS, services: SERVICES });
  scopeStore.reset();
  authStore.setAuth({ id: 'user-1', email: 'a@b.c', name: 'Test User' }, 'token-1');
  organizationStore.clear();
  organizationStore.setCurrentOrganization({ ...org });
});

describe('metrics sources page', () => {
  it('asks the API for every project of the organization and groups hosts and services', async () => {
    render(Page);
    const hosts = await screen.findByTestId('hosts-section');
    expect(screen.getByTestId('services-section')).toBeTruthy();
    expect(h.getSources).toHaveBeenCalledTimes(1);
    const args = h.getSources.mock.calls[0][0];
    expect(args.organizationId).toBe('org-1');
    expect(args.projectIds).toBeNull();
    expect(typeof args.from).toBe('string');
    expect(within(hosts).getByText('alpha')).toBeTruthy();
    expect(screen.getByRole('heading', { name: /Hosts/ }).textContent).toContain('4');
  });

  it('hosts table drops its wide columns below 2xl so it fits 1280-1440px', async () => {
    render(Page);
    const hosts = await screen.findByTestId('hosts-section');
    const headers = within(hosts).getAllByRole('columnheader');
    const byText = (t: string) => headers.find((th) => th.textContent?.includes(t))!;
    for (const t of ['CPU trend', 'Services', 'Load 5m']) {
      expect(byText(t).className).toContain('hidden');
      expect(byText(t).className).toContain('2xl:table-cell');
    }
    for (const t of ['CPU', 'Memory', 'Disk', 'Network', 'Last seen']) {
      expect(byText(t).className).not.toMatch(/(^|\s)hidden(\s|$)/);
    }
    // meters are the narrow variant
    expect(within(hosts).getAllByRole('meter')[0].className).toContain('w-10');
  });

  it('shows a quiet service rate per minute instead of 0/s', async () => {
    h.getSources.mockResolvedValue({
      hosts: [],
      services: [service('quiet', 'ok', { requestRate: sig(0.004, 'req/s') })],
    });
    render(Page);
    const row = (await screen.findByTestId('services-section')).querySelector('tbody tr')!;
    expect(row.textContent).toContain('/min');
    expect(row.textContent).not.toContain('0/s');
  });

  it('sorts worst status first, then by name', async () => {
    render(Page);
    const hosts = await screen.findByTestId('hosts-section');
    expect(names(hosts)).toEqual(['bravo', 'charlie', 'alpha', 'delta']);
    expect(names(screen.getByTestId('services-section'))).toEqual(['checkout', 'api']);
  });

  it('shows where each service RED comes from', async () => {
    h.getSources.mockResolvedValue({
      hosts: [],
      services: [
        service('api', 'ok'),
        service('web', 'ok', { hasTraces: false, redSource: 'metrics' }),
        service('lonely', 'ok', { hasTraces: false, redSource: null, requestRate: sig(null, 'req/s'), errorRate: sig(null), p95: sig(null, 'ms') }),
      ],
    });
    render(Page);
    const section = await screen.findByTestId('services-section');
    const labels = within(section).getAllByTestId('red-source').map((e) => e.textContent?.trim());
    expect(labels.sort()).toEqual(['-', 'From HTTP metrics', 'From traces']);
    expect(within(section).getByText('No request data')).toBeTruthy();
  });

  it('sorts by a column header and reverses on a second click', async () => {
    render(Page);
    const hosts = await screen.findByTestId('hosts-section');
    await fireEvent.click(within(hosts).getByRole('button', { name: 'CPU' }));
    expect(names(hosts)).toEqual(['delta', 'alpha', 'charlie', 'bravo']);
    await fireEvent.click(within(hosts).getByRole('button', { name: 'CPU' }));
    expect(names(hosts)).toEqual(['bravo', 'charlie', 'alpha', 'delta']);
  });

  it('keeps hosts without a value at the bottom', async () => {
    h.getSources.mockResolvedValue({ hosts: [host('alpha', 'ok', 20), host('nodata', 'ok', null)], services: [] });
    render(Page);
    const hosts = await screen.findByTestId('hosts-section');
    await fireEvent.click(within(hosts).getByRole('button', { name: 'CPU' }));
    expect(names(hosts)).toEqual(['alpha', 'nodata']);
    await fireEvent.click(within(hosts).getByRole('button', { name: 'CPU' }));
    expect(names(hosts)).toEqual(['alpha', 'nodata']);
  });

  it('shows the status reason of an unhealthy source', async () => {
    render(Page);
    const hosts = await screen.findByTestId('hosts-section');
    expect(within(hosts).getByText('critical reason')).toBeTruthy();
  });

  it('shows kind chips with counts and writes the kind to the URL', async () => {
    render(Page);
    await screen.findByTestId('hosts-section');
    const group = screen.getByRole('group', { name: 'Kind' });
    expect(within(group).getByRole('button', { name: /All\s*6/ })).toBeTruthy();
    expect(within(group).getByRole('button', { name: /Hosts\s*4/ })).toBeTruthy();
    await fireEvent.click(within(group).getByRole('button', { name: /Services\s*2/ }));
    expect(h.goto).toHaveBeenCalledTimes(1);
    expect(h.goto.mock.calls[0][0]).toBe('/dashboard/metrics?kind=service');
    expect(h.goto.mock.calls[0][1]).toMatchObject({ replaceState: true });
  });

  it('shows only hosts for ?kind=host', async () => {
    setUrl('?kind=host');
    render(Page);
    await screen.findByTestId('hosts-section');
    expect(screen.queryByTestId('services-section')).toBeNull();
    expect(within(screen.getByRole('group', { name: 'Kind' })).getByRole('button', { name: /Hosts/ }).getAttribute('aria-pressed')).toBe('true');
  });

  it('shows only services for ?kind=service', async () => {
    setUrl('?kind=service');
    render(Page);
    await screen.findByTestId('services-section');
    expect(screen.queryByTestId('hosts-section')).toBeNull();
  });

  it('filters by name', async () => {
    render(Page);
    await screen.findByTestId('hosts-section');
    await fireEvent.input(screen.getByLabelText('Filter sources'), { target: { value: 'brav' } });
    expect(names(screen.getByTestId('hosts-section'))).toEqual(['bravo']);
    expect(screen.queryByTestId('services-section')).toBeNull();
  });

  it('shows a no results state when nothing matches', async () => {
    render(Page);
    await screen.findByTestId('hosts-section');
    await fireEvent.input(screen.getByLabelText('Filter sources'), { target: { value: 'zzz' } });
    expect(await screen.findByText('No sources match')).toBeTruthy();
  });

  it('links each row to its source page', async () => {
    h.getSources.mockResolvedValue({ hosts: [host('web 1', 'ok', 10)], services: [service('api', 'ok')] });
    render(Page);
    const hosts = await screen.findByTestId('hosts-section');
    expect(within(hosts).getByRole('link', { name: 'web 1' }).getAttribute('href')).toBe('/dashboard/metrics/hosts/web%201');
    expect(within(screen.getByTestId('services-section')).getByRole('link', { name: 'api' }).getAttribute('href')).toBe(
      '/dashboard/metrics/services/api',
    );
  });

  it('shows setup links when there are no sources', async () => {
    h.getSources.mockResolvedValue({ hosts: [], services: [] });
    render(Page);
    expect(await screen.findByText('No metrics yet')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Hardware agent docs' }).getAttribute('href')).toBe('https://logtide.dev/docs/hardware-health/');
    expect(screen.getByRole('link', { name: 'OTLP docs' })).toBeTruthy();
  });

  it('shows an error state with a retry', async () => {
    h.getSources.mockRejectedValueOnce(new Error('boom'));
    render(Page);
    expect(await screen.findByText('Could not load sources')).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(h.getSources).toHaveBeenCalledTimes(2));
    expect(await screen.findByTestId('hosts-section')).toBeTruthy();
  });

  it('refreshes quietly while the tab is visible', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      render(Page);
      await screen.findByTestId('hosts-section');
      expect(h.getSources).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(60_000);
      await waitFor(() => expect(h.getSources).toHaveBeenCalledTimes(2));
      expect(screen.queryByText('Loading sources')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
