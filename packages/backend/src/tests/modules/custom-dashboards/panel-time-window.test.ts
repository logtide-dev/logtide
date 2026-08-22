// ============================================================================
// Panel time window tests (#305)
// ============================================================================
//
// Deterministic (mocked reservoir + dashboardService) coverage for:
//   - time_series bucket rule and window propagation
//   - top_n_table service dimension path split (cagg fast path vs topValues)
//   - applyTimeRangeOverride (the dashboard-level override)
//
// The Timescale cagg path of time_series is covered by the integration tests
// in panel-data-service.test.ts against the real test database.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { db } from '../../../database/index.js';
import { createTestContext } from '../../helpers/factories.js';

vi.mock('../../../database/reservoir.js', () => ({
  reservoir: {
    getEngineType: vi.fn(() => 'clickhouse'),
    aggregate: vi.fn(async () => ({ timeseries: [], total: 0 })),
    topValues: vi.fn(async () => ({ values: [] })),
    count: vi.fn(async () => ({ count: 0 })),
  },
}));

vi.mock('../../../modules/dashboard/service.js', () => ({
  dashboardService: {
    getTimeseries: vi.fn(async () => []),
    getTopServices: vi.fn(async () => []),
    getStats: vi.fn(),
  },
}));

// Import AFTER the mocks so the module under test picks them up.
import {
  fetchPanelData,
  applyTimeRangeOverride,
} from '../../../modules/custom-dashboards/panel-data-service.js';
import { reservoir } from '../../../database/reservoir.js';
import { dashboardService } from '../../../modules/dashboard/service.js';

const HOUR_MS = 60 * 60 * 1000;

let projectId: string;
let organizationId: string;

function ctx() {
  return { organizationId, userId: 'test-user' };
}

beforeEach(async () => {
  await db.deleteFrom('api_keys').execute();
  await db.deleteFrom('organization_members').execute();
  await db.deleteFrom('projects').execute();
  await db.deleteFrom('organizations').execute();
  await db.deleteFrom('sessions').execute();
  await db.deleteFrom('users').execute();

  const testCtx = await createTestContext();
  projectId = testCtx.project.id;
  organizationId = testCtx.organization.id;

  vi.clearAllMocks();
  vi.mocked(reservoir.getEngineType).mockReturnValue('clickhouse');
  vi.mocked(reservoir.aggregate).mockResolvedValue({ timeseries: [], total: 0 });
  vi.mocked(reservoir.topValues).mockResolvedValue({ values: [] } as never);
  vi.mocked(reservoir.count).mockResolvedValue({ count: 0 } as never);
});

function timeSeriesConfig(interval: string, extra: Record<string, unknown> = {}) {
  return {
    type: 'time_series',
    title: 'T',
    source: 'logs',
    projectId,
    interval,
    levels: ['debug', 'info', 'warn', 'error', 'critical'],
    service: null,
    ...extra,
  } as never;
}

