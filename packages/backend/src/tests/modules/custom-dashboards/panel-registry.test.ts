import { describe, it, expect } from 'vitest';
import { panelRegistry, panelInstanceSchema, panelConfigSchema, dashboardDocumentSchema } from '../../../modules/custom-dashboards/panel-registry.js';

describe('panelRegistry', () => {
  it('has entries for all panel types', () => {
    const types = [
      'time_series', 'single_stat', 'top_n_table', 'live_log_stream',
      'alert_status', 'metric_chart', 'metric_stat', 'trace_latency',
      'trace_volume', 'detection_events', 'monitor_status', 'system_status',
      'activity_overview', 'geo_map', 'log_table',
    ];
    for (const type of types) {
      expect(panelRegistry[type as keyof typeof panelRegistry]).toBeDefined();
      expect(panelRegistry[type as keyof typeof panelRegistry].defaultLayout.w).toBeGreaterThan(0);
      expect(panelRegistry[type as keyof typeof panelRegistry].defaultLayout.h).toBeGreaterThan(0);
    }
  });
});

describe('panelInstanceSchema', () => {
  it('validates a valid time_series panel', () => {
    const panel = {
      id: 'p1',
      layout: { x: 0, y: 0, w: 6, h: 3 },
      config: {
        type: 'time_series',
        title: 'Logs',
        source: 'logs',
        projectId: null,
        interval: '24h',
        levels: ['info', 'error'],
        service: null,
      },
    };
    expect(() => panelInstanceSchema.parse(panel)).not.toThrow();
  });

  it('validates a valid single_stat panel', () => {
    const panel = {
      id: 'p2',
      layout: { x: 0, y: 0, w: 3, h: 2 },
      config: {
        type: 'single_stat',
        title: 'Total',
        source: 'logs',
        metric: 'total_logs',
        projectId: null,
        compareWithPrevious: true,
      },
    };
    expect(() => panelInstanceSchema.parse(panel)).not.toThrow();
  });

  it('validates a valid top_n_table panel', () => {
    const panel = {
      id: 'p3',
      layout: { x: 0, y: 0, w: 6, h: 4 },
      config: {
        type: 'top_n_table',
        title: 'Top services',
        source: 'logs',
        dimension: 'service',
        limit: 5,
        projectId: null,
        interval: '24h',
      },
    };
    expect(() => panelInstanceSchema.parse(panel)).not.toThrow();
  });

  it('rejects invalid panel type', () => {
    const panel = {
      id: 'bad',
      layout: { x: 0, y: 0, w: 4, h: 3 },
      config: { type: 'nonexistent_type' },
    };
    expect(() => panelInstanceSchema.parse(panel)).toThrow();
  });

  it('rejects invalid layout (w > 12)', () => {
    const panel = {
      id: 'bad-layout',
      layout: { x: 0, y: 0, w: 13, h: 3 },
      config: {
        type: 'time_series',
        title: 'T',
        source: 'logs',
        projectId: null,
        interval: '24h',
        levels: ['info'],
        service: null,
      },
    };
    expect(() => panelInstanceSchema.parse(panel)).toThrow();
  });

  it('rejects time_series with empty levels', () => {
    const panel = {
      id: 'no-levels',
      layout: { x: 0, y: 0, w: 6, h: 3 },
      config: {
        type: 'time_series',
        title: 'T',
        source: 'logs',
        projectId: null,
        interval: '24h',
        levels: [],
        service: null,
      },
    };
    expect(() => panelInstanceSchema.parse(panel)).toThrow();
  });
});

describe('panelConfigSchema', () => {
  it('validates metric_chart config', () => {
    const config = {
      type: 'metric_chart',
      title: 'CPU',
      source: 'metrics',
      projectId: null,
      metricName: 'cpu_usage',
      aggregation: 'avg',
      interval: '5m',
      timeRange: '1h',
      serviceName: null,
    };
    expect(() => panelConfigSchema.parse(config)).not.toThrow();
  });

  it('validates trace_latency config', () => {
    const config = {
      type: 'trace_latency',
      title: 'Latency',
      source: 'traces',
      projectId: null,
      serviceName: 'api',
      timeRange: '1h',
      showPercentiles: ['p50', 'p95'],
    };
    expect(() => panelConfigSchema.parse(config)).not.toThrow();
  });

  it('validates detection_events config', () => {
    const config = {
      type: 'detection_events',
      title: 'Detections',
      source: 'detections',
      projectId: null,
      timeRange: '24h',
      severities: ['critical', 'high'],
    };
    expect(() => panelConfigSchema.parse(config)).not.toThrow();
  });

  it('validates monitor_status config', () => {
    const config = {
      type: 'monitor_status',
      title: 'Monitors',
      source: 'monitors',
      projectId: null,
      monitorIds: [],
      limit: 5,
    };
    expect(() => panelConfigSchema.parse(config)).not.toThrow();
  });

  it('validates system_status config', () => {
    const config = {
      type: 'system_status',
      title: 'System',
      source: 'monitors',
      projectId: null,
      showCounts: true,
    };
    expect(() => panelConfigSchema.parse(config)).not.toThrow();
  });
});

