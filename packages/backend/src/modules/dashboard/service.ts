import { db } from '../../database/index.js';
import { sql } from 'kysely';
import { CacheManager, CACHE_TTL } from '../../utils/cache.js';
import { reservoir } from '../../database/reservoir.js';

export interface DashboardStats {
  totalLogsToday: {
    value: number;
    trend: number; // percentage change from yesterday
  };
  errorRate: {
    value: number; // percentage
    trend: number; // percentage point change from yesterday
  };
  activeServices: {
    value: number;
    trend: number; // change from yesterday
  };
  avgThroughput: {
    value: number; // logs per second (last hour)
    trend: number; // percentage change from previous hour
  };
}

export interface TimeseriesDataPoint {
  time: string;
  total: number;
  debug: number;
  info: number;
  warn: number;
  error: number;
  critical: number;
}

export interface RecentError {
  time: string;
  service: string;
  level: 'error' | 'critical';
  message: string;
  projectId: string;
  traceId?: string;
}

export interface TimelineEvent {
  time: string;
  alerts: number;
  detections: number;
  alertDetails: Array<{ ruleName: string; alertType: string; logCount: number }>;
  detectionsBySeverity: { critical: number; high: number; medium: number; low: number };
}

/**
 * Below this recent (last-hour) log volume, dashboard "today" stats are computed
 * from raw logs instead of the hourly continuous aggregate. The aggregate only
 * reflects data below its materialization watermark that its refresh policy has
 * actually processed (start_offset = 3h); on instances where the policy is not
 * keeping the aggregate warm, "today" collapses to roughly the last hour (the
 * only part read from raw), which is what makes "Total Logs Today" and the error
 * rate read far too low. Verified live on the hosted demo: 24h = ~1,500 logs,
 * last hour = ~67, yet "Total Logs Today" showed ~60. A raw count over the
 * bounded today/yesterday window is exact and cheap at low volume; higher-volume
 * instances keep the fast aggregate path (their live ingestion keeps it warm).
 */
const RAW_STATS_MAX_RECENT_VOLUME = 5000;

class DashboardService {
  /**
   * Resolve project IDs from org or single project.
   * When projectId is provided, returns [projectId] directly (skips org lookup).
   */
  private async resolveProjectIds(organizationId: string, projectId?: string): Promise<string[]> {
    if (projectId) {
      return [projectId];
    }
    const projects = await db
      .selectFrom('projects')
      .select('id')
      .where('organization_id', '=', organizationId)
      .execute();
    return projects.map((p) => p.id);
  }

  /**
   * Build a cache key that includes projectId when scoped to a single project.
   */
  private buildCacheKey(organizationId: string, metric: string, projectId?: string, extra?: Record<string, unknown>): string {
    const scope = projectId ? `project-${projectId}` : organizationId;
    return CacheManager.statsKey(scope, `dashboard-${metric}`, extra);
  }

  /**
   * Get dashboard statistics for an organization or a single project.
   *
   * PERFORMANCE: Uses continuous aggregates (logs_hourly_stats) for historical data
   * and real-time queries only for the last hour. This provides 10-50x speedup
   * on large datasets (millions of logs).
   *
   * Metrics calculated:
   * - Total logs today (from aggregate + recent)
   * - Error rate (from aggregate + recent)
   * - Active services (count distinct from aggregate - approximation)
   * - Throughput (logs/sec in last hour - real-time)
   */
  async getStats(organizationId: string, projectId?: string): Promise<DashboardStats> {
    // Try cache first (dashboard stats don't need to be real-time)
    const cacheKey = this.buildCacheKey(organizationId, 'stats', projectId);
    const cached = await CacheManager.get<DashboardStats>(cacheKey);

    if (cached) {
      return cached;
    }

    const projectIds = await this.resolveProjectIds(organizationId, projectId);

    if (projectIds.length === 0) {
      return {
        totalLogsToday: { value: 0, trend: 0 },
        errorRate: { value: 0, trend: 0 },
        activeServices: { value: 0, trend: 0 },
        avgThroughput: { value: 0, trend: 0 },
      };
    }

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterdayStart = new Date(todayStart.getTime() - 24 * 60 * 60 * 1000);
    const lastHourStart = new Date(now.getTime() - 60 * 60 * 1000);
    const prevHourStart = new Date(now.getTime() - 2 * 60 * 60 * 1000);

    // Try continuous aggregate first (10-50x faster)
    let result: DashboardStats;
    try {
      result = await this.getStatsFromAggregate(
        projectIds,
        todayStart,
        yesterdayStart,
        lastHourStart,
        prevHourStart
      );
    } catch {
      // Fallback to raw logs if aggregate not available
      result = await this.getStatsFromRawLogs(
        projectIds,
        todayStart,
        yesterdayStart,
        lastHourStart,
        prevHourStart
      );
    }

    // Cache for 1 minute
    await CacheManager.set(cacheKey, result, CACHE_TTL.QUERY);
    return result;
  }

