import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/svelte';

const h = vi.hoisted(() => ({
  goto: vi.fn(),
  getCatalog: vi.fn(),
  getCatalogEntry: vi.fn(),
  getProjects: vi.fn(),
}));

vi.mock('$app/navigation', () => ({ goto: h.goto }));
vi.mock('$lib/components/app/ScopeBar.svelte', async () => ({
  default: (await import('../../../../test-stubs/ScopeBar.stub.svelte')).default,
}));
vi.mock('$lib/api/projects', () => ({ projectsAPI: { getProjects: h.getProjects } }));
vi.mock('$lib/api/metrics-v2', () => ({
  metricsV2API: { getCatalog: h.getCatalog, getCatalogEntry: h.getCatalogEntry },
}));
vi.mock('$lib/stores/organization', async () => {
  const { writable } = await import('svelte/store');
  return { currentOrganization: writable({ id: 'org1', name: 'Org' }) };
});

import { page } from '$app/state';
import { scopeStore } from '$lib/stores/scope';
import { decodeExplorerQuery } from '$lib/utils/metrics-explorer-url';
import CatalogPage from './+page.svelte';

const entry = (name: string, type: string, extra: Record<string, unknown> = {}) => ({
  name,
  type,
  unit: null,
  description: null,
  isMonotonic: null,
  projectIds: ['p1'],
  firstSeen: '2026-01-01T00:00:00Z',
  lastSeen: '2026-01-02T00:00:00Z',
  ...extra,
});

const metrics = [
  entry('system.cpu.utilization', 'gauge', { unit: '1', lastSeen: '2026-01-03T00:00:00Z' }),
  entry('system.network.io', 'sum', { unit: 'By', isMonotonic: true, projectIds: ['p1', 'p2'], description: 'Network bytes' }),
  entry('http.server.request.duration', 'histogram', { unit: 's' }),
  entry('orders_total', 'sum', { isMonotonic: true }),
];

function visit(search = '') {
  (page as { url: URL }).url = new URL(`http://localhost/dashboard/metrics/catalog${search}`);
}

const names = () => screen.getAllByTestId('catalog-row').map((r) => within(r).getAllByRole('button')[0].textContent?.trim());

beforeEach(() => {
  vi.clearAllMocks();
  scopeStore.set({ projectIds: [], range: { kind: 'preset', preset: '24h' } });
  h.getProjects.mockResolvedValue({ projects: [{ id: 'p1', name: 'One' }] });
  h.getCatalog.mockResolvedValue({ metrics });
  h.getCatalogEntry.mockResolvedValue({
    entry: metrics[1],
    attributes: {
      metric: [{ key: 'network.direction', values: ['receive', 'transmit'] }],
      resource: [{ key: 'host.name', values: ['vps-app', 'lyra-01'] }],
    },
    sources: { hosts: ['vps-app'], services: ['checkout api'] },
    usedIn: { dashboards: [{ id: 'd1', name: 'Infra' }] },
  });
  visit();
});

