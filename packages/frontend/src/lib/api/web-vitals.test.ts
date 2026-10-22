import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WebVitalsAPI } from './web-vitals';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('webVitalsAPI', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let api: WebVitalsAPI;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    api = new WebVitalsAPI(() => 'tok');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('web vitals api sends projectId from to', async () => {
    fetchMock.mockResolvedValue(json(200, { sampleCount: 0, metrics: [], routes: [] }));
    await api.getSummary({ projectId: 'p1', from: '2026-01-01T00:00:00.000Z', to: '2026-01-02T00:00:00.000Z' });

    const [url, init] = fetchMock.mock.calls[0];
    const parsed = new URL(String(url), 'http://localhost');
    expect(parsed.pathname).toMatch(/\/web-vitals\/summary$/);
    expect(parsed.searchParams.get('projectId')).toBe('p1');
    expect(parsed.searchParams.get('from')).toBe('2026-01-01T00:00:00.000Z');
    expect(parsed.searchParams.get('to')).toBe('2026-01-02T00:00:00.000Z');
    expect(init.headers.Authorization).toBe('Bearer tok');
  });

  it('non-2xx rejects with the server error text', async () => {
    fetchMock.mockResolvedValue(json(400, { error: 'Range must be 31 days or less' }));
    await expect(api.getSummary({ projectId: 'p1', from: 'a', to: 'b' })).rejects.toThrow(
      'Range must be 31 days or less',
    );
  });
});
