// ============================================================================
// Panel Data Service
// ============================================================================
//
// Implements the PanelDataSource interface for each panel type. Adding a new
// panel type means adding a new fetcher object here and registering it in
// `dataFetchers`. No other backend file (routes, service, registry) needs to
// change to support a new data source.
//
// Each fetcher delegates to existing services (dashboardService, alertsService,
// reservoir) instead of duplicating query logic.

import type {
  PanelConfig,
  PanelType,
  TimeSeriesConfig,
  SingleStatConfig,
  TopNTableConfig,
  LiveLogStreamConfig,
  AlertStatusConfig,
  MetricChartConfig,
  MetricStatConfig,
  TraceLatencyConfig,
  TraceVolumeConfig,
  DetectionEventsConfig,
  MonitorStatusConfig,
  SystemStatusConfig,
  ActivityOverviewConfig,
  ActivityOverviewSeries,
} from '@logtide/shared';
import { dashboardService } from '../dashboard/service.js';
import { alertsService } from '../alerts/service.js';
import { metricsService } from '../metrics/service.js';
import { monitorService } from '../monitoring/routes.js';
import { SiemDashboardService } from '../siem/dashboard-service.js';
import { db } from '../../database/index.js';
import { reservoir } from '../../database/reservoir.js';
import { sql } from 'kysely';

const siemDashboardService = new SiemDashboardService(db);

export interface PanelDataContext {
  organizationId: string;
  userId: string;
}

export interface PanelDataSource<TConfig extends PanelConfig, TData> {
  readonly type: PanelType;
  fetchData(config: TConfig, ctx: PanelDataContext): Promise<TData>;
}

// ─── Result types (frontend consumes these directly) ───────────────────────

export interface TimeSeriesPanelData {
  series: Array<{
    time: string;
    total: number;
    debug: number;
    info: number;
    warn: number;
    error: number;
    critical: number;
  }>;
  interval: string;
}

export interface SingleStatPanelData {
  value: number;
  trend: number; // signed delta vs previous period
  unit: string; // 'count' | 'percent' | 'rate'
  metric: SingleStatConfig['metric'];
}

export interface TopNTableData {
  rows: Array<{ key: string; count: number; percentage: number }>;
  total: number;
}

export interface LiveLogStreamSnapshot {
  logs: Array<{
    time: string;
    service: string;
    level: string;
    message: string;
    projectId: string;
    traceId?: string;
  }>;
}

export interface AlertStatusData {
  rules: Array<{
    id: string;
    name: string;
    enabled: boolean;
    lastTriggeredAt: string | null;
    triggerCount24h: number;
  }>;
  recentHistory: Array<{
    id: string;
    ruleName: string;
    triggeredAt: string;
    logCount: number;
  }>;
}

export interface MetricChartData {
  metricName: string;
  metricType: string;
  series: Array<{ time: string; value: number; labels?: Record<string, string> }>;
  aggregation: string;
  interval: string;
}

export interface MetricStatData {
  metricName: string;
  value: number | null;
  unit: string | null;
  aggregation: string;
}

export interface TraceLatencyData {
  series: Array<{
    time: string;
    p50: number | null;
    p95: number | null;
    p99: number | null;
    spanCount: number;
    errorRate: number;
  }>;
  serviceName: string | null;
}

export interface TraceVolumePanelData {
  series: Array<{
    time: string;
    total: number;
    errors: number;
  }>;
  serviceName: string | null;
  timeRange: string;
  bucket: 'hour' | 'day';
}

export interface ActivityOverviewPanelData {
  series: Array<{
    time: string;
    logs: number;
    log_errors: number;
    spans: number;
    span_errors: number;
    detections: number;
    alerts: number;
  }>;
  timeRange: string;
  bucket: 'hour' | 'day';
  enabled: ActivityOverviewSeries[];
}

export interface DetectionEventsData {
  series: Array<{ time: string; count: number }>;
  totalDetections: number;
  bySeverity: Array<{ severity: string; count: number }>;
}

export interface MonitorStatusEntry {
  id: string;
  name: string;
  type: string;
  status: string | null;
  enabled: boolean;
  lastCheckedAt: string | null;
  responseTimeMs: number | null;
  consecutiveFailures: number;
  severity: string;
}

export interface MonitorStatusData {
  monitors: MonitorStatusEntry[];
  totalUp: number;
  totalDown: number;
  totalUnknown: number;
}

