import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('$lib/config', () => ({ getApiUrl: () => 'http://api.test' }));
vi.mock('$lib/utils/auth', () => ({ getAuthToken: () => 'tok-1' }));

import { notificationChannelsAPI } from './notification-channels';

describe('notificationChannelsAPI test before save and overrides', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ result: { success: true }, overrides: [{ id: 'r1' }] }),
    }));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('testUnsaved posts the body to /notification-channels/test and returns the result', async () => {
    const input = {
      organizationId: 'org-1',
      channelId: 'ch-1',
      type: 'pagerduty' as const,
      config: { routingKey: 'k'.repeat(32) },
    };
    const result = await notificationChannelsAPI.testUnsaved(input);
    expect(result).toEqual({ success: true });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://api.test/api/v1/notification-channels/test');
    expect((init as RequestInit).method).toBe('POST');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual(input);
  });

  it('testUnsaved throws the server error message', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'Too many requests' }) });
    await expect(
      notificationChannelsAPI.testUnsaved({
        organizationId: 'o',
        type: 'email',
        config: { recipients: ['a@b.co'] },
      })
    ).rejects.toThrow('Too many requests');
  });

  it('getOverrides requests /overrides with the organization id', async () => {
    const overrides = await notificationChannelsAPI.getOverrides('org-1');
    expect(overrides).toEqual([{ id: 'r1' }]);
    const [url] = fetchMock.mock.calls[0];
    const u = new URL(url as string);
    expect(u.pathname).toBe('/api/v1/notification-channels/overrides');
    expect(u.searchParams.get('organizationId')).toBe('org-1');
  });
});