  /**
   * Get stats using continuous aggregates (fast path)
   *
   * PERFORMANCE: This is the critical path for dashboard speed.
   * 1. Uses pre-computed aggregates for 95% of the data.
   * 2. Uses countEstimate for the last hour to avoid scanning millions of rows on TimescaleDB.
   * 3. Falls back to exact count only if estimate is unavailable or volume is very low.
   */
  private async getStatsFromAggregate(
    projectIds: string[],
    todayStart: Date,
    yesterdayStart: Date,
    lastHourStart: Date,
    prevHourStart: Date
  ): Promise<DashboardStats> {
    // 1. Get an initial estimate of the recent log volume.
    // countEstimate is fast on Timescale (EXPLAIN) and ClickHouse (Columnar).
    const recentTotalResult = await reservoir.countEstimate({ 
      projectId: projectIds, 
      from: lastHourStart, 
      to: new Date() 
    });
    const recentVolume = recentTotalResult.count;

    // Low-volume instances (fresh installs, backfilled/seeded data, or a stale
    // continuous aggregate) are exactly where the aggregate undercounts "today",
    // so count today/yesterday from raw for an exact, cheap result.
    if (recentVolume <= RAW_STATS_MAX_RECENT_VOLUME) {
      return this.getStatsFromRawLogs(projectIds, todayStart, yesterdayStart, lastHourStart, prevHourStart);
    }

    // 2. Query aggregate for historical data and reservoir for recent data in parallel
    const [todayAggregateStats, recentTotal, recentErrors, recentServices, yesterdayAggregateStats, prevHourCount] = await Promise.all([
      // Today's historical stats from aggregate (today start to 1 hour ago)
      db
        .selectFrom('logs_hourly_stats')
        .select([
          sql<string>`COALESCE(SUM(log_count), 0)`.as('total'),
          sql<string>`COALESCE(SUM(log_count) FILTER (WHERE level IN ('error', 'critical')), 0)`.as('errors'),
          sql<string>`COUNT(DISTINCT service)`.as('services'),
        ])
        .where('project_id', 'in', projectIds)
        .where('bucket', '>=', todayStart)
        .where('bucket', '<', lastHourStart)
        .executeTakeFirst(),

      // Recent stats from reservoir (last hour)
      // If volume is high (>50k), use the estimate we already got to save a query.
      recentVolume > 50000 
        ? Promise.resolve(recentTotalResult) 
        : reservoir.count({ projectId: projectIds, from: lastHourStart, to: new Date() }),
      
      // Errors in last hour: use estimate if volume is high
      recentVolume > 50000
        ? reservoir.countEstimate({ projectId: projectIds, from: lastHourStart, to: new Date(), level: ['error', 'critical'] })
        : reservoir.count({ projectId: projectIds, from: lastHourStart, to: new Date(), level: ['error', 'critical'] }),
      
      // Active services: scanning millions of rows for DISTINCT is the #1 cause of dashboard lag.
      // We skip real-time distinct if volume is high and rely on the aggregate data.
      recentVolume > 20000 
        ? Promise.resolve({ values: [], executionTimeMs: 0 }) 
        : reservoir.distinct({ field: 'service', projectId: projectIds, from: lastHourStart, to: new Date() }),

      // Yesterday's stats from aggregate
      db
        .selectFrom('logs_hourly_stats')
        .select([
          sql<string>`COALESCE(SUM(log_count), 0)`.as('total'),
          sql<string>`COALESCE(SUM(log_count) FILTER (WHERE level IN ('error', 'critical')), 0)`.as('errors'),
          sql<string>`COUNT(DISTINCT service)`.as('services'),
        ])
        .where('project_id', 'in', projectIds)
        .where('bucket', '>=', yesterdayStart)
        .where('bucket', '<', todayStart)
        .executeTakeFirst(),

      // Previous hour count (for throughput trend)
      recentVolume > 50000
        ? reservoir.countEstimate({ projectId: projectIds, from: prevHourStart, to: lastHourStart })
        : reservoir.count({ projectId: projectIds, from: prevHourStart, to: lastHourStart }),
    ]);

    // Combine aggregate + recent stats
    const todayCount = Number(todayAggregateStats?.total ?? 0) + recentTotal.count;
    const todayErrorCount = Number(todayAggregateStats?.errors ?? 0) + recentErrors.count;
    const yesterdayCount = Number(yesterdayAggregateStats?.total ?? 0);
    const yesterdayErrorCount = Number(yesterdayAggregateStats?.errors ?? 0);

    // Approximate: aggregate distinct + recent distinct (may overcount slightly)
    const todayServiceCount = Number(todayAggregateStats?.services ?? 0) + recentServices.values.length;
    const yesterdayServiceCount = Number(yesterdayAggregateStats?.services ?? 0);

    const lastHourCount = recentTotal.count;

    return this.calculateStats(
      todayCount,
      yesterdayCount,
      todayErrorCount,
      yesterdayErrorCount,
      todayServiceCount,
      yesterdayServiceCount,
      lastHourCount,
      prevHourCount.count
    );
  }