export interface SystemStatusData {
  overallStatus: 'operational' | 'degraded' | 'outage' | 'no_monitors';
  totalMonitors: number;
  upCount: number;
  downCount: number;
  unknownCount: number;
}

// ─── Fetchers ──────────────────────────────────────────────────────────────

const timeSeriesFetcher: PanelDataSource<TimeSeriesConfig, TimeSeriesPanelData> = {
  type: 'time_series',
  async fetchData(config, ctx) {
    // For now, the existing dashboardService.getTimeseries returns last 24h.
    // Interval other than 24h falls back to whatever the service supports;
    // future iterations can parameterize the time window in dashboardService.
    const series = await dashboardService.getTimeseries(
      ctx.organizationId,
      config.projectId ?? undefined
    );

    // Filter levels client-side based on config (the backend already returns
    // all levels per bucket - we zero out unwanted ones to keep the chart's
    // type stable).
    const allowed = new Set(config.levels);
    const filtered = series.map((point) => ({
      time: point.time,
      total: 0,
      debug: allowed.has('debug') ? point.debug : 0,
      info: allowed.has('info') ? point.info : 0,
      warn: allowed.has('warn') ? point.warn : 0,
      error: allowed.has('error') ? point.error : 0,
      critical: allowed.has('critical') ? point.critical : 0,
    }));
    for (const point of filtered) {
      point.total = point.debug + point.info + point.warn + point.error + point.critical;
    }

    return { series: filtered, interval: config.interval };
  },
};

const singleStatFetcher: PanelDataSource<SingleStatConfig, SingleStatPanelData> = {
  type: 'single_stat',
  async fetchData(config, ctx) {
    const stats = await dashboardService.getStats(
      ctx.organizationId,
      config.projectId ?? undefined
    );

    switch (config.metric) {
      case 'total_logs':
        return {
          value: stats.totalLogsToday.value,
          trend: stats.totalLogsToday.trend,
          unit: 'count',
          metric: 'total_logs',
        };
      case 'error_rate':
        return {
          value: stats.errorRate.value,
          trend: stats.errorRate.trend,
          unit: 'percent',
          metric: 'error_rate',
        };
      case 'active_services':
        return {
          value: stats.activeServices.value,
          trend: stats.activeServices.trend,
          unit: 'count',
          metric: 'active_services',
        };
      case 'throughput':
        return {
          value: stats.avgThroughput.value,
          trend: stats.avgThroughput.trend,
          unit: 'rate',
          metric: 'throughput',
        };
    }
  },
};

const topNTableFetcher: PanelDataSource<TopNTableConfig, TopNTableData> = {
  type: 'top_n_table',
  async fetchData(config, ctx) {
    if (config.dimension === 'service') {
      const services = await dashboardService.getTopServices(
        ctx.organizationId,
        config.limit,
        config.projectId ?? undefined
      );
      const total = services.reduce((sum, s) => sum + s.count, 0);
      return {
        rows: services.map((s) => ({
          key: s.name,
          count: s.count,
          percentage: s.percentage,
        })),
        total,
      };
    }

    // 'error_message': aggregate the most frequent error messages in the
    // selected time range. We use reservoir.topValues on the `message` field
    // restricted to error/critical levels.
    const projectIds = config.projectId
      ? [config.projectId]
      : await resolveProjectIdsForOrg(ctx.organizationId);

    if (projectIds.length === 0) {
      return { rows: [], total: 0 };
    }

    const now = new Date();
    const intervalMs = intervalToMs(config.interval);
    const from = new Date(now.getTime() - intervalMs);

    const [top, totalResult] = await Promise.all([
      reservoir.topValues({
        field: 'message',
        projectId: projectIds,
        from,
        to: now,
        level: ['error', 'critical'],
        limit: config.limit,
      }),
      // True total of all error/critical logs in the window, so percentages are a
      // share of the whole, not of just the top-N rows that fit the limit.
      reservoir.count({
        projectId: projectIds,
        from,
        to: now,
        level: ['error', 'critical'],
      }),
    ]);

    const total = totalResult.count;

    return {
      rows: top.values.map((v: { value: string; count: number }) => ({
        key: v.value,
        count: v.count,
        percentage: total > 0 ? Math.round((v.count / total) * 100) : 0,
      })),
      total,
    };
  },
};

