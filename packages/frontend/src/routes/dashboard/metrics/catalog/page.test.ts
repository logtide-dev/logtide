import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/svelte';

const h = vi.hoisted(() => ({
  goto: vi.fn(),
  getCatalog: vi.fn(),
  getCatalogEntry: vi.fn(),
  getSourceIndex: vi.fn(),
  getProjects: vi.fn(),
}));

vi.mock('$app/navigation', () => ({ goto: h.goto }));
vi.mock('$lib/components/app/ScopeBar.svelte', async () => ({
  default: (await import('../../../../test-stubs/ScopeBar.stub.svelte')).default,
}));
vi.mock('$lib/api/projects', () => ({ projectsAPI: { getProjects: h.getProjects } }));
vi.mock('$lib/api/metrics-v2', () => ({
  metricsV2API: { getCatalog: h.getCatalog, getCatalogEntry: h.getCatalogEntry, getSourceIndex: h.getSourceIndex },
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
  const src = (name: string, status = 'ok', metricCount = 10) => ({ name, live: status !== 'stale', lastSeen: '', metricCount });
  h.getSourceIndex.mockResolvedValue({
    hosts: [src('vps-app', 'ok', 26), src('vps-edge', 'ok', 18)],
    services: [src('checkout-api', 'warning', 6), src('auth-service', 'ok', 0)],
  });
  h.getCatalogEntry.mockResolvedValue({
    entry: metrics[1],
    attributes: {
      metric: [{ key: 'network.direction', values: ['receive', 'transmit'] }],
      resource: [{ key: 'host.name', values: ['vps-app', 'db-01'] }],
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

  it('lists hosts and services of the projects in scope, with their metric counts', async () => {
    scopeStore.set({ projectIds: ['p1'], range: { kind: 'preset', preset: '24h' } });
    render(CatalogPage);
    const list = await screen.findByTestId('catalog-sources');
    await waitFor(() => expect(within(list).getByTestId('source-host-vps-app')).toBeTruthy());
    expect(h.getSourceIndex.mock.calls[0][0]).toMatchObject({ organizationId: 'org1', projectIds: ['p1'] });
    const hosts = within(list).getByRole('list', { name: 'Hosts' });
    expect(within(hosts).getAllByRole('button').map((b) => b.textContent?.replace(/\s+/g, ' ').trim())).toEqual(['vps-app 26', 'vps-edge 18']);
    // a service that sent only traces has no metrics to list
    expect(within(list).queryByTestId('source-service-auth-service')).toBeNull();
    expect(within(list).getByTestId('source-service-checkout-api')).toBeTruthy();
  });

  it('filters the catalog on a picked source and clears it on a second click', async () => {
    render(CatalogPage);
    const item = await screen.findByTestId('source-host-vps-app');
    await fireEvent.click(item);
    await waitFor(() => expect(h.getCatalog.mock.calls.at(-1)?.[0]).toMatchObject({ source: 'host:vps-app' }));
    expect(item.getAttribute('aria-pressed')).toBe('true');
    const note = screen.getByTestId('catalog-source');
    expect(within(note).getByRole('link', { name: /vps-app/ }).getAttribute('href')).toBe('/dashboard/metrics/hosts/vps-app');
    await fireEvent.click(item);
    await waitFor(() => expect(h.getCatalog.mock.calls.at(-1)?.[0].source).toBeUndefined());
    expect(screen.queryByTestId('catalog-source')).toBeNull();
  });

  it('opens filtered on ?source= and searches the source list', async () => {
    visit('?source=service:checkout-api');
    render(CatalogPage);
    await waitFor(() => expect(h.getCatalog.mock.calls[0][0]).toMatchObject({ source: 'service:checkout-api' }));
    const item = await screen.findByTestId('source-service-checkout-api');
    expect(item.getAttribute('aria-pressed')).toBe('true');
    await fireEvent.input(screen.getByLabelText('Search sources'), { target: { value: 'edge' } });
    expect(screen.getByTestId('source-host-vps-edge')).toBeTruthy();
    expect(screen.queryByTestId('source-host-vps-app')).toBeNull();
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