  /**
   * Get stats from raw logs (fallback path - slower but always works)
   */
  private async getStatsFromRawLogs(
    projectIds: string[],
    todayStart: Date,
    yesterdayStart: Date,
    lastHourStart: Date,
    prevHourStart: Date
  ): Promise<DashboardStats> {
    const now = new Date();

    const [todayTotal, todayErrors, todayServices, yesterdayTotal, yesterdayErrors, yesterdayServices, lastHour, prevHour] = await Promise.all([
      reservoir.count({ projectId: projectIds, from: todayStart, to: now }),
      reservoir.count({ projectId: projectIds, from: todayStart, to: now, level: ['error', 'critical'] }),
      reservoir.distinct({ field: 'service', projectId: projectIds, from: todayStart, to: now }),
      reservoir.count({ projectId: projectIds, from: yesterdayStart, to: todayStart }),
      reservoir.count({ projectId: projectIds, from: yesterdayStart, to: todayStart, level: ['error', 'critical'] }),
      reservoir.distinct({ field: 'service', projectId: projectIds, from: yesterdayStart, to: todayStart }),
      reservoir.count({ projectId: projectIds, from: lastHourStart, to: now }),
      reservoir.count({ projectId: projectIds, from: prevHourStart, to: lastHourStart }),
    ]);

    return this.calculateStats(
      todayTotal.count,
      yesterdayTotal.count,
      todayErrors.count,
      yesterdayErrors.count,
      todayServices.values.length,
      yesterdayServices.values.length,
      lastHour.count,
      prevHour.count
    );
  }

