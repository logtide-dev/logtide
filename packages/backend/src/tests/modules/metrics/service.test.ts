import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockIngestMetrics = vi.fn();
const mockGetMetricNames = vi.fn();
const mockGetMetricLabelKeys = vi.fn();
const mockGetMetricLabelValues = vi.fn();
const mockQueryMetrics = vi.fn();
const mockAggregateMetrics = vi.fn();
const mockGetMetricsOverview = vi.fn();

vi.mock('../../../database/reservoir.js', () => ({
  reservoir: {
    ingestMetrics: (...args: unknown[]) => mockIngestMetrics(...args),
    getMetricNames: (...args: unknown[]) => mockGetMetricNames(...args),
    getMetricLabelKeys: (...args: unknown[]) => mockGetMetricLabelKeys(...args),
    getMetricLabelValues: (...args: unknown[]) => mockGetMetricLabelValues(...args),
    queryMetrics: (...args: unknown[]) => mockQueryMetrics(...args),
    aggregateMetrics: (...args: unknown[]) => mockAggregateMetrics(...args),
    getMetricsOverview: (...args: unknown[]) => mockGetMetricsOverview(...args),
  },
}));

const mockMeteringRecord = vi.fn();

vi.mock('../../../modules/metering/index.js', () => ({
  metering: {
    record: (...args: unknown[]) => mockMeteringRecord(...args),
  },
}));

import { MetricsService } from '../../../modules/metrics/service.js';

