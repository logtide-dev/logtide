import { db } from '../../database/index.js';
import { sql } from 'kysely';

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

class DashboardService {
  /**
   * Get dashboard statistics for an organization
   */
  async getStats(organizationId: string): Promise<DashboardStats> {
    // Get all project IDs for this organization
    const projects = await db
      .selectFrom('projects')
      .select('id')
      .where('organization_id', '=', organizationId)
      .execute();

    const projectIds = projects.map((p) => p.id);

    if (projectIds.length === 0) {
      // No projects, return zeros
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
    const yesterdayEnd = todayStart;
    const lastHourStart = new Date(now.getTime() - 60 * 60 * 1000);
    const prevHourStart = new Date(now.getTime() - 2 * 60 * 60 * 1000);
    const prevHourEnd = lastHourStart;

    // Total logs today vs yesterday
    const [todayLogs, yesterdayLogs] = await Promise.all([
      db
        .selectFrom('logs')
        .select(sql<string>`count(*)`.as('count'))
        .where('project_id', 'in', projectIds)
        .where('time', '>=', todayStart)
        .executeTakeFirst(),
      db
        .selectFrom('logs')
        .select(sql<string>`count(*)`.as('count'))
        .where('project_id', 'in', projectIds)
        .where('time', '>=', yesterdayStart)
        .where('time', '<', yesterdayEnd)
        .executeTakeFirst(),
    ]);

    const todayCount = parseInt(todayLogs?.count || '0');
    const yesterdayCount = parseInt(yesterdayLogs?.count || '0');
    const logsTrend = yesterdayCount > 0 ? ((todayCount - yesterdayCount) / yesterdayCount) * 100 : 0;

    // Error rate today vs yesterday (percentage of error + critical logs)
    const [todayErrors, yesterdayErrors] = await Promise.all([
      db
        .selectFrom('logs')
        .select(sql<string>`count(*)`.as('count'))
        .where('project_id', 'in', projectIds)
        .where('time', '>=', todayStart)
        .where('level', 'in', ['error', 'critical'])
        .executeTakeFirst(),
      db
        .selectFrom('logs')
        .select(sql<string>`count(*)`.as('count'))
        .where('project_id', 'in', projectIds)
        .where('time', '>=', yesterdayStart)
        .where('time', '<', yesterdayEnd)
        .where('level', 'in', ['error', 'critical'])
        .executeTakeFirst(),
    ]);

    const todayErrorCount = parseInt(todayErrors?.count || '0');
    const yesterdayErrorCount = parseInt(yesterdayErrors?.count || '0');
    const todayErrorRate = todayCount > 0 ? (todayErrorCount / todayCount) * 100 : 0;
    const yesterdayErrorRate = yesterdayCount > 0 ? (yesterdayErrorCount / yesterdayCount) * 100 : 0;
    const errorRateTrend = todayErrorRate - yesterdayErrorRate; // percentage points

    // Active services today vs yesterday (distinct services)
    const [todayServices, yesterdayServices] = await Promise.all([
      db
        .selectFrom('logs')
        .select(sql<string>`count(distinct service)`.as('count'))
        .where('project_id', 'in', projectIds)
        .where('time', '>=', todayStart)
        .executeTakeFirst(),
      db
        .selectFrom('logs')
        .select(sql<string>`count(distinct service)`.as('count'))
        .where('project_id', 'in', projectIds)
        .where('time', '>=', yesterdayStart)
        .where('time', '<', yesterdayEnd)
        .executeTakeFirst(),
    ]);

    const todayServiceCount = parseInt(todayServices?.count || '0');
    const yesterdayServiceCount = parseInt(yesterdayServices?.count || '0');
    const servicesTrend = todayServiceCount - yesterdayServiceCount;

    // Throughput: logs per second (last hour vs previous hour)
    const [lastHourLogs, prevHourLogs] = await Promise.all([
      db
        .selectFrom('logs')
        .select(sql<string>`count(*)`.as('count'))
        .where('project_id', 'in', projectIds)
        .where('time', '>=', lastHourStart)
        .executeTakeFirst(),
      db
        .selectFrom('logs')
        .select(sql<string>`count(*)`.as('count'))
        .where('project_id', 'in', projectIds)
        .where('time', '>=', prevHourStart)
        .where('time', '<', prevHourEnd)
        .executeTakeFirst(),
    ]);

    const lastHourCount = parseInt(lastHourLogs?.count || '0');
    const prevHourCount = parseInt(prevHourLogs?.count || '0');
    const lastHourThroughput = lastHourCount / 3600; // logs per second
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
  async getTimeseries(organizationId: string): Promise<TimeseriesDataPoint[]> {
    // Get all project IDs for this organization
    const projects = await db
      .selectFrom('projects')
      .select('id')
      .where('organization_id', '=', organizationId)
      .execute();

    const projectIds = projects.map((p) => p.id);

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
      // Query pre-computed hourly stats (fast path)
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
      // Continuous aggregate not available, fall back to regular query
      historicalResults = await db
        .selectFrom('logs')
        .select([
          sql<string>`time_bucket('1 hour', time)`.as('bucket'),
          'level',
          sql<string>`count(*)`.as('count'),
        ])
        .where('project_id', 'in', projectIds)
        .where('time', '>=', last24Hours)
        .where('time', '<', lastHour)
        .groupBy(['bucket', 'level'])
        .orderBy('bucket', 'asc')
        .execute();
    }

    // Query real-time data for the last hour (not yet aggregated)
    recentResults = await db
      .selectFrom('logs')
      .select([
        sql<string>`time_bucket('1 hour', time)`.as('bucket'),
        'level',
        sql<string>`count(*)`.as('count'),
      ])
      .where('project_id', 'in', projectIds)
      .where('time', '>=', lastHour)
      .groupBy(['bucket', 'level'])
      .orderBy('bucket', 'asc')
      .execute();

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
      const count = parseInt(row.count);
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

    return Array.from(bucketMap.values());
  }

  /**
   * Get top services by log count (organization-wide)
   */
  async getTopServices(organizationId: string, limit: number = 5): Promise<Array<{ name: string; count: number; percentage: number }>> {
    // Get all project IDs for this organization
    const projects = await db
      .selectFrom('projects')
      .select('id')
      .where('organization_id', '=', organizationId)
      .execute();

    const projectIds = projects.map((p) => p.id);

    if (projectIds.length === 0) {
      return [];
    }

    // Get total count for percentage calculation
    const totalResult = await db
      .selectFrom('logs')
      .select(sql<string>`count(*)`.as('total'))
      .where('project_id', 'in', projectIds)
      .executeTakeFirst();

    const total = parseInt(totalResult?.total || '0');

    if (total === 0) {
      return [];
    }

    // Get top services
    const services = await db
      .selectFrom('logs')
      .select(['service', sql<string>`count(*)`.as('count')])
      .where('project_id', 'in', projectIds)
      .groupBy('service')
      .orderBy('count', 'desc')
      .limit(limit)
      .execute();

    return services.map((s) => {
      const count = parseInt(s.count);
      return {
        name: s.service,
        count,
        percentage: Math.round((count / total) * 100),
      };
    });
  }

  /**
   * Get recent errors (last 10 error/critical logs)
   */
  async getRecentErrors(organizationId: string): Promise<RecentError[]> {
    // Get all project IDs for this organization
    const projects = await db
      .selectFrom('projects')
      .select('id')
      .where('organization_id', '=', organizationId)
      .execute();

    const projectIds = projects.map((p) => p.id);

    if (projectIds.length === 0) {
      return [];
    }

    const errors = await db
      .selectFrom('logs')
      .select(['time', 'service', 'level', 'message', 'project_id', 'trace_id'])
      .where('project_id', 'in', projectIds)
      .where('level', 'in', ['error', 'critical'])
      .orderBy('time', 'desc')
      .limit(10)
      .execute();

    return errors.map((e) => ({
      time: e.time.toISOString(),
      service: e.service,
      level: e.level as 'error' | 'critical',
      message: e.message,
      projectId: e.project_id || '',
      traceId: e.trace_id || undefined,
    }));
  }
}

export const dashboardService = new DashboardService();
