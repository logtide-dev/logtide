import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('$lib/config', () => ({
  getApiUrl: () => 'http://api.test',
}));
vi.mock('$lib/utils/auth', () => ({
  getAuthToken: () => 'tok-1',
}));

import {
  getStatusPageConfig,
  updateStatusPageConfig,
  updateStatusPageComponents,
  listStatusUpdates,
  createStatusUpdate,
  removeStatusSubscriber,
  getPublicStatus,
  subscribeToStatusPage,
} from './status-page';

describe('status-page api', () => {
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

  it('sends organizationId and projectId on reads', async () => {
    respond({ config: {}, subscriptionsAvailable: false });
    await getStatusPageConfig('org-1', 'proj-1');
    const { url } = lastCall();
    expect(url.pathname).toBe('/api/v1/status-page/config');
    expect(url.searchParams.get('organizationId')).toBe('org-1');
    expect(url.searchParams.get('projectId')).toBe('proj-1');
  });

  it('sends organizationId and projectId in write bodies', async () => {
    respond({ config: {} });
    await updateStatusPageConfig('org-1', 'proj-1', { title: 'Acme' });
    let call = lastCall();
    expect(call.init.method).toBe('PUT');
    expect(JSON.parse(call.init.body as string)).toEqual({
      organizationId: 'org-1',
      projectId: 'proj-1',
      title: 'Acme',
    });

    respond({ ok: true });
    await updateStatusPageComponents('org-1', 'proj-1', [
      { monitorId: 'm1', displayName: null, groupName: 'API', order: 0 },
    ]);
    call = lastCall();
    expect(JSON.parse(call.init.body as string).components).toHaveLength(1);
  });

  it('passes sourceIncidentId when listing status updates', async () => {
    respond({ incidents: [] });
    await listStatusUpdates('org-1', 'proj-1', 'inc-9');
    expect(lastCall().url.searchParams.get('sourceIncidentId')).toBe('inc-9');
  });

  it('creates a status update with monitorIds and sourceIncidentId', async () => {
    respond({ incident: { id: 'x' } }, 201);
    await createStatusUpdate({
      organizationId: 'org-1',
      projectId: 'proj-1',
      title: 'API slow',
      severity: 'major',
      monitorIds: ['m1'],
      sourceIncidentId: 'inc-9',
    });
    const body = JSON.parse(lastCall().init.body as string);
    expect(body.monitorIds).toEqual(['m1']);
    expect(body.sourceIncidentId).toBe('inc-9');
  });

  it('throws the server error message', async () => {
    respond({ error: 'Admin or owner role required' }, 403);
    await expect(updateStatusPageConfig('org-1', 'proj-1', {})).rejects.toThrow(
      'Admin or owner role required'
    );
  });

  it('returns null on 204', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 204, json: async () => ({}) });
    await expect(removeStatusSubscriber('s1', 'org-1')).resolves.toBeNull();
  });

  it('public status sends the password header only when given', async () => {
    respond({ monitors: [] });
    await getPublicStatus('acme', 'api');
    let { init } = lastCall();
    expect(JSON.stringify(init.headers ?? {})).not.toContain('x-status-password');

    respond({ monitors: [] });
    await getPublicStatus('acme', 'api', 'secret');
    ({ init } = lastCall());
    expect((init.headers as Record<string, string>)['x-status-password']).toBe('secret');
  });

  it('subscribe posts the email to the public endpoint', async () => {
    respond({ ok: true }, 202);
    await subscribeToStatusPage('acme', 'api', 'a@b.co');
    const { url, init } = lastCall();
    expect(url.pathname).toBe('/api/v1/status/acme/api/subscribe');
    expect(JSON.parse(init.body as string)).toEqual({ email: 'a@b.co' });
  });
});
