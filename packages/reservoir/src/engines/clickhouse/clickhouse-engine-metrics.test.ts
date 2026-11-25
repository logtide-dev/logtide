import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { StorageConfig, MetricRecord, MetricExemplar } from '../../core/types.js';

// Create mock functions
const mockInsert = vi.fn();
const mockQuery = vi.fn();
const mockCommand = vi.fn();
const mockClose = vi.fn();
const mockPing = vi.fn();

// Mock the @clickhouse/client module
vi.mock('@clickhouse/client', () => ({
  createClient: vi.fn(() => ({
    insert: mockInsert,
    query: mockQuery,
    command: mockCommand,
    close: mockClose,
    ping: mockPing,
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

function makeMetric(overrides: Partial<MetricRecord> = {}): MetricRecord {
  return {
    time: new Date('2024-01-01T00:00:00Z'),
    organizationId: 'org-1',
    projectId: 'proj-1',
    metricName: 'cpu.usage',
    metricType: 'gauge',
    value: 0.75,
    serviceName: 'api',
    attributes: { host: 'server-1' },
    resourceAttributes: { 'service.name': 'api' },
    ...overrides,
  };
}

function makeExemplar(overrides: Partial<MetricExemplar> = {}): MetricExemplar {
  return {
    exemplarValue: 0.95,
    exemplarTime: new Date('2024-01-01T00:00:01Z'),
    traceId: 'trace-ex-1',
    spanId: 'span-ex-1',
    attributes: { sampled: 'true' },
    ...overrides,
  };
}

// Helper to create mock query result
function mockQueryResult(data: unknown[]) {
  return {
    json: vi.fn().mockResolvedValue(data),
  };
}

describe('ClickHouseEngine metric operations (unit)', () => {
  let engine: ClickHouseEngine;

  beforeEach(async () => {
    vi.clearAllMocks();
    engine = new ClickHouseEngine(config);
    await engine.connect();
  });

  // ===========================================================================
  // ingestMetrics
  // ===========================================================================

  describe('ingestMetrics', () => {
    it('should return empty result for empty array', async () => {
      const result = await engine.ingestMetrics([]);

      expect(result).toEqual({ ingested: 0, failed: 0, durationMs: 0 });
      expect(mockInsert).not.toHaveBeenCalled();
    });

    it('should insert metrics with client.insert', async () => {
      mockInsert.mockResolvedValueOnce(undefined);
      const metric = makeMetric();

      const result = await engine.ingestMetrics([metric]);

      expect(result.ingested).toBe(1);
      expect(result.failed).toBe(0);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
      expect(mockInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          table: 'metrics',
          format: 'JSONEachRow',
        }),
      );
    });

    it('should convert time to epoch milliseconds', async () => {
      mockInsert.mockResolvedValueOnce(undefined);
      const metric = makeMetric({ time: new Date('2024-06-15T10:30:00Z') });

      await engine.ingestMetrics([metric]);

      const insertCall = mockInsert.mock.calls[0][0];
      const row = insertCall.values[0];
      expect(row.time).toBe(new Date('2024-06-15T10:30:00Z').getTime());
    });

    it('should convert is_monotonic to 1/0/null', async () => {
      mockInsert.mockResolvedValueOnce(undefined);

      const metrics = [
        makeMetric({ isMonotonic: true }),
        makeMetric({ isMonotonic: false }),
        makeMetric({ isMonotonic: undefined }),
      ];

      await engine.ingestMetrics(metrics);

      const insertCall = mockInsert.mock.calls[0][0];
      expect(insertCall.values[0].is_monotonic).toBe(1);
      expect(insertCall.values[1].is_monotonic).toBe(0);
      expect(insertCall.values[2].is_monotonic).toBeNull();
    });

    it('should JSON.stringify attributes and resource_attributes', async () => {
      mockInsert.mockResolvedValueOnce(undefined);
      const metric = makeMetric({
        attributes: { env: 'production', region: 'us-east' },
        resourceAttributes: { 'service.version': '2.0' },
      });

      await engine.ingestMetrics([metric]);

      const row = mockInsert.mock.calls[0][0].values[0];
      expect(row.attributes).toBe(JSON.stringify({ env: 'production', region: 'us-east' }));
      expect(row.resource_attributes).toBe(JSON.stringify({ 'service.version': '2.0' }));
    });

    it('should insert exemplars in a second insert when present', async () => {
      mockInsert.mockResolvedValueOnce(undefined); // metrics insert
      mockInsert.mockResolvedValueOnce(undefined); // exemplars insert

      const metric = makeMetric({
        exemplars: [makeExemplar()],
      });

      await engine.ingestMetrics([metric]);

      expect(mockInsert).toHaveBeenCalledTimes(2);

      // First call: metrics table
      expect(mockInsert.mock.calls[0][0].table).toBe('metrics');
      expect(mockInsert.mock.calls[0][0].values[0].has_exemplars).toBe(1);

      // Second call: metric_exemplars table
      expect(mockInsert.mock.calls[1][0].table).toBe('metric_exemplars');
      const exemplarRow = mockInsert.mock.calls[1][0].values[0];
      expect(exemplarRow.exemplar_value).toBe(0.95);
      expect(exemplarRow.trace_id).toBe('trace-ex-1');
      expect(exemplarRow.span_id).toBe('span-ex-1');
      expect(exemplarRow.attributes).toBe(JSON.stringify({ sampled: 'true' }));
    });

    it('should not insert exemplars when none present', async () => {
      mockInsert.mockResolvedValueOnce(undefined);

      const metric = makeMetric({ exemplars: undefined });

      await engine.ingestMetrics([metric]);

      expect(mockInsert).toHaveBeenCalledTimes(1);
      expect(mockInsert.mock.calls[0][0].table).toBe('metrics');
      expect(mockInsert.mock.calls[0][0].values[0].has_exemplars).toBe(0);
    });

    it('should handle insert errors gracefully', async () => {
      mockInsert.mockRejectedValueOnce(new Error('Connection refused'));

      const metrics = [makeMetric(), makeMetric()];
      const result = await engine.ingestMetrics(metrics);

      expect(result.ingested).toBe(0);
      expect(result.failed).toBe(2);
      expect(result.errors).toBeDefined();
      expect(result.errors![0].error).toBe('Connection refused');
    });
  });

  // ===========================================================================
  // queryMetrics
  // ===========================================================================

  describe('queryMetrics', () => {
    it('should query with time range and project filter', async () => {
      // count query
      mockQuery.mockResolvedValueOnce(mockQueryResult([{ count: '5' }]));
      // data query
      mockQuery.mockResolvedValueOnce(mockQueryResult([]));

      await engine.queryMetrics({
        projectId: 'proj-1',
        from: new Date('2024-01-01T00:00:00Z'),
        to: new Date('2024-01-02T00:00:00Z'),
      });

      const countQuery = mockQuery.mock.calls[0][0].query as string;
      expect(countQuery).toContain('SELECT count() AS count FROM metrics');
      expect(countQuery).toContain('project_id IN {p_pids:Array(String)}');
      expect(countQuery).toContain('time >=');
      expect(countQuery).toContain('time <=');

      const queryParams = mockQuery.mock.calls[0][0].query_params;
      expect(queryParams.p_pids).toEqual(['proj-1']);
      expect(queryParams.p_from).toBe(Math.floor(new Date('2024-01-01T00:00:00Z').getTime() / 1000));
    });

    it('should include optional metricName filter', async () => {
      mockQuery.mockResolvedValueOnce(mockQueryResult([{ count: '0' }]));
      mockQuery.mockResolvedValueOnce(mockQueryResult([]));

      await engine.queryMetrics({
        projectId: 'proj-1',
        metricName: 'cpu.usage',
        from: new Date('2024-01-01T00:00:00Z'),
        to: new Date('2024-01-02T00:00:00Z'),
      });

      const query = mockQuery.mock.calls[0][0].query as string;
      expect(query).toContain('metric_name IN {p_names:Array(String)}');
      expect(mockQuery.mock.calls[0][0].query_params.p_names).toEqual(['cpu.usage']);
    });

    it('should include optional metricType filter', async () => {
      mockQuery.mockResolvedValueOnce(mockQueryResult([{ count: '0' }]));
      mockQuery.mockResolvedValueOnce(mockQueryResult([]));

      await engine.queryMetrics({
        projectId: 'proj-1',
        metricType: 'gauge',
        from: new Date('2024-01-01T00:00:00Z'),
        to: new Date('2024-01-02T00:00:00Z'),
      });

      const query = mockQuery.mock.calls[0][0].query as string;
      expect(query).toContain('metric_type IN {p_types:Array(String)}');
      expect(mockQuery.mock.calls[0][0].query_params.p_types).toEqual(['gauge']);
    });

    it('should include optional serviceName filter', async () => {
      mockQuery.mockResolvedValueOnce(mockQueryResult([{ count: '0' }]));
      mockQuery.mockResolvedValueOnce(mockQueryResult([]));

      await engine.queryMetrics({
        projectId: 'proj-1',
        serviceName: 'api',
        from: new Date('2024-01-01T00:00:00Z'),
        to: new Date('2024-01-02T00:00:00Z'),
      });

      const query = mockQuery.mock.calls[0][0].query as string;
      expect(query).toContain('service_name IN {p_svc:Array(String)}');
      expect(mockQuery.mock.calls[0][0].query_params.p_svc).toEqual(['api']);
    });

    it('should include attribute filter using JSONExtractString', async () => {
      mockQuery.mockResolvedValueOnce(mockQueryResult([{ count: '0' }]));
      mockQuery.mockResolvedValueOnce(mockQueryResult([]));

      await engine.queryMetrics({
        projectId: 'proj-1',
        from: new Date('2024-01-01T00:00:00Z'),
        to: new Date('2024-01-02T00:00:00Z'),
        attributes: { host: 'server-1' },
      });

      const query = mockQuery.mock.calls[0][0].query as string;
      expect(query).toContain('JSONExtractString(attributes, {p_attr_key_0:String}) = {p_attr_val_0:String}');
      const params = mockQuery.mock.calls[0][0].query_params;
      expect(params.p_attr_key_0).toBe('host');
      expect(params.p_attr_val_0).toBe('server-1');
    });

    it('should handle pagination (limit/offset)', async () => {
      mockQuery.mockResolvedValueOnce(mockQueryResult([{ count: '10' }]));
      mockQuery.mockResolvedValueOnce(mockQueryResult([]));

      await engine.queryMetrics({
        projectId: 'proj-1',
        from: new Date('2024-01-01T00:00:00Z'),
        to: new Date('2024-01-02T00:00:00Z'),
        limit: 20,
        offset: 5,
      });

      const dataQuery = mockQuery.mock.calls[1][0].query as string;
      expect(dataQuery).toContain('LIMIT 20');
      expect(dataQuery).toContain('OFFSET 5');
    });

    it('should map ClickHouse rows to StoredMetricRecord', async () => {
      mockQuery.mockResolvedValueOnce(mockQueryResult([{ count: '1' }]));
      mockQuery.mockResolvedValueOnce(
        mockQueryResult([
          {
            id: 'metric-id-1',
            time: '1704067200',
            organization_id: 'org-1',
            project_id: 'proj-1',
            metric_name: 'cpu.usage',
            metric_type: 'gauge',
            value: 0.75,
            is_monotonic: null,
            service_name: 'api',
            attributes: '{"host":"server-1"}',
            resource_attributes: '{"service.name":"api"}',
            histogram_data: null,
            has_exemplars: 0,
          },
        ]),
      );

      const result = await engine.queryMetrics({
        projectId: 'proj-1',
        from: new Date('2024-01-01T00:00:00Z'),
        to: new Date('2024-01-02T00:00:00Z'),
      });

      expect(result.metrics).toHaveLength(1);
      const m = result.metrics[0];
      expect(m.id).toBe('metric-id-1');
      expect(m.metricName).toBe('cpu.usage');
      expect(m.metricType).toBe('gauge');
      expect(m.value).toBe(0.75);
      expect(m.serviceName).toBe('api');
      expect(m.attributes).toEqual({ host: 'server-1' });
      expect(m.hasExemplars).toBe(false);
    });

    it('should load exemplars when includeExemplars is true', async () => {
      mockQuery.mockResolvedValueOnce(mockQueryResult([{ count: '1' }]));
      mockQuery.mockResolvedValueOnce(
        mockQueryResult([
          {
            id: 'metric-id-1',
            time: '1704067200',
            organization_id: 'org-1',
            project_id: 'proj-1',
            metric_name: 'cpu.usage',
            metric_type: 'gauge',
            value: 0.75,
            is_monotonic: null,
            service_name: 'api',
            attributes: '{}',
            resource_attributes: '{}',
            histogram_data: null,
            has_exemplars: 1,
          },
        ]),
      );
      // exemplar query
      mockQuery.mockResolvedValueOnce(
        mockQueryResult([
          {
            metric_id: 'metric-id-1',
            exemplar_value: 0.95,
            exemplar_time: '1704067201',
            trace_id: 'trace-ex-1',
            span_id: 'span-ex-1',
            attributes: '{"sampled":"true"}',
          },
        ]),
      );

      const result = await engine.queryMetrics({
        projectId: 'proj-1',
        from: new Date('2024-01-01T00:00:00Z'),
        to: new Date('2024-01-02T00:00:00Z'),
        includeExemplars: true,
      });

      expect(mockQuery).toHaveBeenCalledTimes(3);
      const exemplarQuery = mockQuery.mock.calls[2][0].query as string;
      expect(exemplarQuery).toContain('SELECT * FROM metric_exemplars');
      expect(exemplarQuery).toContain('metric_id IN {p_mids:Array(String)}');

      expect(result.metrics[0].exemplars).toBeDefined();
      expect(result.metrics[0].exemplars![0].exemplarValue).toBe(0.95);
      expect(result.metrics[0].exemplars![0].traceId).toBe('trace-ex-1');
    });

    it('should not load exemplars when includeExemplars is false', async () => {
      mockQuery.mockResolvedValueOnce(mockQueryResult([{ count: '1' }]));
      mockQuery.mockResolvedValueOnce(
        mockQueryResult([
          {
            id: 'metric-id-1',
            time: '1704067200',
            organization_id: 'org-1',
            project_id: 'proj-1',
            metric_name: 'cpu.usage',
            metric_type: 'gauge',
            value: 0.75,
            is_monotonic: null,
            service_name: 'api',
            attributes: '{}',
            resource_attributes: '{}',
            histogram_data: null,
            has_exemplars: 1,
          },
        ]),
      );

      await engine.queryMetrics({
        projectId: 'proj-1',
        from: new Date('2024-01-01T00:00:00Z'),
        to: new Date('2024-01-02T00:00:00Z'),
        includeExemplars: false,
      });

      // Only count + data queries, no exemplar query
      expect(mockQuery).toHaveBeenCalledTimes(2);
    });

    it('should calculate hasMore correctly', async () => {
      mockQuery.mockResolvedValueOnce(mockQueryResult([{ count: '100' }]));
      mockQuery.mockResolvedValueOnce(
        mockQueryResult(
          Array.from({ length: 50 }, (_, i) => ({
            id: `m-${i}`,
            time: '1704067200',
            organization_id: 'org-1',
            project_id: 'proj-1',
            metric_name: 'cpu.usage',
            metric_type: 'gauge',
            value: i,
            is_monotonic: null,
            service_name: 'api',
            attributes: '{}',
            resource_attributes: '{}',
            histogram_data: null,
            has_exemplars: 0,
          })),
        ),
      );

      const result = await engine.queryMetrics({
        projectId: 'proj-1',
        from: new Date('2024-01-01T00:00:00Z'),
        to: new Date('2024-01-02T00:00:00Z'),
        limit: 50,
        offset: 0,
      });

      // total=100, offset(0) + rows.length(50) < total(100) => hasMore=true
      expect(result.hasMore).toBe(true);
      expect(result.total).toBe(100);
    });
  });

  // ===========================================================================
  // aggregateMetrics
  // ===========================================================================

  describe('aggregateMetrics', () => {
    const baseAggParams = {
      projectId: 'proj-1' as string | string[],
      metricName: 'cpu.usage',
      from: new Date('2024-01-01T00:00:00Z'),
      to: new Date('2024-01-02T00:00:00Z'),
      interval: '5m' as const,
    };

    it('should use avg aggregation', async () => {
      mockQuery.mockResolvedValueOnce(mockQueryResult([]));

      await engine.aggregateMetrics({
        ...baseAggParams,
        aggregation: 'avg',
        metricType: 'gauge',
      });

      const query = mockQuery.mock.calls[0][0].query as string;
      expect(query).toContain('avg(value) AS agg_value');
    });

    it('should use sum aggregation', async () => {
      mockQuery.mockResolvedValueOnce(mockQueryResult([]));

      await engine.aggregateMetrics({
        ...baseAggParams,
        aggregation: 'sum',
        metricType: 'gauge',
      });

      const query = mockQuery.mock.calls[0][0].query as string;
      expect(query).toContain('sum(value) AS agg_value');
    });

    it('should use count aggregation (count())', async () => {
      mockQuery.mockResolvedValueOnce(mockQueryResult([]));

      await engine.aggregateMetrics({
        ...baseAggParams,
        aggregation: 'count',
        metricType: 'gauge',
      });

      const query = mockQuery.mock.calls[0][0].query as string;
      expect(query).toContain('count() AS agg_value');
    });

    it('should use last aggregation (argMax)', async () => {
      mockQuery.mockResolvedValueOnce(mockQueryResult([]));

      await engine.aggregateMetrics({
        ...baseAggParams,
        aggregation: 'last',
        metricType: 'gauge',
      });

      const query = mockQuery.mock.calls[0][0].query as string;
      expect(query).toContain('argMax(value, time) AS agg_value');
    });

    it('should use toStartOfInterval for time bucketing', async () => {
      mockQuery.mockResolvedValueOnce(mockQueryResult([]));

      await engine.aggregateMetrics({
        ...baseAggParams,
        interval: '5m',
        aggregation: 'avg',
        metricType: 'gauge',
      });

      const query = mockQuery.mock.calls[0][0].query as string;
      expect(query).toContain('toStartOfInterval(time, INTERVAL 5 MINUTE) AS bucket');
    });

    it('should include groupBy with JSONExtractString', async () => {
      mockQuery.mockResolvedValueOnce(
        mockQueryResult([
          { bucket: '1704067200', agg_value: 0.8, label_0: 'server-1' },
        ]),
      );

      const result = await engine.aggregateMetrics({
        ...baseAggParams,
        aggregation: 'avg',
        metricType: 'gauge',
        groupBy: ['host'],
      });

      const query = mockQuery.mock.calls[0][0].query as string;
      expect(query).toContain('JSONExtractString(attributes, {p_gb_key_0:String}) AS label_0');
      expect(query).toContain('GROUP BY bucket, label_0');

      const params = mockQuery.mock.calls[0][0].query_params;
      expect(params.p_gb_key_0).toBe('host');

      expect(result.timeseries[0].labels).toEqual({ host: 'server-1' });
    });

    it('should query metric type when not provided', async () => {
      // aggregation query
      mockQuery.mockResolvedValueOnce(mockQueryResult([]));
      // type lookup query
      mockQuery.mockResolvedValueOnce(mockQueryResult([{ metric_type: 'sum' }]));

      const result = await engine.aggregateMetrics({
        ...baseAggParams,
        aggregation: 'avg',
        // no metricType
      });

      expect(mockQuery).toHaveBeenCalledTimes(2);
      const typeQuery = mockQuery.mock.calls[1][0].query as string;
      expect(typeQuery).toContain('SELECT metric_type FROM metrics');
      expect(typeQuery).toContain('metric_name = {p_name:String}');
      expect(result.metricType).toBe('sum');
    });

    it('should include attribute filtering', async () => {
      mockQuery.mockResolvedValueOnce(mockQueryResult([]));

      await engine.aggregateMetrics({
        ...baseAggParams,
        aggregation: 'avg',
        metricType: 'gauge',
        attributes: { region: 'us-east' },
      });

      const query = mockQuery.mock.calls[0][0].query as string;
      expect(query).toContain('JSONExtractString(attributes, {p_attr_key_0:String}) = {p_attr_val_0:String}');
      const params = mockQuery.mock.calls[0][0].query_params;
      expect(params.p_attr_key_0).toBe('region');
      expect(params.p_attr_val_0).toBe('us-east');
    });

    it('should use p50 aggregation (quantile 0.5)', async () => {
      mockQuery.mockResolvedValueOnce(mockQueryResult([]));

      await engine.aggregateMetrics({
        ...baseAggParams,
        aggregation: 'p50',
        metricType: 'gauge',
      });

      const query = mockQuery.mock.calls[0][0].query as string;
      expect(query).toContain('quantile(0.5)(value) AS agg_value');
    });

    it('should use p95 aggregation (quantile 0.95)', async () => {
      mockQuery.mockResolvedValueOnce(mockQueryResult([]));

      await engine.aggregateMetrics({
        ...baseAggParams,
        aggregation: 'p95',
        metricType: 'gauge',
      });

      const query = mockQuery.mock.calls[0][0].query as string;
      expect(query).toContain('quantile(0.95)(value) AS agg_value');
    });

    it('should use p99 aggregation (quantile 0.99)', async () => {
      mockQuery.mockResolvedValueOnce(mockQueryResult([]));

      await engine.aggregateMetrics({
        ...baseAggParams,
        aggregation: 'p99',
        metricType: 'gauge',
      });

      const query = mockQuery.mock.calls[0][0].query as string;
      expect(query).toContain('quantile(0.99)(value) AS agg_value');
    });
  });

  // ===========================================================================
  // aggregateMetrics with rollups
  // ===========================================================================

  describe('aggregateMetrics with rollups', () => {
    const baseRollupParams = {
      projectId: 'proj-1' as string | string[],
      metricName: 'cpu.usage',
      from: new Date('2024-01-01T00:00:00Z'),
      to: new Date('2024-01-02T00:00:00Z'),
      interval: '1h' as const,
    };

    it('should query from metrics_hourly_rollup for 1h interval with avg', async () => {
      mockQuery.mockResolvedValueOnce(
        mockQueryResult([
          { bucket: '2024-01-01 00:00:00.000', agg_value: 42.5, metric_type: 'gauge' },
          { bucket: '2024-01-01 01:00:00.000', agg_value: 43.1, metric_type: 'gauge' },
        ]),
      );

      const result = await engine.aggregateMetrics({
        projectId: 'proj-1',
        metricName: 'http.server.request.duration',
        from: new Date('2024-01-01T00:00:00Z'),
        to: new Date('2024-01-02T00:00:00Z'),
        interval: '1h',
        aggregation: 'avg',
      });

      const query = mockQuery.mock.calls[0][0].query as string;
      expect(query).toContain('metrics_hourly_rollup');
      expect(query).toContain('sum(value_sum) / sum(point_count)');
      expect(result.timeseries).toHaveLength(2);
    });

    it('should query from metrics_daily_rollup for 1d interval', async () => {
      mockQuery.mockResolvedValueOnce(
        mockQueryResult([
          { bucket: '2024-01-01 00:00:00.000', agg_value: 100, metric_type: 'gauge' },
        ]),
      );

      await engine.aggregateMetrics({
        projectId: 'proj-1',
        metricName: 'cpu.usage',
        from: new Date('2024-01-01T00:00:00Z'),
        to: new Date('2024-01-08T00:00:00Z'),
        interval: '1d',
        aggregation: 'max',
      });

      const query = mockQuery.mock.calls[0][0].query as string;
      expect(query).toContain('metrics_daily_rollup');
      expect(query).toContain('max(max_value)');
    });

    it('should use sum(value_sum) for sum aggregation', async () => {
      mockQuery.mockResolvedValueOnce(
        mockQueryResult([
          { bucket: '2024-01-01 00:00:00.000', agg_value: 500, metric_type: 'sum' },
        ]),
      );

      await engine.aggregateMetrics({
        projectId: 'proj-1',
        metricName: 'http.requests',
        from: new Date('2024-01-01T00:00:00Z'),
        to: new Date('2024-01-02T00:00:00Z'),
        interval: '1h',
        aggregation: 'sum',
      });

      const query = mockQuery.mock.calls[0][0].query as string;
      expect(query).toContain('metrics_hourly_rollup');
      expect(query).toContain('sum(value_sum)');
    });

    it('should use sum(point_count) for count aggregation', async () => {
      mockQuery.mockResolvedValueOnce(
        mockQueryResult([
          { bucket: '2024-01-01 00:00:00.000', agg_value: 1000, metric_type: 'gauge' },
        ]),
      );

      await engine.aggregateMetrics({
        projectId: 'proj-1',
        metricName: 'http.requests',
        from: new Date('2024-01-01T00:00:00Z'),
        to: new Date('2024-01-02T00:00:00Z'),
        interval: '1h',
        aggregation: 'count',
      });

      const query = mockQuery.mock.calls[0][0].query as string;
      expect(query).toContain('metrics_hourly_rollup');
      expect(query).toContain('sum(point_count)');
    });

    it('should fall back to raw table for "last" aggregation', async () => {
      mockQuery.mockResolvedValueOnce(mockQueryResult([]));

      await engine.aggregateMetrics({
        ...baseRollupParams,
        aggregation: 'last',
        metricType: 'gauge',
      });

      const query = mockQuery.mock.calls[0][0].query as string;
      expect(query).not.toContain('metrics_hourly_rollup');
      expect(query).toContain('argMax(value, time)');
    });

    it('should fall back to raw table for p50 aggregation', async () => {
      mockQuery.mockResolvedValueOnce(mockQueryResult([]));

      await engine.aggregateMetrics({
        ...baseRollupParams,
        aggregation: 'p50',
        metricType: 'gauge',
      });

      const query = mockQuery.mock.calls[0][0].query as string;
      expect(query).not.toContain('metrics_hourly_rollup');
      expect(query).toContain('quantile(0.5)(value)');
    });

    it('should fall back to raw table for p95 aggregation', async () => {
      mockQuery.mockResolvedValueOnce(mockQueryResult([]));

      await engine.aggregateMetrics({
        ...baseRollupParams,
        aggregation: 'p95',
        metricType: 'gauge',
      });

      const query = mockQuery.mock.calls[0][0].query as string;
      expect(query).not.toContain('metrics_hourly_rollup');
      expect(query).toContain('quantile(0.95)(value)');
    });

    it('should fall back to raw table for p99 aggregation', async () => {
      mockQuery.mockResolvedValueOnce(mockQueryResult([]));

      await engine.aggregateMetrics({
        ...baseRollupParams,
        aggregation: 'p99',
        metricType: 'gauge',
      });

      const query = mockQuery.mock.calls[0][0].query as string;
      expect(query).not.toContain('metrics_hourly_rollup');
      expect(query).toContain('quantile(0.99)(value)');
    });

    it('should fall back to raw table when groupBy is used', async () => {
      mockQuery.mockResolvedValueOnce(mockQueryResult([]));

      await engine.aggregateMetrics({
        ...baseRollupParams,
        aggregation: 'avg',
        metricType: 'gauge',
        groupBy: ['http.method'],
      });

      const query = mockQuery.mock.calls[0][0].query as string;
      expect(query).not.toContain('metrics_hourly_rollup');
    });

    it('should fall back to raw table when attributes filter is used', async () => {
      mockQuery.mockResolvedValueOnce(mockQueryResult([]));

      await engine.aggregateMetrics({
        ...baseRollupParams,
        aggregation: 'avg',
        metricType: 'gauge',
        attributes: { 'http.method': 'GET' },
      });

      const query = mockQuery.mock.calls[0][0].query as string;
      expect(query).not.toContain('metrics_hourly_rollup');
    });

    it('should use raw table for 5m interval', async () => {
      mockQuery.mockResolvedValueOnce(mockQueryResult([]));

      await engine.aggregateMetrics({
        ...baseRollupParams,
        interval: '5m',
        aggregation: 'avg',
        metricType: 'gauge',
      });

      const query = mockQuery.mock.calls[0][0].query as string;
      expect(query).not.toContain('metrics_hourly_rollup');
    });

    it('should include service name filter in rollup query', async () => {
      mockQuery.mockResolvedValueOnce(
        mockQueryResult([
          { bucket: '2024-01-01 00:00:00.000', agg_value: 42.5, metric_type: 'gauge' },
        ]),
      );

      await engine.aggregateMetrics({
        projectId: 'proj-1',
        metricName: 'http.requests',
        from: new Date('2024-01-01T00:00:00Z'),
        to: new Date('2024-01-02T00:00:00Z'),
        interval: '1h',
        aggregation: 'avg',
        serviceName: 'api',
      });

      const query = mockQuery.mock.calls[0][0].query as string;
      expect(query).toContain('metrics_hourly_rollup');
      expect(query).toContain('service_name IN {p_services:Array(String)}');
      expect(mockQuery.mock.calls[0][0].query_params.p_services).toEqual(['api']);
    });
  });

  // ===========================================================================
  // getMetricNames
  // ===========================================================================

  describe('getMetricNames', () => {
    it('should return metric names grouped by name and type', async () => {
      mockQuery.mockResolvedValueOnce(
        mockQueryResult([
          { metric_name: 'cpu.usage', metric_type: 'gauge' },
          { metric_name: 'http.requests', metric_type: 'sum' },
        ]),
      );

      const result = await engine.getMetricNames({ projectId: 'proj-1' });

      expect(result.names).toHaveLength(2);
      expect(result.names[0]).toEqual({ name: 'cpu.usage', type: 'gauge' });
      expect(result.names[1]).toEqual({ name: 'http.requests', type: 'sum' });

      const query = mockQuery.mock.calls[0][0].query as string;
      expect(query).toContain('SELECT metric_name, metric_type FROM metrics');
      expect(query).toContain('GROUP BY metric_name, metric_type');
      expect(query).toContain('ORDER BY metric_name ASC');
    });

    it('should include time range filters when provided', async () => {
      mockQuery.mockResolvedValueOnce(mockQueryResult([]));

      await engine.getMetricNames({
        projectId: 'proj-1',
        from: new Date('2024-01-01T00:00:00Z'),
        to: new Date('2024-01-02T00:00:00Z'),
      });

      const query = mockQuery.mock.calls[0][0].query as string;
      expect(query).toContain('time >= {p_from:DateTime64(3)}');
      expect(query).toContain('time <= {p_to:DateTime64(3)}');
    });
  });

  // ===========================================================================
  // getMetricLabelKeys
  // ===========================================================================

  describe('getMetricLabelKeys', () => {
    it('should return keys using arrayJoin(JSONExtractKeys(...))', async () => {
      mockQuery.mockResolvedValueOnce(
        mockQueryResult([
          { key: 'host' },
          { key: 'region' },
        ]),
      );

      const result = await engine.getMetricLabelKeys({
        projectId: 'proj-1',
        metricName: 'cpu.usage',
      });

      expect(result.keys).toEqual(['host', 'region']);

      const query = mockQuery.mock.calls[0][0].query as string;
      expect(query).toContain('SELECT DISTINCT arrayJoin(JSONExtractKeys(attributes)) AS key');
      expect(query).toContain('FROM metrics');
    });

    it('should include project and metric name filters', async () => {
      mockQuery.mockResolvedValueOnce(mockQueryResult([]));

      await engine.getMetricLabelKeys({
        projectId: 'proj-1',
        metricName: 'cpu.usage',
      });

      const query = mockQuery.mock.calls[0][0].query as string;
      expect(query).toContain('project_id IN {p_pids:Array(String)}');
      expect(query).toContain('metric_name = {p_name:String}');
      const params = mockQuery.mock.calls[0][0].query_params;
      expect(params.p_pids).toEqual(['proj-1']);
      expect(params.p_name).toBe('cpu.usage');
    });
  });

  // ===========================================================================
  // getMetricLabelValues
  // ===========================================================================

  describe('getMetricLabelValues', () => {
    it('should return values as the scalar text of the attribute', async () => {
      mockQuery.mockResolvedValueOnce(
        mockQueryResult([
          { val: 'server-1' },
          { val: 'server-2' },
        ]),
      );

      const result = await engine.getMetricLabelValues(
        { projectId: 'proj-1', metricName: 'cpu.usage' },
        'host',
      );

      expect(result.values).toEqual(['server-1', 'server-2']);

      const query = mockQuery.mock.calls[0][0].query as string;
      expect(query).toContain("SELECT DISTINCT ifNull(multiIf(JSONExtractRaw(attributes, {p_label_key:String}) = ''");
      expect(query).toContain("), '') AS val");
      expect(query).toContain('FROM metrics');
      expect(mockQuery.mock.calls[0][0].query_params.p_label_key).toBe('host');
    });

    it('should include HAVING val != \'\' in query', async () => {
      mockQuery.mockResolvedValueOnce(mockQueryResult([]));

      await engine.getMetricLabelValues(
        { projectId: 'proj-1', metricName: 'cpu.usage' },
        'host',
      );

      const query = mockQuery.mock.calls[0][0].query as string;
      expect(query).toContain("HAVING val != ''");
    });
  });

  // ===========================================================================
  // deleteMetricsByTimeRange
  // ===========================================================================

  describe('deleteMetricsByTimeRange', () => {
    it('should use ALTER TABLE DELETE for metrics', async () => {
      mockCommand.mockResolvedValueOnce(undefined); // metrics delete
      mockCommand.mockResolvedValueOnce(undefined); // exemplars delete

      await engine.deleteMetricsByTimeRange({
        projectId: 'proj-1',
        from: new Date('2024-01-01T00:00:00Z'),
        to: new Date('2024-01-02T00:00:00Z'),
      });

      const metricsCmd = mockCommand.mock.calls[0][0].query as string;
      expect(metricsCmd).toContain('ALTER TABLE metrics DELETE WHERE');
      expect(metricsCmd).toContain('project_id IN {p_pids:Array(String)}');
      expect(metricsCmd).toContain('time >= {p_from:DateTime64(3)}');
      expect(metricsCmd).toContain('time <= {p_to:DateTime64(3)}');
    });

    it('should also delete from metric_exemplars', async () => {
      mockCommand.mockResolvedValueOnce(undefined);
      mockCommand.mockResolvedValueOnce(undefined);

      await engine.deleteMetricsByTimeRange({
        projectId: 'proj-1',
        from: new Date('2024-01-01T00:00:00Z'),
        to: new Date('2024-01-02T00:00:00Z'),
      });

      expect(mockCommand).toHaveBeenCalledTimes(2);

      const exemplarCmd = mockCommand.mock.calls[1][0].query as string;
      expect(exemplarCmd).toContain('ALTER TABLE metric_exemplars DELETE WHERE');
      expect(exemplarCmd).toContain('project_id IN {p_pids:Array(String)}');
      expect(exemplarCmd).toContain('time >= {p_from:DateTime64(3)}');
      expect(exemplarCmd).toContain('time <= {p_to:DateTime64(3)}');
    });

    it('should return deleted: 0 (ClickHouse mutations are async)', async () => {
      mockCommand.mockResolvedValueOnce(undefined);
      mockCommand.mockResolvedValueOnce(undefined);

      const result = await engine.deleteMetricsByTimeRange({
        projectId: 'proj-1',
        from: new Date('2024-01-01T00:00:00Z'),
        to: new Date('2024-01-02T00:00:00Z'),
      });

      expect(result.deleted).toBe(0);
      expect(result.executionTimeMs).toBeGreaterThanOrEqual(0);
    });
  });

  // ===========================================================================
  // getMetricsOverview
  // ===========================================================================

  describe('getMetricsOverview', () => {
    // getMetricsOverview now issues a second query (latest value from raw metrics)
    // alongside the rollup query. Default any un-queued call to an empty result so
    // the per-test mockResolvedValueOnce drives the first (rollup) query and the
    // latest query falls through to empty.
    beforeEach(() => {
      mockQuery.mockResolvedValue(mockQueryResult([]));
    });

    it('should return metrics grouped by service', async () => {
      mockQuery.mockResolvedValueOnce(
        mockQueryResult([
          { metric_name: 'http.requests', mt: 'sum', service_name: 'api', total_points: 100, avg_val: 5.2, mn: 1, mx: 10 },
          { metric_name: 'cpu.usage', mt: 'gauge', service_name: 'api', total_points: 50, avg_val: 65.3, mn: 20, mx: 95 },
          { metric_name: 'http.requests', mt: 'sum', service_name: 'worker', total_points: 30, avg_val: 2.1, mn: 0, mx: 8 },
        ]),
      );

      const result = await engine.getMetricsOverview({
        projectId: 'proj-1',
        from: new Date('2024-01-01T00:00:00Z'),
        to: new Date('2024-01-02T00:00:00Z'),
      });

      expect(result.services).toHaveLength(2);
      expect(result.services[0].serviceName).toBe('api');
      expect(result.services[0].metrics).toHaveLength(2);
      expect(result.services[1].serviceName).toBe('worker');
      expect(result.services[1].metrics).toHaveLength(1);
      expect(result.executionTimeMs).toBeGreaterThanOrEqual(0);
    });

    it('should filter by serviceName', async () => {
      mockQuery.mockResolvedValueOnce(mockQueryResult([]));

      await engine.getMetricsOverview({
        projectId: 'proj-1',
        from: new Date('2024-01-01T00:00:00Z'),
        to: new Date('2024-01-02T00:00:00Z'),
        serviceName: 'api',
      });

      const query = mockQuery.mock.calls[0][0].query as string;
      expect(query).toContain('service_name');
      const params = mockQuery.mock.calls[0][0].query_params;
      expect(params.p_service).toBe('api');
    });

    it('should return empty services when no data', async () => {
      mockQuery.mockResolvedValueOnce(mockQueryResult([]));

      const result = await engine.getMetricsOverview({
        projectId: 'proj-1',
        from: new Date('2024-01-01T00:00:00Z'),
        to: new Date('2024-01-02T00:00:00Z'),
      });

      expect(result.services).toHaveLength(0);
    });

    it('should query from metrics_hourly_rollup', async () => {
      mockQuery.mockResolvedValueOnce(
        mockQueryResult([
          { metric_name: 'cpu.usage', mt: 'gauge', service_name: 'api', total_points: 50, avg_val: 65.3, mn: 20, mx: 95 },
        ]),
      );

      await engine.getMetricsOverview({
        projectId: 'proj-1',
        from: new Date('2024-01-01T00:00:00Z'),
        to: new Date('2024-01-02T00:00:00Z'),
      });

      const query = mockQuery.mock.calls[0][0].query as string;
      expect(query).toContain('metrics_hourly_rollup');
    });

    it('should map metric fields correctly', async () => {
      mockQuery.mockResolvedValueOnce(
        mockQueryResult([
          { metric_name: 'http.duration', mt: 'gauge', service_name: 'gateway', total_points: 200, avg_val: 42.5, mn: 1.2, mx: 150.7 },
        ]),
      );

      const result = await engine.getMetricsOverview({
        projectId: 'proj-1',
        from: new Date('2024-01-01T00:00:00Z'),
        to: new Date('2024-01-02T00:00:00Z'),
      });

      const metric = result.services[0].metrics[0];
      expect(metric.metricName).toBe('http.duration');
      expect(metric.metricType).toBe('gauge');
      expect(metric.serviceName).toBe('gateway');
      expect(metric.avgValue).toBe(42.5);
      expect(metric.minValue).toBe(1.2);
      expect(metric.maxValue).toBe(150.7);
      expect(metric.pointCount).toBe(200);
    });

    it('should include project filter in query', async () => {
      mockQuery.mockResolvedValueOnce(mockQueryResult([]));

      await engine.getMetricsOverview({
        projectId: 'proj-1',
        from: new Date('2024-01-01T00:00:00Z'),
        to: new Date('2024-01-02T00:00:00Z'),
      });

      const query = mockQuery.mock.calls[0][0].query as string;
      expect(query).toContain('project_id IN');
      const params = mockQuery.mock.calls[0][0].query_params;
      expect(params.p_pids).toEqual(['proj-1']);
    });
  });
});
