import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { getOptions, getLabelKeys } = vi.hoisted(() => ({
  getOptions: vi.fn(),
  getLabelKeys: vi.fn(),
}));

vi.mock('$lib/api/custom-dashboards', () => ({ customDashboardsAPI: { getOptions } }));
vi.mock('$lib/api/metrics', () => ({ metricsAPI: { getLabelKeys } }));
vi.mock('$lib/config', () => ({ getApiBaseUrl: () => '/api/v1' }));
vi.mock('$lib/utils/auth', () => ({ getAuthToken: () => 'tok' }));

import {
  loadPickerOptions,
  loadMetadataKeys,
  loadMetricLabelKeys,
  clearPickerCache,
  PICKER_CACHE_TTL_MS,
  PICKER_TIMEOUT_MS,
} from './picker-options';

const base = { organizationId: 'org-1', kind: 'metric-names' as const };

beforeEach(() => {
  clearPickerCache();
  getOptions.mockReset();
  getLabelKeys.mockReset();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('picker-options', () => {
  it('caches within TTL and refetches after', async () => {
    getOptions.mockResolvedValue(['cpu']);
    expect(await loadPickerOptions(base)).toEqual(['cpu']);
    expect(await loadPickerOptions(base)).toEqual(['cpu']);
    expect(getOptions).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(PICKER_CACHE_TTL_MS + 1);
    expect(await loadPickerOptions(base)).toEqual(['cpu']);
    expect(getOptions).toHaveBeenCalledTimes(2);
  });

  it('resolves [] on API error', async () => {
    getOptions.mockRejectedValue(new Error('boom'));
    await expect(loadPickerOptions(base)).resolves.toEqual([]);
    // a failure is not cached: the next call retries
    getOptions.mockResolvedValue(['cpu']);
    await expect(loadPickerOptions(base)).resolves.toEqual(['cpu']);
  });

  it('resolves [] after timeout', async () => {
    getOptions.mockImplementation(() => new Promise(() => {}));
    const p = loadPickerOptions(base);
    await vi.advanceTimersByTimeAsync(PICKER_TIMEOUT_MS + 1);
    await expect(p).resolves.toEqual([]);
  });

  it('different projectId is a different cache key', async () => {
    getOptions.mockResolvedValueOnce(['a']).mockResolvedValueOnce(['b']);
    expect(await loadPickerOptions({ ...base, projectId: 'p1' })).toEqual(['a']);
    expect(await loadPickerOptions({ ...base, projectId: 'p2' })).toEqual(['b']);
    expect(getOptions).toHaveBeenCalledTimes(2);
  });

  it('loadMetadataKeys maps the W3 response and resolves [] on 404', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          fields: [
            { key: 'http_host', occurrences: 10 },
            { key: 'geo.city', occurrences: 4 },
          ],
        }),
      })
      .mockResolvedValueOnce({ ok: false, status: 404, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);

    expect(await loadMetadataKeys({ organizationId: 'org-1', projectId: 'p1' })).toEqual([
      'http_host',
      'geo.city',
    ]);
    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/v1/logs/fields?projectId=p1');

    expect(await loadMetadataKeys({ organizationId: 'org-1', projectId: 'p2' })).toEqual([]);
  });

  it('loadMetricLabelKeys wraps metricsAPI and never rejects', async () => {
    getLabelKeys.mockResolvedValueOnce(['host']);
    expect(await loadMetricLabelKeys('p1', 'cpu')).toEqual(['host']);
    getLabelKeys.mockRejectedValueOnce(new Error('x'));
    expect(await loadMetricLabelKeys('p1', 'mem')).toEqual([]);
  });
});
