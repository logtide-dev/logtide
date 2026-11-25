import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MetricsAPI } from './metrics';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

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
