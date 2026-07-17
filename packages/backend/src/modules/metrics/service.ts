import { reservoir } from '../../database/reservoir.js';
import { projectsService } from '../projects/service.js';
import { metering } from '../metering/index.js';
import { createSkewTracker } from '../ingestion/skew.js';
import type {
  MetricRecord,
  AggregationInterval,
  MetricAggregationFn,
} from '@logtide/reservoir';

export class MetricsService {
  async ingestMetrics(
    records: MetricRecord[],
    projectId: string,
    organizationId: string,
  ): Promise<number> {
    if (records.length === 0) return 0;

    // Clock skew (span-metric-skew): observed on the data point timestamp
    // (r.time), inside the same map as the enrichment above. No PII masking
    // exists on this path, so there is nothing to order against. 24h is a
    // judgement call (see traces/service.ts ingestSpans for the full rationale),
    // not a derivation: the harm here is a metric invisible in dashboard windows.
    const metricSkewTracker = createSkewTracker(Date.now());
    const enriched = records.map((r) => {
      metricSkewTracker.observe(r.time);
      return {
        ...r,
        projectId,
        organizationId,
      };
    });

    const result = await reservoir.ingestMetrics(enriched);

    const metricSkew = metricSkewTracker.summary();
    if (metricSkew && organizationId) {
      metering.record({
        type: 'ingestion.metric_timestamp_skew',
        quantity: metricSkew.count,
        organizationId,
        projectId,
        metadata: { maxPastMs: metricSkew.maxPastMs, maxFutureMs: metricSkew.maxFutureMs },
      });
    }

    // Mark the project as having metrics (debounced, fire-and-forget)
    projectsService.markHasData(projectId, 'metrics').catch(() => {});

    return result.ingested;
  }

  async listMetricNames(projectId: string | string[], from?: Date, to?: Date) {
    return reservoir.getMetricNames({ projectId, from, to });
  }

  async getLabelKeys(projectId: string | string[], metricName: string, from?: Date, to?: Date) {
    return reservoir.getMetricLabelKeys({ projectId, metricName, from, to });
  }

  async getLabelValues(
    projectId: string | string[],
    metricName: string,
    labelKey: string,
    from?: Date,
    to?: Date,
  ) {
    return reservoir.getMetricLabelValues({ projectId, metricName, from, to }, labelKey);
  }

  async queryMetrics(params: {
    projectId: string | string[];
    metricName?: string | string[];
    from: Date;
    to: Date;
    attributes?: Record<string, string>;
    limit?: number;
    offset?: number;
    includeExemplars?: boolean;
  }) {
    return reservoir.queryMetrics({
      projectId: params.projectId,
      metricName: params.metricName,
      from: params.from,
      to: params.to,
      attributes: params.attributes,
      limit: params.limit,
      offset: params.offset,
      includeExemplars: params.includeExemplars,
    });
  }

  async aggregateMetrics(params: {
    projectId: string | string[];
    metricName: string;
    from: Date;
    to: Date;
    interval: AggregationInterval;
    aggregation: MetricAggregationFn;
    groupBy?: string[];
    attributes?: Record<string, string>;
    serviceName?: string;
  }) {
    return reservoir.aggregateMetrics({
      projectId: params.projectId,
      metricName: params.metricName,
      from: params.from,
      to: params.to,
      interval: params.interval,
      aggregation: params.aggregation,
      groupBy: params.groupBy,
      attributes: params.attributes,
      serviceName: params.serviceName,
    });
  }

  async getOverview(params: {
    projectId: string | string[];
    from: Date;
    to: Date;
    serviceName?: string;
  }) {
    return reservoir.getMetricsOverview({
      projectId: params.projectId,
      from: params.from,
      to: params.to,
      serviceName: params.serviceName,
    });
  }
}

export const metricsService = new MetricsService();
