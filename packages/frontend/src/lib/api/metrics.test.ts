import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { MetricChartConfig } from '@logtide/shared';
import { MetricsAPI, addMetricPanelToDashboard, listDashboardsForPicker } from './metrics';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const config: MetricChartConfig = {
  type: 'metric_chart',
  title: 'cpu',
  source: 'metrics',
  projectId: 'p1',
  metricName: 'cpu.usage',
  aggregation: 'avg',
  interval: '5m',
  timeRange: '24h',
  serviceName: null,
};

describe('metricsAPI.aggregateMetrics', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let api: MetricsAPI;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    api = new MetricsAPI(() => 'tok');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const base = { projectId: 'p1', metricName: 'm', from: '2026-01-01T00:00:00Z', to: '2026-01-02T00:00:00Z' };
  const lastParams = () => new URL(String(fetchMock.mock.calls[0][0]), 'http://localhost').searchParams;

  it('serialises multi-value attributes as repeated params', async () => {
    fetchMock.mockImplementation(async () => json(200, { timeseries: [] }));
    await api.aggregateMetrics({ ...base, attributes: { method: ['GET', 'a=b&c'], env: 'prod' } });

    const params = lastParams();
    expect(params.getAll('attributes[method]')).toEqual(['GET', 'a=b&c']);
    expect(params.getAll('attributes[env]')).toEqual(['prod']);
  });

  it('sends interval=auto', async () => {
    fetchMock.mockImplementation(async () => json(200, { timeseries: [] }));
    await api.aggregateMetrics({ ...base });
    expect(lastParams().get('interval')).toBe('auto');

    fetchMock.mockClear();
    await api.aggregateMetrics({ ...base, interval: '1h', aggregation: 'rate', groupBy: ['a', 'b'] });
    const params = lastParams();
    expect(params.get('interval')).toBe('1h');
    expect(params.get('aggregation')).toBe('rate');
    expect(params.getAll('groupBy')).toEqual(['a', 'b']);
  });

  it('non-2xx rejects with the server error text', async () => {
    fetchMock.mockResolvedValue(json(400, { error: 'Too many filter values (max 10 combinations)' }));
    await expect(api.aggregateMetrics({ ...base })).rejects.toThrow('Too many filter values');
  });

  it('falls back to the status text when the body has no error', async () => {
    fetchMock.mockResolvedValue(new Response('boom', { status: 500, statusText: 'Server Error' }));
    await expect(api.aggregateMetrics({ ...base })).rejects.toThrow('Failed to aggregate metrics: Server Error');
  });
});

describe('dashboard helpers', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('addMetricPanelToDashboard appends below the lowest panel and PUTs panels only', async () => {
    const existing = [
      { id: 'a', layout: { x: 0, y: 0, w: 6, h: 4 }, config: {} },
      { id: 'b', layout: { x: 6, y: 2, w: 6, h: 5 }, config: {} },
    ];
    fetchMock.mockResolvedValueOnce(json(200, { dashboard: { id: 'd1', name: 'Main', panels: existing } }));
    fetchMock.mockResolvedValueOnce(json(200, { dashboard: {} }));

    await addMetricPanelToDashboard({ organizationId: 'org1', dashboardId: 'd1', config });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [getUrl] = fetchMock.mock.calls[0];
    expect(String(getUrl)).toContain('/api/v1/custom-dashboards/d1?organizationId=org1');
    const [putUrl, putInit] = fetchMock.mock.calls[1];
    expect(String(putUrl)).toContain('/api/v1/custom-dashboards/d1?organizationId=org1');
    expect(putInit.method).toBe('PUT');
    const body = JSON.parse(putInit.body);
    expect(Object.keys(body)).toEqual(['panels']);
    expect(body.panels).toHaveLength(3);
    const added = body.panels[2];
    expect(added.layout).toEqual({ x: 0, y: 7, w: 6, h: 4 });
    expect(added.config).toEqual(config);
    expect(added.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('appends at y 0 on an empty dashboard', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { dashboard: { panels: [] } }));
    fetchMock.mockResolvedValueOnce(json(200, { dashboard: {} }));
    await addMetricPanelToDashboard({ organizationId: 'org1', dashboardId: 'd1', config });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).panels[0].layout.y).toBe(0);
  });

  it('rejects with the server error and does not PUT when the load fails', async () => {
    fetchMock.mockResolvedValueOnce(json(404, { error: 'Not found' }));
    await expect(
      addMetricPanelToDashboard({ organizationId: 'org1', dashboardId: 'd1', config }),
    ).rejects.toThrow('Not found');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('lists dashboards as id and name', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { dashboards: [{ id: 'd1', name: 'Main', panels: [] }] }));
    await expect(listDashboardsForPicker('org1')).resolves.toEqual([{ id: 'd1', name: 'Main' }]);
  });
});