const liveLogStreamFetcher: PanelDataSource<
  LiveLogStreamConfig,
  LiveLogStreamSnapshot
> = {
  type: 'live_log_stream',
  async fetchData(config, ctx) {
    // Snapshot fetch - the panel polls this endpoint every few seconds.
    // True SSE streaming is provided separately by the frontend if needed.
    const projectIds = config.projectId
      ? [config.projectId]
      : await resolveProjectIdsForOrg(ctx.organizationId);

    if (projectIds.length === 0) {
      return { logs: [] };
    }

    const now = new Date();
    const fiveMinAgo = new Date(now.getTime() - 5 * 60 * 1000);

    const result = await reservoir.query({
      projectId: projectIds,
      level: config.levels,
      service: config.service ?? undefined,
      from: fiveMinAgo,
      to: now,
      limit: config.maxRows,
      sortOrder: 'desc',
    });

    return {
      logs: result.logs.map(
        (l: {
          time: Date;
          service: string;
          level: string;
          message: string;
          projectId: string;
          traceId?: string;
        }) => ({
          time: l.time.toISOString(),
          service: l.service,
          level: l.level,
          message: l.message,
          projectId: l.projectId || '',
          traceId: l.traceId,
        })
      ),
    };
  },
};

const alertStatusFetcher: PanelDataSource<AlertStatusConfig, AlertStatusData> = {
  type: 'alert_status',
  async fetchData(config, ctx) {
    const rules = await alertsService.getAlertRules(ctx.organizationId, {
      projectId: config.projectId,
      enabledOnly: false,
    });

    const filtered = config.ruleIds.length > 0
      ? rules.filter((r) => config.ruleIds.includes(r.id))
      : rules;

    const history = config.showHistory
      ? await alertsService.getAlertHistory(ctx.organizationId, {
          projectId: config.projectId ?? undefined,
          limit: config.limit,
        })
      : { history: [] as Array<{ id: string; ruleId: string; ruleName: string; triggeredAt: Date; logCount: number }> };

    // Build per-rule trigger counts from the history snapshot
    const triggerCounts = new Map<string, number>();
    const lastTriggered = new Map<string, Date>();
    for (const h of history.history) {
      triggerCounts.set(h.ruleId, (triggerCounts.get(h.ruleId) ?? 0) + 1);
      const existing = lastTriggered.get(h.ruleId);
      const triggeredAt = h.triggeredAt instanceof Date ? h.triggeredAt : new Date(h.triggeredAt);
      if (!existing || triggeredAt > existing) {
        lastTriggered.set(h.ruleId, triggeredAt);
      }
    }

    return {
      rules: filtered.slice(0, config.limit).map((r) => ({
        id: r.id,
        name: r.name,
        enabled: r.enabled,
        lastTriggeredAt: lastTriggered.get(r.id)?.toISOString() ?? null,
        triggerCount24h: triggerCounts.get(r.id) ?? 0,
      })),
      recentHistory: history.history.slice(0, config.limit).map((h) => ({
        id: h.id,
        ruleName: h.ruleName,
        triggeredAt: (h.triggeredAt instanceof Date
          ? h.triggeredAt
          : new Date(h.triggeredAt)
        ).toISOString(),
        logCount: h.logCount,
      })),
    };
  },
};

const metricChartFetcher: PanelDataSource<MetricChartConfig, MetricChartData> = {
  type: 'metric_chart',
  async fetchData(config, ctx) {
    const projectIds = config.projectId
      ? [config.projectId]
      : await resolveProjectIdsForOrg(ctx.organizationId);

    if (projectIds.length === 0) {
      return {
        metricName: config.metricName,
        metricType: 'gauge',
        series: [],
        aggregation: config.aggregation,
        interval: config.interval,
      };
    }

    const now = new Date();
    const from = new Date(now.getTime() - timeRangeToMs(config.timeRange));

    const result = await metricsService.aggregateMetrics({
      projectId: projectIds,
      metricName: config.metricName,
      from,
      to: now,
      interval: config.interval,
      aggregation: config.aggregation,
      serviceName: config.serviceName ?? undefined,
    });

    return {
      metricName: result.metricName,
      metricType: result.metricType,
      aggregation: config.aggregation,
      interval: config.interval,
      series: result.timeseries.map((b) => ({
        time: b.bucket.toISOString(),
        value: Number(b.value ?? 0),
        labels: b.labels,
      })),
    };
  },
};

