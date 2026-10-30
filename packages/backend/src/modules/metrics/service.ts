import { reservoir } from '../../database/reservoir.js';
import { projectsService } from '../projects/service.js';
import { metering, recordMetricIngestion } from '../metering/index.js';
import { createSkewTracker } from '../ingestion/skew.js';
import {
  pickAutoInterval,
  intervalSeconds,
  toRateSeries,
  expandAttributeFilters,
  capSeries,
} from './aggregate-options.js';
import type {
  MetricTimeBucket,
  MetricRecord,
  AggregationInterval,
  MetricAggregationFn,
} from '@logtide/reservoir';

/** Cap on attribute keys used to split a counter into series for `rate`. */
const MAX_RATE_SERIES_KEYS = 10;

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

    // Metering: accepted data points only (reservoir result), billed like
    // spans. Deliberately not under the ingestion.* prefix, which is excluded
    // from usage breakdowns and bypasses METERING_ENABLED=false.
    if (organizationId) {
      recordMetricIngestion({ datapointCount: result.ingested, organizationId, projectId, records: enriched });
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

  /**
   * Explorer aggregate: resolves `auto` intervals, maps `rate` onto `last`,
   * fans out one reservoir call per attribute combination (multi-value filters
   * are one series per value), and caps the number of series.
   */
  async aggregateWithOptions(params: {
    projectId: string | string[];
    metricName: string;
    from: Date;
    to: Date;
    interval: AggregationInterval | 'auto';
    aggregation: MetricAggregationFn | 'rate';
    groupBy?: string[];
    attributes?: Record<string, string[]>;
    serviceName?: string;
  }) {
    const interval = params.interval === 'auto' ? pickAutoInterval(params.from, params.to) : params.interval;
    const bucketSeconds = intervalSeconds(interval);
    const isRate = params.aggregation === 'rate';
    const aggregation: MetricAggregationFn = isRate ? 'last' : (params.aggregation as MetricAggregationFn);

    const attributes = params.attributes ?? {};
    const combos = expandAttributeFilters(attributes);
    const multiKeys = Object.keys(attributes).filter((k) => attributes[k].length > 1);

    // Rate needs `last` per FULL series. The engines take `last` over every row
    // of a bucket that shares the groupBy labels, so group by every attribute
    // key of the metric (the requested groupBy first) and sum the per-series
    // rates back into the requested groups afterwards.
    let engineGroupBy = params.groupBy;
    if (isRate) {
      const labelKeys = await reservoir.getMetricLabelKeys({
        projectId: params.projectId,
        metricName: params.metricName,
        from: params.from,
        to: params.to,
      });
      const merged = [...(params.groupBy ?? [])];
      for (const k of labelKeys?.keys ?? []) {
        if (!merged.includes(k)) merged.push(k);
      }
      engineGroupBy = merged.length > 0 ? merged.slice(0, MAX_RATE_SERIES_KEYS) : undefined;
    }

    const results = await Promise.all(
      combos.map(async (combo) => {
        const result = await reservoir.aggregateMetrics({
          projectId: params.projectId,
          metricName: params.metricName,
          from: params.from,
          to: params.to,
          interval,
          aggregation,
          groupBy: engineGroupBy,
          attributes: Object.keys(combo).length > 0 ? combo : undefined,
          serviceName: params.serviceName,
        });
        const extra: Record<string, string> = {};
        for (const k of multiKeys) extra[k] = combo[k];
        return { result, extra };
      }),
    );

    let timeseries: MetricTimeBucket[] = [];
    for (const { result, extra } of results) {
      for (const point of result.timeseries ?? []) {
        timeseries.push(multiKeys.length > 0 ? { ...point, labels: { ...(point.labels ?? {}), ...extra } } : point);
      }
    }

    if (isRate) timeseries = toRateSeries(timeseries, bucketSeconds, { groupBy: [...(params.groupBy ?? []), ...multiKeys] });
    const capped = capSeries(timeseries);

    const first = results[0]?.result;
    return {
      ...(first ?? { metricName: params.metricName, metricType: 'gauge' as const }),
      timeseries: capped.points,
      interval,
      bucketSeconds,
      seriesTotal: capped.seriesTotal,
      seriesShown: capped.seriesShown,
    };
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
