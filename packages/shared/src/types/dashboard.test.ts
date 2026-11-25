import { describe, it, expect } from 'vitest';
import {
  PANEL_TIME_RANGES,
  PANEL_TIME_RANGE_MS,
  PANEL_TIME_RANGE_LABELS,
  panelTimeRangeToMs,
  CURRENT_SCHEMA_VERSION,
  type DashboardDocument,
} from './dashboard.js';
import { migrateDashboard } from './dashboard-migrations.js';

describe('panel time range catalog', () => {
  it('has an ms value and a label for every preset', () => {
    for (const range of PANEL_TIME_RANGES) {
      expect(PANEL_TIME_RANGE_MS[range]).toBeGreaterThan(0);
      expect(PANEL_TIME_RANGE_LABELS[range]).toBeTruthy();
    }
    expect(Object.keys(PANEL_TIME_RANGE_MS).sort()).toEqual([...PANEL_TIME_RANGES].sort());
    expect(Object.keys(PANEL_TIME_RANGE_LABELS).sort()).toEqual([...PANEL_TIME_RANGES].sort());
  });

  it('is ordered from shortest to longest window', () => {
    const values = PANEL_TIME_RANGES.map((r) => PANEL_TIME_RANGE_MS[r]);
    for (let i = 1; i < values.length; i++) {
      expect(values[i]).toBeGreaterThan(values[i - 1]);
    }
  });

  it('covers every preset previously accepted by any panel enum', () => {
    // Union of the pre-#305 per-panel enums; losing one would break stored dashboards.
    for (const legacy of ['15m', '1h', '6h', '24h', '7d', '30d']) {
      expect(PANEL_TIME_RANGES).toContain(legacy);
    }
  });

  it('resolves known presets and falls back to 24h for unknown strings', () => {
    expect(panelTimeRangeToMs('48h')).toBe(48 * 60 * 60 * 1000);
    expect(panelTimeRangeToMs('3d')).toBe(3 * 24 * 60 * 60 * 1000);
    expect(panelTimeRangeToMs('bogus')).toBe(24 * 60 * 60 * 1000);
  });
});

describe('dashboard schema version', () => {
  it('CURRENT_SCHEMA_VERSION is 2 since 1.8 (metrics panel, variables)', () => {
    expect(CURRENT_SCHEMA_VERSION).toBe(2);
  });

  it('v1 metric_chart and metric_stat migrate to the metrics panel', () => {
    const v1 = {
      schema_version: 1,
      panels: [
        {
          id: 'p1',
          layout: { x: 0, y: 0, w: 6, h: 4 },
          config: { type: 'metric_chart', title: 'CPU', source: 'metrics', projectId: 'proj-1', metricName: 'cpu', aggregation: 'rate', interval: '5m', timeRange: '24h', serviceName: 'api', groupBy: ['state'] },
        },
        {
          id: 'p2',
          layout: { x: 6, y: 0, w: 3, h: 2 },
          config: { type: 'metric_stat', title: 'Mem', source: 'metrics', projectId: null, metricName: 'mem', aggregation: 'last', timeRange: '1h', serviceName: null, unit: '%' },
        },
        { id: 'p3', layout: { x: 9, y: 0, w: 3, h: 2 }, config: { type: 'system_status', title: 'Sys' } },
      ],
    } as unknown as DashboardDocument;
    const v2 = migrateDashboard(v1, 2);
    expect(v2.schema_version).toBe(2);
    expect(v2.variables).toEqual([]);
    expect(v2.panels[0].config).toEqual({
      type: 'metrics',
      title: 'CPU',
      source: 'metrics',
      timeRange: '24h',
      query: {
        projectIds: ['proj-1'],
        queries: [
          {
            id: 'A',
            metricName: 'cpu',
            aggregation: 'rate',
            filters: [{ scope: 'resource', key: 'service.name', op: 'eq', values: ['api'] }],
            groupBy: [{ scope: 'metric', key: 'state' }],
          },
        ],
        formulas: [],
        interval: '5m',
        compareTo: 'none',
        display: 'lines',
        unitOverride: null,
      },
    });
    const stat = v2.panels[1].config as { type: string; query: { projectIds: unknown; display: string; interval: string; unitOverride: unknown; queries: Array<{ filters: unknown[]; groupBy: unknown[] }> } };
    expect(stat.type).toBe('metrics');
    expect(stat.query.projectIds).toBeNull();
    expect(stat.query.display).toBe('stat');
    expect(stat.query.interval).toBe('auto');
    expect(stat.query.unitOverride).toBe('%');
    expect(stat.query.queries[0].filters).toEqual([]);
    expect(stat.query.queries[0].groupBy).toEqual([]);
    expect(v2.panels[2]).toEqual(v1.panels[2]);
  });
});
