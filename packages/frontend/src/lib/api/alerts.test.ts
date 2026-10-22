import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AlertsAPI } from './alerts';

const fetchMock = vi.fn();

function ok(body: unknown, status = 200) {
  return Promise.resolve({
    ok: true,
    status,
    json: () => Promise.resolve(body),
  } as Response);
}

describe('AlertsAPI lifecycle', () => {
  const api = new AlertsAPI(() => 'tok');

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('snooze posts until with organizationId', async () => {
    fetchMock.mockReturnValue(ok({ alertRule: { id: 'r1' } }));
    await api.snoozeAlertRule('org1', 'r1', '2026-10-23T00:00:00.000Z');
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/api/v1/alerts/r1/snooze?organizationId=org1');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ until: '2026-10-23T00:00:00.000Z' });
    expect(init.headers.Authorization).toBe('Bearer tok');
  });

  it('unsnooze issues DELETE', async () => {
    fetchMock.mockReturnValue(ok({ alertRule: { id: 'r1' } }));
    await api.unsnoozeAlertRule('org1', 'r1');
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/api/v1/alerts/r1/snooze?organizationId=org1');
    expect(init.method).toBe('DELETE');
  });

  it('getAlertRules returns new lifecycle fields untouched', async () => {
    const rule = {
      id: 'r1',
      query: 'timeout',
      state: 'firing',
      lastTriggeredAt: '2026-10-22T10:00:00Z',
      snoozedUntil: null,
      renotifyMinutes: 60,
      triggersLast24h: 4,
    };
    fetchMock.mockReturnValue(ok({ alertRules: [rule] }));
    const res = await api.getAlertRules('org1');
    expect(res.alertRules[0]).toEqual(rule);
  });

  it('previewAlertRule forwards query and metadataFilters', async () => {
    fetchMock.mockReturnValue(ok({ preview: {} }));
    await api.previewAlertRule({
      organizationId: 'org1',
      level: ['error'],
      threshold: 5,
      timeWindow: 5,
      previewRange: '7d',
      query: 'timeout',
      metadataFilters: [{ key: 'env', op: 'equals', value: 'prod' }],
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.query).toBe('timeout');
    expect(body.metadataFilters).toEqual([{ key: 'env', op: 'equals', value: 'prod' }]);
  });
});
