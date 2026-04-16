import { db } from '../../database/index.js';
import { reservoir } from '../../database/reservoir.js';
import type { TimeBucket, StoredLogRecord } from '@logtide/reservoir';
import { CacheManager, CACHE_TTL } from '../../utils/cache.js';
import type { LogLevel } from '@logtide/shared';

/** Supported search modes */
export type SearchMode = 'fulltext' | 'substring';

export interface LogQueryParams {
  projectId: string | string[]; // Support single or multiple projects
  service?: string | string[]; // Support single or multiple services
  level?: LogLevel | LogLevel[]; // Support single or multiple levels
  hostname?: string | string[]; // Filter by hostname (from metadata.hostname)
  traceId?: string; // Filter by trace ID
  sessionId?: string; // Filter by browser session ID
  from?: Date;
  to?: Date;
  q?: string; // Search query
  searchMode?: SearchMode; // Search mode: 'fulltext' (default) or 'substring'
  limit?: number;
  offset?: number;
  cursor?: string;
}

export class QueryService {
  /**
   * Query logs with filters
   * Cached for performance - common queries are frequently repeated
   *
   * PERFORMANCE: Always uses a time filter (defaults to last 24h)
   * to prevent full table scans on large datasets.
   */
  async queryLogs(params: LogQueryParams) {
    const {
      projectId,
      service,
      level,
      hostname,
      traceId,
      sessionId,
      from,
      to,
      q,
      searchMode = 'fulltext',
      limit = 100,
      offset = 0,
      cursor,
    } = params;

    // PERFORMANCE: Default to last 24h if no time filter provided
    const effectiveFrom = from || new Date(Date.now() - 24 * 60 * 60 * 1000);

    // Generate deterministic cache key
    const cacheParams = {
      service: service || null,
      level: level || null,
      hostname: hostname || null,
      traceId: traceId || null,
      sessionId: sessionId || null,
      from: effectiveFrom.toISOString(),
      to: to?.toISOString() || null,
      q: q || null,
      searchMode: searchMode || 'fulltext',
      limit,
      offset,
      cursor: cursor || null,
    };
    const cacheKey = CacheManager.queryKey(projectId, cacheParams);
    const cached = await CacheManager.get<any>(cacheKey);

    if (cached && cached.total !== -1) {
      return {
        ...cached,
        logs: cached.logs.map((log: any) => ({
          ...log,
          time: new Date(log.time),
        })),
      };
    }

    // Delegate to reservoir (raw parametrized SQL, no Kysely overhead)
    const effectiveTo = to ?? new Date();
    const commonParams = {
      projectId,
      service,
      level,
      hostname,
      traceId,
      sessionId,
      from: effectiveFrom,
      to: effectiveTo,
      search: q,
      searchMode,
    };

    // Run data query and count query in parallel
    const [queryResult, countResult] = await Promise.all([
      reservoir.query({
        ...commonParams,
        limit,
        offset,
        cursor,
      }),
      reservoir.countEstimate(commonParams),
    ]);

    // Map reservoir StoredLogRecord to API format
    const logs = queryResult.logs.map((log: StoredLogRecord) => ({
      id: log.id,
      time: log.time,
      projectId: log.projectId,
      service: log.service,
      level: log.level,
      message: log.message,
      metadata: log.metadata,
      traceId: log.traceId,
      sessionId: log.sessionId,
    }));

    const result = {
      logs,
      total: countResult.count,
      hasMore: queryResult.hasMore,
      limit: queryResult.limit,
      offset: queryResult.offset,
      nextCursor: queryResult.nextCursor,
    };

    await CacheManager.set(cacheKey, result, CACHE_TTL.QUERY);

    return result;
  }

