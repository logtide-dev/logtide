// Query shape of the 1.8 metric attribute contract on ClickHouse
// (groupByAttrs, filters, resource-scope labels, metric sources). Mocked client.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MetricAttrFilter, StorageConfig } from '../../core/types.js';
import { compileMetricAttrFilters } from './metric-attrs.js';

const mockQuery = vi.fn();

vi.mock('@clickhouse/client', () => ({
  createClient: vi.fn(() => ({
    insert: vi.fn(),
    query: mockQuery,
    command: vi.fn(),
    close: vi.fn(),
    ping: vi.fn(),
  })),
}));

import { ClickHouseEngine } from './clickhouse-engine.js';

const config: StorageConfig = {
  host: 'localhost',
  port: 8123,
  database: 'logtide_test',
  username: 'default',
  password: '',
};

function rows(data: unknown[]) {
  return { json: vi.fn().mockResolvedValue(data) };
}

function lastCall(): { query: string; query_params: Record<string, unknown> } {
  return mockQuery.mock.calls[0][0];
}

const base = {
  projectId: 'proj-1',
  metricName: 'system.cpu.utilization',
  metricType: 'gauge' as const,
  from: new Date('2026-01-01T00:00:00Z'),
  to: new Date('2026-01-01T01:00:00Z'),
  aggregation: 'avg' as const,
};

describe('compileMetricAttrFilters', () => {
  const compile = (f: MetricAttrFilter) => {
    const params: Record<string, unknown> = {};
    const [sql] = compileMetricAttrFilters([f], params, 'p_mf');
    return { sql, params };
  };
  const scalar = (col: string) =>
    `multiIf(JSONExtractRaw(${col}, {p_mfk0:String}) = '' OR JSONExtractRaw(${col}, {p_mfk0:String}) = 'null'`;

  it('eq binds key and value, resource scope reads resource_attributes', () => {
    const { sql, params } = compile({ scope: 'resource', key: 'host.name', op: 'eq', values: ['web-1'] });
    expect(sql.startsWith(`ifNull(${scalar('resource_attributes')}`)).toBe(true);
    expect(sql.endsWith(' = {p_mfv0:String}, 0)')).toBe(true);
    // Literal key: one parameter, never split on dots
    expect(params).toEqual({ p_mfk0: 'host.name', p_mfv0: 'web-1' });
  });

  it('neq and nin keep points lacking the key', () => {
    const neq = compile({ scope: 'metric', key: 'state', op: 'neq', values: ['idle'] });
    expect(neq.sql).toMatch(/^\(NOT \(\(JSONHas\(attributes, \{p_mfk0:String\}\) AND JSONExtractRaw\(attributes, \{p_mfk0:String\}\) != 'null'\)\) OR ifNull\(.* != \{p_mfv0:String\}, 1\)\)$/);
    const nin = compile({ scope: 'metric', key: 'state', op: 'nin', values: ['idle', 'wait'] });
    expect(nin.sql).toMatch(/^\(NOT \(\(JSONHas\(attributes, \{p_mfk0:String\}\) AND JSONExtractRaw\(attributes, \{p_mfk0:String\}\) != 'null'\)\) OR ifNull\(.* NOT IN \{p_mfv0:Array\(String\)\}, 1\)\)$/);
    expect(nin.params.p_mfv0).toEqual(['idle', 'wait']);
  });

  it('in uses an array parameter, empty lists short-circuit', () => {
    const inF = compile({ scope: 'metric', key: 'state', op: 'in', values: ['a', 'b'] });
    expect(inF.sql).toMatch(/ IN \{p_mfv0:Array\(String\)\}, 0\)$/);
    expect(compile({ scope: 'metric', key: 'state', op: 'in', values: [] }).sql).toBe('0');
    expect(compile({ scope: 'metric', key: 'state', op: 'nin', values: [] }).sql).toBe('1');
  });

  it('exists and notExists use JSONHas and treat JSON null as missing', () => {
    expect(compile({ scope: 'resource', key: 'k8s.pod.name', op: 'exists' }).sql).toBe(
      "(JSONHas(resource_attributes, {p_mfk0:String}) AND JSONExtractRaw(resource_attributes, {p_mfk0:String}) != 'null')",
    );
    expect(compile({ scope: 'metric', key: 'cpu', op: 'notExists' }).sql).toBe("NOT ((JSONHas(attributes, {p_mfk0:String}) AND JSONExtractRaw(attributes, {p_mfk0:String}) != 'null'))");
  });

  it('gte and lt compare numerically with toFloat64OrNull', () => {
    const gte = compile({ scope: 'metric', key: 'http.status_code', op: 'gte', values: ['500'] });
    expect(gte.sql).toMatch(/^ifNull\(toFloat64OrNull\(.*\) >= \{p_mfv0:Float64\}, 0\)$/);
    expect(gte.params.p_mfv0).toBe(500);
    const lt = compile({ scope: 'metric', key: 'http.status_code', op: 'lt', values: ['1.5'] });
    expect(lt.sql).toMatch(/\) < \{p_mfv0:Float64\}, 0\)$/);
    expect(compile({ scope: 'metric', key: 'x', op: 'gte', values: ['abc'] }).sql).toBe('0');
    expect(compile({ scope: 'metric', key: 'x', op: 'lt', values: [] }).sql).toBe('0');
  });
});