const metricStatFetcher: PanelDataSource<MetricStatConfig, MetricStatData> = {
  type: 'metric_stat',
  async fetchData(config, ctx) {
    const projectIds = config.projectId
      ? [config.projectId]
      : await resolveProjectIdsForOrg(ctx.organizationId);

    if (projectIds.length === 0) {
      return {
        metricName: config.metricName,
        value: null,
        unit: config.unit,
        aggregation: config.aggregation,
      };
    }

    const now = new Date();
    const from = new Date(now.getTime() - timeRangeToMs(config.timeRange));

    // Use a single bucket spanning the whole window for the stat value.
    // 1d is the largest supported aggregation interval that fits any
    // timeRange this panel exposes (1h, 6h, 24h).
    const result = await metricsService.aggregateMetrics({
      projectId: projectIds,
      metricName: config.metricName,
      from,
      to: now,
      interval: '1d',
      aggregation: config.aggregation,
      serviceName: config.serviceName ?? undefined,
    });

    // The window can span more than one bucket (e.g. a 24h range crossing midnight
    // at 1d interval). For additive aggregations (sum/count) the buckets must be
    // summed, otherwise only the latest day is counted and the stat undercounts.
    // For avg/min/max/last/percentiles the tile shows the most recent bucket.
    const nonNull = result.timeseries.filter((b) => b.value != null);
    let value: number | null = null;
    if (nonNull.length > 0) {
      if (config.aggregation === 'sum' || config.aggregation === 'count') {
        value = nonNull.reduce((acc, b) => acc + Number(b.value), 0);
      } else {
        value = Number(nonNull[nonNull.length - 1].value);
      }
    }

    return {
      metricName: result.metricName,
      value,
      unit: config.unit,
      aggregation: config.aggregation,
    };
  },
};

const traceLatencyFetcher: PanelDataSource<TraceLatencyConfig, TraceLatencyData> = {
  type: 'trace_latency',
  async fetchData(config, ctx) {
    const projectIds = config.projectId
      ? [config.projectId]
      : await resolveProjectIdsForOrg(ctx.organizationId);

    if (projectIds.length === 0) {
      return { series: [], serviceName: config.serviceName };
    }

    const now = new Date();
    const rangeMs = timeRangeToMs(config.timeRange);
    const from = new Date(now.getTime() - rangeMs);
    const bucket: 'hour' | 'day' = rangeMs <= 48 * 60 * 60 * 1000 ? 'hour' : 'day';

    // Multi-engine: true window percentiles from raw spans on every storage
    // engine (Timescale percentile_cont / ClickHouse quantile / Mongo $percentile).
    const rows = await reservoir.getSpanTimeseries({
      projectIds,
      from,
      to: now,
      bucket,
      serviceName: config.serviceName ?? undefined,
    });

    return {
      serviceName: config.serviceName,
      series: rows.map((r) => ({
        time: r.time.toISOString(),
        p50: r.p50,
        p95: r.p95,
        p99: r.p99,
        spanCount: r.spanCount,
        errorRate: r.spanCount > 0 ? r.errorCount / r.spanCount : 0,
      })),
    };
  },
};

const traceVolumeFetcher: PanelDataSource<TraceVolumeConfig, TraceVolumePanelData> = {
  type: 'trace_volume',
  async fetchData(config, ctx) {
    const projectIds = config.projectId
      ? [config.projectId]
      : await resolveProjectIdsForOrg(ctx.organizationId);

    const bucket: 'hour' | 'day' =
      timeRangeToMs(config.timeRange) <= 48 * 60 * 60 * 1000 ? 'hour' : 'day';

    if (projectIds.length === 0) {
      return {
        series: [],
        serviceName: config.serviceName,
        timeRange: config.timeRange,
        bucket,
      };
    }

    const now = new Date();
    const from = new Date(now.getTime() - timeRangeToMs(config.timeRange));

    // Multi-engine span volume straight from raw spans via the reservoir
    // abstraction (works on Timescale, ClickHouse and MongoDB alike).
    const rows = await reservoir.getSpanTimeseries({
      projectIds,
      from,
      to: now,
      bucket,
      serviceName: config.serviceName ?? undefined,
    });

    return {
      series: rows.map((r) => ({
        time: r.time.toISOString(),
        total: r.spanCount,
        errors: r.errorCount,
      })),
      serviceName: config.serviceName,
      timeRange: config.timeRange,
      bucket,
    };
  },
};