  /**
   * Calculate final stats from counts
   */
  private calculateStats(
    todayCount: number,
    yesterdayCount: number,
    todayErrorCount: number,
    yesterdayErrorCount: number,
    todayServiceCount: number,
    yesterdayServiceCount: number,
    lastHourCount: number,
    prevHourCount: number
  ): DashboardStats {
    const logsTrend = yesterdayCount > 0 ? ((todayCount - yesterdayCount) / yesterdayCount) * 100 : 0;
    const todayErrorRate = todayCount > 0 ? (todayErrorCount / todayCount) * 100 : 0;
    const yesterdayErrorRate = yesterdayCount > 0 ? (yesterdayErrorCount / yesterdayCount) * 100 : 0;
    const errorRateTrend = todayErrorRate - yesterdayErrorRate;
    const servicesTrend = todayServiceCount - yesterdayServiceCount;
    const lastHourThroughput = lastHourCount / 3600;
    const prevHourThroughput = prevHourCount / 3600;
    const throughputTrend =
      prevHourThroughput > 0 ? ((lastHourThroughput - prevHourThroughput) / prevHourThroughput) * 100 : 0;

    return {
      totalLogsToday: {
        value: todayCount,
        trend: logsTrend,
      },
      errorRate: {
        value: todayErrorRate,
        trend: errorRateTrend,
      },
      activeServices: {
        value: todayServiceCount,
        trend: servicesTrend,
      },
      avgThroughput: {
        value: lastHourThroughput,
        trend: throughputTrend,
      },
    };
  }

  /**
   * Get timeseries data for dashboard chart (last 24 hours, hourly buckets)
   *
   * Performance optimization: Uses pre-computed continuous aggregate (logs_hourly_stats)
   * for historical data (>1 hour old), with real-time query for the most recent hour.
   * This provides 10-50x faster queries for dashboard charts.
   */
  async getTimeseries(organizationId: string, projectId?: string): Promise<TimeseriesDataPoint[]> {
    // Try cache first
    const cacheKey = this.buildCacheKey(organizationId, 'timeseries', projectId);
    const cached = await CacheManager.get<TimeseriesDataPoint[]>(cacheKey);

    if (cached) {
      return cached;
    }

    const projectIds = await this.resolveProjectIds(organizationId, projectId);

    if (projectIds.length === 0) {
      return [];
    }

    const now = new Date();
    const last24Hours = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const lastHour = new Date(now.getTime() - 60 * 60 * 1000);

    // Try to use continuous aggregate for historical data (>1 hour old)
    // This is much faster than real-time aggregation
    let historicalResults: Array<{ bucket: string | Date; level: string; count: string }> = [];
    let recentResults: Array<{ bucket: string; level: string; count: string }> = [];

    try {
      if (reservoir.getEngineType() !== 'timescale') throw new Error('skip aggregate');

      // Query pre-computed hourly stats (fast path, TimescaleDB only)
      historicalResults = await db
        .selectFrom('logs_hourly_stats')
        .select([
          'bucket',
          'level',
          sql<string>`sum(log_count)`.as('count'),
        ])
        .where('project_id', 'in', projectIds)
        .where('bucket', '>=', last24Hours)
        .where('bucket', '<', lastHour)
        .groupBy(['bucket', 'level'])
        .orderBy('bucket', 'asc')
        .execute();
    } catch {
      // Fallback: use reservoir aggregate
      const aggResult = await reservoir.aggregate({
        projectId: projectIds,
        from: last24Hours,
        to: lastHour,
        interval: '1h',
      });
      historicalResults = aggResult.timeseries.flatMap((bucket: { bucket: Date; byLevel?: Record<string, number> }) => {
        const entries: Array<{ bucket: string | Date; level: string; count: string }> = [];
        if (bucket.byLevel) {
          for (const [level, count] of Object.entries(bucket.byLevel) as [string, number][]) {
            if (count > 0) {
              entries.push({ bucket: bucket.bucket, level, count: String(count) });
            }
          }
        }
        return entries;
      });
    }

    // Query real-time data for the last hour using reservoir
    const recentAgg = await reservoir.aggregate({
      projectId: projectIds,
      from: lastHour,
      to: now,
      interval: '1h',
    });
    recentResults = recentAgg.timeseries.flatMap((bucket: { bucket: Date; byLevel?: Record<string, number> }) => {
      const entries: Array<{ bucket: string; level: string; count: string }> = [];
      if (bucket.byLevel) {
        for (const [level, count] of Object.entries(bucket.byLevel) as [string, number][]) {
          if (count > 0) {
            entries.push({ bucket: bucket.bucket.toISOString(), level, count: String(count) });
          }
        }
      }
      return entries;
    });

    // Combine historical and recent results
    const allResults = [...historicalResults, ...recentResults];

    // Transform to timeseries format
    const bucketMap = new Map<string, TimeseriesDataPoint>();

    for (const row of allResults) {
      // Normalize bucket timestamp to ISO string for consistent Map keys
      const bucketKey = new Date(row.bucket).toISOString();

      if (!bucketMap.has(bucketKey)) {
        bucketMap.set(bucketKey, {
          time: bucketKey,
          total: 0,
          debug: 0,
          info: 0,
          warn: 0,
          error: 0,
          critical: 0,
        });
      }

      const point = bucketMap.get(bucketKey)!;
      const count = Number(row.count ?? 0);
      point.total += count;

      switch (row.level) {
        case 'debug':
          point.debug += count;
          break;
        case 'info':
          point.info += count;
          break;
        case 'warn':
          point.warn += count;
          break;
        case 'error':
          point.error += count;
          break;
        case 'critical':
          point.critical += count;
          break;
      }
    }

    const timeseriesResult = Array.from(bucketMap.values());

    // Cache for 1 minute
    await CacheManager.set(cacheKey, timeseriesResult, CACHE_TTL.QUERY);

    return timeseriesResult;
  }

