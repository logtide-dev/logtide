import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/svelte';
import type { ServiceSourceDetail, SourceSignalValue } from '@logtide/shared';

const h = vi.hoisted(() => ({
  goto: vi.fn(),
  getServiceSource: vi.fn(),
  getSources: vi.fn(),
  panelsData: vi.fn(),
  customizeSource: vi.fn(),
  getCatalog: vi.fn(),
  getProjects: vi.fn(),
  getLogs: vi.fn(),
}));

vi.mock('$app/navigation', () => ({ goto: h.goto }));
vi.mock('$lib/components/app/ScopeBar.svelte', async () => ({
  default: (await import('../../../../../test-stubs/ScopeBar.stub.svelte')).default,
}));
vi.mock('$lib/components/custom-dashboards/panels/TraceVolumePanel.svelte', async () => ({
  default: (await import('../../../../../test-stubs/TracePanel.stub.svelte')).default,
}));
vi.mock('$lib/components/custom-dashboards/panels/TraceLatencyPanel.svelte', async () => ({
  default: (await import('../../../../../test-stubs/TracePanel.stub.svelte')).default,
}));
vi.mock('$lib/components/metrics/v2/MetricSeriesView.svelte', async () => ({
  default: (await import('../../../../../test-stubs/SeriesView.stub.svelte')).default,
}));
vi.mock('$lib/api/metrics-v2', () => ({
  metricsV2API: {
    getServiceSource: h.getServiceSource,
    getSources: h.getSources,
    panelsData: h.panelsData,
    customizeSource: h.customizeSource,
    getCatalog: h.getCatalog,
  },
}));
vi.mock('$lib/api/projects', () => ({
  ProjectsAPI: class {
    getProjects = h.getProjects;
  },
}));
vi.mock('$lib/api/logs', () => ({ logsAPI: { getLogs: h.getLogs } }));

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

const sig = (value: number | null, unit: string | null = '%'): SourceSignalValue => ({ value, unit, spark: [] });

const detail: ServiceSourceDetail = {
  kind: 'service',
  name: 'checkout-api',
  projectIds: ['p1'],
  lastSeen: new Date().toISOString(),
  status: 'critical',
  statusReason: 'Error rate 6.2%',
  requestRate: sig(18, 'req/s'),
  errorRate: sig(6.2),
  p95: sig(920, 'ms'),
  hosts: ['vps-app'],
  metricCount: 2,
  hasTraces: true,
  metricNames: ['process.cpu.utilization', 'v8js.memory.heap.used'],
};

function setUrl(search = '') {
  (page as { url: URL }).url = new URL(`http://localhost/dashboard/metrics/services/checkout-api${search}`);
  (page as { params: Record<string, string> }).params = { name: 'checkout-api' };
}

beforeEach(() => {
  Object.values(h).forEach((m) => m.mockReset());
  setUrl();
  h.getProjects.mockResolvedValue({ projects: [{ id: 'p1', name: 'production' }] });
  h.getServiceSource.mockResolvedValue(detail);
  h.getSources.mockResolvedValue({ hosts: [], services: [] });
  h.panelsData.mockImplementation(async (req: { panels: Array<{ id: string }> }) => ({
    panels: Object.fromEntries(req.panels.map((p) => [p.id, { data: { series: [], queries: [] } }])),
  }));
  h.customizeSource.mockResolvedValue({ dashboardId: 'dash-3' });
  h.getCatalog.mockResolvedValue({ metrics: [] });
  scopeStore.reset();
  authStore.setAuth({ id: 'user-1', email: 'a@b.c', name: 'Test User' }, 'token-1');
  organizationStore.clear();
  organizationStore.setCurrentOrganization({ ...org });
});

describe('service page', () => {
  it('shows the five service tabs with Overview first', async () => {
    render(Page);
    const tablist = await screen.findByRole('tablist');
    expect(within(tablist).getAllByRole('tab').map((t) => t.textContent?.trim())).toEqual([
      'Overview',
      'Hosts (1)',
      'Logs',
      'Traces',
      'Metrics (2)',
    ]);
    expect(screen.getByTestId('status-reason').textContent).toContain('Error rate 6.2%');
  });

  it('renders trace panels and the runtime panels the service can fill, bound to the service', async () => {
    render(Page);
    await waitFor(() => expect(h.panelsData).toHaveBeenCalled());
    const req = h.panelsData.mock.calls[0][0];
    expect(req.variables).toEqual({ service: 'checkout-api' });
    const titles = req.panels.map((p: { config: { title: string } }) => p.config.title);
    expect(titles).toEqual(expect.arrayContaining(['Requests and errors', 'Latency', 'Node.js heap used', 'Process CPU']));
    expect(titles).not.toContain('JVM memory used');
    expect(await screen.findByTestId('template-panel-trace-volume')).toBeTruthy();
    expect(screen.getAllByTestId('trace-panel').length).toBe(2);
  });

  it('shows the red KPIs from the summary', async () => {
    render(Page);
    expect((await screen.findByTestId('kpi-errors')).textContent).toContain('6.2');
    expect(screen.getByTestId('kpi-p95')).toBeTruthy();
  });

  it('customize opens the new dashboard', async () => {
    render(Page);
    await fireEvent.click(await screen.findByRole('button', { name: 'Customize' }));
    await waitFor(() => expect(h.customizeSource).toHaveBeenCalledWith('service', 'checkout-api', { organizationId: 'org-1', projectIds: null }));
    await waitFor(() => expect(h.goto).toHaveBeenCalledWith('/dashboard?id=dash-3'));
  });

  it('hosts tab lists the hosts of the service', async () => {
    setUrl('?tab=hosts');
    render(Page);
    const rows = await screen.findAllByTestId('related-row');
    expect(within(rows[0]).getByRole('link', { name: 'vps-app' }).getAttribute('href')).toBe('/dashboard/metrics/hosts/vps-app');
  });

  it('traces tab links to Traces filtered by the service', async () => {
    setUrl('?tab=traces');
    render(Page);
    const link = await screen.findByRole('link', { name: 'Open in Traces' });
    expect(new URL(link.getAttribute('href') ?? '', 'http://x').searchParams.get('service')).toBe('checkout-api');
  });
});