describe('ClickHouseEngine 1.8 metric attributes (unit)', () => {
  let engine: ClickHouseEngine;

  beforeEach(async () => {
    vi.clearAllMocks();
    engine = new ClickHouseEngine(config);
    await engine.connect();
  });

  describe('aggregateMetrics', () => {
    it('keeps project and window in PREWHERE', async () => {
      mockQuery.mockResolvedValueOnce(rows([]));
      await engine.aggregateMetrics({ ...base, interval: '5m' });
      expect(lastCall().query).toContain(
        'FROM metrics PREWHERE project_id IN {p_pids:Array(String)} AND time >= {p_from:DateTime64(3)} AND time <= {p_to:DateTime64(3)} WHERE metric_name = {p_name:String}',
      );
    });

    it('groups by legacy keys then attribute refs, labels keyed by metricAttrLabel', async () => {
      mockQuery.mockResolvedValueOnce(
        rows([{ bucket: '2026-01-01 00:00:00.000', agg_value: 1.5, label_0: 'idle', label_attr_0: 'web-1', label_attr_1: '' }]),
      );
      const result = await engine.aggregateMetrics({
        ...base,
        interval: '5m',
        groupBy: ['state'],
        groupByAttrs: [
          { scope: 'resource', key: 'host.name' },
          { scope: 'metric', key: 'cpu' },
        ],
      });
      const { query, query_params } = lastCall();
      expect(query).toContain("AS label_attr_0");
      expect(query).toContain('JSONExtractRaw(resource_attributes, {p_gba_key_0:String})');
      expect(query).toContain('JSONExtractRaw(attributes, {p_gba_key_1:String})');
      expect(query).toContain('GROUP BY bucket, label_0, label_attr_0, label_attr_1');
      expect(query_params.p_gba_key_0).toBe('host.name');
      expect(query_params.p_gba_key_1).toBe('cpu');
      expect(result.timeseries[0].labels).toEqual({ state: 'idle', 'resource.host.name': 'web-1', cpu: '' });
    });

    it('ANDs filters into WHERE', async () => {
      mockQuery.mockResolvedValueOnce(rows([]));
      await engine.aggregateMetrics({
        ...base,
        interval: '5m',
        filters: [
          { scope: 'resource', key: 'host.name', op: 'eq', values: ['web-1'] },
          { scope: 'metric', key: 'state', op: 'neq', values: ['idle'] },
        ],
      });
      const { query, query_params } = lastCall();
      const where = query.slice(query.indexOf(' WHERE '));
      expect(where).toContain("= {p_mfv0:String}, 0) AND (NOT ((JSONHas(attributes, {p_mfk1:String}) AND JSONExtractRaw(attributes, {p_mfk1:String}) != 'null'))");
      expect(query_params).toMatchObject({ p_mfk0: 'host.name', p_mfv0: 'web-1', p_mfk1: 'state', p_mfv1: 'idle' });
    });

    it('skips the rollup when groupByAttrs or filters are present', async () => {
      mockQuery.mockResolvedValue(rows([]));
      await engine.aggregateMetrics({ ...base, interval: '1h', groupByAttrs: [{ scope: 'resource', key: 'host.name' }] });
      await engine.aggregateMetrics({ ...base, interval: '1d', filters: [{ scope: 'metric', key: 'cpu', op: 'exists' }] });
      for (const call of mockQuery.mock.calls) {
        expect(call[0].query).not.toContain('rollup');
        expect(call[0].query).toContain('FROM metrics PREWHERE');
      }
      mockQuery.mockReset();
    });

    it('still uses the rollup without attribute options', async () => {
      mockQuery.mockResolvedValueOnce(rows([]));
      await engine.aggregateMetrics({ ...base, interval: '1h', groupByAttrs: [], filters: [] });
      expect(lastCall().query).toContain('FROM metrics_hourly_rollup');
    });
  });

  describe('aggregateMetrics hist_last / hist_sum', () => {
    const hrow = {
      bucket: '2026-01-01 00:00:00.000',
      label_attr_0: 'api',
      h_bounds: [10, 100],
      h_counts: [3, 5, 1],
      h_sum: 350,
      h_count: 9,
    };

    it('hist_last takes argMax by time per length class, then the latest class, never a rollup', async () => {
      mockQuery.mockResolvedValueOnce(rows([hrow]));
      const result = await engine.aggregateMetrics({
        ...base,
        metricType: 'histogram',
        interval: '1h',
        aggregation: 'hist_last',
        groupByAttrs: [{ scope: 'resource', key: 'service.name' }],
      });
      const { query } = lastCall();
      expect(query).not.toContain('rollup');
      expect(query).toContain('FROM metrics PREWHERE');
      expect(query).toContain("JSONExtract(ifNull(histogram_data, ''), 'bucket_counts', 'Array(Float64)')");
      expect(query).toContain('argMax(tuple(h_bounds, h_counts, h_sum, h_count, h_grid), time) AS h_class');
      expect(query).toContain('GROUP BY bucket, label_attr_0, h_grid, h_bounds, length(h_counts)');
      expect(query).toContain('argMax(h_class, last_t) AS picked');
      expect(result.timeseries).toEqual([{
        bucket: new Date('2026-01-01T00:00:00.000Z'),
        value: 9,
        labels: { 'resource.service.name': 'api' },
        histogram: { bounds: [10, 100], counts: [3, 5, 1], sum: 350, count: 9 },
      }]);
    });

    it('hist_sum uses sumForEach and keeps filters in WHERE', async () => {
      mockQuery.mockResolvedValueOnce(rows([{ ...hrow, label_attr_0: undefined }]));
      const result = await engine.aggregateMetrics({
        ...base,
        metricType: 'histogram',
        interval: '5m',
        aggregation: 'hist_sum',
        filters: [{ scope: 'metric', key: 'http.route', op: 'eq', values: ['/a'] }],
      });
      const { query, query_params } = lastCall();
      expect(query).toContain('tuple(any(h_bounds), sumForEach(h_counts), sum(h_sum), sum(h_count), any(h_grid)) AS h_class');
      expect(query).toContain("length(JSONExtract(ifNull(histogram_data, ''), 'bucket_counts', 'Array(Float64)')) = length(JSONExtract(ifNull(histogram_data, ''), 'explicit_bounds', 'Array(Float64)')) + 1");
      expect(query).toContain('GROUP BY bucket, h_grid, h_bounds, length(h_counts)');
      expect(query_params).toMatchObject({ p_mfk0: 'http.route', p_mfv0: '/a' });
      expect(result.timeseries[0].histogram).toEqual({ bounds: [10, 100], counts: [3, 5, 1], sum: 350, count: 9 });
      expect(result.timeseries[0].value).toBe(9);
    });

    it('grid points: the grid id is part of the class and comes back with empty bounds', async () => {
      mockQuery.mockResolvedValueOnce(rows([{ ...hrow, label_attr_0: undefined, h_bounds: [], h_grid: 'exp2-s2-v1' }]));
      const result = await engine.aggregateMetrics({ ...base, metricType: 'exp_histogram', interval: '5m', aggregation: 'hist_sum' });
      const { query } = lastCall();
      expect(query).toContain("JSONExtractString(ifNull(histogram_data, ''), 'grid') AS h_grid");
      expect(query).toContain("if(h_grid != '', emptyArrayFloat64(), JSONExtract(ifNull(histogram_data, ''), 'explicit_bounds', 'Array(Float64)')) AS h_bounds");
      expect(query).toContain("(JSONExtractString(ifNull(histogram_data, ''), 'grid') != '' OR (JSONHas(ifNull(histogram_data, ''), 'explicit_bounds') AND");
      expect(query).toContain('tupleElement(picked, 5) AS h_grid');
      expect(result.timeseries[0].histogram).toEqual({ bounds: [], grid: 'exp2-s2-v1', counts: [3, 5, 1], sum: 350, count: 9 });
    });

    it('an empty h_grid (explicit bounds class) sets no grid', async () => {
      mockQuery.mockResolvedValueOnce(rows([{ ...hrow, label_attr_0: undefined, h_grid: '' }]));
      const result = await engine.aggregateMetrics({ ...base, metricType: 'histogram', interval: '5m', aggregation: 'hist_last' });
      expect(result.timeseries[0].histogram).toEqual({ bounds: [10, 100], counts: [3, 5, 1], sum: 350, count: 9 });
    });
  });

  describe('getMetricNames with filters', () => {
    it('keeps project and window in PREWHERE and ANDs filters into WHERE', async () => {
      mockQuery.mockResolvedValueOnce(rows([{ metric_name: 'system.cpu.utilization', metric_type: 'gauge' }]));
      const result = await engine.getMetricNames({
        projectId: 'proj-1',
        from: base.from,
        to: base.to,
        filters: [{ scope: 'resource', key: 'host.name', op: 'eq', values: ['web-1'] }],
      });
      const { query, query_params } = lastCall();
      expect(result.names).toEqual([{ name: 'system.cpu.utilization', type: 'gauge' }]);
      expect(query).toContain(
        'FROM metrics PREWHERE project_id IN {p_pids:Array(String)} AND time >= {p_from:DateTime64(3)} AND time <= {p_to:DateTime64(3)} WHERE ifNull(',
      );
      expect(query).toContain('JSONExtractRaw(resource_attributes, {p_mfk0:String})');
      expect(query).toContain('GROUP BY metric_name, metric_type');
      expect(query_params).toMatchObject({ p_mfk0: 'host.name', p_mfv0: 'web-1' });
    });

    it('has no WHERE without filters, organization or type', async () => {
      mockQuery.mockResolvedValueOnce(rows([]));
      await engine.getMetricNames({ projectId: 'proj-1' });
      const { query } = lastCall();
      expect(query).toContain('FROM metrics PREWHERE project_id IN {p_pids:Array(String)} GROUP BY');
      expect(query).not.toContain(' WHERE ');
    });
  });

  describe('labels with resource scope', () => {
    it('keys read resource_attributes and an empty metric name means every metric', async () => {
      mockQuery.mockResolvedValueOnce(rows([{ key: 'host.name' }]));
      const result = await engine.getMetricLabelKeys({ projectId: 'proj-1', metricName: '', scope: 'resource', from: base.from, to: base.to });
      const { query, query_params } = lastCall();
      expect(result.keys).toEqual(['host.name']);
      expect(query).toContain('arrayJoin(JSONExtractKeys(resource_attributes))');
      expect(query).toContain('PREWHERE project_id IN {p_pids:Array(String)} AND time >= {p_from:DateTime64(3)} AND time <= {p_to:DateTime64(3)}');
      expect(query).not.toContain('metric_name');
      expect(query_params.p_name).toBeUndefined();
    });

    it('keys with resource scope and a metric name filter by name', async () => {
      mockQuery.mockResolvedValueOnce(rows([]));
      await engine.getMetricLabelKeys({ projectId: 'proj-1', metricName: 'cpu', scope: 'resource' });
      expect(lastCall().query).toContain('WHERE metric_name = {p_name:String}');
    });

    it('metric scope with an empty metric name also means every metric', async () => {
      mockQuery.mockResolvedValueOnce(rows([]));
      await engine.getMetricLabelKeys({ projectId: 'proj-1', metricName: '' });
      expect(lastCall().query).toContain('JSONExtractKeys(attributes)');
      expect(lastCall().query).not.toContain('metric_name');
      expect(lastCall().query_params.p_name).toBeUndefined();
    });

    it('values read resource_attributes by literal key', async () => {
      mockQuery.mockResolvedValueOnce(rows([{ val: 'web-1' }]));
      const result = await engine.getMetricLabelValues({ projectId: 'proj-1', metricName: '', scope: 'resource' }, 'host.name');
      const { query, query_params } = lastCall();
      expect(result.values).toEqual(['web-1']);
      expect(query).toContain('JSONExtractRaw(resource_attributes, {p_label_key:String})');
      expect(query).toContain("HAVING val != ''");
      expect(query).not.toContain('metric_name');
      expect(query_params.p_label_key).toBe('host.name');
    });
  });

  describe('getMetricSources', () => {
    it('builds one grouped query bounded by project and window', async () => {
      mockQuery.mockResolvedValueOnce(
        rows([
          {
            source: 'web-1',
            project_ids: ['p1', 'p2'],
            last_seen: '2026-01-01 00:59:00.000',
            metric_count: '3',
            point_count: '120',
            co_0: ['linux'],
            co_1: [],
          },
        ]),
      );
      const result = await engine.getMetricSources({
        projectId: ['p1', 'p2'],
        organizationId: 'org-1',
        from: base.from,
        to: base.to,
        key: 'host.name',
        includeMetricPrefixes: ['system.', 'hw.'],
        excludeMetricPrefixes: ['system.network.'],
        coKeys: ['os.type', 'service.name'],
      });
      const { query, query_params } = lastCall();
      expect(query).toContain('FROM metrics PREWHERE project_id IN {p_pids:Array(String)} AND time >= {p_from:DateTime64(3)} AND time <= {p_to:DateTime64(3)} WHERE ');
      expect(query).toContain('JSONExtractRaw(resource_attributes, {p_src_key:String})');
      expect(query).toContain('arraySort(groupUniqArray(project_id)) AS project_ids');
      expect(query).toContain('max(time) AS last_seen');
      expect(query).toContain('uniqExact(metric_name) AS metric_count');
      expect(query).toContain('count() AS point_count');
      expect(query).toContain('arraySort(groupUniqArrayIf(20)(');
      expect(query).toContain(') AS co_1');
      expect(query).toContain('(startsWith(metric_name, {p_inc_0:String}) OR startsWith(metric_name, {p_inc_1:String}))');
      expect(query).toContain('NOT startsWith(metric_name, {p_exc_0:String})');
      expect(query).toContain('organization_id IN {p_oids:Array(String)}');
      expect(query).toContain('GROUP BY source ORDER BY source ASC LIMIT {p_limit:UInt32}');
      expect(query_params).toMatchObject({
        p_src_key: 'host.name',
        p_inc_0: 'system.',
        p_inc_1: 'hw.',
        p_exc_0: 'system.network.',
        p_co_key_0: 'os.type',
        p_co_key_1: 'service.name',
        p_limit: 500,
      });
      expect(result.sources).toEqual([
        {
          value: 'web-1',
          projectIds: ['p1', 'p2'],
          lastSeen: new Date('2026-01-01T00:59:00.000Z'),
          metricCount: 3,
          pointCount: 120,
          co: { 'os.type': ['linux'], 'service.name': [] },
        },
      ]);
    });

    it('omits optional clauses and honours the limit', async () => {
      mockQuery.mockResolvedValueOnce(rows([]));
      const result = await engine.getMetricSources({ projectId: 'p1', from: base.from, to: base.to, key: 'service.name', limit: 10 });
      const { query, query_params } = lastCall();
      expect(result.sources).toEqual([]);
      expect(query).not.toContain('startsWith(metric_name');
      expect(query).not.toContain('organization_id');
      expect(query).not.toContain('co_0');
      expect(query).toContain('count() AS point_count FROM metrics');
      expect(query_params.p_limit).toBe(10);
    });
  });
});