describe('dashboardDocumentSchema', () => {
  it('validates a valid document', () => {
    const doc = {
      schema_version: 1,
      panels: [],
    };
    expect(() => dashboardDocumentSchema.parse(doc)).not.toThrow();
  });

  it('rejects invalid schema_version', () => {
    const doc = { schema_version: 0, panels: [] };
    expect(() => dashboardDocumentSchema.parse(doc)).toThrow();
  });
});

describe('geo_map schema', () => {
  const valid = {
    type: 'geo_map',
    title: 'Traffic Map',
    source: 'logs',
    projectId: null,
    interval: '24h',
    mode: 'country',
    limit: 100,
    fieldPrefix: 'geo',
    levels: [],
    service: null,
    hostname: null,
  };

  it('accepts a valid country-mode config', () => {
    expect(panelConfigSchema.safeParse(valid).success).toBe(true);
  });

  it('accepts a valid points-mode config with filters', () => {
    const parsed = panelConfigSchema.safeParse({
      ...valid,
      mode: 'points',
      levels: ['error', 'critical'],
      service: 'caddy',
      hostname: 'edge-1',
      fieldPrefix: 'upstream_geo',
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects fieldPrefix with dots (would fake nested metadata paths in SQL)', () => {
    expect(panelConfigSchema.safeParse({ ...valid, fieldPrefix: 'geo.country' }).success).toBe(false);
  });

  it('rejects fieldPrefix with quotes or spaces', () => {
    expect(panelConfigSchema.safeParse({ ...valid, fieldPrefix: "geo'--" }).success).toBe(false);
    expect(panelConfigSchema.safeParse({ ...valid, fieldPrefix: 'geo x' }).success).toBe(false);
  });

  it('rejects fieldPrefix longer than 32 chars', () => {
    expect(panelConfigSchema.safeParse({ ...valid, fieldPrefix: 'a'.repeat(33) }).success).toBe(false);
  });

  it('rejects out-of-bounds limit', () => {
    expect(panelConfigSchema.safeParse({ ...valid, limit: 5 }).success).toBe(false);
    expect(panelConfigSchema.safeParse({ ...valid, limit: 501 }).success).toBe(false);
  });

  it('has a registry entry with a default layout', () => {
    expect(panelRegistry.geo_map.defaultLayout).toEqual({ w: 6, h: 4 });
  });
});

describe('top_n_table schema', () => {
  const legacy = {
    type: 'top_n_table',
    title: 'Top services',
    source: 'logs',
    dimension: 'service',
    limit: 5,
    projectId: null,
    interval: '24h',
  };

  it('accepts legacy top_n_table without new fields', () => {
    expect(panelConfigSchema.safeParse(legacy).success).toBe(true);
  });

  it('accepts metadata dimension with field and limit 50', () => {
    const parsed = panelConfigSchema.safeParse({
      ...legacy,
      dimension: 'metadata',
      metadataField: 'geo_place',
      limit: 50,
      showLastSeen: true,
      levels: ['error'],
      service: 'caddy',
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects metadata dimension without metadataField', () => {
    expect(panelConfigSchema.safeParse({ ...legacy, dimension: 'metadata' }).success).toBe(false);
    expect(
      panelConfigSchema.safeParse({ ...legacy, dimension: 'metadata', metadataField: null }).success
    ).toBe(false);
    expect(
      panelConfigSchema.safeParse({ ...legacy, dimension: 'metadata', metadataField: '' }).success
    ).toBe(false);
  });

  it('rejects metadataField with quotes', () => {
    expect(
      panelConfigSchema.safeParse({
        ...legacy,
        dimension: 'metadata',
        metadataField: "x' OR 1=1--",
      }).success
    ).toBe(false);
  });

  it('rejects limit above 50', () => {
    expect(panelConfigSchema.safeParse({ ...legacy, limit: 51 }).success).toBe(false);
  });

  it('accepts a dotted metadata path', () => {
    expect(
      panelConfigSchema.safeParse({
        ...legacy,
        dimension: 'metadata',
        metadataField: 'geo.city',
      }).success
    ).toBe(true);
  });
});

describe('log_table schema', () => {
  const valid = {
    type: 'log_table',
    title: 'WAN hits',
    source: 'logs',
    projectId: null,
    mode: 'snapshot',
    timeRange: '1h',
    levels: [],
    service: null,
    maxRows: 25,
    columns: ['http_host', 'geo.city'],
    builtinColumns: ['time', 'level', 'service', 'message'],
    wrapCells: false,
  };

  it('accepts a valid snapshot config', () => {
    expect(panelConfigSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects live mode without a project', () => {
    const result = panelConfigSchema.safeParse({ ...valid, mode: 'live', projectId: null });
    expect(result.success).toBe(false);
  });

  it('accepts live mode with a project', () => {
    const result = panelConfigSchema.safeParse({
      ...valid,
      mode: 'live',
      projectId: '5f0c1b2a-1111-4222-8333-444455556666',
    });
    expect(result.success).toBe(true);
  });

  it('rejects more than 10 columns', () => {
    const columns = Array.from({ length: 11 }, (_, i) => `c${i}`);
    expect(panelConfigSchema.safeParse({ ...valid, columns }).success).toBe(false);
  });

  it('rejects a config with zero total columns', () => {
    const result = panelConfigSchema.safeParse({ ...valid, columns: [], builtinColumns: [] });
    expect(result.success).toBe(false);
  });

  it('rejects out-of-range maxRows', () => {
    expect(panelConfigSchema.safeParse({ ...valid, maxRows: 5 }).success).toBe(false);
    expect(panelConfigSchema.safeParse({ ...valid, maxRows: 101 }).success).toBe(false);
  });

  it('validates a full panel instance through dashboardDocumentSchema', () => {
    const doc = {
      schema_version: 1,
      panels: [{ id: 'lt1', layout: { x: 0, y: 0, w: 12, h: 4 }, config: valid }],
    };
    expect(dashboardDocumentSchema.safeParse(doc).success).toBe(true);
  });

  it('has a registry entry with a default layout', () => {
    expect(panelRegistry.log_table.defaultLayout).toEqual({ w: 12, h: 4 });
  });
});

describe('time_series seriesLabels', () => {
  const baseTimeSeries = {
    type: 'time_series',
    title: 'Volume',
    source: 'logs',
    projectId: null,
    interval: '24h',
    levels: ['info', 'warn', 'error'],
    service: null,
  };

  it('accepts time_series without seriesLabels (backward compat)', () => {
    expect(panelConfigSchema.safeParse(baseTimeSeries).success).toBe(true);
  });

  it('accepts time_series with partial seriesLabels', () => {
    const labels = { info: 'Heartbeat', warn: 'Normal', error: 'Blocked' };
    const result = panelConfigSchema.safeParse({ ...baseTimeSeries, seriesLabels: labels });
    expect(result.success).toBe(true);
    expect(result.success && result.data.type === 'time_series' && result.data.seriesLabels).toEqual(labels);
  });

  it('rejects seriesLabels with unknown level key', () => {
    const result = panelConfigSchema.safeParse({
      ...baseTimeSeries,
      seriesLabels: { fatal: 'Nope' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects seriesLabels longer than 40 chars', () => {
    const result = panelConfigSchema.safeParse({
      ...baseTimeSeries,
      seriesLabels: { info: 'x'.repeat(41) },
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty seriesLabels values', () => {
    const result = panelConfigSchema.safeParse({
      ...baseTimeSeries,
      seriesLabels: { info: '' },
    });
    expect(result.success).toBe(false);
  });
});

describe('live_log_stream schema', () => {
  const valid = {
    type: 'live_log_stream',
    title: 'Stream',
    source: 'logs',
    projectId: null,
    service: null,
    levels: ['info'],
    maxRows: 25,
  };

  it('accepts a valid config', () => {
    expect(panelConfigSchema.safeParse(valid).success).toBe(true);
  });

  it('accepts maxRows of 100', () => {
    expect(panelConfigSchema.safeParse({ ...valid, maxRows: 100 }).success).toBe(true);
  });

  it('rejects maxRows above 100', () => {
    expect(panelConfigSchema.safeParse({ ...valid, maxRows: 101 }).success).toBe(false);
  });

  it('rejects maxRows below 10', () => {
    expect(panelConfigSchema.safeParse({ ...valid, maxRows: 9 }).success).toBe(false);
  });
});
