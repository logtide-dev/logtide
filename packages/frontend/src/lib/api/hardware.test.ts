import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('$lib/config', () => ({ getApiUrl: () => 'http://api.test' }));
vi.mock('$lib/utils/auth', () => ({ getAuthToken: () => 'tok-1' }));

import {
  listHardwareHosts,
  getHardwareHost,
  getHardwareHostEvents,
  updateHardwareHost,
  deleteHardwareHost,
} from './hardware';

describe('hardware api', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  function lastCall() {
    const [url, init] = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
    return { url: new URL(url as string), init: (init ?? {}) as RequestInit };
  }

  function respond(body: unknown, status = 200) {
    fetchMock.mockResolvedValueOnce({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    });
  }

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('lists hosts of a project with the bearer token', async () => {
    respond({ hosts: [] });
    const res = await listHardwareHosts('proj-1');
    expect(res).toEqual({ hosts: [] });
    const { url, init } = lastCall();
    expect(url.pathname).toBe('/api/v1/hardware/hosts');
    expect(url.searchParams.get('projectId')).toBe('proj-1');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok-1');
  });

  it('gets one host and encodes the id', async () => {
    respond({ host: {}, series: [] });
    await getHardwareHost('a/b');
    expect(lastCall().url.pathname).toBe('/api/v1/hardware/hosts/a%2Fb');
  });

  it('gets events with a limit', async () => {
    respond({ events: [] });
    await getHardwareHostEvents('h1', 20);
    const { url } = lastCall();
    expect(url.pathname).toBe('/api/v1/hardware/hosts/h1/events');
    expect(url.searchParams.get('limit')).toBe('20');
  });

  it('defaults the events limit to 50', async () => {
    respond({ events: [] });
    await getHardwareHostEvents('h1');
    expect(lastCall().url.searchParams.get('limit')).toBe('50');
  });

  it('patches the muted flag as JSON', async () => {
    respond({ host: { id: 'h1', muted: true } });
    await updateHardwareHost('h1', { muted: true });
    const { init, url } = lastCall();
    expect(init.method).toBe('PATCH');
    expect(url.pathname).toBe('/api/v1/hardware/hosts/h1');
    expect(JSON.parse(init.body as string)).toEqual({ muted: true });
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });

  it('deletes a host and tolerates 204', async () => {
    respond(null, 204);
    await expect(deleteHardwareHost('h1')).resolves.toBeNull();
    expect(lastCall().init.method).toBe('DELETE');
  });

  it('throws the server error message with the status', async () => {
    respond({ error: 'Forbidden' }, 403);
    await expect(deleteHardwareHost('h1')).rejects.toMatchObject({ message: 'Forbidden', status: 403 });
  });
});
