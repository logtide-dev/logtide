import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import type { MetricExplorerQuery } from '@logtide/shared';

const h = vi.hoisted(() => ({
  goto: vi.fn(),
  query: vi.fn(),
  getCatalog: vi.fn(),
  getCatalogEntry: vi.fn(),
  getAttributes: vi.fn(),
  getAttributeValues: vi.fn(),
  getProjects: vi.fn(),
  list: vi.fn(),
  addPanel: vi.fn(),
  create: vi.fn(),
}));

vi.mock('$app/navigation', () => ({ goto: h.goto }));
vi.mock('svelte-sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('$lib/components/app/ScopeBar.svelte', async () => ({
  default: (await import('../../../../test-stubs/ScopeBar.stub.svelte')).default,
}));
vi.mock('echarts', () => ({
  graphic: { LinearGradient: class {} },
  init: vi.fn(() => ({
    setOption: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    resize: vi.fn(),
    dispose: vi.fn(),
    clear: vi.fn(),
    getZr: () => ({ on: vi.fn(), off: vi.fn() }),
  })),
}));
vi.mock('$lib/api/projects', () => ({ projectsAPI: { getProjects: h.getProjects } }));
vi.mock('$lib/api/metrics-v2', () => ({
  metricsV2API: {
    query: h.query,
    getCatalog: h.getCatalog,
    getCatalogEntry: h.getCatalogEntry,
    getAttributes: h.getAttributes,
    getAttributeValues: h.getAttributeValues,
  },
}));
vi.mock('$lib/api/custom-dashboards', () => ({
  customDashboardsAPI: { list: h.list, addPanel: h.addPanel, create: h.create },
}));
vi.mock('$lib/stores/organization', async () => {
  const { writable } = await import('svelte/store');
  return { currentOrganization: writable({ id: 'org1', name: 'Org' }) };
});

import { page } from '$app/state';
import { scopeStore } from '$lib/stores/scope';
import { chooseSelectOption } from '$lib/test-utils/select-field';
import { decodeExplorerQuery, defaultExplorerQuery, encodeExplorerQuery } from '$lib/utils/metrics-explorer-url';
import ExplorePage from './+page.svelte';

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

const cpuQuery = (): MetricExplorerQuery => ({
  ...defaultExplorerQuery(),
  queries: [{ id: 'A', metricName: 'system.cpu.utilization', aggregation: 'avg', filters: [], groupBy: [] }],
});

function visit(q?: MetricExplorerQuery, extra = '') {
  const params = new URLSearchParams(extra);
  if (q) params.set('q', encodeExplorerQuery(q));
  (page as { url: URL }).url = new URL(`http://localhost/dashboard/metrics/explore?${params}`);
}

const hostSeries = (name: string, last: number) => ({
  id: `A|resource.host.name=${name}`,
  queryId: 'A',
  labels: { 'resource.host.name': name },
  name,
  unit: '%',
  comparison: false,
  points: [
    { t: '2026-01-01T00:00:00Z', v: last - 1 },
    { t: '2026-01-01T00:05:00Z', v: last },
  ],
  stats: { min: last - 1, avg: last - 0.5, max: last, last },
});

const response = {
  series: [hostSeries('vps-app', 71), hostSeries('lyra-01', 20)],
  interval: '5m',
  queries: [{ id: 'A', seriesTotal: 2, seriesShown: 2, metricType: 'gauge', unit: '%' }],
  warnings: [],
};

const lastRequest = () => h.query.mock.calls[h.query.mock.calls.length - 1][0];
const gotoQuery = () => {
  const url = h.goto.mock.calls[h.goto.mock.calls.length - 1][0] as URL;
  return decodeExplorerQuery(url.searchParams.get('q'));
};

beforeEach(() => {
  vi.clearAllMocks();
  scopeStore.set({ projectIds: [], range: { kind: 'preset', preset: '1h' } });
  h.getProjects.mockResolvedValue({ projects: [{ id: 'p1', name: 'One' }, { id: 'p2', name: 'Two' }] });
  h.getCatalog.mockResolvedValue({
    metrics: [{ name: 'system.cpu.utilization', type: 'gauge', unit: '1', description: null, isMonotonic: null, projectIds: ['p1'], firstSeen: '2026-01-01T00:00:00Z', lastSeen: '2026-01-02T00:00:00Z' }],
  });
  h.getCatalogEntry.mockResolvedValue({
    entry: {},
    attributes: {
      metric: [{ key: 'system.cpu.state', values: ['user', 'system'] }],
      resource: [{ key: 'host.name', values: ['vps-app', 'lyra-01', 'nas'] }],
    },
    sources: { hosts: [], services: [] },
    usedIn: { dashboards: [] },
  });
  h.getAttributes.mockResolvedValue([]);
  h.getAttributeValues.mockResolvedValue([]);
  h.query.mockResolvedValue(response);
  h.list.mockResolvedValue([{ id: 'd1', name: 'Ops' }]);
  h.addPanel.mockResolvedValue({ dashboard: {}, panel: {} });
  visit(cpuQuery());
});

