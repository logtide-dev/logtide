import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('$lib/config', () => ({
  getApiBaseUrl: () => '/api/v1',
  getApiUrl: () => '',
}));
vi.mock('$lib/utils/auth', () => ({
  getAuthToken: () => 'session-token',
}));

import { savedSearchesAPI, type SavedSearch } from './saved-searches';

type Call = { url: string; init: RequestInit };
type FakeResponse = { ok: boolean; status: number; statusText?: string; json: () => Promise<unknown> };

let calls: Call[] = [];
let nextResponse: FakeResponse;

function respond(body: unknown, init: Partial<FakeResponse> = {}) {
  nextResponse = { ok: true, status: 200, statusText: 'OK', json: async () => body, ...init };
}

function last(): { url: URL; init: RequestInit; body: unknown } {
  const call = calls[calls.length - 1];
  return {
    url: new URL(call.url, 'http://localhost'),
    init: call.init,
    body: call.init.body ? JSON.parse(String(call.init.body)) : undefined,
  };
}

const saved: SavedSearch = {
  id: 's1',
  organizationId: 'org-1',
  createdBy: 'u1',
  createdByName: 'Ada',
  name: 'Errors',
  visibility: 'private',
  state: { q: 'level:error', projectIds: ['p1'], range: '24h' },
  canEdit: true,
  createdAt: '2026-10-21T10:00:00.000Z',
  updatedAt: '2026-10-21T10:00:00.000Z',
};

beforeEach(() => {
  calls = [];
  respond({});
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return nextResponse;
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('savedSearchesAPI', () => {
  it('list passes organizationId and unwraps savedSearches', async () => {
    respond({ savedSearches: [saved] });
    const res = await savedSearchesAPI.list('org-1');
    const { url, init } = last();
    expect(url.pathname).toBe('/api/v1/saved-searches');
    expect(url.searchParams.get('organizationId')).toBe('org-1');
    expect(init.method ?? 'GET').toBe('GET');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer session-token');
    expect(res).toEqual([saved]);
  });

  it('create posts organizationId, name, visibility and state', async () => {
    respond({ savedSearch: saved }, { status: 201 });
    const res = await savedSearchesAPI.create('org-1', {
      name: 'Errors',
      visibility: 'organization',
      state: { q: 'level:error', projectIds: ['p1'], range: '24h' },
    });
    const { url, init, body } = last();
    expect(url.pathname).toBe('/api/v1/saved-searches');
    expect(init.method).toBe('POST');
    expect(body).toEqual({
      organizationId: 'org-1',
      name: 'Errors',
      visibility: 'organization',
      state: { q: 'level:error', projectIds: ['p1'], range: '24h' },
    });
    expect(res).toEqual(saved);
  });

  it('update patches only the given fields', async () => {
    respond({ savedSearch: { ...saved, name: 'New name' } });
    const res = await savedSearchesAPI.update('s1', 'org-1', { name: 'New name' });
    const { url, init, body } = last();
    expect(url.pathname).toBe('/api/v1/saved-searches/s1');
    expect(url.searchParams.get('organizationId')).toBe('org-1');
    expect(init.method).toBe('PATCH');
    expect(body).toEqual({ name: 'New name' });
    expect(res.name).toBe('New name');
  });

  it('remove sends DELETE and resolves on 204', async () => {
    respond(undefined, {
      status: 204,
      json: async () => {
        throw new Error('no body');
      },
    });
    await expect(savedSearchesAPI.remove('s1', 'org-1')).resolves.toBeUndefined();
    const { url, init } = last();
    expect(url.pathname).toBe('/api/v1/saved-searches/s1');
    expect(url.searchParams.get('organizationId')).toBe('org-1');
    expect(init.method).toBe('DELETE');
  });

  it('surfaces the server error message', async () => {
    respond({ error: 'Saved search limit reached' }, { ok: false, status: 403, statusText: 'Forbidden' });
    await expect(
      savedSearchesAPI.create('org-1', { name: 'x', visibility: 'private', state: { q: '', projectIds: [] } }),
    ).rejects.toThrow('Saved search limit reached');
  });

  it('falls back to the status when the error body is unreadable', async () => {
    respond(undefined, {
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      json: async () => {
        throw new Error('not json');
      },
    });
    await expect(savedSearchesAPI.list('org-1')).rejects.toThrow('500 Internal Server Error');
  });
});
