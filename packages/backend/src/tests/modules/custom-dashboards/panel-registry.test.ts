import { describe, it, expect } from 'vitest';
import { panelRegistry, panelInstanceSchema, panelConfigSchema, dashboardDocumentSchema } from '../../../modules/custom-dashboards/panel-registry.js';

describe('panelRegistry', () => {
  it('has entries for all panel types', () => {
    const types = [
      'time_series', 'single_stat', 'top_n_table', 'live_log_stream',
      'alert_status', 'metric_chart', 'metric_stat', 'trace_latency',
      'trace_volume', 'detection_events', 'monitor_status', 'system_status',
      'activity_overview', 'geo_map',
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
