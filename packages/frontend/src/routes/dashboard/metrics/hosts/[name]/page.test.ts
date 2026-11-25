import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/svelte';
import type { HostSourceDetail, SourceSignalValue } from '@logtide/shared';

const h = vi.hoisted(() => ({
  goto: vi.fn(),
  getHostSource: vi.fn(),
  getSources: vi.fn(),
  panelsData: vi.fn(),
  query: vi.fn(),
  customizeSource: vi.fn(),
  getProjects: vi.fn(),
  getLogs: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('$app/navigation', () => ({ goto: h.goto }));
vi.mock('$lib/components/app/ScopeBar.svelte', async () => ({
  default: (await import('../../../../../test-stubs/ScopeBar.stub.svelte')).default,
}));
vi.mock('$lib/components/hardware/HardwareHostPanel.svelte', async () => ({
  default: (await import('../../../../../test-stubs/HardwarePanel.stub.svelte')).default,
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
    getHostSource: h.getHostSource,
    getSources: h.getSources,
    panelsData: h.panelsData,
    query: h.query,
    customizeSource: h.customizeSource,
  },
}));
vi.mock('$lib/api/projects', () => ({
  ProjectsAPI: class {
    getProjects = h.getProjects;
  },
}));
vi.mock('$lib/api/logs', () => ({ logsAPI: { getLogs: h.getLogs } }));
vi.mock('$lib/stores/toast', () => ({
  toastStore: { success: vi.fn(), warning: vi.fn(), error: h.toastError, info: vi.fn() },
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

const sig = (value: number | null, unit: string | null = '%'): SourceSignalValue => ({ value, unit, spark: [] });

function detail(extra: Partial<HostSourceDetail> = {}): HostSourceDetail {
  return {
    kind: 'host',
    name: 'vps-app',
    projectIds: ['p1'],
    lastSeen: new Date().toISOString(),
    status: 'warning',
    statusReason: 'CPU at 91%',
    cpu: sig(91),
    memory: sig(64),
    disk: sig(41),
    network: sig(1_200_000, 'By/s'),
    load: sig(3.4, '1'),
    hardwareStatus: null,
    hardwareHosts: [],
    services: ['api-gateway', 'checkout-api'],
    os: 'Debian 12',
    metricCount: 3,
    info: { os: 'Debian 12', kernel: '6.1.0', cpuCount: 4, memoryBytes: 8 * 1024 ** 3, uptimeSeconds: 41 * 86400, agentVersion: '1.1.0' },
    metricNames: ['system.cpu.utilization', 'system.memory.usage', 'custom.thing'],
    ...extra,
  };
}

function setUrl(search = '') {
  (page as { url: URL }).url = new URL(`http://localhost/dashboard/metrics/hosts/vps-app${search}`);
  (page as { params: Record<string, string> }).params = { name: 'vps-app' };
}

beforeEach(() => {
  Object.values(h).forEach((m) => m.mockReset());
  setUrl();
  h.getProjects.mockResolvedValue({ projects: [{ id: 'p1', name: 'production' }, { id: 'p2', name: 'staging' }] });
  h.getHostSource.mockResolvedValue(detail());
  h.getSources.mockResolvedValue({ hosts: [], services: [] });
  h.panelsData.mockResolvedValue({ panels: {} });
  h.query.mockResolvedValue({ series: [], queries: [] });
  h.getLogs.mockResolvedValue({ logs: [] });
  h.customizeSource.mockResolvedValue({ dashboardId: 'dash-9' });
  scopeStore.reset();
  authStore.setAuth({ id: 'user-1', email: 'a@b.c', name: 'Test User' }, 'token-1');
  organizationStore.clear();
  organizationStore.setCurrentOrganization({ ...org });
});

describe('host page', () => {
  it('loads the host with the org scope and shows the header', async () => {
    render(Page);
    expect(await screen.findByTestId('status-reason')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'vps-app', level: 1 })).toBeTruthy();
    const args = h.getHostSource.mock.calls[0];
    expect(args[0]).toBe('vps-app');
    expect(args[1].organizationId).toBe('org-1');
    expect(screen.getByTestId('status-reason').textContent).toContain('CPU at 91%');
    const info = screen.getByText(/Debian 12/);
    expect(info.textContent).toContain('4 vCPU');
    expect(info.textContent).toContain('uptime 41 days');
    expect(info.textContent).toContain('agent 1.1.0');
    expect(info.textContent).toContain('project production');
  });

  it('shows the six host tabs with counts and Resources first', async () => {
    render(Page);
    await screen.findByRole('tablist');
    const tabs = within(screen.getByRole('tablist')).getAllByRole('tab').map((t) => t.textContent?.trim());
    expect(tabs).toEqual(['Resources', 'Hardware', 'Services (2)', 'Logs', 'Traces', 'Metrics (3)']);
    expect(screen.getByRole('tab', { name: 'Resources' }).getAttribute('aria-selected')).toBe('true');
  });

  it('writes the tab to the URL', async () => {
    render(Page);
    await fireEvent.click(await screen.findByRole('tab', { name: 'Logs' }));
    expect(h.goto).toHaveBeenCalledWith('/dashboard/metrics/hosts/vps-app?tab=logs', expect.objectContaining({ replaceState: true }));
  });

  it('shows the KPI row from the summary signals', async () => {
    render(Page);
    const cpu = await screen.findByTestId('kpi-cpu');
    expect(cpu.textContent).toContain('91');
    expect(screen.getByTestId('kpi-memory').textContent).toContain('64');
    expect(screen.getByTestId('kpi-load')).toBeTruthy();
  });

  it('renders the template panels the host can fill, with the host variable', async () => {
    h.panelsData.mockImplementation(async (req: { panels: Array<{ id: string }> }) => ({
      panels: Object.fromEntries(req.panels.map((p) => [p.id, { data: { series: [], queries: [] } }])),
    }));
    render(Page);
    await waitFor(() => expect(h.panelsData).toHaveBeenCalled());
    const req = h.panelsData.mock.calls[0][0];
    expect(req.organizationId).toBe('org-1');
    expect(req.variables).toEqual({ host: 'vps-app' });
    const configs = req.panels.map((p: { config: { title: string } }) => p.config.title);
    expect(configs).toContain('CPU by state');
    expect(configs).toContain('Memory');
    // Panels that need metrics the host does not send are not requested
    expect(configs).not.toContain('Load average');
    expect(await screen.findByTestId('template-panel-cpu-state')).toBeTruthy();
    expect(screen.getAllByTestId('series-view').length).toBeGreaterThan(0);
  });

  it('shows the error of a panel that failed', async () => {
    h.panelsData.mockImplementation(async (req: { panels: Array<{ id: string }> }) => ({
      panels: Object.fromEntries(req.panels.map((p) => [p.id, { error: 'query failed' }])),
    }));
    render(Page);
    expect((await screen.findAllByText('query failed')).length).toBeGreaterThan(0);
  });

  it('customize creates the dashboard and opens it', async () => {
    render(Page);
    await fireEvent.click(await screen.findByRole('button', { name: 'Customize' }));
    await waitFor(() => expect(h.customizeSource).toHaveBeenCalledWith('host', 'vps-app', { organizationId: 'org-1', projectIds: null }));
    await waitFor(() => expect(h.goto).toHaveBeenCalledWith('/dashboard?id=dash-9'));
  });

  it('customize reports a failure and stays', async () => {
    h.customizeSource.mockRejectedValue(new Error('Dashboard limit reached'));
    render(Page);
    await fireEvent.click(await screen.findByRole('button', { name: 'Customize' }));
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith('Dashboard limit reached'));
    expect(h.goto).not.toHaveBeenCalledWith(expect.stringContaining('/dashboard?id='));
  });

  it('opens Explore prefilled on the host', async () => {
    render(Page);
    const link = await screen.findByRole('link', { name: /Open in Explore/ });
    const url = new URL(link.getAttribute('href') ?? '', 'http://x');
    expect(url.pathname).toBe('/dashboard/metrics/explore');
    const q = JSON.parse(atob((url.searchParams.get('q') ?? '').replace(/-/g, '+').replace(/_/g, '/')));
    expect(q.queries[0].filters).toEqual([{ scope: 'resource', key: 'host.name', op: 'eq', values: ['vps-app'] }]);
  });

  it('hardware tab shows setup help when the host has no hardware data', async () => {
    setUrl('?tab=hardware');
    render(Page);
    expect(await screen.findByTestId('hardware-empty')).toBeTruthy();
  });

  it('hardware tab embeds the hardware panel for the host id', async () => {
    setUrl('?tab=hardware');
    h.getHostSource.mockResolvedValue(detail({ hardwareHosts: [{ projectId: 'p1', id: 'hw-1' }] }));
    render(Page);
    expect((await screen.findByTestId('hardware-panel')).textContent).toContain('hw-1');
  });

  it('hardware tab offers a project switcher when several hardware hosts exist', async () => {
    setUrl('?tab=hardware');
    h.getHostSource.mockResolvedValue(
      detail({
        hardwareHosts: [
          { projectId: 'p1', id: 'hw-1' },
          { projectId: 'p2', id: 'hw-2' },
        ],
      }),
    );
    render(Page);
    expect((await screen.findByTestId('hardware-panel')).textContent).toContain('hw-1');
    await fireEvent.click(screen.getByRole('button', { name: 'staging' }));
    await waitFor(() => expect(screen.getByTestId('hardware-panel').textContent).toContain('hw-2'));
  });

  it('services tab lists the services on the host with links', async () => {
    setUrl('?tab=services');
    render(Page);
    const rows = await screen.findAllByTestId('related-row');
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByRole('link', { name: 'api-gateway' }).getAttribute('href')).toBe('/dashboard/metrics/services/api-gateway');
  });

  it('logs tab links to Logs filtered by the host and lists recent lines', async () => {
    setUrl('?tab=logs');
    h.getLogs.mockResolvedValue({
      logs: [{ id: 'l1', time: new Date().toISOString(), projectId: 'p1', service: 'sshd', level: 'error', message: 'boom on vps-app' }],
    });
    render(Page);
    expect(await screen.findByText('boom on vps-app')).toBeTruthy();
    expect(h.getLogs.mock.calls[0][0]).toMatchObject({ projectId: ['p1'], hostname: 'vps-app', limit: 10 });
    const href = screen.getByRole('link', { name: 'Open in Logs' }).getAttribute('href') ?? '';
    expect(new URL(href, 'http://x').searchParams.get('q')).toBe('host:vps-app');
  });

  it('traces tab links each service to Traces', async () => {
    setUrl('?tab=traces');
    render(Page);
    const link = await screen.findByRole('link', { name: 'Open traces of checkout-api' });
    expect(new URL(link.getAttribute('href') ?? '', 'http://x').searchParams.get('service')).toBe('checkout-api');
  });

  it('metrics tab shows 12 cards first and loads more on demand', async () => {
    setUrl('?tab=metrics');
    const metricNames = Array.from({ length: 30 }, (_, i) => `m.metric.${String(i).padStart(2, '0')}`);
    h.getHostSource.mockResolvedValue(detail({ metricNames }));
    render(Page);
    expect(await screen.findAllByTestId('metric-card')).toHaveLength(12);
    expect(h.query).toHaveBeenCalledTimes(12);
    await fireEvent.click(screen.getByRole('button', { name: 'Show 12 more' }));
    expect(screen.getAllByTestId('metric-card')).toHaveLength(24);
    const explore = screen.getByRole('link', { name: 'Open m.metric.00 in Explore' });
    expect(explore.getAttribute('href')).toContain('/dashboard/metrics/explore?q=');
  });

  it('shows an error with a retry when the host cannot be loaded', async () => {
    h.getHostSource.mockRejectedValueOnce(new Error('Host not found'));
    render(Page);
    expect(await screen.findByText('Could not load this host')).toBeTruthy();
    expect(screen.getByText('Host not found')).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('tablist')).toBeTruthy();
  });
});