describe('time_series window and bucket rule (#305)', () => {
  const bucketCases: Array<[string, string, number]> = [
    // [interval, expected aggregate bucket, expected window ms]
    ['15m', '1m', 15 * 60 * 1000],
    ['1h', '1m', HOUR_MS],
    ['6h', '5m', 6 * HOUR_MS],
    ['12h', '15m', 12 * HOUR_MS],
    ['24h', '1h', 24 * HOUR_MS],
    ['48h', '1h', 48 * HOUR_MS],
    ['7d', '1h', 7 * 24 * HOUR_MS],
    ['14d', '1h', 14 * 24 * HOUR_MS],
    ['30d', '1d', 30 * 24 * HOUR_MS],
  ];

  for (const [interval, expectedBucket, windowMs] of bucketCases) {
    it(`interval ${interval} aggregates at ${expectedBucket} over the right window`, async () => {
      const before = Date.now();
      const result = (await fetchPanelData(timeSeriesConfig(interval), ctx())) as {
        bucket: string;
        interval: string;
      };
      const after = Date.now();

      expect(result.interval).toBe(interval);
      expect(result.bucket).toBe(expectedBucket);

      expect(reservoir.aggregate).toHaveBeenCalledTimes(1);
      const params = vi.mocked(reservoir.aggregate).mock.calls[0][0] as {
        from: Date;
        to: Date;
        interval: string;
        projectId: string[];
      };
      expect(params.interval).toBe(expectedBucket);
      expect(params.projectId).toEqual([projectId]);
      // from = to - window, with a little slack for test execution time
      expect(params.to.getTime() - params.from.getTime()).toBe(windowMs);
      expect(params.to.getTime()).toBeGreaterThanOrEqual(before);
      expect(params.to.getTime()).toBeLessThanOrEqual(after);
    });
  }

  it('no longer goes through dashboardService.getTimeseries', async () => {
    await fetchPanelData(timeSeriesConfig('24h'), ctx());
    expect(dashboardService.getTimeseries).not.toHaveBeenCalled();
  });

  it('passes the service filter through to the aggregate query', async () => {
    await fetchPanelData(timeSeriesConfig('24h', { service: 'api' }), ctx());
    expect(reservoir.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({ service: 'api' }),
    );
  });

  it('maps byLevel buckets into the series and zero-fills the window', async () => {
    const bucket = new Date(Math.floor(Date.now() / HOUR_MS) * HOUR_MS - 2 * HOUR_MS);
    vi.mocked(reservoir.aggregate).mockResolvedValue({
      timeseries: [
        {
          bucket,
          total: 15,
          byLevel: { debug: 0, info: 10, warn: 2, error: 2, critical: 1 },
        },
      ],
      total: 15,
    });

    const result = (await fetchPanelData(timeSeriesConfig('24h'), ctx())) as {
      series: Array<{ time: string; total: number; info: number; error: number }>;
    };

    // 24h window at 1h buckets: 24 or 25 buckets depending on alignment.
    expect(result.series.length).toBeGreaterThanOrEqual(24);
    expect(result.series.length).toBeLessThanOrEqual(25);

    const hit = result.series.find((s) => new Date(s.time).getTime() === bucket.getTime());
    expect(hit).toBeDefined();
    expect(hit!.info).toBe(10);
    expect(hit!.error).toBe(2);
    expect(hit!.total).toBe(15);

    // Every other bucket exists and is zero-filled.
    for (const point of result.series) {
      if (point.time !== hit!.time) expect(point.total).toBe(0);
    }
  });

  it('zeroes out levels excluded by the config and recomputes total', async () => {
    const bucket = new Date(Math.floor(Date.now() / HOUR_MS) * HOUR_MS - 2 * HOUR_MS);
    vi.mocked(reservoir.aggregate).mockResolvedValue({
      timeseries: [
        {
          bucket,
          total: 15,
          byLevel: { debug: 4, info: 10, warn: 0, error: 1, critical: 0 },
        },
      ],
      total: 15,
    });

    const result = (await fetchPanelData(
      timeSeriesConfig('24h', { levels: ['info'] }),
      ctx(),
    )) as { series: Array<{ time: string; total: number; info: number; debug: number; error: number }> };

    const hit = result.series.find((s) => new Date(s.time).getTime() === bucket.getTime());
    expect(hit).toBeDefined();
    expect(hit!.info).toBe(10);
    expect(hit!.debug).toBe(0);
    expect(hit!.error).toBe(0);
    expect(hit!.total).toBe(10);
  });

  it('renders an all-zero series when the aggregate query fails', async () => {
    vi.mocked(reservoir.aggregate).mockRejectedValue(new Error('engine down'));
    const result = (await fetchPanelData(timeSeriesConfig('24h'), ctx())) as {
      series: Array<{ total: number }>;
    };
    expect(result.series.length).toBeGreaterThan(0);
    expect(result.series.every((s) => s.total === 0)).toBe(true);
  });
});

describe('top_n_table service dimension window (#305)', () => {
  function topNConfig(interval: string, extra: Record<string, unknown> = {}) {
    return {
      type: 'top_n_table',
      title: 'Top services',
      source: 'logs',
      dimension: 'service',
      limit: 5,
      projectId,
      interval,
      ...extra,
    } as never;
  }

  it('keeps the cagg fast path for the 7d default', async () => {
    vi.mocked(dashboardService.getTopServices).mockResolvedValue([
      { name: 'api', count: 10, percentage: 100 },
    ]);

    const result = (await fetchPanelData(topNConfig('7d'), ctx())) as {
      rows: Array<{ key: string }>;
    };

    expect(dashboardService.getTopServices).toHaveBeenCalledWith(organizationId, 5, projectId);
    expect(reservoir.topValues).not.toHaveBeenCalled();
    expect(result.rows[0].key).toBe('api');
  });

  it('honors a non-7d window through reservoir.topValues', async () => {
    vi.mocked(reservoir.topValues).mockResolvedValue({
      values: [{ value: 'api', count: 8 }],
    } as never);
    vi.mocked(reservoir.count).mockResolvedValue({ count: 10 } as never);

    const result = (await fetchPanelData(topNConfig('48h'), ctx())) as {
      rows: Array<{ key: string; count: number; percentage: number }>;
      total: number;
    };

    expect(dashboardService.getTopServices).not.toHaveBeenCalled();
    expect(reservoir.topValues).toHaveBeenCalledTimes(1);
    const params = vi.mocked(reservoir.topValues).mock.calls[0][0] as {
      field: string;
      from: Date;
      to: Date;
      limit: number;
    };
    expect(params.field).toBe('service');
    expect(params.limit).toBe(5);
    expect(params.to.getTime() - params.from.getTime()).toBe(48 * HOUR_MS);

    expect(result.rows).toEqual([{ key: 'api', count: 8, percentage: 80 }]);
    expect(result.total).toBe(10);
  });

  it('uses the windowed path for 7d when showLastSeen is on', async () => {
    vi.mocked(reservoir.topValues).mockResolvedValue({
      values: [{ value: 'api', count: 3, lastSeen: '2026-08-20T10:00:00.000Z' }],
    } as never);
    vi.mocked(reservoir.count).mockResolvedValue({ count: 3 } as never);

    const result = (await fetchPanelData(topNConfig('7d', { showLastSeen: true }), ctx())) as {
      rows: Array<{ key: string; lastSeen?: string }>;
    };

    expect(dashboardService.getTopServices).not.toHaveBeenCalled();
    expect(reservoir.topValues).toHaveBeenCalledWith(
      expect.objectContaining({ field: 'service', includeLastSeen: true }),
    );
    expect(result.rows[0].lastSeen).toBe('2026-08-20T10:00:00.000Z');
  });
});

