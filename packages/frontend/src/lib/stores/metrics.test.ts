import { describe, it, expect, vi, beforeEach } from 'vitest';
import { get } from 'svelte/store';

vi.mock('$lib/api/metrics', () => ({
  metricsAPI: {
    getMetricNames: vi.fn(),
    getLabelKeys: vi.fn(),
    getLabelValues: vi.fn(),
    getMetricData: vi.fn(),
    aggregateMetrics: vi.fn(),
    getOverview: vi.fn(),
  },
}));

import { metricsAPI } from '$lib/api/metrics';
import { metricsStore } from './metrics';

const api = vi.mocked(metricsAPI, true);

const T0 = new Date('2026-01-01T00:00:00Z');
const T1 = new Date('2026-01-01T01:00:00Z');
const T2 = new Date('2026-01-01T06:00:00Z');

function result(name = 'm') {
  return { metricName: name, metricType: 'gauge' as const, timeseries: [] };
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  metricsStore.reset();
  vi.clearAllMocks();
  api.getMetricNames.mockResolvedValue([{ name: 'cpu', type: 'gauge' }]);
  api.getLabelKeys.mockResolvedValue([]);
  api.getLabelValues.mockResolvedValue([]);
  api.getMetricData.mockResolvedValue({ metrics: [], total: 0, hasMore: false, limit: 100, offset: 0 });
  api.aggregateMetrics.mockResolvedValue(result());
  api.getOverview.mockResolvedValue({ services: [] });
});

describe('metricsStore context', () => {
  it('changing project triggers one names reload and one timeseries reload', async () => {
    metricsStore.setQuery({ tab: 'explorer', metric: 'cpu' });
    metricsStore.setContext({ projectId: 'p1', from: T0, to: T1 });
    await flush();
    vi.clearAllMocks();
    api.getMetricNames.mockResolvedValue([]);
    api.aggregateMetrics.mockResolvedValue(result());

    metricsStore.setContext({ projectId: 'p2', from: T0, to: T1 });
    await flush();

    expect(api.getMetricNames).toHaveBeenCalledTimes(1);
    expect(api.getMetricNames.mock.calls[0][0]).toBe('p2');
    expect(api.aggregateMetrics).toHaveBeenCalledTimes(1);
    expect(api.aggregateMetrics.mock.calls[0][0].projectId).toBe('p2');
  });

  it('changing only the time range reloads timeseries once', async () => {
    metricsStore.setQuery({ tab: 'explorer', metric: 'cpu' });
    metricsStore.setContext({ projectId: 'p1', from: T0, to: T1 });
    await flush();
    vi.clearAllMocks();
    api.aggregateMetrics.mockResolvedValue(result());

    metricsStore.setContext({ projectId: 'p1', from: T0, to: T2 });
    await flush();

    expect(api.aggregateMetrics).toHaveBeenCalledTimes(1);
    expect(api.aggregateMetrics.mock.calls[0][0].to).toBe(T2.toISOString());
  });

  it('identical context does not refetch', async () => {
    metricsStore.setQuery({ tab: 'explorer', metric: 'cpu' });
    metricsStore.setContext({ projectId: 'p1', from: T0, to: T1 });
    await flush();
    vi.clearAllMocks();

    metricsStore.setContext({ projectId: 'p1', from: new Date(T0), to: new Date(T1) });
    await flush();

    expect(api.getMetricNames).not.toHaveBeenCalled();
    expect(api.aggregateMetrics).not.toHaveBeenCalled();
    expect(api.getOverview).not.toHaveBeenCalled();
  });

  it('stale response is dropped when context changed mid-flight', async () => {
    const first = deferred<ReturnType<typeof result>>();
    api.aggregateMetrics.mockReturnValueOnce(first.promise);
    metricsStore.setQuery({ tab: 'explorer', metric: 'cpu' });
    metricsStore.setContext({ projectId: 'p1', from: T0, to: T1 });
    await flush();

    api.aggregateMetrics.mockResolvedValueOnce(result('fresh'));
    metricsStore.setContext({ projectId: 'p2', from: T0, to: T1 });
    await flush();
    expect(get(metricsStore).timeseries?.metricName).toBe('fresh');

    first.resolve(result('stale'));
    await flush();
    expect(get(metricsStore).timeseries?.metricName).toBe('fresh');
  });

  it('loads the overview, not the timeseries, on the overview tab', async () => {
    metricsStore.setQuery({ tab: 'overview', metric: 'cpu' });
    metricsStore.setContext({ projectId: 'p1', from: T0, to: T1 });
    await flush();
    expect(api.getOverview).toHaveBeenCalledTimes(1);
    expect(api.aggregateMetrics).not.toHaveBeenCalled();
  });

  it('switching to explorer loads the timeseries once, back to overview does not refetch', async () => {
    metricsStore.setQuery({ metric: 'cpu' });
    metricsStore.setContext({ projectId: 'p1', from: T0, to: T1 });
    await flush();
    metricsStore.setQuery({ tab: 'explorer' });
    await flush();
    expect(api.aggregateMetrics).toHaveBeenCalledTimes(1);
    metricsStore.setQuery({ tab: 'overview' });
    await flush();
    expect(api.getOverview).toHaveBeenCalledTimes(1);
  });
});