describe('catalog page', () => {
  it('lists metrics sorted by name with their columns', async () => {
    render(CatalogPage);
    await waitFor(() => expect(screen.getAllByTestId('catalog-row')).toHaveLength(4));
    expect(names()).toEqual(['http.server.request.duration', 'orders_total', 'system.cpu.utilization', 'system.network.io']);
    expect(h.getCatalog).toHaveBeenCalledWith({ organizationId: 'org1', projectIds: null, search: undefined });
  });

  it('derives prefix chips from the data and filters by them', async () => {
    render(CatalogPage);
    await waitFor(() => expect(screen.getAllByTestId('catalog-row')).toHaveLength(4));
    const group = screen.getByRole('group', { name: 'Filter by prefix' });
    expect(within(group).getByRole('button', { name: /^system\./ })).toBeInTheDocument();
    expect(within(group).getByRole('button', { name: /^other/ })).toBeInTheDocument();
    await fireEvent.click(within(group).getByRole('button', { name: /^system\./ }));
    expect(names()).toEqual(['system.cpu.utilization', 'system.network.io']);
  });

  it('searches with a debounce', async () => {
    render(CatalogPage);
    await waitFor(() => expect(h.getCatalog).toHaveBeenCalledTimes(1));
    await fireEvent.input(screen.getByLabelText('Search metrics'), { target: { value: 'cpu' } });
    expect(h.getCatalog).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(h.getCatalog).toHaveBeenCalledTimes(2));
    expect(h.getCatalog.mock.calls[1][0].search).toBe('cpu');
  });

  it('sorts by a column and flips direction', async () => {
    render(CatalogPage);
    await waitFor(() => expect(screen.getAllByTestId('catalog-row')).toHaveLength(4));
    await fireEvent.click(screen.getByRole('button', { name: 'Projects' }));
    expect(names()[0]).toBe('system.network.io');
    expect(screen.getByRole('columnheader', { name: /Projects/ })).toHaveAttribute('aria-sort', 'descending');
    await fireEvent.click(screen.getByRole('button', { name: 'Projects' }));
    expect(screen.getByRole('columnheader', { name: /Projects/ })).toHaveAttribute('aria-sort', 'ascending');
  });

  it('opens the drawer with attributes, sources and dashboards, and builds the Explore link', async () => {
    visit('?range=6h');
    render(CatalogPage);
    await waitFor(() => expect(screen.getAllByTestId('catalog-row')).toHaveLength(4));
    await fireEvent.click(screen.getByRole('button', { name: 'system.network.io' }));
    const drawer = await screen.findByRole('dialog');
    await waitFor(() => expect(within(drawer).getByText('host.name')).toBeInTheDocument());
    expect(within(drawer).getByText('network.direction')).toBeInTheDocument();
    expect(within(drawer).getByRole('link', { name: 'host vps-app' })).toHaveAttribute('href', '/dashboard/metrics/hosts/vps-app');
    expect(within(drawer).getByRole('link', { name: 'service checkout api' })).toHaveAttribute('href', '/dashboard/metrics/services/checkout%20api');
    expect(within(drawer).getByRole('link', { name: 'Infra' })).toHaveAttribute('href', '/dashboard?id=d1');

    const open = within(drawer).getByRole('link', { name: 'Open in Explore' });
    const url = new URL(open.getAttribute('href')!, 'http://localhost');
    expect(url.pathname).toBe('/dashboard/metrics/explore');
    expect(url.searchParams.get('range')).toBe('6h');
    const q = decodeExplorerQuery(url.searchParams.get('q'));
    // monotonic sum: rate
    expect(q?.queries[0]).toMatchObject({ metricName: 'system.network.io', aggregation: 'rate' });
    expect(h.getCatalogEntry).toHaveBeenCalledWith('system.network.io', { organizationId: 'org1', projectIds: null });
  });

  it('uses avg for gauges and p95 for histograms in the Explore link', async () => {
    render(CatalogPage);
    await waitFor(() => expect(screen.getAllByTestId('catalog-row')).toHaveLength(4));
    for (const [name, agg] of [['system.cpu.utilization', 'avg'], ['http.server.request.duration', 'p95']] as const) {
      await fireEvent.click(screen.getByRole('button', { name }));
      const link = await screen.findByRole('link', { name: 'Open in Explore' });
      const q = decodeExplorerQuery(new URL(link.getAttribute('href')!, 'http://localhost').searchParams.get('q'));
      expect(q?.queries[0].aggregation).toBe(agg);
      await fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    }
  });

  it('shows an error when the catalog fails', async () => {
    h.getCatalog.mockRejectedValue(new Error('nope'));
    render(CatalogPage);
    expect(await screen.findByText('nope')).toBeInTheDocument();
  });

  it('shows the empty state', async () => {
    h.getCatalog.mockResolvedValue({ metrics: [] });
    render(CatalogPage);
    expect(await screen.findByText('No metrics yet')).toBeInTheDocument();
  });
});