  /**
   * Get a single log by ID
   */
  async getLogById(logId: string, projectId: string) {
    const log = await reservoir.getById({ id: logId, projectId });

    if (!log) {
      return null;
    }

    return {
      id: log.id,
      time: log.time,
      projectId: log.projectId,
      service: log.service,
      level: log.level,
      message: log.message,
      metadata: log.metadata,
      traceId: log.traceId,
    };
  }

  /**
   * Get logs by trace ID
   * Cached for longer since trace data is immutable
   */
  async getLogsByTraceId(projectId: string, traceId: string) {
    // Try cache first
    const cacheKey = CacheManager.traceKey(projectId, traceId);
    const cached = await CacheManager.get<any[]>(cacheKey);

    if (cached) {
      return cached.map(log => ({
        ...log,
        time: new Date(log.time),
      }));
    }

    // Query through reservoir (works with any engine)
    const queryResult = await reservoir.query({
      projectId,
      traceId,
      from: new Date(0), // All time - trace correlation needs all logs
      to: new Date(),
      sortOrder: 'asc',
      limit: 1000,
    });

    const result = queryResult.logs.map((log: { id: string; time: Date; projectId: string; service: string; level: string; message: string; metadata?: Record<string, unknown>; traceId?: string }) => ({
      id: log.id,
      time: log.time,
      projectId: log.projectId,
      service: log.service,
      level: log.level,
      message: log.message,
      metadata: log.metadata,
      traceId: log.traceId,
    }));

    // Cache for longer since trace data is immutable
    await CacheManager.set(cacheKey, result, CACHE_TTL.TRACE);

    return result;
  }

  /**
   * Get log context (logs before and after a specific timestamp)
   */
  async getLogContext(params: {
    projectId: string;
    time: Date;
    before?: number;
    after?: number;
  }) {
    const { projectId, time, before = 10, after = 10 } = params;

    const [beforeResult, afterResult, currentResult] = await Promise.all([
      // Logs before (exclusive, descending → then reverse)
      reservoir.query({
        projectId,
        from: new Date(0),
        to: time,
        toExclusive: true,
        sortOrder: 'desc',
        limit: before,
      }),
      // Logs after (exclusive, ascending) - no upper bound needed
      reservoir.query({
        projectId,
        from: time,
        fromExclusive: true,
        to: new Date('9999-12-31T23:59:59.999Z'),
        sortOrder: 'asc',
        limit: after,
      }),
      // Current log at exact time
      reservoir.query({
        projectId,
        from: time,
        to: time,
        limit: 1,
      }),
    ]);

    const mapLog = (log: StoredLogRecord) => ({
      id: log.id,
      time: log.time,
      projectId: log.projectId,
      service: log.service,
      level: log.level,
      message: log.message,
      metadata: log.metadata,
      traceId: log.traceId,
    });

    return {
      before: beforeResult.logs.reverse().map(mapLog),
      current: currentResult.logs.length > 0 ? mapLog(currentResult.logs[0]) : null,
      after: afterResult.logs.map(mapLog),
    };
  }

  /**
   * Get aggregated statistics with time buckets
   */
  async getAggregatedStats(params: {
    projectId: string;
    service?: string;
    from: Date;
    to: Date;
    interval: '1m' | '5m' | '1h' | '1d';
  }) {
    const { projectId, service, from, to, interval } = params;

    const aggResult = await reservoir.aggregate({
      projectId,
      service,
      from,
      to,
      interval,
    });

    // Map reservoir format (byLevel) to existing API format (by_level)
    const timeseries = aggResult.timeseries.map((bucket: TimeBucket) => ({
      bucket: bucket.bucket,
      total: bucket.total,
      by_level: bucket.byLevel ?? {},
    }));

    return { timeseries };
  }