const activityOverviewFetcher: PanelDataSource<
  ActivityOverviewConfig,
  ActivityOverviewPanelData
> = {
  type: 'activity_overview',
  async fetchData(config, ctx) {
    const bucket: 'hour' | 'day' =
      timeRangeToMs(config.timeRange) <= 48 * 60 * 60 * 1000 ? 'hour' : 'day';
    const enabled = new Set(config.series);

    const projectIds = config.projectId
      ? [config.projectId]
      : await resolveProjectIdsForOrg(ctx.organizationId);

    const now = new Date();
    const from = new Date(now.getTime() - timeRangeToMs(config.timeRange));

    // Build the ordered list of bucket timestamps we expect in the window,
    // truncated to bucket boundary (same rule Postgres date_trunc would use).
    const bucketTimes = buildBucketTimes(from, now, bucket);
    const index = new Map<string, number>();
    bucketTimes.forEach((t, i) => index.set(t, i));

    const series = bucketTimes.map((time) => ({
      time,
      logs: 0,
      log_errors: 0,
      spans: 0,
      span_errors: 0,
      detections: 0,
      alerts: 0,
    }));

    const isTimescale = reservoir.getEngineType() === 'timescale';
    const needsLogs = enabled.has('logs') || enabled.has('log_errors');
    const needsSpans = enabled.has('spans') || enabled.has('span_errors');

    // Strategy: read from continuous aggregates first (cheap). If an aggregate
    // returns zero rows for the window we fall back to the raw hypertable so
    // freshly-ingested data isn't hidden by the `end_offset=1 hour` lag on the
    // caggs' refresh policy. Alerts have no cagg so they always hit raw.
    const logsRawTrunc =
      bucket === 'hour'
        ? sql<Date>`date_trunc('hour', time)`
        : sql<Date>`date_trunc('day', time)`;
    const spansRawTrunc =
      bucket === 'hour'
        ? sql<Date>`date_trunc('hour', start_time)`
        : sql<Date>`date_trunc('day', start_time)`;
    const detectionsRawTrunc =
      bucket === 'hour'
        ? sql<Date>`date_trunc('hour', time)`
        : sql<Date>`date_trunc('day', time)`;
    const alertsTrunc =
      bucket === 'hour'
        ? sql<Date>`date_trunc('hour', ah.triggered_at)`
        : sql<Date>`date_trunc('day', ah.triggered_at)`;

    const tasks: Array<Promise<void>> = [];

    if (needsLogs && projectIds.length > 0) {
      if (isTimescale) {
        const logsTable = bucket === 'hour' ? 'logs_hourly_stats' : 'logs_daily_stats';
        tasks.push(
          (async () => {
            const caggRows = await db
              .selectFrom(logsTable)
              .select([
                'bucket',
                'level',
                sql<string>`SUM(log_count)`.as('count'),
              ])
              .where('project_id', 'in', projectIds)
              .where('bucket', '>=', from)
              .where('bucket', '<=', now)
              .groupBy(['bucket', 'level'])
              .execute()
              .catch(() => [] as Array<{ bucket: unknown; level: string; count: string }>);

            const rows = caggRows.length > 0
              ? caggRows
              : await db
                  .selectFrom('logs')
                  .select([
                    logsRawTrunc.as('bucket'),
                    'level',
                    sql<string>`COUNT(*)`.as('count'),
                  ])
                  .where('project_id', 'in', projectIds)
                  .where('time', '>=', from)
                  .where('time', '<=', now)
                  .groupBy([logsRawTrunc, 'level'])
                  .execute()
                  .catch(() => [] as Array<{ bucket: unknown; level: string; count: string }>);

            for (const r of rows) {
              const key = new Date(r.bucket as unknown as string).toISOString();
              const i = index.get(key);
              if (i === undefined) continue;
              const n = Number(r.count ?? 0);
              series[i].logs += n;
              if (r.level === 'error' || r.level === 'critical') {
                series[i].log_errors += n;
              }
            }
          })(),
        );
      } else {
        // ClickHouse / MongoDB: continuous aggregates are TimescaleDB-only,
        // so go through the reservoir aggregate API (same pattern used by
        // baseline-calculator). Bucket boundaries from toStartOfHour/$dateTrunc
        // align with buildBucketTimes (UTC), so keys collide cleanly.
        tasks.push(
          (async () => {
            const aggResult = await reservoir
              .aggregate({
                projectId: projectIds,
                from,
                to: now,
                interval: bucket === 'hour' ? '1h' : '1d',
              })
              .catch(() => ({ timeseries: [] as Array<{ bucket: Date; total: number; byLevel?: Record<string, number> }>, total: 0 }));

            for (const b of aggResult.timeseries) {
              const key = (b.bucket instanceof Date ? b.bucket : new Date(b.bucket)).toISOString();
              const i = index.get(key);
              if (i === undefined) continue;
              series[i].logs += b.total;
              if (b.byLevel) {
                series[i].log_errors += (b.byLevel.error ?? 0) + (b.byLevel.critical ?? 0);
              }
            }
          })(),
        );
      }
    }

    if (needsSpans && isTimescale && projectIds.length > 0) {
      // spans series stay at zero on non-Timescale engines: the reservoir
      // interface has no aggregateSpans() primitive, so we follow the same
      // convention as trace_latency / trace_volume.
      const spansTable = bucket === 'hour' ? 'spans_hourly_stats' : 'spans_daily_stats';
      tasks.push(
        (async () => {
          const caggRows = await db
            .selectFrom(spansTable)
            .select([
              'bucket',
              sql<string>`SUM(span_count)`.as('total'),
              sql<string>`SUM(COALESCE(error_count, 0))`.as('errors'),
            ])
            .where('project_id', 'in', projectIds)
            .where('bucket', '>=', from)
            .where('bucket', '<=', now)
            .groupBy('bucket')
            .execute()
            .catch(() => [] as Array<{ bucket: unknown; total: string; errors: string }>);

          const rows = caggRows.length > 0
            ? caggRows
            : await db
                .selectFrom('spans')
                .select([
                  spansRawTrunc.as('bucket'),
                  sql<string>`COUNT(*)`.as('total'),
                  sql<string>`SUM(CASE WHEN status_code = 'ERROR' THEN 1 ELSE 0 END)`.as(
                    'errors',
                  ),
                ])
                .where('project_id', 'in', projectIds)
                .where('start_time', '>=', from)
                .where('start_time', '<=', now)
                .groupBy(spansRawTrunc)
                .execute()
                .catch(() => [] as Array<{ bucket: unknown; total: string; errors: string }>);

          for (const r of rows) {
            const key = new Date(r.bucket as unknown as string).toISOString();
            const i = index.get(key);
            if (i === undefined) continue;
            series[i].spans += Number(r.total ?? 0);
            series[i].span_errors += Number(r.errors ?? 0);
          }
        })(),
      );
    }

    if (enabled.has('detections')) {
      const detTable =
        bucket === 'hour'
          ? 'detection_events_hourly_stats'
          : 'detection_events_daily_stats';
      tasks.push(
        (async () => {
          let caggQuery = db
            .selectFrom(detTable)
            .select([
              'bucket',
              sql<string>`SUM(detection_count)`.as('count'),
            ])
            .where('organization_id', '=', ctx.organizationId)
            .where('bucket', '>=', from)
            .where('bucket', '<=', now);
          if (config.projectId) {
            caggQuery = caggQuery.where('project_id', '=', config.projectId);
          }
          const caggRows = await caggQuery
            .groupBy('bucket')
            .execute()
            .catch(() => [] as Array<{ bucket: unknown; count: string }>);

          let rows: Array<{ bucket: unknown; count: string }> = caggRows;
          if (rows.length === 0) {
            let rawQuery = db
              .selectFrom('detection_events')
              .select([
                detectionsRawTrunc.as('bucket'),
                sql<string>`COUNT(*)`.as('count'),
              ])
              .where('organization_id', '=', ctx.organizationId)
              .where('time', '>=', from)
              .where('time', '<=', now);
            if (config.projectId) {
              rawQuery = rawQuery.where('project_id', '=', config.projectId);
            }
            rows = await rawQuery
              .groupBy(detectionsRawTrunc)
              .execute()
              .catch(() => [] as Array<{ bucket: unknown; count: string }>);
          }

          for (const r of rows) {
            const key = new Date(r.bucket as unknown as string).toISOString();
            const i = index.get(key);
            if (i === undefined) continue;
            series[i].detections += Number(r.count ?? 0);
          }
        })(),
      );
    }

    if (enabled.has('alerts')) {
      let alertQuery = db
        .selectFrom('alert_history as ah')
        .innerJoin('alert_rules as ar', 'ar.id', 'ah.rule_id')
        .select([
          alertsTrunc.as('bucket'),
          sql<string>`COUNT(*)`.as('count'),
        ])
        .where('ar.organization_id', '=', ctx.organizationId)
        .where('ah.triggered_at', '>=', from)
        .where('ah.triggered_at', '<=', now);
      if (config.projectId) {
        alertQuery = alertQuery.where('ar.project_id', '=', config.projectId);
      }
      tasks.push(
        alertQuery
          .groupBy(alertsTrunc)
          .execute()
          .then((rows) => {
            for (const r of rows) {
              const key = new Date(r.bucket as unknown as string).toISOString();
              const i = index.get(key);
              if (i === undefined) continue;
              series[i].alerts += Number(r.count ?? 0);
            }
          })
          .catch(() => void 0),
      );
    }

    await Promise.all(tasks);

    return {
      series,
      timeRange: config.timeRange,
      bucket,
      enabled: config.series,
    };
  },
};

