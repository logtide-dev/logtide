import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';

const h = vi.hoisted(() => ({
  goto: vi.fn(),
  chartHandlers: [] as Array<[string, (p: unknown) => void]>,
  getProjects: vi.fn(),
  getAvailability: vi.fn(),
  api: {
    getMetricNames: vi.fn(),
    getLabelKeys: vi.fn(),
    getLabelValues: vi.fn(),
    getMetricData: vi.fn(),
    aggregateMetrics: vi.fn(),
    getOverview: vi.fn(),
  },
}));

vi.mock('$app/navigation', () => ({ goto: h.goto }));
vi.mock('echarts', () => ({
  graphic: { LinearGradient: class {} },
  init: vi.fn(() => ({
    setOption: vi.fn(),
    on: (name: string, fn: (p: unknown) => void) => h.chartHandlers.push([name, fn]),
    resize: vi.fn(),
    dispose: vi.fn(),
    clear: vi.fn(),
  })),
}));
vi.mock('$lib/api/projects', () => ({
  ProjectsAPI: class {
    getProjects = h.getProjects;
    getProjectDataAvailability = h.getAvailability;
  },
}));
vi.mock('$lib/api/metrics', () => ({
  metricsAPI: h.api,
  listDashboardsForPicker: vi.fn().mockResolvedValue([]),
  addMetricPanelToDashboard: vi.fn(),
}));
vi.mock('$lib/stores/organization', async () => {
  const { writable } = await import('svelte/store');
  return { currentOrganization: writable({ id: 'org1', name: 'Org' }) };
});

import { page } from '$app/state';
import { scopeStore } from '$lib/stores/scope';
import { metricsStore } from '$lib/stores/metrics';
import MetricsPage from './+page.svelte';

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

const flush = () => new Promise((r) => setTimeout(r, 20));

function visit(search: string) {
  (page as { url: URL }).url = new URL(`http://localhost/dashboard/metrics${search}`);
}

const overview = {
  services: [
    {
      serviceName: 'a',
      metrics: [
        { metricName: 'http.server.request.duration', metricType: 'histogram', serviceName: 'a', latestValue: 1, avgValue: 1, minValue: 1, maxValue: 1, pointCount: 1 },
      ],
    },
    {
      serviceName: 'b',
      metrics: [
        { metricName: 'http.server.request.duration', metricType: 'histogram', serviceName: 'b', latestValue: 2, avgValue: 2, minValue: 2, maxValue: 2, pointCount: 1 },
      ],
    },
  ],
};

const series = {
  metricName: 'cpu',
  metricType: 'gauge',
  bucketSeconds: 300,
  timeseries: [
    { bucket: '2026-01-01T00:00:00Z', value: 1 },
    { bucket: '2026-01-01T00:05:00Z', value: 2 },
  ],
};

beforeEach(() => {
  metricsStore.reset();
  vi.clearAllMocks();
  h.chartHandlers.length = 0;
  scopeStore.set({ projectIds: ['p1'], range: { kind: 'preset', preset: '24h' } });
  h.getProjects.mockResolvedValue({ projects: [{ id: 'p1', name: 'One' }, { id: 'p2', name: 'Two' }] });
  h.getAvailability.mockResolvedValue({ logs: [], traces: [], metrics: ['p1', 'p2'] });
  h.api.getMetricNames.mockResolvedValue([
    { name: 'cpu', type: 'gauge' },
    { name: 'http.server.request.duration', type: 'histogram' },
  ]);
  h.api.getLabelKeys.mockResolvedValue(['host']);
  h.api.getLabelValues.mockResolvedValue([]);
  h.api.getMetricData.mockResolvedValue({ metrics: [], total: 0, hasMore: false, limit: 100, offset: 0 });
  h.api.aggregateMetrics.mockResolvedValue(series);
  h.api.getOverview.mockResolvedValue(overview);
  visit('');
});

