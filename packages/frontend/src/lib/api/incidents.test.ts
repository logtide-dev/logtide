import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('$lib/config', () => ({ getApiUrl: () => 'http://api.test' }));
vi.mock('$lib/utils/auth', () => ({ getAuthToken: () => 'tok' }));

import { incidentsAPI } from './incidents';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('incidentsAPI', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn().mockImplementation(async () => json(200, { incidents: [], total: 0 }));
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  const calledUrl = () => new URL(String(fetchMock.mock.calls[0][0]));

  it('list sends repeated projectId, status, severity, source params', async () => {
    await incidentsAPI.list({
      organizationId: 'o1',
      projectIds: ['p1', 'p2'],
      status: ['open', 'investigating'],
      severity: ['high', 'critical'],
      source: ['alert', 'monitor'],
      limit: 25,
      offset: 50,
    });
    const u = calledUrl();
    expect(u.pathname).toBe('/api/v1/incidents');
    expect(u.searchParams.getAll('projectId')).toEqual(['p1', 'p2']);
    expect(u.searchParams.getAll('status')).toEqual(['open', 'investigating']);
    expect(u.searchParams.getAll('severity')).toEqual(['high', 'critical']);
    expect(u.searchParams.getAll('source')).toEqual(['alert', 'monitor']);
    expect(u.searchParams.get('limit')).toBe('25');
    expect(u.searchParams.get('offset')).toBe('50');
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer tok');
  });

  it('list sends assignee=unassigned, assignee=me or assignee=<uuid> and omits assignee for anyone', async () => {
    await incidentsAPI.list({ organizationId: 'o1', assignee: { kind: 'unassigned' } });
    expect(calledUrl().searchParams.get('assignee')).toBe('unassigned');
    fetchMock.mockClear();
    await incidentsAPI.list({ organizationId: 'o1', assignee: { kind: 'me' } });
    expect(calledUrl().searchParams.get('assignee')).toBe('me');
    fetchMock.mockClear();
    await incidentsAPI.list({ organizationId: 'o1', assignee: { kind: 'user', userId: 'u-1' } });
    expect(calledUrl().searchParams.get('assignee')).toBe('u-1');
    fetchMock.mockClear();
    await incidentsAPI.list({ organizationId: 'o1' });
    expect(calledUrl().searchParams.has('assignee')).toBe(false);
  });

  it('list sends ruleId', async () => {
    await incidentsAPI.list({ organizationId: 'o1', ruleId: 'r1' });
    expect(calledUrl().searchParams.get('ruleId')).toBe('r1');
  });

  it('list omits empty arrays', async () => {
    await incidentsAPI.list({ organizationId: 'o1', projectIds: [], status: [], severity: [], source: [] });
    expect([...calledUrl().searchParams.keys()]).toEqual(['organizationId']);
  });

  it('update sends assigneeId null when unassigning', async () => {
    fetchMock.mockResolvedValue(json(200, { id: 'i1' }));
    await incidentsAPI.update('i1', 'o1', { assigneeId: null });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('http://api.test/api/v1/incidents/i1');
    expect(init.method).toBe('PATCH');
    expect(init.body).toContain('"assigneeId":null');
    expect(JSON.parse(init.body).organizationId).toBe('o1');
  });

  it('bulk posts ids, action and assigneeId', async () => {
    fetchMock.mockResolvedValue(json(200, { updated: [], skipped: [] }));
    await incidentsAPI.bulk({ organizationId: 'o1', ids: ['a', 'b'], action: 'assign', assigneeId: null });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('http://api.test/api/v1/incidents/bulk');
    expect(JSON.parse(init.body)).toEqual({
      organizationId: 'o1',
      ids: ['a', 'b'],
      action: 'assign',
      assigneeId: null,
    });
  });

  it('non-ok response throws the server error message', async () => {
    fetchMock.mockResolvedValue(
      json(409, { error: 'False positive applies to security incidents only', code: 'invalid_transition' })
    );
    await expect(incidentsAPI.update('i1', 'o1', { status: 'false_positive' })).rejects.toMatchObject({
      message: 'False positive applies to security incidents only',
      code: 'invalid_transition',
      status: 409,
    });
  });

  it('get defaults sourceEvents to an empty array', async () => {
    fetchMock.mockResolvedValue(
      json(200, { incident: { id: 'i1' }, detections: [], comments: [], history: [] })
    );
    const detail = await incidentsAPI.get('i1', 'o1');
    expect(detail.sourceEvents).toEqual([]);
  });
});