const detectionEventsFetcher: PanelDataSource<
  DetectionEventsConfig,
  DetectionEventsData
> = {
  type: 'detection_events',
  async fetchData(config, ctx) {
    const stats = await siemDashboardService.getDashboardStats({
      organizationId: ctx.organizationId,
      projectId: config.projectId ?? undefined,
      timeRange: config.timeRange,
      severity: config.severities,
    });

    return {
      series: stats.timeline.map((b) => ({
        time: (b.timestamp instanceof Date
          ? b.timestamp
          : new Date(b.timestamp)
        ).toISOString(),
        count: b.count,
      })),
      totalDetections: stats.totalDetections,
      bySeverity: stats.severityDistribution.map((s) => ({
        severity: s.severity,
        count: s.count,
      })),
    };
  },
};

const monitorStatusFetcher: PanelDataSource<MonitorStatusConfig, MonitorStatusData> = {
  type: 'monitor_status',
  async fetchData(config, ctx) {
    const monitors = await monitorService.listMonitors(
      ctx.organizationId,
      config.projectId ?? undefined
    );

    const filtered = config.monitorIds.length > 0
      ? monitors.filter((m) => config.monitorIds.includes(m.id))
      : monitors;

    // Totals counted across the full filtered list (not just the rows we
    // render), so the summary stays accurate even when limit truncates.
    const totalUp = filtered.filter((m) => m.status?.status === 'up').length;
    const totalDown = filtered.filter((m) => m.status?.status === 'down').length;
    const totalUnknown = filtered.length - totalUp - totalDown;

    const entries: MonitorStatusEntry[] = filtered.slice(0, config.limit).map((m) => ({
      id: m.id,
      name: m.name,
      type: m.type,
      status: m.status?.status ?? null,
      enabled: m.enabled,
      lastCheckedAt: m.status?.lastCheckedAt
        ? (m.status.lastCheckedAt instanceof Date
            ? m.status.lastCheckedAt
            : new Date(m.status.lastCheckedAt)
          ).toISOString()
        : null,
      responseTimeMs: m.status?.responseTimeMs ?? null,
      consecutiveFailures: m.status?.consecutiveFailures ?? 0,
      severity: m.severity,
    }));

    return {
      monitors: entries,
      totalUp,
      totalDown,
      totalUnknown,
    };
  },
};