  /**
   * Get top services by log count
   * Cached for performance - aggregation queries are expensive
   *
   * PERFORMANCE: Uses logs_daily_stats continuous aggregate for historical data
   * and raw logs only for the most recent day. Falls back to raw logs if aggregate unavailable.
   */
  async getTopServices(projectId: string, limit: number = 5, from?: Date, to?: Date) {
    // PERFORMANCE: Default to last 7 days if no time filter provided
    const effectiveFrom = from || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    // Try cache first
    const cacheKey = CacheManager.statsKey(projectId, 'top-services', {
      limit,
      from: effectiveFrom.toISOString(),
      to: to?.toISOString() || null,
    });
    const cached = await CacheManager.get<any[]>(cacheKey);

    if (cached) {
      return cached;
    }

    let result: Array<{ service: string; count: string | number | bigint }>;

    try {
      if (reservoir.getEngineType() !== 'timescale') throw new Error('skip aggregate');

      // Fast path: use continuous aggregate (TimescaleDB only)
      const { sql } = await import('kysely');
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

      const [historicalServices, recentServices] = await Promise.all([
        db
          .selectFrom('logs_daily_stats')
          .select(['service', sql<string>`SUM(log_count)`.as('count')])
          .where('project_id', '=', projectId)
          .where('bucket', '>=', effectiveFrom)
          .where('bucket', '<', oneDayAgo)
          .groupBy('service')
          .execute(),
        reservoir.topValues({
          field: 'service',
          projectId,
          from: oneDayAgo,
          to: to ?? new Date(),
          limit: 100,
        }),
      ]);

      const serviceMap = new Map<string, number>();
      for (const row of historicalServices) {
        serviceMap.set(row.service, Number(row.count ?? 0));
      }
      for (const row of recentServices.values) {
        const existing = serviceMap.get(row.value) ?? 0;
        serviceMap.set(row.value, existing + row.count);
      }

      result = Array.from(serviceMap.entries())
        .map(([service, count]) => ({ service, count }))
        .sort((a, b) => Number(b.count) - Number(a.count))
        .slice(0, limit);
    } catch {
      // Fallback: reservoir topValues (works on any engine)
      const topResult = await reservoir.topValues({
        field: 'service',
        projectId,
        from: effectiveFrom,
        to: to ?? new Date(),
        limit,
      });
      result = topResult.values.map((v: { value: string; count: number }) => ({ service: v.value, count: v.count }));
    }

    // Cache aggregation results
    await CacheManager.set(cacheKey, result, CACHE_TTL.STATS);

    return result;
  }

  /**
   * Get all distinct services for given projects
   * Cached for performance - used for filter dropdowns
   *
   * PERFORMANCE: Uses logs_daily_stats continuous aggregate instead of scanning
   * raw logs. Falls back to raw logs with 7-day window if aggregate unavailable.
   */
  async getDistinctServices(
    projectId: string | string[],
    from?: Date,
    to?: Date
  ): Promise<string[]> {
    // PERFORMANCE: Default to last 7 days (reduced from 30)
    const effectiveFrom = from || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    // Try cache first
    const cacheKey = CacheManager.statsKey(
      Array.isArray(projectId) ? projectId.join(',') : projectId,
      'distinct-services',
      {
        from: effectiveFrom.toISOString(),
        to: to?.toISOString() || null,
      }
    );
    const cached = await CacheManager.get<string[]>(cacheKey);

    if (cached) {
      return cached;
    }

    let services: string[];

    try {
      if (reservoir.getEngineType() !== 'timescale') throw new Error('skip aggregate');

      // Fast path: combine aggregate (historical) + reservoir distinct (recent)
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const projectFilter = Array.isArray(projectId) ? projectId : [projectId];

      const [aggResults, recentResults] = await Promise.all([
        db
          .selectFrom('logs_daily_stats')
          .select('service')
          .distinct()
          .where('service', 'is not', null)
          .where('service', '!=', '')
          .where('project_id', 'in', projectFilter)
          .where('bucket', '>=', effectiveFrom)
          .where('bucket', '<', oneDayAgo)
          .$if(!!to, (qb) => qb.where('bucket', '<=', to!))
          .execute(),
        reservoir.distinct({
          field: 'service',
          projectId,
          from: oneDayAgo,
          to: to ?? new Date(),
        }),
      ]);

      const serviceSet = new Set<string>();
      for (const r of aggResults) serviceSet.add(r.service);
      for (const v of recentResults.values) serviceSet.add(v);
      services = Array.from(serviceSet).sort();
    } catch {
      // Fallback: reservoir distinct (works on any engine)
      const result = await reservoir.distinct({
        field: 'service',
        projectId,
        from: effectiveFrom,
        to: to ?? new Date(),
      });
      services = result.values;
    }

    // Cache for 5 minutes
    await CacheManager.set(cacheKey, services, CACHE_TTL.STATS);

    return services;
  }