  /**
   * Get top services by log count (organization-wide, last 7 days)
   *
   * PERFORMANCE: Uses continuous aggregate (logs_daily_stats) for historical data
   * and raw logs only for the most recent day. This provides 10-50x speedup.
   */
  async getTopServices(organizationId: string, limit: number = 5, projectId?: string): Promise<Array<{ name: string; count: number; percentage: number }>> {
    // Try cache first
    const cacheKey = this.buildCacheKey(organizationId, 'top-services', projectId, { limit });
    const cached = await CacheManager.get<Array<{ name: string; count: number; percentage: number }>>(cacheKey);

    if (cached) {
      return cached;
    }

    const projectIds = await this.resolveProjectIds(organizationId, projectId);

    if (projectIds.length === 0) {
      return [];
    }

    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    let result: Array<{ name: string; count: number; percentage: number }>;
    try {
      result = await this.getTopServicesFromAggregate(projectIds, sevenDaysAgo, oneDayAgo, limit);
    } catch {
      // Fallback to raw logs
      result = await this.getTopServicesFromRawLogs(projectIds, sevenDaysAgo, limit);
    }

    // Cache for 5 minutes
    await CacheManager.set(cacheKey, result, CACHE_TTL.STATS);

    return result;
  }

  /**
   * Get top services using continuous aggregates (fast path)
   */
  private async getTopServicesFromAggregate(
    projectIds: string[],
    sevenDaysAgo: Date,
    oneDayAgo: Date,
    limit: number
  ): Promise<Array<{ name: string; count: number; percentage: number }>> {
    // Query historical data from daily aggregate + recent data from reservoir
    const [historicalServices, recentServices] = await Promise.all([
      // 7 days ago to 1 day ago (use daily stats)
      db
        .selectFrom('logs_daily_stats')
        .select(['service', sql<string>`SUM(log_count)`.as('count')])
        .where('project_id', 'in', projectIds)
        .where('bucket', '>=', sevenDaysAgo)
        .where('bucket', '<', oneDayAgo)
        .groupBy('service')
        .execute(),

      // Last 24 hours from reservoir
      reservoir.topValues({
        field: 'service',
        projectId: projectIds,
        from: oneDayAgo,
        to: new Date(),
        limit: 100,
      }),
    ]);

    // Merge service counts
    const serviceMap = new Map<string, number>();

    for (const row of historicalServices) {
      serviceMap.set(row.service, Number(row.count ?? 0));
    }

    for (const row of recentServices.values) {
      const existing = serviceMap.get(row.value) ?? 0;
      serviceMap.set(row.value, existing + row.count);
    }

    const total = Array.from(serviceMap.values()).reduce((sum, count) => sum + count, 0);

    if (total === 0) {
      return [];
    }

    // Sort and limit
    return Array.from(serviceMap.entries())
      .map(([service, count]) => ({
        name: service,
        count,
        percentage: Math.round((count / total) * 100),
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  }

  /**
   * Get top services from raw logs (fallback path)
   */
  private async getTopServicesFromRawLogs(
    projectIds: string[],
    sevenDaysAgo: Date,
    limit: number
  ): Promise<Array<{ name: string; count: number; percentage: number }>> {
    const [totalResult, topResult] = await Promise.all([
      reservoir.count({ projectId: projectIds, from: sevenDaysAgo, to: new Date() }),
      reservoir.topValues({ field: 'service', projectId: projectIds, from: sevenDaysAgo, to: new Date(), limit }),
    ]);

    const total = totalResult.count;
    if (total === 0) return [];

    return topResult.values.map((s: { value: string; count: number }) => ({
      name: s.value,
      count: s.count,
      percentage: Math.round((s.count / total) * 100),
    }));
  }

  /**
   * Get timeline events (alerts + detections) for last 24 hours, bucketed by hour.
   * Used to overlay markers on the dashboard logs chart.
   */
  async getTimelineEvents(organizationId: string, projectId?: string): Promise<TimelineEvent[]> {
    const projectIds = await this.resolveProjectIds(organizationId, projectId);

    if (projectIds.length === 0) {
      return [];
    }

    const now = new Date();
    const last24Hours = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const lastHour = new Date(now.getTime() - 60 * 60 * 1000);

    // Query alerts from alert_history JOIN alert_rules (last 24h)
    let alertQuery = db
      .selectFrom('alert_history')
      .innerJoin('alert_rules', 'alert_rules.id', 'alert_history.rule_id')
      .select([
        sql<string>`time_bucket('1 hour', alert_history.triggered_at)`.as('bucket'),
        'alert_rules.name as rule_name',
        sql<string>`COALESCE(alert_rules.alert_type, 'threshold')`.as('alert_type'),
        'alert_history.log_count',
      ])
      .where('alert_rules.organization_id', '=', organizationId)
      .where('alert_history.triggered_at', '>=', last24Hours);

    if (projectId) {
      alertQuery = alertQuery.where('alert_rules.project_id', '=', projectId);
    }

    const alertRows = await alertQuery.execute();

    // Query detections - try continuous aggregate first, fallback to raw
    let detectionRows: Array<{ bucket: string | Date; severity: string; count: string }> = [];

    try {
      // Historical from aggregate + recent from raw
      let histQuery = db
        .selectFrom('detection_events_hourly_stats')
        .select([
          'bucket',
          'severity',
          sql<string>`SUM(detection_count)`.as('count'),
        ])
        .where('organization_id', '=', organizationId)
        .where('bucket', '>=', last24Hours)
        .where('bucket', '<', lastHour);

      let recentQuery = db
        .selectFrom('detection_events')
        .select([
          sql<string>`time_bucket('1 hour', time)`.as('bucket'),
          'severity',
          sql<string>`COUNT(*)`.as('count'),
        ])
        .where('organization_id', '=', organizationId)
        .where('time', '>=', lastHour);

      if (projectId) {
        histQuery = histQuery.where('project_id', '=', projectId);
        recentQuery = recentQuery.where('project_id', '=', projectId);
      }

      const [historicalDetections, recentDetections] = await Promise.all([
        histQuery.groupBy(['bucket', 'severity']).execute(),
        recentQuery.groupBy(['bucket', 'severity']).execute(),
      ]);

      detectionRows = [...historicalDetections, ...recentDetections];
    } catch {
      // Fallback: query raw detection_events for full 24h
      let fallbackQuery = db
        .selectFrom('detection_events')
        .select([
          sql<string>`time_bucket('1 hour', time)`.as('bucket'),
          'severity',
          sql<string>`COUNT(*)`.as('count'),
        ])
        .where('organization_id', '=', organizationId)
        .where('time', '>=', last24Hours);

      if (projectId) {
        fallbackQuery = fallbackQuery.where('project_id', '=', projectId);
      }

      detectionRows = await fallbackQuery
        .groupBy(['bucket', 'severity'])
        .execute();
    }

    // Merge into hourly buckets
    const bucketMap = new Map<string, TimelineEvent>();

    for (const row of alertRows) {
      const bucketKey = new Date(row.bucket).toISOString();
      if (!bucketMap.has(bucketKey)) {
        bucketMap.set(bucketKey, {
          time: bucketKey,
          alerts: 0,
          detections: 0,
          alertDetails: [],
          detectionsBySeverity: { critical: 0, high: 0, medium: 0, low: 0 },
        });
      }
      const event = bucketMap.get(bucketKey)!;
      event.alerts += 1;
      event.alertDetails.push({
        ruleName: row.rule_name,
        alertType: row.alert_type,
        logCount: row.log_count,
      });
    }

    for (const row of detectionRows) {
      const bucketKey = new Date(row.bucket).toISOString();
      if (!bucketMap.has(bucketKey)) {
        bucketMap.set(bucketKey, {
          time: bucketKey,
          alerts: 0,
          detections: 0,
          alertDetails: [],
          detectionsBySeverity: { critical: 0, high: 0, medium: 0, low: 0 },
        });
      }
      const event = bucketMap.get(bucketKey)!;
      const count = Number(row.count ?? 0);
      event.detections += count;

      const sev = (row.severity || '').toLowerCase();
      if (sev === 'critical') event.detectionsBySeverity.critical += count;
      else if (sev === 'high') event.detectionsBySeverity.high += count;
      else if (sev === 'medium') event.detectionsBySeverity.medium += count;
      else event.detectionsBySeverity.low += count;
    }

    return Array.from(bucketMap.values());
  }

  /**
   * Get recent errors (last 10 error/critical logs)
   *
   * PERFORMANCE: Added time filter (last 24h) to use partial index
   * idx_logs_project_errors instead of scanning the entire table.
   * Results are cached for 1 minute.
   */
  async getRecentErrors(organizationId: string, projectId?: string): Promise<RecentError[]> {
    // Try cache first
    const cacheKey = this.buildCacheKey(organizationId, 'recent-errors', projectId);
    const cached = await CacheManager.get<RecentError[]>(cacheKey);

    if (cached) {
      return cached;
    }

    const projectIds = await this.resolveProjectIds(organizationId, projectId);

    if (projectIds.length === 0) {
      return [];
    }

    const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const queryResult = await reservoir.query({
      projectId: projectIds,
      level: ['error', 'critical'],
      from: last24h,
      to: new Date(),
      limit: 10,
      sortOrder: 'desc',
    });

    const result = queryResult.logs.map((e: { time: Date; service: string; level: string; message: string; projectId: string; traceId?: string }) => ({
      time: e.time.toISOString(),
      service: e.service,
      level: e.level as 'error' | 'critical',
      message: e.message,
      projectId: e.projectId || '',
      traceId: e.traceId || undefined,
    }));

    // Cache for 1 minute
    await CacheManager.set(cacheKey, result, CACHE_TTL.QUERY);

    return result;
  }
}

export const dashboardService = new DashboardService();
