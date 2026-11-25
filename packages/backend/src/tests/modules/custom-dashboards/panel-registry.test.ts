import { describe, it, expect } from 'vitest';
import { panelRegistry, panelInstanceSchema, panelConfigSchema, dashboardDocumentSchema } from '../../../modules/custom-dashboards/panel-registry.js';

function metricsPanel(overrides: Record<string, unknown> = {}) {
  return {
    type: 'metrics',
    title: 'T',
    source: 'metrics',
    timeRange: '24h',
    query: {
      projectIds: null,
      queries: [{ id: 'A', metricName: 'cpu', aggregation: 'avg', filters: [], groupBy: [] }],
      formulas: [],
      interval: 'auto',
      compareTo: 'none',
      display: 'lines',
    },
    ...overrides,
  };
}

describe('panelRegistry', () => {
  it('has entries for all panel types', () => {
    const types = [
      'time_series', 'single_stat', 'top_n_table', 'live_log_stream',
      'alert_status', 'metrics', 'trace_latency',
      'trace_volume', 'detection_events', 'monitor_status', 'system_status',
      'activity_overview', 'geo_map', 'log_table',
    ];
    for (const type of types) {
      expect(panelRegistry[type as keyof typeof panelRegistry]).toBeDefined();
      expect(panelRegistry[type as keyof typeof panelRegistry].defaultLayout.w).toBeGreaterThan(0);
      expect(panelRegistry[type as keyof typeof panelRegistry].defaultLayout.h).toBeGreaterThan(0);
    }
  });

  it('no longer registers the v1 metric panels', () => {
    expect(panelRegistry).not.toHaveProperty('metric_chart');
    expect(panelRegistry).not.toHaveProperty('metric_stat');
    for (const type of ['metric_chart', 'metric_stat']) {
      expect(panelConfigSchema.safeParse({ type, title: 'T', source: 'metrics' }).success).toBe(false);
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
  it('validates metrics config', () => {
    expect(() => panelConfigSchema.parse(metricsPanel())).not.toThrow();
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

describe('panel time range presets (#305)', () => {
  const configs: Record<string, Record<string, unknown>> = {
    time_series: {
      type: 'time_series', title: 'T', source: 'logs', projectId: null,
      interval: '24h', levels: ['info'], service: null,
    },
    top_n_table: {
      type: 'top_n_table', title: 'T', source: 'logs', dimension: 'service',
      limit: 5, projectId: null, interval: '24h',
    },
    geo_map: {
      type: 'geo_map', title: 'T', source: 'logs', projectId: null,
      interval: '24h', mode: 'country', limit: 100, fieldPrefix: 'geo',
      levels: [], service: null, hostname: null,
    },
    log_table: {
      type: 'log_table', title: 'T', source: 'logs', projectId: null,
      mode: 'snapshot', timeRange: '1h', levels: [], service: null,
      maxRows: 25, columns: [], builtinColumns: ['time', 'message'], wrapCells: false,
    },
    metrics: metricsPanel(),
    trace_latency: {
      type: 'trace_latency', title: 'T', source: 'traces', projectId: null,
      serviceName: null, timeRange: '24h', showPercentiles: ['p95'],
    },
    trace_volume: {
      type: 'trace_volume', title: 'T', source: 'traces', projectId: null,
      serviceName: null, timeRange: '24h', showErrors: true,
    },
    detection_events: {
      type: 'detection_events', title: 'T', source: 'detections', projectId: null,
      timeRange: '24h', severities: ['high'],
    },
    activity_overview: {
      type: 'activity_overview', title: 'T', source: 'mixed', projectId: null,
      timeRange: '24h', series: ['logs'],
    },
  };

  const timeField: Record<string, string> = {
    time_series: 'interval',
    top_n_table: 'interval',
    geo_map: 'interval',
    log_table: 'timeRange',
    metrics: 'timeRange',
    trace_latency: 'timeRange',
    trace_volume: 'timeRange',
    detection_events: 'timeRange',
    activity_overview: 'timeRange',
  };

  const presets = ['15m', '1h', '6h', '12h', '24h', '48h', '3d', '7d', '14d', '30d'];

  for (const [type, base] of Object.entries(configs)) {
    it(`accepts every shared preset on ${type}`, () => {
      for (const preset of presets) {
        const result = panelConfigSchema.safeParse({ ...base, [timeField[type]]: preset });
        expect(result.success, `${type} should accept ${preset}`).toBe(true);
      }
    });

    it(`rejects an unknown preset on ${type}`, () => {
      const result = panelConfigSchema.safeParse({ ...base, [timeField[type]]: '2h' });
      expect(result.success).toBe(false);
    });
  }
});

function qspec(overrides: Record<string, unknown> = {}) {
  return { id: 'A', metricName: 'cpu', aggregation: 'avg', filters: [], groupBy: [], ...overrides };
}

describe('metrics panel schema', () => {
  const parse = (query: Record<string, unknown>) =>
    panelConfigSchema.safeParse(metricsPanel({ query: { ...metricsPanel().query, ...query } }));

  it('accepts a full explorer query', () => {
    const r = parse({
      projectIds: ['11111111-1111-4111-8111-111111111111'],
      queries: [
        qspec({
          spaceAggregation: 'max',
          filters: [
            { scope: 'resource', key: 'host.name', op: 'in', values: ['a', 'b'] },
            { scope: 'metric', key: 'state', op: 'neq', values: ['idle'] },
            { scope: 'metric', key: 'mount', op: 'exists' },
            { scope: 'metric', key: 'latency', op: 'gte', values: ['0.5'] },
          ],
          groupBy: [{ scope: 'resource', key: 'host.name' }],
          limit: 20,
          hidden: true,
          label: 'CPU',
        }),
        qspec({ id: 'B', metricName: 'mem' }),
      ],
      formulas: [{ id: 'F1', expression: 'A / B * 100', label: 'ratio' }],
      interval: '15m',
      compareTo: '1w',
      display: 'table',
      unitOverride: '%',
    });
    expect(r.success).toBe(true);
  });

  it('requires 1 to 6 queries with unique ids A..F', () => {
    expect(parse({ queries: [] }).success).toBe(false);
    const seven = ['A', 'B', 'C', 'D', 'E', 'F', 'A'].map((id) => qspec({ id }));
    expect(parse({ queries: seven }).success).toBe(false);
    expect(parse({ queries: [qspec(), qspec()] }).success).toBe(false);
    expect(parse({ queries: [qspec({ id: 'G' })] }).success).toBe(false);
    const six = ['A', 'B', 'C', 'D', 'E', 'F'].map((id) => qspec({ id }));
    expect(parse({ queries: six }).success).toBe(true);
  });

  it('limits formulas to F1..F4 unique', () => {
    const f = (id: string) => ({ id, expression: 'A' });
    expect(parse({ formulas: [f('F1'), f('F2'), f('F3'), f('F4')] }).success).toBe(true);
    expect(parse({ formulas: [f('F1'), f('F2'), f('F3'), f('F4'), f('F5')] }).success).toBe(false);
    expect(parse({ formulas: [f('F1'), f('F1')] }).success).toBe(false);
    expect(parse({ formulas: [f('A')] }).success).toBe(false);
  });

  it('enforces filter value shapes per operator', () => {
    const ok = (op: string, values?: string[]) =>
      parse({ queries: [qspec({ filters: [{ scope: 'metric', key: 'k', op, values }] })] }).success;
    expect(ok('eq', ['a'])).toBe(true);
    expect(ok('eq', ['a', 'b'])).toBe(false);
    expect(ok('eq')).toBe(false);
    expect(ok('neq', ['a'])).toBe(true);
    expect(ok('in', ['a', 'b'])).toBe(true);
    expect(ok('in', [])).toBe(false);
    expect(ok('nin', ['a'])).toBe(true);
    expect(ok('exists')).toBe(true);
    expect(ok('exists', [])).toBe(true);
    expect(ok('exists', ['a'])).toBe(false);
    expect(ok('notExists', ['a'])).toBe(false);
    expect(ok('gte', ['3'])).toBe(true);
    expect(ok('gte', ['abc'])).toBe(false);
    expect(ok('lt', ['1', '2'])).toBe(false);
    expect(ok('regex')).toBe(false);
  });

  it('caps filters, group by and series limit', () => {
    const filters = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ scope: 'metric', key: `k${i}`, op: 'exists' }));
    expect(parse({ queries: [qspec({ filters: filters(10) })] }).success).toBe(true);
    expect(parse({ queries: [qspec({ filters: filters(11) })] }).success).toBe(false);
    const refs = (n: number) => Array.from({ length: n }, (_, i) => ({ scope: 'metric', key: `g${i}` }));
    expect(parse({ queries: [qspec({ groupBy: refs(3) })] }).success).toBe(true);
    expect(parse({ queries: [qspec({ groupBy: refs(4) })] }).success).toBe(false);
    expect(parse({ queries: [qspec({ limit: 50 })] }).success).toBe(true);
    expect(parse({ queries: [qspec({ limit: 51 })] }).success).toBe(false);
    expect(parse({ queries: [qspec({ limit: 0 })] }).success).toBe(false);
  });

  it('validates attribute keys (dots, dashes, slashes allowed, SQL characters not)', () => {
    const withKey = (key: string) =>
      parse({ queries: [qspec({ groupBy: [{ scope: 'resource', key }] })] }).success;
    for (const key of ['k8s.pod.name', 'a-b', 'app.kubernetes.io/name']) expect(withKey(key), key).toBe(true);
    for (const key of ["host'; DROP TABLE x;--", 'a b', '1abc', '', 'x"y']) {
      expect(withKey(key), key).toBe(false);
    }
  });

  it('validates scope, enums, project ids and unit override', () => {
    expect(parse({ queries: [qspec({ groupBy: [{ scope: 'other', key: 'k' }] })] }).success).toBe(false);
    expect(parse({ queries: [qspec({ aggregation: 'geomean' })] }).success).toBe(false);
    expect(parse({ queries: [qspec({ spaceAggregation: 'p95' })] }).success).toBe(false);
    expect(parse({ interval: '2m' }).success).toBe(false);
    expect(parse({ compareTo: '1y' }).success).toBe(false);
    expect(parse({ display: 'pie' }).success).toBe(false);
    expect(parse({ projectIds: ['nope'] }).success).toBe(false);
    expect(parse({ projectIds: null }).success).toBe(true);
    // Same limits as the explorer and alerts (metrics/query/schema.ts).
    expect(parse({ unitOverride: 'x'.repeat(33) }).success).toBe(false);
    expect(parse({ unitOverride: 'x'.repeat(32) }).success).toBe(true);
    // Unknown keys are stripped, not stored.
    const stripped = parse({ extra: 1 });
    expect(stripped.success).toBe(true);
    expect((stripped.data as { query: Record<string, unknown> }).query.extra).toBeUndefined();
  });
});

describe('dashboard variables', () => {
  const varDef = (over: Record<string, unknown> = {}) => ({
    name: 'host',
    label: 'Host',
    attr: { scope: 'resource', key: 'host.name' },
    default: null,
    ...over,
  });
  const refPanel = (value = '$host') =>
    metricsPanel({
      query: {
        ...metricsPanel().query,
        queries: [qspec({ filters: [{ scope: 'resource', key: 'host.name', op: 'eq', values: [value] }] })],
      },
    });
  const doc = (panels: unknown[], variables?: unknown[]) => ({
    schema_version: 2,
    panels: panels.map((config, i) => ({ id: `p${i}`, layout: { x: 0, y: 0, w: 4, h: 3 }, config })),
    ...(variables ? { variables } : {}),
  });

  it('accepts a declared variable referenced by a metrics filter', () => {
    expect(dashboardDocumentSchema.safeParse(doc([refPanel()], [varDef()])).success).toBe(true);
  });

  it('rejects a reference to an undeclared variable', () => {
    expect(dashboardDocumentSchema.safeParse(doc([refPanel()], [])).success).toBe(false);
    expect(dashboardDocumentSchema.safeParse(doc([refPanel()])).success).toBe(false);
    expect(dashboardDocumentSchema.safeParse(doc([refPanel('$other')], [varDef()])).success).toBe(false);
  });

  it('checks trace panel service variables too', () => {
    const trace = { type: 'trace_volume', title: 'T', source: 'traces', projectId: null, serviceName: '$service', timeRange: '24h', showErrors: true };
    expect(dashboardDocumentSchema.safeParse(doc([trace], [])).success).toBe(false);
    expect(
      dashboardDocumentSchema.safeParse(doc([trace], [varDef({ name: 'service', label: 'Service', attr: { scope: 'resource', key: 'service.name' } })])).success
    ).toBe(true);
  });

  it('validates names, uniqueness, count and attr shape', () => {
    const ok = (vars: unknown[]) => dashboardDocumentSchema.safeParse(doc([], vars)).success;
    expect(ok([varDef()])).toBe(true);
    expect(ok([varDef({ name: 'Host' })])).toBe(false);
    expect(ok([varDef({ name: '1host' })])).toBe(false);
    expect(ok([varDef({ name: 'a'.repeat(33) })])).toBe(false);
    expect(ok([varDef(), varDef()])).toBe(false);
    const five = ['a', 'b', 'c', 'd', 'e'].map((name) => varDef({ name }));
    expect(ok(five)).toBe(true);
    expect(ok([...five, varDef({ name: 'f' })])).toBe(false);
    expect(ok([varDef({ attr: { scope: 'nope', key: 'k' } })])).toBe(false);
    expect(ok([varDef({ attr: { scope: 'metric', key: 'bad key' } })])).toBe(false);
    expect(ok([varDef({ default: 'web-1', metricName: 'cpu' })])).toBe(true);
    expect(ok([varDef({ label: '' })])).toBe(false);
  });
});