describe('metricsStore query', () => {
  beforeEach(async () => {
    metricsStore.setQuery({ tab: 'explorer', metric: 'cpu' });
    metricsStore.setContext({ projectId: 'p1', from: T0, to: T1 });
    await flush();
    vi.clearAllMocks();
    api.aggregateMetrics.mockResolvedValue(result());
    api.getMetricData.mockResolvedValue({ metrics: [], total: 0, hasMore: false, limit: 100, offset: 0 });
    api.getLabelKeys.mockResolvedValue([]);
  });

  it('service filter is sent to aggregate', async () => {
    metricsStore.setQuery({ service: 'checkout' });
    await flush();
    expect(api.aggregateMetrics).toHaveBeenCalledTimes(1);
    expect(api.aggregateMetrics.mock.calls[0][0].serviceName).toBe('checkout');
  });

  it('groupBy is sent and max 2 enforced', async () => {
    metricsStore.setQuery({ groupBy: ['a', 'b', 'c'] });
    await flush();
    expect(api.aggregateMetrics.mock.calls[0][0].groupBy).toEqual(['a', 'b']);
    expect(get(metricsStore).query.groupBy).toEqual(['a', 'b']);
  });

  it('multi-value where, aggregation and interval are sent', async () => {
    metricsStore.setQuery({
      where: { env: ['prod', 'stage'] },
      aggregation: 'rate',
      interval: '5m',
    });
    await flush();
    const call = api.aggregateMetrics.mock.calls[0][0];
    expect(call.attributes).toEqual({ env: ['prod', 'stage'] });
    expect(call.aggregation).toBe('rate');
    expect(call.interval).toBe('5m');
  });

  it('selectMetric clears labels and group by', async () => {
    metricsStore.setQuery({ where: { env: ['prod'] }, groupBy: ['host'] });
    await flush();
    vi.clearAllMocks();
    api.aggregateMetrics.mockResolvedValue(result('mem'));
    api.getLabelKeys.mockResolvedValue(['host']);

    metricsStore.selectMetric('mem');
    await flush();

    const q = get(metricsStore).query;
    expect(q.metric).toBe('mem');
    expect(q.where).toEqual({});
    expect(q.groupBy).toEqual([]);
    expect(api.getLabelKeys).toHaveBeenCalledTimes(1);
    expect(api.aggregateMetrics).toHaveBeenCalledTimes(1);
    expect(api.aggregateMetrics.mock.calls[0][0].attributes).toBeUndefined();
  });

  it('a setQuery with the same query does not refetch', async () => {
    metricsStore.setQuery({ aggregation: 'avg' });
    await flush();
    expect(api.aggregateMetrics).not.toHaveBeenCalled();
  });

  it('loadLabelValues returns and caches values', async () => {
    api.getLabelValues.mockResolvedValue(['a', 'b']);
    expect(await metricsStore.loadLabelValues('env')).toEqual(['a', 'b']);
    expect(await metricsStore.loadLabelValues('env')).toEqual(['a', 'b']);
    expect(api.getLabelValues).toHaveBeenCalledTimes(1);
  });
});

describe('metricsStore overview', () => {
  it('keeps the service list when a service filter is set and fetches sparklines for it only', async () => {
    api.getOverview.mockResolvedValue({
      services: [
        {
          serviceName: 'a',
          metrics: [
            { metricName: 'm1', metricType: 'gauge', serviceName: 'a', latestValue: 1, avgValue: 1, minValue: 1, maxValue: 1, pointCount: 1 },
          ],
        },
        {
          serviceName: 'b',
          metrics: [
            { metricName: 'm1', metricType: 'gauge', serviceName: 'b', latestValue: 1, avgValue: 1, minValue: 1, maxValue: 1, pointCount: 1 },
          ],
        },
      ],
    });
    metricsStore.setQuery({ service: 'b' });
    metricsStore.setContext({ projectId: 'p1', from: T0, to: T1 });
    await flush();

    expect(get(metricsStore).services).toEqual(['a', 'b']);
    expect(api.aggregateMetrics).toHaveBeenCalledTimes(1);
    expect(api.aggregateMetrics.mock.calls[0][0].serviceName).toBe('b');
    expect(api.getOverview.mock.calls[0][0].serviceName).toBeUndefined();
  });
});