describe('MetricsService', () => {
  let service: MetricsService;

  beforeEach(() => {
    service = new MetricsService();
    vi.clearAllMocks();
  });

  describe('ingestMetrics', () => {
    it('should return 0 for empty records array without calling reservoir', async () => {
      const result = await service.ingestMetrics([], 'proj-1', 'org-1');

      expect(result).toBe(0);
      expect(mockIngestMetrics).not.toHaveBeenCalled();
    });

    it('should enrich records with projectId and organizationId', async () => {
      mockIngestMetrics.mockResolvedValueOnce({ ingested: 2 });

      const records = [
        {
          time: new Date('2025-01-01T00:00:00Z'),
          metricName: 'http_requests_total',
          metricType: 'sum' as const,
          value: 42,
          serviceName: 'api-gateway',
          organizationId: '',
          projectId: '',
        },
        {
          time: new Date('2025-01-01T00:01:00Z'),
          metricName: 'cpu_usage',
          metricType: 'gauge' as const,
          value: 0.75,
          serviceName: 'worker',
          organizationId: '',
          projectId: '',
        },
      ];

      await service.ingestMetrics(records, 'proj-1', 'org-1');

      expect(mockIngestMetrics).toHaveBeenCalledOnce();
      const enriched = mockIngestMetrics.mock.calls[0][0];
      expect(enriched).toHaveLength(2);
      expect(enriched[0]).toEqual(expect.objectContaining({
        projectId: 'proj-1',
        organizationId: 'org-1',
        metricName: 'http_requests_total',
        value: 42,
      }));
      expect(enriched[1]).toEqual(expect.objectContaining({
        projectId: 'proj-1',
        organizationId: 'org-1',
        metricName: 'cpu_usage',
        value: 0.75,
      }));
    });

    it('should return ingested count from reservoir result', async () => {
      mockIngestMetrics.mockResolvedValueOnce({ ingested: 5 });

      const records = [
        {
          time: new Date('2025-01-01T00:00:00Z'),
          metricName: 'requests',
          metricType: 'sum' as const,
          value: 1,
          serviceName: 'api',
          organizationId: '',
          projectId: '',
        },
      ];

      const result = await service.ingestMetrics(records, 'proj-1', 'org-1');

      expect(result).toBe(5);
    });

    describe('clock skew detection (span-metric-skew)', () => {
      it('counts a metric with a past-skewed time', async () => {
        mockIngestMetrics.mockResolvedValueOnce({ ingested: 1 });

        const skewedTime = new Date(Date.now() - 27 * 60 * 60 * 1000);
        const records = [
          {
            time: skewedTime,
            metricName: 'old_metric',
            metricType: 'gauge' as const,
            value: 1,
            serviceName: 'svc',
            organizationId: '',
            projectId: '',
          },
        ];

        const result = await service.ingestMetrics(records, 'proj-1', 'org-1');

        // The skewed metric is still written, not rejected.
        expect(result).toBe(1);
        expect(mockIngestMetrics).toHaveBeenCalledOnce();

        const skewCall = mockMeteringRecord.mock.calls.find(
          ([e]) => e.type === 'ingestion.metric_timestamp_skew',
        );
        expect(skewCall).toBeDefined();
        expect(skewCall![0].quantity).toBe(1);
        expect(skewCall![0].organizationId).toBe('org-1');
        expect(skewCall![0].projectId).toBe('proj-1');
        expect((skewCall![0].metadata as { maxPastMs: number }).maxPastMs).toBeGreaterThan(
          24 * 60 * 60 * 1000,
        );
      });

      it('counts a metric with a future-skewed time', async () => {
        mockIngestMetrics.mockResolvedValueOnce({ ingested: 1 });

        const futureTime = new Date(Date.now() + 10 * 60 * 1000);
        const records = [
          {
            time: futureTime,
            metricName: 'future_metric',
            metricType: 'gauge' as const,
            value: 1,
            serviceName: 'svc',
            organizationId: '',
            projectId: '',
          },
        ];

        await service.ingestMetrics(records, 'proj-1', 'org-1');

        const skewCall = mockMeteringRecord.mock.calls.find(
          ([e]) => e.type === 'ingestion.metric_timestamp_skew',
        );
        expect(skewCall).toBeDefined();
        expect(skewCall![0].quantity).toBe(1);
        expect((skewCall![0].metadata as { maxFutureMs: number }).maxFutureMs).toBeGreaterThan(0);
      });

      it('does not count a fresh metric', async () => {
        mockIngestMetrics.mockResolvedValueOnce({ ingested: 1 });

        const records = [
          {
            time: new Date(),
            metricName: 'fresh_metric',
            metricType: 'gauge' as const,
            value: 1,
            serviceName: 'svc',
            organizationId: '',
            projectId: '',
          },
        ];

        await service.ingestMetrics(records, 'proj-1', 'org-1');

        expect(
          mockMeteringRecord.mock.calls.find(([e]) => e.type === 'ingestion.metric_timestamp_skew'),
        ).toBeUndefined();
      });
    });
  });

  describe('listMetricNames', () => {
    it('should delegate to reservoir.getMetricNames with correct params', async () => {
      mockGetMetricNames.mockResolvedValueOnce(['http_requests_total', 'cpu_usage']);

      const result = await service.listMetricNames('proj-1');

      expect(mockGetMetricNames).toHaveBeenCalledWith({
        projectId: 'proj-1',
        from: undefined,
        to: undefined,
      });
      expect(result).toEqual(['http_requests_total', 'cpu_usage']);
    });

    it('should pass optional from/to dates', async () => {
      mockGetMetricNames.mockResolvedValueOnce(['cpu_usage']);

      const from = new Date('2025-01-01T00:00:00Z');
      const to = new Date('2025-01-02T00:00:00Z');

      const result = await service.listMetricNames('proj-1', from, to);

      expect(mockGetMetricNames).toHaveBeenCalledWith({
        projectId: 'proj-1',
        from,
        to,
      });
      expect(result).toEqual(['cpu_usage']);
    });
  });

  describe('getLabelKeys', () => {
    it('should delegate to reservoir.getMetricLabelKeys with correct params', async () => {
      mockGetMetricLabelKeys.mockResolvedValueOnce(['host', 'method', 'status']);

      const from = new Date('2025-01-01T00:00:00Z');
      const to = new Date('2025-01-02T00:00:00Z');

      const result = await service.getLabelKeys('proj-1', 'http_requests_total', from, to);

      expect(mockGetMetricLabelKeys).toHaveBeenCalledWith({
        projectId: 'proj-1',
        metricName: 'http_requests_total',
        from,
        to,
      });
      expect(result).toEqual(['host', 'method', 'status']);
    });
  });

  describe('getLabelValues', () => {
    it('should delegate to reservoir.getMetricLabelValues with correct params including labelKey', async () => {
      mockGetMetricLabelValues.mockResolvedValueOnce(['GET', 'POST', 'PUT']);

      const from = new Date('2025-01-01T00:00:00Z');
      const to = new Date('2025-01-02T00:00:00Z');

      const result = await service.getLabelValues(
        'proj-1',
        'http_requests_total',
        'method',
        from,
        to,
      );

      expect(mockGetMetricLabelValues).toHaveBeenCalledWith(
        {
          projectId: 'proj-1',
          metricName: 'http_requests_total',
          from,
          to,
        },
        'method',
      );
      expect(result).toEqual(['GET', 'POST', 'PUT']);
    });
  });

  describe('queryMetrics', () => {
    it('should delegate to reservoir.queryMetrics with all params', async () => {
      const mockResult = {
        metrics: [
          { id: 'm-1', metricName: 'cpu_usage', value: 0.8, time: new Date() },
        ],
        total: 1,
        hasMore: false,
        limit: 100,
        offset: 0,
      };
      mockQueryMetrics.mockResolvedValueOnce(mockResult);

      const from = new Date('2025-01-01T00:00:00Z');
      const to = new Date('2025-01-02T00:00:00Z');

      const result = await service.queryMetrics({
        projectId: 'proj-1',
        metricName: 'cpu_usage',
        from,
        to,
        limit: 100,
        offset: 0,
      });

      expect(mockQueryMetrics).toHaveBeenCalledWith({
        projectId: 'proj-1',
        metricName: 'cpu_usage',
        from,
        to,
        attributes: undefined,
        limit: 100,
        offset: 0,
        includeExemplars: undefined,
      });
      expect(result).toBe(mockResult);
    });

    it('should pass through optional attributes and includeExemplars', async () => {
      const mockResult = {
        metrics: [],
        total: 0,
        hasMore: false,
        limit: 50,
        offset: 0,
      };
      mockQueryMetrics.mockResolvedValueOnce(mockResult);

      const from = new Date('2025-01-01T00:00:00Z');
      const to = new Date('2025-01-02T00:00:00Z');

      const result = await service.queryMetrics({
        projectId: ['proj-1', 'proj-2'],
        metricName: ['cpu_usage', 'memory_usage'],
        from,
        to,
        attributes: { host: 'server-1', region: 'eu-west' },
        limit: 50,
        offset: 10,
        includeExemplars: true,
      });

      expect(mockQueryMetrics).toHaveBeenCalledWith({
        projectId: ['proj-1', 'proj-2'],
        metricName: ['cpu_usage', 'memory_usage'],
        from,
        to,
        attributes: { host: 'server-1', region: 'eu-west' },
        limit: 50,
        offset: 10,
        includeExemplars: true,
      });
      expect(result).toBe(mockResult);
    });
  });

  describe('aggregateMetrics', () => {
    it('should delegate to reservoir.aggregateMetrics with all params', async () => {
      const mockResult = {
        timeseries: [
          { time: new Date('2025-01-01T00:00:00Z'), value: 42 },
          { time: new Date('2025-01-01T01:00:00Z'), value: 55 },
        ],
      };
      mockAggregateMetrics.mockResolvedValueOnce(mockResult);

      const from = new Date('2025-01-01T00:00:00Z');
      const to = new Date('2025-01-02T00:00:00Z');

      const result = await service.aggregateMetrics({
        projectId: 'proj-1',
        metricName: 'http_requests_total',
        from,
        to,
        interval: '1h',
        aggregation: 'sum',
      });

      expect(mockAggregateMetrics).toHaveBeenCalledWith({
        projectId: 'proj-1',
        metricName: 'http_requests_total',
        from,
        to,
        interval: '1h',
        aggregation: 'sum',
        groupBy: undefined,
        attributes: undefined,
      });
      expect(result).toBe(mockResult);
    });

    it('should pass through optional groupBy and attributes', async () => {
      const mockResult = {
        timeseries: [
          { time: new Date('2025-01-01T00:00:00Z'), value: 10, group: { method: 'GET' } },
        ],
      };
      mockAggregateMetrics.mockResolvedValueOnce(mockResult);

      const from = new Date('2025-01-01T00:00:00Z');
      const to = new Date('2025-01-02T00:00:00Z');

      const result = await service.aggregateMetrics({
        projectId: ['proj-1', 'proj-2'],
        metricName: 'http_requests_total',
        from,
        to,
        interval: '5m',
        aggregation: 'avg',
        groupBy: ['method', 'status'],
        attributes: { host: 'server-1' },
      });

      expect(mockAggregateMetrics).toHaveBeenCalledWith({
        projectId: ['proj-1', 'proj-2'],
        metricName: 'http_requests_total',
        from,
        to,
        interval: '5m',
        aggregation: 'avg',
        groupBy: ['method', 'status'],
        attributes: { host: 'server-1' },
      });
      expect(result).toBe(mockResult);
    });

    it('should pass interval and aggregation correctly for all supported values', async () => {
      mockAggregateMetrics.mockResolvedValueOnce({ timeseries: [] });

      const from = new Date('2025-01-01T00:00:00Z');
      const to = new Date('2025-01-08T00:00:00Z');

      await service.aggregateMetrics({
        projectId: 'proj-1',
        metricName: 'memory_usage',
        from,
        to,
        interval: '1d',
        aggregation: 'max',
      });

      expect(mockAggregateMetrics).toHaveBeenCalledWith(
        expect.objectContaining({
          interval: '1d',
          aggregation: 'max',
          metricName: 'memory_usage',
        }),
      );
    });

    it('should pass serviceName to reservoir.aggregateMetrics', async () => {
      mockAggregateMetrics.mockResolvedValueOnce({ timeseries: [] });

      const from = new Date('2025-01-01T00:00:00Z');
      const to = new Date('2025-01-02T00:00:00Z');

      await service.aggregateMetrics({
        projectId: 'proj-1',
        metricName: 'http_requests_total',
        from,
        to,
        interval: '1h',
        aggregation: 'avg',
        serviceName: 'api-gateway',
      });

      expect(mockAggregateMetrics).toHaveBeenCalledWith(
        expect.objectContaining({
          serviceName: 'api-gateway',
        }),
      );
    });
  });

  describe('getOverview', () => {
    it('should delegate to reservoir.getMetricsOverview with correct params', async () => {
      const mockResult = {
        services: [
          {
            serviceName: 'api',
            metrics: [
              {
                metricName: 'http.requests',
                metricType: 'sum',
                serviceName: 'api',
                latestValue: 100,
                avgValue: 80,
                minValue: 10,
                maxValue: 200,
                pointCount: 50,
              },
            ],
          },
        ],
        executionTimeMs: 5,
      };
      mockGetMetricsOverview.mockResolvedValueOnce(mockResult);

      const from = new Date('2025-01-01T00:00:00Z');
      const to = new Date('2025-01-02T00:00:00Z');

      const result = await service.getOverview({
        projectId: 'proj-1',
        from,
        to,
      });

      expect(mockGetMetricsOverview).toHaveBeenCalledWith({
        projectId: 'proj-1',
        from,
        to,
        serviceName: undefined,
      });
      expect(result).toBe(mockResult);
    });

    it('should pass serviceName filter to reservoir', async () => {
      mockGetMetricsOverview.mockResolvedValueOnce({ services: [] });

      const from = new Date('2025-01-01T00:00:00Z');
      const to = new Date('2025-01-02T00:00:00Z');

      await service.getOverview({
        projectId: 'proj-1',
        from,
        to,
        serviceName: 'worker',
      });

      expect(mockGetMetricsOverview).toHaveBeenCalledWith({
        projectId: 'proj-1',
        from,
        to,
        serviceName: 'worker',
      });
    });
  });
});
