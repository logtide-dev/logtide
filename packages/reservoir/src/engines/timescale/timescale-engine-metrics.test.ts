import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { StorageConfig, MetricRecord, MetricExemplar } from '../../core/types.js';

const mockQuery = vi.fn();
const mockEnd = vi.fn();

vi.mock('pg', () => {
  return {
    default: {
      Pool: vi.fn(function () {
        return {
          query: mockQuery,
          end: mockEnd,
        };
      }),
    },
  };
});

import { TimescaleEngine } from './timescale-engine.js';

const config: StorageConfig = {
  host: 'localhost',
  port: 5432,
  database: 'logtide',
  username: 'logtide',
  password: 'secret',
  schema: 'public',
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

describe('TimescaleEngine - Metrics', () => {
  let engine: TimescaleEngine;

  beforeEach(() => {
    vi.clearAllMocks();
    engine = new TimescaleEngine(config);
  });

  // =========================================================================
  // ingestMetrics
  // =========================================================================

  describe('ingestMetrics', () => {
    it('should return empty result for empty array without calling query', async () => {
      await engine.connect();
      const result = await engine.ingestMetrics([]);
      expect(result.ingested).toBe(0);
      expect(result.failed).toBe(0);
      expect(result.durationMs).toBe(0);
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('should insert metrics using UNNEST batch insert', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'metric-1', time: new Date('2024-01-01T00:00:00Z') }],
      });
      await engine.connect();

      const result = await engine.ingestMetrics([makeMetric()]);

      expect(result.ingested).toBe(1);
      expect(result.failed).toBe(0);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);

      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).toContain('INSERT INTO public.metrics');
      expect(sql).toContain('UNNEST');
      expect(sql).toContain('RETURNING id, time');
    });

    it('should include all 12 column arrays in UNNEST parameters', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'metric-1', time: new Date('2024-01-01T00:00:00Z') }],
      });
      await engine.connect();

      await engine.ingestMetrics([makeMetric()]);

      const params = mockQuery.mock.calls[0][1] as unknown[];
      expect(params.length).toBe(12);

      // Verify individual arrays
      // $1: times
      expect((params[0] as Date[])[0]).toEqual(new Date('2024-01-01T00:00:00Z'));
      // $2: orgIds
      expect((params[1] as string[])[0]).toBe('org-1');
      // $3: projectIds
      expect((params[2] as string[])[0]).toBe('proj-1');
      // $4: metricNames
      expect((params[3] as string[])[0]).toBe('cpu.usage');
      // $5: metricTypes
      expect((params[4] as string[])[0]).toBe('gauge');
      // $6: values
      expect((params[5] as number[])[0]).toBe(0.75);
      // $7: isMonotonics
      expect((params[6] as (boolean | null)[])[0]).toBeNull();
      // $8: serviceNames
      expect((params[7] as string[])[0]).toBe('api');
      // $9: attributes JSON
      expect((params[8] as (string | null)[])[0]).toBe(JSON.stringify({ host: 'server-1' }));
      // $10: resourceAttributes JSON
      expect((params[9] as (string | null)[])[0]).toBe(JSON.stringify({ 'service.name': 'api' }));
      // $11: histogramData JSON
      expect((params[10] as (string | null)[])[0]).toBeNull();
      // $12: hasExemplars flags
      expect((params[11] as boolean[])[0]).toBe(false);
    });

    it('should set has_exemplars flag to true when exemplars present', async () => {
      const metric = makeMetric({
        exemplars: [{ exemplarValue: 1.5, traceId: 'trace-1', spanId: 'span-1' }],
      });
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'metric-1', time: new Date('2024-01-01T00:00:00Z') }],
      });
      // Exemplar insert
      mockQuery.mockResolvedValueOnce({ rows: [] });
      await engine.connect();

      await engine.ingestMetrics([metric]);

      const params = mockQuery.mock.calls[0][1] as unknown[];
      // $12: hasExemplars flags
      expect((params[11] as boolean[])[0]).toBe(true);
    });

    it('should insert exemplars in a second query when present', async () => {
      const exemplar: MetricExemplar = {
        exemplarValue: 1.5,
        exemplarTime: new Date('2024-01-01T00:00:01Z'),
        traceId: 'trace-1',
        spanId: 'span-1',
        attributes: { key: 'val' },
      };
      const metric = makeMetric({ exemplars: [exemplar] });

      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'metric-1', time: new Date('2024-01-01T00:00:00Z') }],
      });
      mockQuery.mockResolvedValueOnce({ rows: [] });
      await engine.connect();

      await engine.ingestMetrics([metric]);

      expect(mockQuery).toHaveBeenCalledTimes(2);

      // Second call is exemplar insert
      const exSql = mockQuery.mock.calls[1][0] as string;
      expect(exSql).toContain('INSERT INTO public.metric_exemplars');
      expect(exSql).toContain('UNNEST');

      const exParams = mockQuery.mock.calls[1][1] as unknown[];
      expect(exParams.length).toBe(9);

      // Verify exemplar data
      // $1: times (from metric row)
      expect((exParams[0] as Date[])[0]).toEqual(new Date('2024-01-01T00:00:00Z'));
      // $2: metricIds
      expect((exParams[1] as string[])[0]).toBe('metric-1');
      // $3: orgIds
      expect((exParams[2] as string[])[0]).toBe('org-1');
      // $4: projectIds
      expect((exParams[3] as string[])[0]).toBe('proj-1');
      // $5: exemplarValues
      expect((exParams[4] as number[])[0]).toBe(1.5);
      // $6: exemplarTimes
      expect((exParams[5] as (Date | null)[])[0]).toEqual(new Date('2024-01-01T00:00:01Z'));
      // $7: traceIds
      expect((exParams[6] as (string | null)[])[0]).toBe('trace-1');
      // $8: spanIds
      expect((exParams[7] as (string | null)[])[0]).toBe('span-1');
      // $9: attributes JSON
      expect((exParams[8] as (string | null)[])[0]).toBe(JSON.stringify({ key: 'val' }));
    });

    it('should not insert exemplars when none present (only 1 query call)', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'metric-1', time: new Date('2024-01-01T00:00:00Z') }],
      });
      await engine.connect();

      await engine.ingestMetrics([makeMetric()]);

      expect(mockQuery).toHaveBeenCalledTimes(1);
    });

    it('should handle insert errors gracefully', async () => {
      mockQuery.mockRejectedValueOnce(new Error('disk full'));
      await engine.connect();

      const result = await engine.ingestMetrics([makeMetric(), makeMetric()]);

      expect(result.ingested).toBe(0);
      expect(result.failed).toBe(2);
      expect(result.errors).toHaveLength(1);
      expect(result.errors![0].error).toBe('disk full');
    });

    it('should serialize attributes and histogram_data as JSON strings', async () => {
      const histData = { sum: 10, count: 5, min: 1, max: 3 };
      const metric = makeMetric({
        attributes: { env: 'prod' },
        histogramData: histData,
      });

      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'metric-1', time: new Date('2024-01-01T00:00:00Z') }],
      });
      await engine.connect();

      await engine.ingestMetrics([metric]);

      const params = mockQuery.mock.calls[0][1] as unknown[];
      // $9: attributes JSON
      expect((params[8] as (string | null)[])[0]).toBe(JSON.stringify({ env: 'prod' }));
      // $11: histogramData JSON
      expect((params[10] as (string | null)[])[0]).toBe(JSON.stringify(histData));
    });
  });

  // =========================================================================
  // queryMetrics
  // =========================================================================

  describe('queryMetrics', () => {
    const defaultRow = {
      id: 'metric-1',
      time: new Date('2024-01-01T00:00:00Z'),
      organization_id: 'org-1',
      project_id: 'proj-1',
      metric_name: 'cpu.usage',
      metric_type: 'gauge',
      value: 0.75,
      is_monotonic: null,
      service_name: 'api',
      attributes: { host: 'server-1' },
      resource_attributes: { 'service.name': 'api' },
      histogram_data: null,
      has_exemplars: false,
    };

    it('should query with time range and project filter', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ count: 1 }] });
      mockQuery.mockResolvedValueOnce({ rows: [defaultRow] });
      await engine.connect();

      const result = await engine.queryMetrics({
        projectId: 'proj-1',
        from: new Date('2024-01-01'),
        to: new Date('2024-01-02'),
      });

      expect(result.metrics).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.executionTimeMs).toBeGreaterThanOrEqual(0);

      const countSql = mockQuery.mock.calls[0][0] as string;
      expect(countSql).toContain('COUNT(*)');
      expect(countSql).toContain('public.metrics');
      expect(countSql).toContain('m.time >=');
      expect(countSql).toContain('m.time <=');
      expect(countSql).toContain('m.project_id = ANY');

      const dataSql = mockQuery.mock.calls[1][0] as string;
      expect(dataSql).toContain('FROM public.metrics m');
      expect(dataSql).toContain('LIMIT');
      expect(dataSql).toContain('OFFSET');
    });

    it('should include optional metricName filter', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ count: 0 }] });
      mockQuery.mockResolvedValueOnce({ rows: [] });
      await engine.connect();

      await engine.queryMetrics({
        projectId: 'proj-1',
        metricName: 'cpu.usage',
        from: new Date('2024-01-01'),
        to: new Date('2024-01-02'),
      });

      const countSql = mockQuery.mock.calls[0][0] as string;
      expect(countSql).toContain('m.metric_name = ANY');
    });

    it('should include optional metricType filter', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ count: 0 }] });
      mockQuery.mockResolvedValueOnce({ rows: [] });
      await engine.connect();

      await engine.queryMetrics({
        projectId: 'proj-1',
        metricType: 'gauge',
        from: new Date('2024-01-01'),
        to: new Date('2024-01-02'),
      });

      const countSql = mockQuery.mock.calls[0][0] as string;
      expect(countSql).toContain('m.metric_type = ANY');
    });

    it('should include optional serviceName filter', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ count: 0 }] });
      mockQuery.mockResolvedValueOnce({ rows: [] });
      await engine.connect();

      await engine.queryMetrics({
        projectId: 'proj-1',
        serviceName: 'api',
        from: new Date('2024-01-01'),
        to: new Date('2024-01-02'),
      });

      const countSql = mockQuery.mock.calls[0][0] as string;
      expect(countSql).toContain('m.service_name = ANY');
    });

    it('should include optional attributes jsonb filter', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ count: 0 }] });
      mockQuery.mockResolvedValueOnce({ rows: [] });
      await engine.connect();

      await engine.queryMetrics({
        projectId: 'proj-1',
        attributes: { host: 'server-1' },
        from: new Date('2024-01-01'),
        to: new Date('2024-01-02'),
      });

      const countSql = mockQuery.mock.calls[0][0] as string;
      expect(countSql).toContain('m.attributes @>');
      expect(countSql).toContain('::jsonb');

      const countParams = mockQuery.mock.calls[0][1] as unknown[];
      expect(countParams).toContain(JSON.stringify({ host: 'server-1' }));
    });

    it('should handle pagination (limit/offset)', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ count: 100 }] });
      mockQuery.mockResolvedValueOnce({ rows: [defaultRow] });
      await engine.connect();

      const result = await engine.queryMetrics({
        projectId: 'proj-1',
        from: new Date('2024-01-01'),
        to: new Date('2024-01-02'),
        limit: 20,
        offset: 40,
      });

      expect(result.limit).toBe(20);
      expect(result.offset).toBe(40);

      const dataParams = mockQuery.mock.calls[1][1] as unknown[];
      // Last two params should be limit and offset
      expect(dataParams[dataParams.length - 2]).toBe(20);
      expect(dataParams[dataParams.length - 1]).toBe(40);
    });

    it('should map DB rows to StoredMetricRecord', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ count: 1 }] });
      mockQuery.mockResolvedValueOnce({ rows: [defaultRow] });
      await engine.connect();

      const result = await engine.queryMetrics({
        projectId: 'proj-1',
        from: new Date('2024-01-01'),
        to: new Date('2024-01-02'),
      });

      const metric = result.metrics[0];
      expect(metric.id).toBe('metric-1');
      expect(metric.time).toEqual(new Date('2024-01-01T00:00:00Z'));
      expect(metric.organizationId).toBe('org-1');
      expect(metric.projectId).toBe('proj-1');
      expect(metric.metricName).toBe('cpu.usage');
      expect(metric.metricType).toBe('gauge');
      expect(metric.value).toBe(0.75);
      expect(metric.serviceName).toBe('api');
      expect(metric.attributes).toEqual({ host: 'server-1' });
      expect(metric.resourceAttributes).toEqual({ 'service.name': 'api' });
      expect(metric.hasExemplars).toBe(false);
    });

    it('should load exemplars when includeExemplars is true (3 queries)', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ count: 1 }] });
      mockQuery.mockResolvedValueOnce({ rows: [{ ...defaultRow, has_exemplars: true }] });
      mockQuery.mockResolvedValueOnce({
        rows: [{
          metric_id: 'metric-1',
          exemplar_value: 1.5,
          exemplar_time: new Date('2024-01-01T00:00:01Z'),
          trace_id: 'trace-1',
          span_id: 'span-1',
          attributes: { key: 'val' },
        }],
      });
      await engine.connect();

      const result = await engine.queryMetrics({
        projectId: 'proj-1',
        from: new Date('2024-01-01'),
        to: new Date('2024-01-02'),
        includeExemplars: true,
      });

      expect(mockQuery).toHaveBeenCalledTimes(3);

      const exSql = mockQuery.mock.calls[2][0] as string;
      expect(exSql).toContain('metric_exemplars');
      expect(exSql).toContain('metric_id = ANY');

      const metric = result.metrics[0];
      expect(metric.hasExemplars).toBe(true);
      expect(metric.exemplars).toHaveLength(1);
      expect(metric.exemplars![0].exemplarValue).toBe(1.5);
      expect(metric.exemplars![0].traceId).toBe('trace-1');
    });

    it('should not load exemplars when includeExemplars is false (2 queries)', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ count: 1 }] });
      mockQuery.mockResolvedValueOnce({ rows: [defaultRow] });
      await engine.connect();

      await engine.queryMetrics({
        projectId: 'proj-1',
        from: new Date('2024-01-01'),
        to: new Date('2024-01-02'),
        includeExemplars: false,
      });

      expect(mockQuery).toHaveBeenCalledTimes(2);
    });

    it('should calculate hasMore correctly', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ count: 100 }] });
      mockQuery.mockResolvedValueOnce({ rows: [defaultRow] });
      await engine.connect();

      const result = await engine.queryMetrics({
        projectId: 'proj-1',
        from: new Date('2024-01-01'),
        to: new Date('2024-01-02'),
        limit: 50,
        offset: 0,
      });

      // offset(0) + rows.length(1) < total(100) → hasMore = true
      expect(result.hasMore).toBe(true);
    });
  });

  // =========================================================================
  // aggregateMetrics
  // =========================================================================

  describe('aggregateMetrics', () => {
    const baseParams = {
      projectId: 'proj-1' as string | string[],
      metricName: 'cpu.usage',
      from: new Date('2024-01-01'),
      to: new Date('2024-01-02'),
      interval: '5m' as const,
    };

    it('should query with time_bucket and AVG aggregation', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          { bucket: new Date('2024-01-01T00:00:00Z'), agg_value: 0.5 },
          { bucket: new Date('2024-01-01T01:00:00Z'), agg_value: 0.8 },
        ],
      });
      await engine.connect();

      const result = await engine.aggregateMetrics({
        ...baseParams,
        aggregation: 'avg',
      });

      expect(result.metricName).toBe('cpu.usage');
      expect(result.timeseries).toHaveLength(2);
      expect(result.timeseries[0].bucket).toEqual(new Date('2024-01-01T00:00:00Z'));
      expect(result.timeseries[0].value).toBe(0.5);
      expect(result.timeseries[1].value).toBe(0.8);
      expect(result.executionTimeMs).toBeGreaterThanOrEqual(0);

      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).toContain('time_bucket($1, time)');
      expect(sql).toContain('AVG(value)');
      expect(sql).toContain('GROUP BY');
      expect(sql).toContain('ORDER BY bucket ASC');

      const params = mockQuery.mock.calls[0][1] as unknown[];
      expect(params[0]).toBe('5 minutes');
    });

    it('should use SUM aggregation', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ bucket: new Date('2024-01-01T00:00:00Z'), agg_value: 10 }],
      });
      await engine.connect();

      await engine.aggregateMetrics({
        ...baseParams,
        aggregation: 'sum',
      });

      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).toContain('SUM(value)');
    });

    it('should use MIN aggregation', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ bucket: new Date('2024-01-01T00:00:00Z'), agg_value: 0.1 }],
      });
      await engine.connect();

      await engine.aggregateMetrics({
        ...baseParams,
        aggregation: 'min',
      });

      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).toContain('MIN(value)');
    });

    it('should use MAX aggregation', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ bucket: new Date('2024-01-01T00:00:00Z'), agg_value: 0.99 }],
      });
      await engine.connect();

      await engine.aggregateMetrics({
        ...baseParams,
        aggregation: 'max',
      });

      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).toContain('MAX(value)');
    });

    it('should use COUNT aggregation', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ bucket: new Date('2024-01-01T00:00:00Z'), agg_value: 42 }],
      });
      await engine.connect();

      await engine.aggregateMetrics({
        ...baseParams,
        aggregation: 'count',
      });

      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).toContain('COUNT(*)');
    });

    it('should use last aggregation (array_agg)', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ bucket: new Date('2024-01-01T00:00:00Z'), agg_value: 0.9 }],
      });
      await engine.connect();

      await engine.aggregateMetrics({
        ...baseParams,
        aggregation: 'last',
      });

      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).toContain('(array_agg(value ORDER BY time DESC))[1]');
    });

    it('should use percentile_cont for p50 aggregation', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ bucket: new Date('2024-01-01T00:00:00Z'), agg_value: 0.45 }],
      });
      await engine.connect();

      await engine.aggregateMetrics({ ...baseParams, aggregation: 'p50' });
      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).toContain('percentile_cont(0.5) WITHIN GROUP (ORDER BY value)');
    });

    it('should use percentile_cont for p95 aggregation', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ bucket: new Date('2024-01-01T00:00:00Z'), agg_value: 0.95 }],
      });
      await engine.connect();

      await engine.aggregateMetrics({ ...baseParams, aggregation: 'p95' });
      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).toContain('percentile_cont(0.95) WITHIN GROUP (ORDER BY value)');
    });

    it('should use percentile_cont for p99 aggregation', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ bucket: new Date('2024-01-01T00:00:00Z'), agg_value: 0.99 }],
      });
      await engine.connect();

      await engine.aggregateMetrics({ ...baseParams, aggregation: 'p99' });
      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).toContain('percentile_cont(0.99) WITHIN GROUP (ORDER BY value)');
    });

    it('should include groupBy columns', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          { bucket: new Date('2024-01-01T00:00:00Z'), agg_value: 0.5, label_0: 'server-1' },
          { bucket: new Date('2024-01-01T00:00:00Z'), agg_value: 0.8, label_0: 'server-2' },
        ],
      });
      await engine.connect();

      await engine.aggregateMetrics({
        ...baseParams,
        aggregation: 'avg',
        groupBy: ['host'],
      });

      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).toContain('attributes->>');
      expect(sql).toContain('AS label_0');
      expect(sql).toContain('GROUP BY bucket, label_0');

      const params = mockQuery.mock.calls[0][1] as unknown[];
      expect(params).toContain('host');
    });

    it('should include attribute filtering', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ bucket: new Date('2024-01-01T00:00:00Z'), agg_value: 0.5 }],
      });
      await engine.connect();

      await engine.aggregateMetrics({
        ...baseParams,
        aggregation: 'avg',
        attributes: { env: 'prod' },
      });

      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).toContain('attributes @>');
      expect(sql).toContain('::jsonb');

      const params = mockQuery.mock.calls[0][1] as unknown[];
      expect(params).toContain(JSON.stringify({ env: 'prod' }));
    });

    it('should return timeseries with labels when groupBy is used', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          { bucket: new Date('2024-01-01T00:00:00Z'), agg_value: 0.5, label_0: 'server-1' },
          { bucket: new Date('2024-01-01T01:00:00Z'), agg_value: 0.8, label_0: 'server-2' },
        ],
      });
      await engine.connect();

      const result = await engine.aggregateMetrics({
        ...baseParams,
        aggregation: 'avg',
        groupBy: ['host'],
      });

      expect(result.timeseries).toHaveLength(2);
      expect(result.timeseries[0].labels).toEqual({ host: 'server-1' });
      expect(result.timeseries[1].labels).toEqual({ host: 'server-2' });
    });
  });

  // =========================================================================
  // aggregateMetrics with rollups
  // =========================================================================

  describe('aggregateMetrics with rollups', () => {
    it('should query from metrics_hourly_stats for 1h interval with avg', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          { bucket: '2024-01-01T00:00:00Z', agg_value: 42.5 },
          { bucket: '2024-01-01T01:00:00Z', agg_value: 43.1 },
        ],
      });
      await engine.connect();

      const result = await engine.aggregateMetrics({
        projectId: 'proj-1',
        metricName: 'http.server.request.duration',
        metricType: 'gauge',
        from: new Date('2024-01-01T00:00:00Z'),
        to: new Date('2024-01-02T00:00:00Z'),
        interval: '1h',
        aggregation: 'avg',
      });

      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).toContain('metrics_hourly_stats');
      expect(sql).toContain('avg_value');
      expect(result.timeseries).toHaveLength(2);
    });

    it('should query from metrics_daily_stats for 1d interval', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ bucket: '2024-01-01T00:00:00Z', agg_value: 100 }],
      });
      await engine.connect();

      await engine.aggregateMetrics({
        projectId: 'proj-1',
        metricName: 'cpu.usage',
        metricType: 'gauge',
        from: new Date('2024-01-01T00:00:00Z'),
        to: new Date('2024-01-08T00:00:00Z'),
        interval: '1d',
        aggregation: 'max',
      });

      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).toContain('metrics_daily_stats');
      expect(sql).toContain('max_value');
    });

    it('should use sum_value column for sum aggregation', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ bucket: '2024-01-01T00:00:00Z', agg_value: 500 }],
      });
      await engine.connect();

      await engine.aggregateMetrics({
        projectId: 'proj-1',
        metricName: 'http.requests',
        metricType: 'sum',
        from: new Date('2024-01-01T00:00:00Z'),
        to: new Date('2024-01-02T00:00:00Z'),
        interval: '1h',
        aggregation: 'sum',
      });

      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).toContain('metrics_hourly_stats');
      expect(sql).toContain('sum_value');
    });

    it('should use point_count column for count aggregation', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ bucket: '2024-01-01T00:00:00Z', agg_value: 1000 }],
      });
      await engine.connect();

      await engine.aggregateMetrics({
        projectId: 'proj-1',
        metricName: 'http.requests',
        metricType: 'sum',
        from: new Date('2024-01-01T00:00:00Z'),
        to: new Date('2024-01-02T00:00:00Z'),
        interval: '1h',
        aggregation: 'count',
      });

      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).toContain('metrics_hourly_stats');
      expect(sql).toContain('point_count');
    });

    it('should fall back to raw table for "last" aggregation', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ bucket: new Date('2024-01-01T00:00:00Z'), agg_value: 10 }],
      });
      await engine.connect();

      await engine.aggregateMetrics({
        projectId: 'proj-1',
        metricName: 'cpu.usage',
        from: new Date('2024-01-01T00:00:00Z'),
        to: new Date('2024-01-02T00:00:00Z'),
        interval: '1h',
        aggregation: 'last',
      });

      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).not.toContain('metrics_hourly_stats');
    });

    it('should fall back to raw table for p50 aggregation', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ bucket: new Date('2024-01-01T00:00:00Z'), agg_value: 0.5 }],
      });
      await engine.connect();

      await engine.aggregateMetrics({
        projectId: 'proj-1',
        metricName: 'cpu.usage',
        from: new Date('2024-01-01T00:00:00Z'),
        to: new Date('2024-01-02T00:00:00Z'),
        interval: '1h' as const,
        aggregation: 'p50',
      });
      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).toContain('time_bucket');
      expect(sql).not.toContain('metrics_hourly_stats');
    });

    it('should fall back to raw table when groupBy is used', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [],
      });
      await engine.connect();

      await engine.aggregateMetrics({
        projectId: 'proj-1',
        metricName: 'http.requests',
        from: new Date('2024-01-01T00:00:00Z'),
        to: new Date('2024-01-02T00:00:00Z'),
        interval: '1h',
        aggregation: 'avg',
        groupBy: ['http.method'],
      });

      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).not.toContain('metrics_hourly_stats');
    });

    it('should fall back to raw table when attributes filter is used', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [],
      });
      await engine.connect();

      await engine.aggregateMetrics({
        projectId: 'proj-1',
        metricName: 'http.requests',
        from: new Date('2024-01-01T00:00:00Z'),
        to: new Date('2024-01-02T00:00:00Z'),
        interval: '1h',
        aggregation: 'avg',
        attributes: { 'http.method': 'GET' },
      });

      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).not.toContain('metrics_hourly_stats');
    });

    it('should use raw table for 5m interval', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [],
      });
      await engine.connect();

      await engine.aggregateMetrics({
        projectId: 'proj-1',
        metricName: 'http.requests',
        from: new Date('2024-01-01T00:00:00Z'),
        to: new Date('2024-01-02T00:00:00Z'),
        interval: '5m',
        aggregation: 'avg',
      });

      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).not.toContain('metrics_hourly_stats');
    });

    it('should include service name filter in rollup query', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ bucket: '2024-01-01T00:00:00Z', agg_value: 42.5 }],
      });
      await engine.connect();

      await engine.aggregateMetrics({
        projectId: 'proj-1',
        metricName: 'http.requests',
        metricType: 'gauge',
        from: new Date('2024-01-01T00:00:00Z'),
        to: new Date('2024-01-02T00:00:00Z'),
        interval: '1h',
        aggregation: 'avg',
        serviceName: 'api',
      });

      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).toContain('metrics_hourly_stats');
      expect(sql).toContain('service_name = ANY');
    });
  });

  // =========================================================================
  // getMetricNames
  // =========================================================================

  describe('getMetricNames', () => {
    it('should return distinct metric names and types', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          { metric_name: 'cpu.usage', metric_type: 'gauge' },
          { metric_name: 'http.requests', metric_type: 'sum' },
        ],
      });
      await engine.connect();

      const result = await engine.getMetricNames({
        projectId: 'proj-1',
      });

      expect(result.names).toHaveLength(2);
      expect(result.names[0]).toEqual({ name: 'cpu.usage', type: 'gauge' });
      expect(result.names[1]).toEqual({ name: 'http.requests', type: 'sum' });
      expect(result.executionTimeMs).toBeGreaterThanOrEqual(0);

      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).toContain('SELECT DISTINCT metric_name, metric_type');
      expect(sql).toContain('FROM public.metrics');
      expect(sql).toContain('ORDER BY metric_name ASC');
    });

    it('should filter by project and optional time range', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      await engine.connect();

      await engine.getMetricNames({
        projectId: 'proj-1',
        from: new Date('2024-01-01'),
        to: new Date('2024-01-02'),
      });

      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).toContain('project_id = ANY');
      expect(sql).toContain('time >=');
      expect(sql).toContain('time <=');

      const params = mockQuery.mock.calls[0][1] as unknown[];
      expect(params[0]).toEqual(['proj-1']);
      expect(params[1]).toEqual(new Date('2024-01-01'));
      expect(params[2]).toEqual(new Date('2024-01-02'));
    });
  });

  // =========================================================================
  // getMetricLabelKeys
  // =========================================================================

  describe('getMetricLabelKeys', () => {
    it('should return distinct attribute keys', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          { key: 'env' },
          { key: 'host' },
          { key: 'region' },
        ],
      });
      await engine.connect();

      const result = await engine.getMetricLabelKeys({
        projectId: 'proj-1',
        metricName: 'cpu.usage',
      });

      expect(result.keys).toEqual(['env', 'host', 'region']);
      expect(result.executionTimeMs).toBeGreaterThanOrEqual(0);

      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).toContain('SELECT DISTINCT jsonb_object_keys(attributes) AS key');
      expect(sql).toContain('FROM public.metrics');
      expect(sql).toContain('ORDER BY key ASC');
    });

    it('should include NULL check in WHERE clause', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      await engine.connect();

      await engine.getMetricLabelKeys({
        projectId: 'proj-1',
        metricName: 'cpu.usage',
      });

      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).toContain('attributes IS NOT NULL');
    });
  });

  // =========================================================================
  // getMetricLabelValues
  // =========================================================================

  describe('getMetricLabelValues', () => {
    it('should return distinct attribute values for a label key', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          { value: 'server-1' },
          { value: 'server-2' },
          { value: 'server-3' },
        ],
      });
      await engine.connect();

      const result = await engine.getMetricLabelValues(
        { projectId: 'proj-1', metricName: 'cpu.usage' },
        'host',
      );

      expect(result.values).toEqual(['server-1', 'server-2', 'server-3']);
      expect(result.executionTimeMs).toBeGreaterThanOrEqual(0);

      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).toContain('SELECT DISTINCT attributes->>');
      expect(sql).toContain('AS value');
      expect(sql).toContain('FROM public.metrics');
      expect(sql).toContain('ORDER BY value ASC');

      // Check the jsonb has-key operator is in WHERE
      expect(sql).toContain('attributes ?');
    });

    it('should filter out null values from results', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          { value: 'server-1' },
          { value: null },
          { value: 'server-3' },
        ],
      });
      await engine.connect();

      const result = await engine.getMetricLabelValues(
        { projectId: 'proj-1', metricName: 'cpu.usage' },
        'host',
      );

      expect(result.values).toEqual(['server-1', 'server-3']);
    });
  });

  // =========================================================================
  // deleteMetricsByTimeRange
  // =========================================================================

  describe('deleteMetricsByTimeRange', () => {
    it('should delete exemplars first, then metrics', async () => {
      // Delete exemplars
      mockQuery.mockResolvedValueOnce({ rowCount: 0 });
      // Delete metrics
      mockQuery.mockResolvedValueOnce({ rowCount: 5 });
      await engine.connect();

      const result = await engine.deleteMetricsByTimeRange({
        projectId: 'proj-1',
        from: new Date('2024-01-01'),
        to: new Date('2024-01-02'),
      });

      expect(result.deleted).toBe(5);
      expect(result.executionTimeMs).toBeGreaterThanOrEqual(0);
      expect(mockQuery).toHaveBeenCalledTimes(2);

      // First call: delete exemplars
      const exSql = mockQuery.mock.calls[0][0] as string;
      expect(exSql).toContain('DELETE FROM public.metric_exemplars');
      expect(exSql).toContain('metric_id IN');
      expect(exSql).toContain('SELECT id FROM public.metrics');

      // Second call: delete metrics
      const metricSql = mockQuery.mock.calls[1][0] as string;
      expect(metricSql).toContain('DELETE FROM public.metrics');
      expect(metricSql).toContain('project_id = ANY');
      expect(metricSql).toContain('time >=');
      expect(metricSql).toContain('time <=');

      // Both queries should receive the same params
      const params1 = mockQuery.mock.calls[0][1] as unknown[];
      const params2 = mockQuery.mock.calls[1][1] as unknown[];
      expect(params1).toEqual(params2);
      expect(params1[0]).toEqual(['proj-1']);
      expect(params1[1]).toEqual(new Date('2024-01-01'));
      expect(params1[2]).toEqual(new Date('2024-01-02'));
    });

    it('should include optional metricName and serviceName filters', async () => {
      mockQuery.mockResolvedValueOnce({ rowCount: 0 });
      mockQuery.mockResolvedValueOnce({ rowCount: 3 });
      await engine.connect();

      await engine.deleteMetricsByTimeRange({
        projectId: 'proj-1',
        from: new Date('2024-01-01'),
        to: new Date('2024-01-02'),
        metricName: 'cpu.usage',
        serviceName: 'api',
      });

      const metricSql = mockQuery.mock.calls[1][0] as string;
      expect(metricSql).toContain('metric_name = ANY');
      expect(metricSql).toContain('service_name = ANY');

      const params = mockQuery.mock.calls[1][1] as unknown[];
      expect(params).toContainEqual(['cpu.usage']);
      expect(params).toContainEqual(['api']);
    });
  });

  // =========================================================================
  // getMetricsOverview
  // =========================================================================

  describe('getMetricsOverview', () => {
    it('should return metrics grouped by service', async () => {
      // First query: aggregate stats (tries metrics_hourly_stats)
      mockQuery
        .mockResolvedValueOnce({
          rows: [
            { metric_name: 'http.requests', metric_type: 'sum', service_name: 'api', point_count: 100, avg_value: 5.2, min_value: 1, max_value: 10 },
            { metric_name: 'cpu.usage', metric_type: 'gauge', service_name: 'api', point_count: 50, avg_value: 65.3, min_value: 20, max_value: 95 },
            { metric_name: 'http.requests', metric_type: 'sum', service_name: 'worker', point_count: 30, avg_value: 2.1, min_value: 0, max_value: 8 },
          ],
        })
        // Second query: latest values
        .mockResolvedValueOnce({ rows: [] });

      await engine.connect();

      const result = await engine.getMetricsOverview({
        projectId: 'proj-1',
        from: new Date('2024-01-01'),
        to: new Date('2024-01-02'),
      });

      expect(result.services).toHaveLength(2);
      expect(result.services[0].serviceName).toBe('api');
      expect(result.services[0].metrics).toHaveLength(2);
      expect(result.services[1].serviceName).toBe('worker');
      expect(result.services[1].metrics).toHaveLength(1);
      expect(result.executionTimeMs).toBeGreaterThanOrEqual(0);
    });

    it('should filter by serviceName', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      await engine.connect();

      await engine.getMetricsOverview({
        projectId: 'proj-1',
        from: new Date('2024-01-01'),
        to: new Date('2024-01-02'),
        serviceName: 'api',
      });

      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).toContain('service_name');
      const params = mockQuery.mock.calls[0][1] as unknown[];
      expect(params).toContain('api');
    });

    it('should return empty services when no data', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      await engine.connect();

      const result = await engine.getMetricsOverview({
        projectId: 'proj-1',
        from: new Date('2024-01-01'),
        to: new Date('2024-01-02'),
      });

      expect(result.services).toHaveLength(0);
    });

    it('should use latest values when available', async () => {
      mockQuery
        .mockResolvedValueOnce({
          rows: [
            { metric_name: 'cpu.usage', metric_type: 'gauge', service_name: 'api', point_count: 50, avg_value: 65.3, min_value: 20, max_value: 95 },
          ],
        })
        .mockResolvedValueOnce({
          rows: [
            { metric_name: 'cpu.usage', service_name: 'api', latest_value: 78.5 },
          ],
        });

      await engine.connect();

      const result = await engine.getMetricsOverview({
        projectId: 'proj-1',
        from: new Date('2024-01-01'),
        to: new Date('2024-01-02'),
      });

      expect(result.services[0].metrics[0].latestValue).toBe(78.5);
      expect(result.services[0].metrics[0].avgValue).toBe(65.3);
    });

    it('should fall back to raw metrics table when hourly stats fail', async () => {
      // First query fails (hourly stats not available)
      mockQuery.mockRejectedValueOnce(new Error('relation does not exist'));
      // Fallback raw query succeeds
      mockQuery.mockResolvedValueOnce({
        rows: [
          { metric_name: 'cpu.usage', metric_type: 'gauge', service_name: 'api', point_count: 10, avg_value: 50, min_value: 10, max_value: 90 },
        ],
      });
      // Latest values query
      mockQuery.mockResolvedValueOnce({ rows: [] });

      await engine.connect();

      const result = await engine.getMetricsOverview({
        projectId: 'proj-1',
        from: new Date('2024-01-01'),
        to: new Date('2024-01-02'),
      });

      expect(result.services).toHaveLength(1);
      expect(result.services[0].serviceName).toBe('api');
      expect(result.services[0].metrics[0].metricName).toBe('cpu.usage');
    });

    it('should map metric fields correctly', async () => {
      mockQuery
        .mockResolvedValueOnce({
          rows: [
            { metric_name: 'http.duration', metric_type: 'gauge', service_name: 'gateway', point_count: 200, avg_value: 42.5, min_value: 1.2, max_value: 150.7 },
          ],
        })
        .mockResolvedValueOnce({ rows: [] });

      await engine.connect();

      const result = await engine.getMetricsOverview({
        projectId: 'proj-1',
        from: new Date('2024-01-01'),
        to: new Date('2024-01-02'),
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
  });
});
