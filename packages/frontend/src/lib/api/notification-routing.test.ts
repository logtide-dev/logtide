import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const auth = vi.hoisted(() => ({ token: 'tok-1' as string | null }));

vi.mock('$lib/config', () => ({
  getApiUrl: () => 'http://api.test',
}));
vi.mock('$lib/utils/auth', () => ({
  getAuthToken: () => auth.token,
}));

import { notificationRoutingAPI } from './notification-routing';

describe('notificationRoutingAPI.preview', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  function lastCall() {
    const [url, init] = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
    return { url: new URL(url as string), init: init as RequestInit };
  }

  beforeEach(() => {
    auth.token = 'tok-1';
    fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ destinations: [], fallback: null }),
    }));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('builds the preview url with organizationId and eventType', async () => {
    await notificationRoutingAPI.preview({ organizationId: 'org-1', eventType: 'alert' });
    const { url } = lastCall();
    expect(url.origin + url.pathname).toBe('http://api.test/api/v1/notification-routing/preview');
    expect(url.searchParams.get('organizationId')).toBe('org-1');
    expect(url.searchParams.get('eventType')).toBe('alert');
  });

  it('joins sorted channelIds with commas and omits empty ones', async () => {
    await notificationRoutingAPI.preview({
      organizationId: 'org-1',
      eventType: 'alert',
      channelIds: ['c2', 'c1'],
    });
    expect(lastCall().url.searchParams.get('channelIds')).toBe('c1,c2');

    await notificationRoutingAPI.preview({
      organizationId: 'org-1',
      eventType: 'alert',
      channelIds: [],
    });
    expect(lastCall().url.searchParams.has('channelIds')).toBe(false);

    await notificationRoutingAPI.preview({ organizationId: 'org-1', eventType: 'alert' });
    expect(lastCall().url.searchParams.has('channelIds')).toBe(false);
  });

  it('omits projectId when null', async () => {
    await notificationRoutingAPI.preview({
      organizationId: 'org-1',
      eventType: 'incident',
      projectId: null,
    });
    expect(lastCall().url.searchParams.has('projectId')).toBe(false);

    await notificationRoutingAPI.preview({
      organizationId: 'org-1',
      eventType: 'incident',
      projectId: 'p1',
    });
    expect(lastCall().url.searchParams.get('projectId')).toBe('p1');
  });

  it('sends the bearer token and credentials include', async () => {
    await notificationRoutingAPI.preview({ organizationId: 'org-1', eventType: 'alert' });
    const { init } = lastCall();
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok-1');
    expect(init.credentials).toBe('include');
  });

  it('does not send Authorization without a token', async () => {
    auth.token = null;
    await notificationRoutingAPI.preview({ organizationId: 'org-1', eventType: 'alert' });
    expect((lastCall().init.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it('returns the parsed body', async () => {
    const body = {
      destinations: [{ id: 'c1', name: 'Ops', type: 'email' }],
      fallback: null,
    };
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => body });
    const res = await notificationRoutingAPI.preview({ organizationId: 'org-1', eventType: 'alert' });
    expect(res).toEqual(body);
  });

  it('throws the server error message on a non-ok response', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'Not a member of this organization' }),
    });
    await expect(
      notificationRoutingAPI.preview({ organizationId: 'org-1', eventType: 'alert' })
    ).rejects.toThrow('Not a member of this organization');

    fetchMock.mockResolvedValueOnce({
      ok: false,
      json: async () => {
        throw new Error('bad json');
      },
    });
    await expect(
      notificationRoutingAPI.preview({ organizationId: 'org-1', eventType: 'alert' })
    ).rejects.toThrow('Failed to load routing preview');
  });

  it('passes the abort signal to fetch', async () => {
    const controller = new AbortController();
    await notificationRoutingAPI.preview(
      { organizationId: 'org-1', eventType: 'alert' },
      controller.signal
    );
    expect(lastCall().init.signal).toBe(controller.signal);
  });
});