describe('explore page', () => {
  it('reads the query from the URL and runs it with the scope window and null projects', async () => {
    render(ExplorePage);
    await waitFor(() => expect(h.query).toHaveBeenCalledTimes(1));
    const req = lastRequest();
    expect(req.organizationId).toBe('org1');
    expect(req.projectIds).toBeNull();
    expect(req.queries[0].metricName).toBe('system.cpu.utilization');
    expect(Date.parse(req.to) - Date.parse(req.from)).toBe(3600_000);
    expect(h.query.mock.calls[0][1]).toBeInstanceOf(AbortSignal);
  });

  it('follows the scope projects and reruns when the range changes, aborting the first request', async () => {
    let first!: AbortSignal;
    h.query.mockImplementationOnce((_req: unknown, signal: AbortSignal) => {
      first = signal;
      return new Promise(() => {});
    });
    render(ExplorePage);
    await waitFor(() => expect(h.query).toHaveBeenCalledTimes(1));
    scopeStore.setProjects(['p1']);
    await waitFor(() => expect(h.query).toHaveBeenCalledTimes(2));
    expect(first.aborted).toBe(true);
    expect(lastRequest().projectIds).toEqual(['p1']);

    scopeStore.setRange({ kind: 'preset', preset: '6h' });
    await waitFor(() => expect(h.query).toHaveBeenCalledTimes(3));
    expect(Date.parse(lastRequest().to) - Date.parse(lastRequest().from)).toBe(6 * 3600_000);
  });

  it('shows the pick a metric state and does not query without a metric', async () => {
    visit(undefined);
    render(ExplorePage);
    expect(await screen.findByText('Pick a metric to start')).toBeInTheDocument();
    expect(h.query).not.toHaveBeenCalled();
  });

  it('adds a group by from a breakdown suggestion and switches to split', async () => {
    render(ExplorePage);
    const suggestion = await screen.findByRole('button', { name: /resource\.host\.name/ });
    await fireEvent.click(suggestion);
    await waitFor(() => expect(h.query).toHaveBeenCalledTimes(2));
    expect(lastRequest().queries[0].groupBy).toEqual([{ scope: 'resource', key: 'host.name' }]);
    await waitFor(() => expect(screen.getAllByTestId('split-card').length).toBe(2));
    expect(screen.queryByRole('region', { name: 'Breakdown suggestions' })).not.toBeInTheDocument();
    // URL round trip: the new query is written to the address bar
    await waitFor(() => expect(h.goto).toHaveBeenCalled());
    expect(gotoQuery()?.queries[0].groupBy).toEqual([{ scope: 'resource', key: 'host.name' }]);
    expect(h.goto.mock.calls[0][1]).toMatchObject({ replaceState: true });
  });

  it('clicking a series adds its labels as eq filters', async () => {
    const q = cpuQuery();
    q.queries[0].groupBy = [{ scope: 'resource', key: 'host.name' }];
    q.display = 'table';
    visit(q);
    render(ExplorePage);
    const row = await screen.findByRole('button', { name: 'vps-app' });
    await fireEvent.click(row);
    await waitFor(() => expect(h.query).toHaveBeenCalledTimes(2));
    expect(lastRequest().queries[0].filters).toEqual([
      { scope: 'resource', key: 'host.name', op: 'eq', values: ['vps-app'] },
    ]);
    await waitFor(() => expect(gotoQuery()?.queries[0].filters).toHaveLength(1));
  });

  it('refresh button reruns the query', async () => {
    render(ExplorePage);
    await waitFor(() => expect(h.query).toHaveBeenCalledTimes(1));
    await fireEvent.click(screen.getByRole('button', { name: /Refresh/ }));
    await waitFor(() => expect(h.query).toHaveBeenCalledTimes(2));
  });

  it('shows a request error', async () => {
    h.query.mockRejectedValue(new Error('backend down'));
    render(ExplorePage);
    expect(await screen.findByText('backend down')).toBeInTheDocument();
  });

  it('saves the query as a metrics panel through Add to dashboard', async () => {
    render(ExplorePage);
    await waitFor(() => expect(h.query).toHaveBeenCalled());
    await fireEvent.click(screen.getByRole('button', { name: /Add to dashboard/ }));
    await waitFor(() => expect(screen.getByLabelText('Dashboard')).not.toBeDisabled());
    await chooseSelectOption(screen.getByLabelText('Dashboard'), 'Ops');
    await fireEvent.click(screen.getByRole('button', { name: 'Add panel' }));
    await waitFor(() => expect(h.addPanel).toHaveBeenCalledTimes(1));
    const [id, org, config] = h.addPanel.mock.calls[0];
    expect(id).toBe('d1');
    expect(org).toBe('org1');
    expect(config.type).toBe('metrics');
    expect(config.timeRange).toBe('1h');
    expect(config.query.queries[0].metricName).toBe('system.cpu.utilization');
    expect(config.query.projectIds).toBeNull();
  });
});
