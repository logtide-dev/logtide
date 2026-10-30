import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SigmaAPI, SigmaApiError } from './sigma';

const ORG = '11111111-1111-4111-8111-111111111111';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('SigmaAPI rules management', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let api: SigmaAPI;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    api = new SigmaAPI(() => 'tok');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('listRules builds a query string with comma separated arrays and omits undefined', async () => {
    fetchMock.mockResolvedValue(json(200, { rules: [], total: 0, page: 1, pageSize: 25 }));
    await api.listRules({
      organizationId: ORG,
      page: 2,
      search: 'ssh',
      severity: ['high', 'critical'],
      tactic: [],
      enabled: false,
      sortBy: 'hits7d',
      sortOrder: 'desc',
      projectId: undefined,
    });
    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.pathname).toBe('/api/v1/sigma/rules');
    expect(url.searchParams.get('organizationId')).toBe(ORG);
    expect(url.searchParams.get('page')).toBe('2');
    expect(url.searchParams.get('search')).toBe('ssh');
    expect(url.searchParams.get('severity')).toBe('high,critical');
    expect(url.searchParams.get('enabled')).toBe('false');
    expect(url.searchParams.get('sortBy')).toBe('hits7d');
    expect(url.searchParams.has('tactic')).toBe(false);
    expect(url.searchParams.has('projectId')).toBe(false);
  });

  it('bulk posts ids and action', async () => {
    fetchMock.mockResolvedValue(json(200, { affected: 2 }));
    await expect(api.bulk(ORG, ['a', 'b'], 'disable')).resolves.toEqual({ affected: 2 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/api\/v1\/sigma\/rules\/bulk$/);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ organizationId: ORG, ids: ['a', 'b'], action: 'disable' });
  });

  it('previewRule posts range', async () => {
    fetchMock.mockResolvedValue(json(200, { matches: 1 }));
    await api.previewRule('r1', { organizationId: ORG, range: '7d' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/api\/v1\/sigma\/rules\/r1\/preview$/);
    expect(JSON.parse(init.body)).toEqual({ organizationId: ORG, range: '7d' });
  });

  it('updateRuleYaml sends yaml in a PATCH', async () => {
    fetchMock.mockResolvedValue(json(200, { rule: {} }));
    await api.updateRuleYaml('r1', ORG, 'title: x');
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/api\/v1\/sigma\/rules\/r1$/);
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body)).toEqual({ organizationId: ORG, yaml: 'title: x' });
  });

  it('exceptions, matches, validate and detail use the expected paths', async () => {
    fetchMock.mockImplementation(async () => json(200, {}));
    await api.listExceptions('r1', ORG);
    await api.createException('r1', ORG, {
      conditions: [{ field: 'service', operator: 'equals', values: ['a'] }],
    });
    await api.deleteException('r1', 'e1', ORG);
    await api.getMatches('r1', ORG, { limit: 10, offset: 20, days: 3 });
    await api.validateYaml(ORG, 'title: x');
    await api.getRuleDetail('r1', ORG);
    const calls = fetchMock.mock.calls.map(
      ([u, i]) => `${i?.method ?? 'GET'} ${new URL(String(u)).pathname}`
    );
    expect(calls).toEqual([
      'GET /api/v1/sigma/rules/r1/exceptions',
      'POST /api/v1/sigma/rules/r1/exceptions',
      'DELETE /api/v1/sigma/rules/r1/exceptions/e1',
      'GET /api/v1/sigma/rules/r1/matches',
      'POST /api/v1/sigma/validate',
      'GET /api/v1/sigma/rules/r1',
    ]);
    const matchesUrl = new URL(String(fetchMock.mock.calls[3][0]));
    expect(matchesUrl.searchParams.get('limit')).toBe('10');
    expect(matchesUrl.searchParams.get('days')).toBe('3');
  });

  it('error responses surface the server message and 429 is distinguishable', async () => {
    fetchMock.mockResolvedValueOnce(
      json(429, { error: 'A preview is already running for this organization' })
    );
    const err = await api.previewRule('r1', { organizationId: ORG, range: '24h' }).catch((e) => e);
    expect(err).toBeInstanceOf(SigmaApiError);
    expect(err.message).toBe('A preview is already running for this organization');
    expect(err.status).toBe(429);

    fetchMock.mockResolvedValueOnce(json(400, { error: 'Invalid rule' }));
    const bad = await api.updateRuleYaml('r1', ORG, 'x').catch((e) => e);
    expect(bad.status).toBe(400);
    expect(bad.message).toBe('Invalid rule');
  });
});
