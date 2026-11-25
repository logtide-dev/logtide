import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { MetricQueryRequest } from '@logtide/shared';
import { MetricsV2API } from './metrics-v2';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('MetricsV2API', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let api: MetricsV2API;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    api = new MetricsV2API(() => 'tok');
  });
  afterEach(() => vi.unstubAllGlobals());

  const url = () => new URL(String(fetchMock.mock.calls[0][0]), 'http://localhost');
  const init = () => fetchMock.mock.calls[0][1] as RequestInit;

  it('posts the query with the bearer token', async () => {
    fetchMock.mockResolvedValue(json(200, { series: [], interval: '5m', queries: [], warnings: [] }));
    const req = {
      organizationId: 'o1',
      projectIds: null,
      queries: [],
      formulas: [],
      interval: 'auto',
      compareTo: 'none',
      display: 'lines',
      from: 'a',
      to: 'b',
    } as MetricQueryRequest;
    const res = await api.query(req);
    expect(res.interval).toBe('5m');
    expect(url().pathname).toBe('/api/v1/metrics/query');
    expect(init().method).toBe('POST');
    expect((init().headers as Record<string, string>).Authorization).toBe('Bearer tok');
    expect(JSON.parse(String(init().body)).organizationId).toBe('o1');
  });

  it('posts panel data requests', async () => {
    fetchMock.mockResolvedValue(json(200, { panels: { p1: { data: 1 } } }));
    const res = await api.panelsData({ organizationId: 'o', from: 'a', to: 'b', variables: { host: 'h' }, panels: [] });
    expect(res.panels.p1.data).toBe(1);
    expect(url().pathname).toBe('/api/v1/metrics/panels/data');
  });

  it('lists sources with a comma separated project filter', async () => {
    fetchMock.mockResolvedValue(json(200, { hosts: [], services: [] }));
    await api.getSources({ organizationId: 'o', projectIds: ['a', 'b'], from: 'f', to: 't' });
    expect(url().pathname).toBe('/api/v1/metrics/sources');
    expect(url().searchParams.get('projectIds')).toBe('a,b');
    expect(url().searchParams.get('organizationId')).toBe('o');
  });

  it('omits projectIds when null', async () => {
    fetchMock.mockResolvedValue(json(200, { hosts: [], services: [] }));
    await api.getSources({ organizationId: 'o', projectIds: null });
    expect(url().searchParams.has('projectIds')).toBe(false);
  });

  it('encodes source names in detail paths', async () => {
    fetchMock.mockResolvedValue(json(200, {}));
    await api.getHostSource('web/01 a', { organizationId: 'o' });
    expect(String(fetchMock.mock.calls[0][0])).toContain('/metrics/sources/host/web%2F01%20a?');
  });

  it('gets a service source', async () => {
    fetchMock.mockResolvedValue(json(200, {}));
    await api.getServiceSource('api', { organizationId: 'o' });
    expect(url().pathname).toBe('/api/v1/metrics/sources/service/api');
  });

  it('customizes a source', async () => {
    fetchMock.mockResolvedValue(json(200, { dashboardId: 'd1' }));
    const res = await api.customizeSource('host', 'h1', { organizationId: 'o' });
    expect(res.dashboardId).toBe('d1');
    expect(url().pathname).toBe('/api/v1/metrics/sources/host/h1/customize');
    expect(init().method).toBe('POST');
  });

  it('searches the catalog', async () => {
    fetchMock.mockResolvedValue(json(200, { metrics: [] }));
    await api.getCatalog({ organizationId: 'o', search: 'cpu', prefix: 'system.' });
    expect(url().pathname).toBe('/api/v1/metrics/catalog');
    expect(url().searchParams.get('search')).toBe('cpu');
    expect(url().searchParams.get('prefix')).toBe('system.');
  });

  it('gets a catalog entry by name', async () => {
    fetchMock.mockResolvedValue(json(200, {}));
    await api.getCatalogEntry('system.cpu', { organizationId: 'o' });
    expect(url().pathname).toBe('/api/v1/metrics/catalog/entry');
    expect(url().searchParams.get('name')).toBe('system.cpu');
  });

  it('returns attribute keys and values', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { keys: ['a', 'b'] }));
    expect(await api.getAttributes({ organizationId: 'o', scope: 'resource' })).toEqual(['a', 'b']);
    expect(url().searchParams.get('scope')).toBe('resource');
    expect(url().searchParams.has('metricName')).toBe(false);

    fetchMock.mockClear();
    fetchMock.mockResolvedValueOnce(json(200, { values: ['x'] }));
    const values = await api.getAttributeValues({ organizationId: 'o', scope: 'metric', metricName: 'm', key: 'k' });
    expect(values).toEqual(['x']);
    expect(url().pathname).toBe('/api/v1/metrics/attribute-values');
    expect(url().searchParams.get('key')).toBe('k');
  });

  it('throws the server error text', async () => {
    fetchMock.mockResolvedValue(json(400, { error: 'unknown variable' }));
    await expect(api.query({} as MetricQueryRequest)).rejects.toThrow('unknown variable');
  });

  it('falls back to the status text', async () => {
    fetchMock.mockResolvedValue(new Response('x', { status: 500, statusText: 'Boom' }));
    await expect(api.getSources({ organizationId: 'o' })).rejects.toThrow('Failed to load metric sources: Boom');
  });
});