const systemStatusFetcher: PanelDataSource<SystemStatusConfig, SystemStatusData> = {
  type: 'system_status',
  async fetchData(config, ctx) {
    const monitors = await monitorService.listMonitors(
      ctx.organizationId,
      config.projectId ?? undefined
    );

    const upCount = monitors.filter((m) => m.status?.status === 'up').length;
    const downCount = monitors.filter((m) => m.status?.status === 'down').length;
    const unknownCount = monitors.length - upCount - downCount;

    // Mirrors the logic in monitorService.getPublicStatus (service.ts:421-427)
    let overallStatus: SystemStatusData['overallStatus'];
    if (monitors.length === 0) {
      overallStatus = 'no_monitors';
    } else if (downCount === 0) {
      overallStatus = 'operational';
    } else if (downCount === monitors.length) {
      overallStatus = 'outage';
    } else {
      overallStatus = 'degraded';
    }

    return {
      overallStatus,
      totalMonitors: monitors.length,
      upCount,
      downCount,
      unknownCount,
    };
  },
};

// ─── Helpers ───────────────────────────────────────────────────────────────

function timeRangeToMs(range: string): number {
  switch (range) {
    case '1h': return 60 * 60 * 1000;
    case '6h': return 6 * 60 * 60 * 1000;
    case '24h': return 24 * 60 * 60 * 1000;
    case '7d': return 7 * 24 * 60 * 60 * 1000;
    case '30d': return 30 * 24 * 60 * 60 * 1000;
    default: return 24 * 60 * 60 * 1000;
  }
}