describe('applyTimeRangeOverride (#305)', () => {
  it('replaces interval on time_series, top_n_table and geo_map', () => {
    const ts = applyTimeRangeOverride(
      { type: 'time_series', title: 'T', source: 'logs', projectId: null, interval: '24h', levels: ['info'], service: null },
      '48h',
    );
    expect(ts).toMatchObject({ type: 'time_series', interval: '48h' });

    const topN = applyTimeRangeOverride(
      { type: 'top_n_table', title: 'T', source: 'logs', dimension: 'service', limit: 5, projectId: null, interval: '7d' },
      '3d',
    );
    expect(topN).toMatchObject({ type: 'top_n_table', interval: '3d' });

    const geo = applyTimeRangeOverride(
      { type: 'geo_map', title: 'T', source: 'logs', projectId: null, interval: '24h', mode: 'country', limit: 100, fieldPrefix: 'geo', levels: [], service: null, hostname: null },
      '14d',
    );
    expect(geo).toMatchObject({ type: 'geo_map', interval: '14d' });
  });

  it('replaces timeRange on the timeRange-scoped panels', () => {
    for (const config of [
      { type: 'metric_chart', title: 'T', source: 'metrics', projectId: null, metricName: 'cpu', aggregation: 'avg', interval: '5m', timeRange: '24h', serviceName: null },
      { type: 'metric_stat', title: 'T', source: 'metrics', projectId: null, metricName: 'cpu', aggregation: 'last', timeRange: '1h', serviceName: null, unit: null },
      { type: 'trace_latency', title: 'T', source: 'traces', projectId: null, serviceName: null, timeRange: '24h', showPercentiles: ['p95'] },
      { type: 'trace_volume', title: 'T', source: 'traces', projectId: null, serviceName: null, timeRange: '24h', showErrors: true },
      { type: 'detection_events', title: 'T', source: 'detections', projectId: null, timeRange: '24h', severities: ['high'] },
      { type: 'activity_overview', title: 'T', source: 'mixed', projectId: null, timeRange: '24h', series: ['logs'] },
    ] as never[]) {
      const result = applyTimeRangeOverride(config, '48h') as { timeRange: string };
      expect(result.timeRange).toBe('48h');
    }
  });

  it('overrides snapshot log tables but leaves live mode alone', () => {
    const base = {
      type: 'log_table', title: 'T', source: 'logs', projectId: null,
      timeRange: '1h', levels: [], service: null, maxRows: 25,
      columns: [], builtinColumns: ['time'], wrapCells: false,
    };
    const snapshot = applyTimeRangeOverride({ ...base, mode: 'snapshot' } as never, '48h');
    expect(snapshot).toMatchObject({ timeRange: '48h' });

    const live = { ...base, mode: 'live', projectId: 'p1' } as never;
    expect(applyTimeRangeOverride(live, '48h')).toBe(live);
  });

  it('leaves windowless panels untouched', () => {
    for (const config of [
      { type: 'single_stat', title: 'T', source: 'logs', metric: 'total_logs', projectId: null, compareWithPrevious: true },
      { type: 'live_log_stream', title: 'T', source: 'logs', projectId: null, service: null, levels: ['info'], maxRows: 25 },
      { type: 'alert_status', title: 'T', source: 'alerts', projectId: null, ruleIds: [], showHistory: true, limit: 5 },
      { type: 'monitor_status', title: 'T', source: 'monitors', projectId: null, monitorIds: [], limit: 5 },
      { type: 'system_status', title: 'T', source: 'monitors', projectId: null, showCounts: true },
    ] as never[]) {
      expect(applyTimeRangeOverride(config, '48h')).toBe(config);
    }
  });

  it('does not mutate the input config', () => {
    const config = {
      type: 'time_series', title: 'T', source: 'logs', projectId: null,
      interval: '24h', levels: ['info'], service: null,
    } as never;
    applyTimeRangeOverride(config, '48h');
    expect((config as { interval: string }).interval).toBe('24h');
  });
});
