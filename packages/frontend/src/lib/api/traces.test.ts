import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// $lib/config pulls in $app/environment (a SvelteKit virtual module that does
// not resolve under plain vitest), so both helpers are mocked at module level.
vi.mock('$lib/config', () => ({
  getApiBaseUrl: () => '/api/v1',
}));
vi.mock('$lib/utils/auth', () => ({
  getAuthToken: () => 'tok',
}));
vi.mock('./stream-tickets', () => ({
  requestStreamTicket: async () => 'ticket',
}));

import { TracesAPI } from './traces';

type FetchResult = { ok: boolean; status?: number; statusText?: string; json: () => Promise<unknown> };

describe('TracesAPI', () => {
  let capturedUrl: string | null = null;
  let capturedInit: RequestInit | undefined;
  let result: FetchResult;
  let api: TracesAPI;

  beforeEach(() => {
    capturedUrl = null;
    capturedInit = undefined;
    result = { ok: true, status: 200, json: async () => ({}) };
    api = new TracesAPI(() => 'tok');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        capturedUrl = url;
        capturedInit = init;
        return result;
      })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const params = () => new URL(capturedUrl!, 'http://localhost').searchParams;

  it('getTraces sends operation, attr, sortBy and sortOrder only when set', async () => {
    result = { ok: true, json: async () => ({ traces: [], total: 0 }) };

    await api.getTraces({ projectId: 'p1' });
    expect(params().has('operation')).toBe(false);
    expect(params().has('attr')).toBe(false);
    expect(params().has('sortBy')).toBe(false);
    expect(params().has('sortOrder')).toBe(false);

    await api.getTraces({
      projectId: 'p1',
      operation: 'GET /a b',
      attr: 'http.method:GET',
      sortBy: 'duration',
      sortOrder: 'asc',
    });
    expect(params().get('operation')).toBe('GET /a b');
    expect(params().get('attr')).toBe('http.method:GET');
    expect(params().get('sortBy')).toBe('duration');
    expect(params().get('sortOrder')).toBe('asc');
  });

  it('getOperations builds the query string and returns the operations array', async () => {
    const rows = [
      {
        service: 'api',
        operation: 'GET /a',
        count: 3,
        errorCount: 1,
        errorRate: 1 / 3,
        avgMs: 10,
        p50Ms: 9,
        p95Ms: 20,
        p99Ms: 30,
        throughputPerMin: 0.1,
      },
    ];
    result = { ok: true, json: async () => ({ operations: rows }) };

    const out = await api.getOperations({
      projectId: 'p1',
      service: 'api',
      from: '2026-10-22T10:00:00.000Z',
      to: '2026-10-22T11:00:00.000Z',
      limit: 20,
    });

    expect(out).toEqual(rows);
    expect(capturedUrl).toContain('/api/v1/traces/operations?');
    expect(params().get('projectId')).toBe('p1');
    expect(params().get('service')).toBe('api');
    expect(params().get('from')).toBe('2026-10-22T10:00:00.000Z');
    expect(params().get('to')).toBe('2026-10-22T11:00:00.000Z');
    expect(params().get('limit')).toBe('20');
  });

  it('getLatencyHistogram passes service and operation', async () => {
    const histogram = { bounds: [1, 10], counts: [0, 1, 2] };
    result = { ok: true, json: async () => histogram };

    const out = await api.getLatencyHistogram({ projectId: 'p1', service: 'api', operation: 'GET /a' });

    expect(out).toEqual(histogram);
    expect(capturedUrl).toContain('/api/v1/traces/latency-histogram?');
    expect(params().get('service')).toBe('api');
    expect(params().get('operation')).toBe('GET /a');
  });

  it('getErrorGroupsByTrace returns [] on 404', async () => {
    result = { ok: false, status: 404, statusText: 'Not Found', json: async () => ({}) };
    expect(await api.getErrorGroupsByTrace('t1', 'p1', 'o1')).toEqual([]);
  });

  it('getErrorGroupsByTrace returns [] when the request throws', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network');
      })
    );
    expect(await api.getErrorGroupsByTrace('t1', 'p1', 'o1')).toEqual([]);
  });

  it('getErrorGroupsByTrace maps the groups array', async () => {
    const groups = [
      {
        errorGroupId: 'g1',
        status: 'open',
        exceptionType: 'TypeError',
        exceptionMessage: null,
        projectId: 'p1',
        logId: 'l1',
        spanId: 's1',
        occurredAt: '2026-10-22T10:00:00.000Z',
      },
    ];
    result = { ok: true, json: async () => ({ groups }) };

    const out = await api.getErrorGroupsByTrace('t 1', 'p1', 'o1');

    expect(out).toEqual(groups);
    expect(capturedUrl).toContain('/api/v1/error-groups/by-trace/t%201?');
    expect(params().get('organizationId')).toBe('o1');
    expect(params().get('projectId')).toBe('p1');
  });

  it('getSpanLogs sends q=span:<id> with the window', async () => {
    const logs = [{ time: '2026-10-22T10:00:00.000Z', level: 'error', service: 'api', message: 'boom' }];
    result = { ok: true, json: async () => ({ logs }) };

    const out = await api.getSpanLogs({
      projectId: 'p1',
      spanId: 'abc123',
      from: '2026-10-22T09:55:00.000Z',
      to: '2026-10-22T10:05:00.000Z',
      limit: 50,
    });

    expect(out).toEqual(logs);
    expect(capturedUrl).toContain('/api/v1/logs?');
    expect(params().get('q')).toBe('span:abc123');
    expect(params().get('projectId')).toBe('p1');
    expect(params().get('from')).toBe('2026-10-22T09:55:00.000Z');
    expect(params().get('to')).toBe('2026-10-22T10:05:00.000Z');
    expect(params().get('limit')).toBe('50');
    expect((capturedInit?.headers as Record<string, string>).Authorization).toBe('Bearer tok');
  });

  it('a non-ok response throws with the status text', async () => {
    result = { ok: false, status: 500, statusText: 'Internal Server Error', json: async () => ({}) };
    await expect(api.getOperations({ projectId: 'p1' })).rejects.toThrow('Internal Server Error');
  });
});