async function resolveProjectIdsForOrg(organizationId: string): Promise<string[]> {
  const { db } = await import('../../database/index.js');
  const rows = await db
    .selectFrom('projects')
    .select('id')
    .where('organization_id', '=', organizationId)
    .execute();
  return rows.map((r) => r.id);
}

/**
 * Verify the panel's projectId (if any) belongs to the context organization.
 * Prevents cross-org data leaks via maliciously crafted panel configs (e.g.
 * an attacker who imports a YAML referencing a foreign projectId, then queries
 * panel data and gets results from another org).
 */
async function ensureProjectInOrg(
  projectId: string | null | undefined,
  organizationId: string
): Promise<void> {
  if (!projectId) return;
  const { db } = await import('../../database/index.js');
  const row = await db
    .selectFrom('projects')
    .select('id')
    .where('id', '=', projectId)
    .where('organization_id', '=', organizationId)
    .executeTakeFirst();
  if (!row) {
    throw new Error('Panel projectId does not belong to the requesting organization');
  }
}

function buildBucketTimes(
  from: Date,
  to: Date,
  bucket: 'hour' | 'day',
): string[] {
  const stepMs = bucket === 'hour' ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
  // Align `from` to bucket boundary to match Postgres date_trunc output so the
  // keys produced here collide with the keys built from SQL rows.
  const start = new Date(from);
  if (bucket === 'hour') {
    start.setUTCMinutes(0, 0, 0);
  } else {
    start.setUTCHours(0, 0, 0, 0);
  }
  const out: string[] = [];
  for (let t = start.getTime(); t <= to.getTime(); t += stepMs) {
    out.push(new Date(t).toISOString());
  }
  return out;
}

function intervalToMs(interval: '1h' | '24h' | '7d'): number {
  switch (interval) {
    case '1h':
      return 60 * 60 * 1000;
    case '24h':
      return 24 * 60 * 60 * 1000;
    case '7d':
      return 7 * 24 * 60 * 60 * 1000;
  }
}

// ─── Registry ──────────────────────────────────────────────────────────────

type AnyFetcher = PanelDataSource<PanelConfig, unknown>;

const dataFetchers: Record<PanelType, AnyFetcher> = {
  time_series: timeSeriesFetcher as AnyFetcher,
  single_stat: singleStatFetcher as AnyFetcher,
  top_n_table: topNTableFetcher as AnyFetcher,
  live_log_stream: liveLogStreamFetcher as AnyFetcher,
  alert_status: alertStatusFetcher as AnyFetcher,
  metric_chart: metricChartFetcher as AnyFetcher,
  metric_stat: metricStatFetcher as AnyFetcher,
  trace_latency: traceLatencyFetcher as AnyFetcher,
  trace_volume: traceVolumeFetcher as AnyFetcher,
  detection_events: detectionEventsFetcher as AnyFetcher,
  monitor_status: monitorStatusFetcher as AnyFetcher,
  system_status: systemStatusFetcher as AnyFetcher,
  activity_overview: activityOverviewFetcher as AnyFetcher,
};

export async function fetchPanelData(
  config: PanelConfig,
  ctx: PanelDataContext
): Promise<unknown> {
  const fetcher = dataFetchers[config.type];
  if (!fetcher) {
    throw new Error(`No data fetcher registered for panel type: ${config.type}`);
  }

  // Cross-org isolation: every panel config that carries a projectId must
  // reference a project owned by the requesting org. This catches both
  // malicious imports and stale references after a project is moved/deleted.
  if ('projectId' in config) {
    await ensureProjectInOrg(config.projectId, ctx.organizationId);
  }

  return fetcher.fetchData(config, ctx);
}
