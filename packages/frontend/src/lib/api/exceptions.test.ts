import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// $lib/config pulls in $app/environment, so it is mocked at module level.
vi.mock('$lib/config', () => ({
  getApiUrl: () => 'http://api.test',
}));
vi.mock('$lib/utils/auth', () => ({
  getAuthToken: () => 'tok',
}));

import {
  getErrorGroups,
  getErrorGroupTrends,
  getErrorGroupEvents,
  updateErrorGroup,
  bulkUpdateErrorGroups,
} from './exceptions';

type Call = { url: string; init?: RequestInit };

describe('exceptions api client', () => {
  let calls: Call[];
  let respond: () => Partial<Response>;

  beforeEach(() => {
    calls = [];
    respond = () => ({ ok: true, status: 200, json: async () => ({ groups: [], total: 0 }) });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, init });
        return respond();
      })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const params = () => new URL(calls[0].url).searchParams;

  it('getErrorGroups sends comma separated projectId, from, to, sort and assignedTo', async () => {
    await getErrorGroups({
      organizationId: 'org-1',
      projectIds: ['p1', 'p2'],
      from: new Date('2026-10-21T00:00:00.000Z'),
      to: '2026-10-21T12:00:00.000Z',
      sort: 'events',
      assignedTo: 'unassigned',
      service: 'api',
      status: 'open',
      limit: 20,
      offset: 40,
    });

    const p = params();
    expect(new URL(calls[0].url).pathname).toBe('/api/v1/error-groups');
    expect(p.get('organizationId')).toBe('org-1');
    expect(p.get('projectId')).toBe('p1,p2');
    expect(p.get('from')).toBe('2026-10-21T00:00:00.000Z');
    expect(p.get('to')).toBe('2026-10-21T12:00:00.000Z');
    expect(p.get('sort')).toBe('events');
    expect(p.get('assignedTo')).toBe('unassigned');
    expect(p.get('service')).toBe('api');
    expect(p.get('status')).toBe('open');
    expect(p.get('limit')).toBe('20');
    expect(p.get('offset')).toBe('40');
    expect((calls[0].init?.headers as Record<string, string>).Authorization).toBe('Bearer tok');
  });

  it('getErrorGroups still sends a single legacy projectId', async () => {
    await getErrorGroups({ organizationId: 'org-1', projectId: 'p9' });
    expect(params().get('projectId')).toBe('p9');
  });

  it('getErrorGroups omits empty filters', async () => {
    await getErrorGroups({ organizationId: 'org-1', projectIds: [], search: '', service: '' });
    const p = params();
    expect([...p.keys()]).toEqual(['organizationId']);
  });

  it('getErrorGroupTrends builds ids and ISO bounds', async () => {
    respond = () => ({ ok: true, status: 200, json: async () => ({ trends: {}, from: '', bucketMs: 1, buckets: 24 }) });
    await getErrorGroupTrends({
      organizationId: 'org-1',
      ids: ['a', 'b'],
      from: new Date('2026-10-20T00:00:00.000Z'),
      to: new Date('2026-10-21T00:00:00.000Z'),
      buckets: 12,
    });

    const url = new URL(calls[0].url);
    expect(url.pathname).toBe('/api/v1/error-groups/trends');
    expect(url.searchParams.get('ids')).toBe('a,b');
    expect(url.searchParams.get('from')).toBe('2026-10-20T00:00:00.000Z');
    expect(url.searchParams.get('to')).toBe('2026-10-21T00:00:00.000Z');
    expect(url.searchParams.get('buckets')).toBe('12');
  });

  it('getErrorGroupEvents sends cursor, direction and limit', async () => {
    await getErrorGroupEvents({ groupId: 'g1', organizationId: 'org-1', cursor: 'c1', direction: 'older', limit: 1 });
    const url = new URL(calls[0].url);
    expect(url.pathname).toBe('/api/v1/error-groups/g1/events');
    expect(url.searchParams.get('cursor')).toBe('c1');
    expect(url.searchParams.get('direction')).toBe('older');
    expect(url.searchParams.get('limit')).toBe('1');
  });

  it('updateErrorGroup sends PATCH with the patch body', async () => {
    await updateErrorGroup('g1', 'org-1', { status: 'ignored', ignoreUntilCount: 25 });
    expect(new URL(calls[0].url).pathname).toBe('/api/v1/error-groups/g1');
    expect(calls[0].init?.method).toBe('PATCH');
    expect(JSON.parse(calls[0].init?.body as string)).toEqual({
      organizationId: 'org-1',
      status: 'ignored',
      ignoreUntilCount: 25,
    });
  });

  it('bulkUpdateErrorGroups sends POST', async () => {
    respond = () => ({ ok: true, status: 200, json: async () => ({ updated: ['a'], skipped: [] }) });
    const result = await bulkUpdateErrorGroups({ organizationId: 'org-1', ids: ['a'], action: 'resolve' });
    expect(new URL(calls[0].url).pathname).toBe('/api/v1/error-groups/bulk');
    expect(calls[0].init?.method).toBe('POST');
    expect(JSON.parse(calls[0].init?.body as string)).toEqual({
      organizationId: 'org-1',
      ids: ['a'],
      action: 'resolve',
    });
    expect(result).toEqual({ updated: ['a'], skipped: [] });
  });

  it('server error messages are surfaced', async () => {
    respond = () => ({ ok: false, status: 400, json: async () => ({ error: 'Assignee is not a member' }) });
    await expect(updateErrorGroup('g1', 'org-1', { assignedTo: 'u1' })).rejects.toThrow('Assignee is not a member');
  });

  it('error bodies that are not JSON fall back to the HTTP status', async () => {
    respond = () => ({
      ok: false,
      status: 502,
      json: async () => {
        throw new Error('not json');
      },
    });
    await expect(bulkUpdateErrorGroups({ organizationId: 'o', ids: ['a'], action: 'resolve' })).rejects.toThrow(
      'Failed to update error groups (HTTP 502)'
    );
    await expect(getErrorGroups({ organizationId: 'o' })).rejects.toThrow('Failed to get error groups (HTTP 502)');
    await expect(
      getErrorGroupTrends({ organizationId: 'o', ids: ['a'], from: new Date(), to: new Date() })
    ).rejects.toThrow('HTTP 502');
  });
});