  /**
   * Get all distinct hostnames from logs within a time range.
   * Hostnames are extracted from metadata.hostname field.
   * Cached for performance - used for filter dropdowns.
   *
   * PERFORMANCE: Window is capped at 6 hours regardless of what the caller passes.
   * JSONB extraction is expensive on large datasets - 6h ≈ 350ms, 24h+ ≈ 8s+.
   * For a filter dropdown this is an acceptable trade-off: hostnames are stable.
   * With 5-minute cache, most requests are served from cache after the first hit.
   */
  async getDistinctHostnames(
    projectId: string | string[],
    from?: Date,
    to?: Date
  ): Promise<string[]> {
    // PERFORMANCE: Cap window to 6h max. If the caller requests a longer window
    // (e.g. 24h), silently clamp it - JSONB distinct over large ranges is O(rows).
    const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000);
    const effectiveFrom = !from || from < sixHoursAgo ? sixHoursAgo : from;

    // Try cache first
    const cacheKey = CacheManager.statsKey(
      Array.isArray(projectId) ? projectId.join(',') : projectId,
      'distinct-hostnames',
      {
        from: effectiveFrom.toISOString(),
        to: to?.toISOString() || null,
      }
    );
    const cached = await CacheManager.get<string[]>(cacheKey);

    if (cached) {
      return cached;
    }

    // Query through reservoir (works with any engine - handles JSONB vs JSON extraction)
    const result = await reservoir.distinct({
      field: 'metadata.hostname',
      projectId,
      from: effectiveFrom,
      to: to ?? new Date(),
      limit: 500,
    });

    const hostnames = result.values;

    // Cache for 5 minutes
    await CacheManager.set(cacheKey, hostnames, CACHE_TTL.STATS);

    return hostnames;
  }

  /**
   * Get top error messages
   * Cached for performance - aggregation queries are expensive
   *
   * PERFORMANCE: Defaults to last 24 hours (reduced from 7 days).
   * GROUP BY message is inherently expensive so we keep the window tight.
   * Uses partial index idx_logs_project_errors for fast error filtering.
   */
  async getTopErrors(projectId: string, limit: number = 10, from?: Date, to?: Date) {
    // PERFORMANCE: Default to last 24 hours (reduced from 7 days)
    // GROUP BY message on full text is expensive, keep window tight
    const effectiveFrom = from || new Date(Date.now() - 24 * 60 * 60 * 1000);

    // Try cache first
    const cacheKey = CacheManager.statsKey(projectId, 'top-errors', {
      limit,
      from: effectiveFrom.toISOString(),
      to: to?.toISOString() || null,
    });
    const cached = await CacheManager.get<any[]>(cacheKey);

    if (cached) {
      return cached;
    }

    const topResult = await reservoir.topValues({
      field: 'message',
      projectId,
      from: effectiveFrom,
      to: to ?? new Date(),
      level: ['error', 'critical'],
      limit,
    });
    const result = topResult.values.map((v: { value: string; count: number }) => ({ message: v.value, count: v.count }));

    // Cache aggregation results
    await CacheManager.set(cacheKey, result, CACHE_TTL.STATS);

    return result;
  }
}

export const queryService = new QueryService();