describe('metrics page', () => {
  it('scope time range change reloads timeseries once', async () => {
    visit('?tab=explorer&metric=cpu');
    render(MetricsPage);
    await waitFor(() => expect(h.api.aggregateMetrics).toHaveBeenCalledTimes(1));
    await flush();

    scopeStore.setRange({ kind: 'preset', preset: '1h' });
    await waitFor(() => expect(h.api.aggregateMetrics).toHaveBeenCalledTimes(2));
    await flush();
    expect(h.api.aggregateMetrics).toHaveBeenCalledTimes(2);
    const last = h.api.aggregateMetrics.mock.calls[1][0];
    expect(Date.parse(last.to) - Date.parse(last.from)).toBe(3600_000);
  });

  it('explorer state restored from url on load', async () => {
    visit('?tab=explorer&metric=cpu&agg=rate&by=host&w=env%3Dprod&w=env%3Dstage&service=a&interval=5m');
    render(MetricsPage);
    await waitFor(() => expect(h.api.aggregateMetrics).toHaveBeenCalled());
    const call = h.api.aggregateMetrics.mock.calls[0][0];
    expect(call).toMatchObject({
      metricName: 'cpu',
      aggregation: 'rate',
      groupBy: ['host'],
      attributes: { env: ['prod', 'stage'] },
      serviceName: 'a',
      interval: '5m',
      projectId: 'p1',
    });
  });

  it('service selection reaches aggregate request on the overview tab', async () => {
    visit('?service=b');
    render(MetricsPage);
    await waitFor(() => expect(h.api.aggregateMetrics).toHaveBeenCalled());
    await flush();
    const services = h.api.aggregateMetrics.mock.calls.map(([arg]) => arg.serviceName);
    expect(services.length).toBeGreaterThan(0);
    expect(new Set(services)).toEqual(new Set(['b']));
  });

  it('service selection reaches aggregate request on the explorer tab', async () => {
    visit('?tab=explorer&metric=cpu');
    render(MetricsPage);
    await waitFor(() => expect(h.api.aggregateMetrics).toHaveBeenCalledTimes(1));
    await flush();
    await fireEvent.change(await screen.findByLabelText('Service'), { target: { value: 'b' } });
    await waitFor(() => expect(h.api.aggregateMetrics).toHaveBeenCalledTimes(2));
    expect(h.api.aggregateMetrics.mock.calls[1][0].serviceName).toBe('b');
  });

  it('service selection reaches aggregate request on the golden signals tab', async () => {
    visit('?tab=golden&service=b');
    render(MetricsPage);
    await waitFor(() => expect(h.api.aggregateMetrics).toHaveBeenCalled());
    await flush();
    for (const [arg] of h.api.aggregateMetrics.mock.calls) expect(arg.serviceName).toBe('b');
  });

  it('tab is read from and written to the url', async () => {
    visit('?tab=golden');
    render(MetricsPage);
    const golden = await screen.findByRole('tab', { name: 'Golden signals' });
    expect(golden.getAttribute('aria-selected')).toBe('true');

    await fireEvent.click(screen.getByRole('tab', { name: 'Explorer' }));
    await waitFor(() => expect(h.goto).toHaveBeenCalled());
    const url = String(h.goto.mock.calls.at(-1)![0]);
    expect(url).toContain('tab=explorer');
  });

  it('shows EmptyMetrics when no project has metrics', async () => {
    h.getProjects.mockResolvedValue({ projects: [] });
    render(MetricsPage);
    expect(await screen.findByText('No metrics yet')).toBeInTheDocument();
  });

  it('chart click with exemplar navigates to the trace', async () => {
    h.api.getMetricData.mockResolvedValue({
      metrics: [
        {
          id: 'm1',
          time: '2026-01-01T00:05:30Z',
          metricName: 'cpu',
          metricType: 'gauge',
          value: 2,
          serviceName: 'a',
          attributes: null,
          resourceAttributes: null,
          histogramData: null,
          hasExemplars: true,
          exemplars: [{ exemplarValue: 2, traceId: 't-1' }],
        },
      ],
      total: 1,
      hasMore: false,
      limit: 100,
      offset: 0,
    });
    visit('?tab=explorer&metric=cpu');
    render(MetricsPage);
    await waitFor(() => expect(h.chartHandlers.length).toBeGreaterThan(0));
    await waitFor(() => expect(h.api.getMetricData).toHaveBeenCalled());
    await flush();
    h.goto.mockClear();

    const click = h.chartHandlers.filter(([n]) => n === 'click').at(-1)![1];
    click({ value: [Date.parse('2026-01-01T00:05:00Z'), 2] });
    expect(h.goto).toHaveBeenCalledWith('/dashboard/traces/t-1?project=p1');
  });

  it('chart click without exemplar does not navigate', async () => {
    visit('?tab=explorer&metric=cpu');
    render(MetricsPage);
    await waitFor(() => expect(h.chartHandlers.length).toBeGreaterThan(0));
    await flush();
    h.goto.mockClear();

    const click = h.chartHandlers.filter(([n]) => n === 'click').at(-1)![1];
    click({ value: [Date.parse('2026-01-01T00:05:00Z'), 2] });
    expect(h.goto).not.toHaveBeenCalled();
  });

  it('add to dashboard is disabled until a metric is selected', async () => {
    visit('');
    render(MetricsPage);
    const button = await screen.findByRole('button', { name: 'Add to dashboard' });
    expect(button).toBeDisabled();
  });
});
