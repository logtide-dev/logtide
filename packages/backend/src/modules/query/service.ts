import { db } from '../../database/index.js';
import { reservoir } from '../../database/reservoir.js';
import type { TimeBucket, StoredLogRecord, IReservoir } from '@logtide/reservoir';
import { CacheManager, CACHE_TTL } from '../../utils/cache.js';
import { resolveFieldKey } from '@logtide/shared';
import type { LogLevel, LogSearchQuery, MetadataFilter } from '@logtide/shared';
import { hooks } from '../../hooks/index.js';
import { context } from '@logtide/shared/context';
import { buildLogFilter, type SearchMode } from './build-log-filter.js';
import { MAX_HISTOGRAM_BUCKETS } from '@logtide/reservoir';
import {
  ExplorerParamError,
  histogramBucketCount,
  pickBucketSeconds,
  type FacetFieldRequest,
  type LogHistogramResponse,
} from './explorer-params.js';

/** Supported search modes */
export type { SearchMode };

export interface LogQueryParams {
  projectId: string | string[]; // Support single or multiple projects
  service?: string | string[]; // Support single or multiple services
  level?: LogLevel | LogLevel[]; // Support single or multiple levels
  hostname?: string | string[]; // Filter by hostname (from metadata.hostname)
  traceId?: string; // Filter by trace ID
  sessionId?: string; // Filter by browser session ID
  from?: Date;
  to?: Date;
  q?: string; // Search query (log query language, or one phrase in substring mode)
  searchMode?: SearchMode; // Search mode: 'fulltext' (default, parses q) or 'substring'
  metadata_filters?: MetadataFilter[]; // Filter by metadata key/value
  limit?: number;
  offset?: number;
  cursor?: string;
  skipCache?: boolean; // Bypass the query cache (e.g. for per-second live tail polling)
}

/** The reservoir filter part shared by query, count, histogram and facets. */
export type LogFilterParams = Omit<Parameters<IReservoir['histogram']>[0], 'bucketSeconds'>;

export interface PreparedLogFilter {
  filter: LogFilterParams;
  query: LogSearchQuery;
  /** The params after beforeQuery hooks ran (limit, offset, cursor, skipCache live here). */
  params: LogQueryParams;
}

/** The log payload of every log read endpoint (list, by id, context, trace, live tail). */
export interface ApiLog {
  id: string;
  time: Date;
  projectId: string;
  service: string;
  level: LogLevel;
  message: string;
  metadata?: Record<string, unknown>;
  traceId?: string;
  spanId?: string;
  sessionId?: string;
  hostname?: string;
}

export type { LogHistogramResponse };

export interface LogFacetsResponse {
  facets: { field: string; values: { value: string; count: number }[]; otherCount: number }[];
}

export interface LogFieldsResponse {
  fields: { key: string; occurrences: number }[];
}

/** Most metadata keys GET /api/v1/logs/fields returns. */
export const FIELDS_MAX_RESULTS = 200;

const DEFAULT_WINDOW_MS = 24 * 60 * 60 * 1000;

const orUndefined = (value: string | null | undefined): string | undefined =>
  value === null || value === undefined || value === '' ? undefined : value;

/** CacheManager.queryKey sorts an array argument in place: hand it a copy. */
const cacheProjectPart = (projectId: LogFilterParams['projectId']): string | string[] =>
  Array.isArray(projectId) ? [...projectId] : projectId;

/** The one mapper from a stored log to the API payload. */
export function mapApiLog(log: StoredLogRecord): ApiLog {
  const metadataHost = log.metadata?.hostname;
  return {
    id: log.id,
    time: log.time,
    projectId: log.projectId,
    service: log.service,
    level: log.level,
    message: log.message,
    metadata: log.metadata ?? undefined,
    traceId: orUndefined(log.traceId),
    spanId: orUndefined(log.spanId),
    sessionId: orUndefined(log.sessionId),
    hostname: typeof metadataHost === 'string' && metadataHost !== '' ? metadataHost : undefined,
  };
}

export class QueryService {
  /**
   * Runs the beforeQuery hook (#216), compiles the (possibly mutated) params
   * with the log query language and applies the default window (last 24h).
   * Every log read endpoint goes through here, so a hook that forces a filter
   * narrows search, count, histogram, facets and fields alike.
   *
   * Throws LogQueryError for an invalid q.
   */
  async prepare(params: LogQueryParams): Promise<PreparedLogFilter> {
    const ctx = {
      organizationId: context.currentOrNull()?.organizationId ?? null,
      projectIds: Array.isArray(params.projectId) ? [...params.projectId] : [params.projectId],
      params,
    };
    if (hooks.hasHandlers('beforeQuery')) {
      await hooks.run('beforeQuery', ctx);
    }
    const effective = ctx.params;

    const built = buildLogFilter({
      q: effective.q,
      searchMode: effective.searchMode,
      service: effective.service,
      level: effective.level,
      hostname: effective.hostname,
      traceId: effective.traceId,
      sessionId: effective.sessionId,
      metadata_filters: effective.metadata_filters,
    });

    // PERFORMANCE: always a time filter (defaults to the last 24h) to prevent
    // full table scans on large datasets.
    const to = effective.to ?? new Date();
    const from = effective.from ?? new Date(Date.now() - DEFAULT_WINDOW_MS);

    return {
      filter: { projectId: effective.projectId, from, to, ...built.filter },
      query: built.query,
      params: effective,
    };
  }

  /**
   * Query logs with filters
   * Cached for performance - common queries are frequently repeated
   */
  async queryLogs(params: LogQueryParams) {
    // Hooks run inside prepare, before the cache key is built, so mutated
    // params drive both the cache key and the reservoir read.
    const prepared = await this.prepare(params);
    const { filter } = prepared;
    const { limit = 100, offset = 0, cursor, skipCache = false } = prepared.params;

    const cacheKey = CacheManager.queryKey(cacheProjectPart(filter.projectId), {
      filter: JSON.stringify(filter),
      limit,
      offset,
      cursor: cursor || null,
    });
    const cached = skipCache ? null : await CacheManager.get<any>(cacheKey);

    if (cached && cached.total !== -1) {
      return {
        ...cached,
        logs: cached.logs.map((log: any) => ({
          ...log,
          time: new Date(log.time),
        })),
      };
    }

    // Run data query and count query in parallel
    const [queryResult, countResult] = await Promise.all([
      reservoir.query({ ...filter, limit, offset, cursor }),
      reservoir.countEstimate(filter),
    ]);

    const result = {
      logs: queryResult.logs.map(mapApiLog),
      total: countResult.count,
      hasMore: queryResult.hasMore,
      limit: queryResult.limit,
      offset: queryResult.offset,
      nextCursor: queryResult.nextCursor,
    };

    if (!skipCache) {
      await CacheManager.set(cacheKey, result, CACHE_TTL.QUERY);
    }

    return result;
  }

  /**
   * Exact number of logs matching the filters (same prepare path as search).
   */
  async countLogs(params: LogQueryParams): Promise<{ count: number }> {
    const { filter } = await this.prepare(params);
    const cacheKey = CacheManager.queryKey(cacheProjectPart(filter.projectId), {
      kind: 'count',
      filter: JSON.stringify(filter),
    });
    const cached = await CacheManager.get<{ count: number }>(cacheKey);
    if (cached && typeof cached.count === 'number') return { count: cached.count };

    const result = await reservoir.count(filter);
    const value = { count: result.count };
    await CacheManager.set(cacheKey, value, CACHE_TTL.QUERY);
    return value;
  }

  /**
   * Log volume over time stacked by level, zero-filled. `bucketSeconds`
   * defaults to an automatic size (about 60 buckets over the range the
   * filters resolve to, after hooks and the default window).
   *
   * Throws LogQueryError for an invalid q, ExplorerParamError for an empty
   * range or a range needing more than MAX_HISTOGRAM_BUCKETS buckets.
   */
  async getHistogram(params: LogQueryParams & { bucketSeconds?: number }): Promise<LogHistogramResponse> {
    const { bucketSeconds: requested, ...rest } = params;
    const { filter } = await this.prepare(rest);
    if (filter.to.getTime() <= filter.from.getTime()) {
      throw new ExplorerParamError('"to" must be after "from"');
    }

    const bucketSeconds = requested ?? pickBucketSeconds(filter.from, filter.to);
    if (histogramBucketCount(filter.from, filter.to, bucketSeconds) > MAX_HISTOGRAM_BUCKETS) {
      throw new ExplorerParamError(
        requested !== undefined ? 'Bucket size is too small for this range' : 'Time range is too long for a histogram',
      );
    }

    const cacheKey = CacheManager.queryKey(cacheProjectPart(filter.projectId), {
      kind: 'histogram',
      filter: JSON.stringify(filter),
      bucketSeconds,
    });
    const cached = await CacheManager.get<LogHistogramResponse>(cacheKey);
    if (cached && Array.isArray(cached.buckets)) {
      return {
        ...cached,
        buckets: cached.buckets.map((bucket) => ({ ...bucket, time: new Date(bucket.time) })),
        from: new Date(cached.from),
        to: new Date(cached.to),
      };
    }

    const result = await reservoir.histogram({ ...filter, bucketSeconds });
    const response: LogHistogramResponse = {
      buckets: result.buckets,
      bucketSeconds: result.bucketSeconds,
      total: result.buckets.reduce((sum, bucket) => sum + bucket.total, 0),
      from: filter.from,
      to: filter.to,
    };
    await CacheManager.set(cacheKey, response, CACHE_TTL.QUERY);
    return response;
  }

  /**
   * Top values per field over the logs matching the filters, one reservoir
   * call for every field. `field` echoes the requested grammar key, in
   * request order.
   *
   * Throws LogQueryError for an invalid q.
   */
  async getFacets(params: LogQueryParams & { fields: FacetFieldRequest[]; limit: number }): Promise<LogFacetsResponse> {
    const { fields, limit, ...rest } = params;
    const { filter } = await this.prepare(rest);
    if (fields.length === 0) return { facets: [] };

    const cacheKey = CacheManager.queryKey(cacheProjectPart(filter.projectId), {
      kind: 'facets',
      filter: JSON.stringify(filter),
      fields: JSON.stringify(fields),
      limit,
    });
    const cached = await CacheManager.get<LogFacetsResponse>(cacheKey);
    if (cached && Array.isArray(cached.facets)) return cached;

    const result = await reservoir.facets({ ...filter, fields: fields.map((f) => f.field), limit });
    // The reservoir labels fields 'level' | 'service' | 'hostname' | 'metadata.<key>'.
    const keyByLabel = new Map(
      fields.map((f) => ['builtin' in f.field ? f.field.builtin : `metadata.${f.field.metadata}`, f.key] as const),
    );
    const response: LogFacetsResponse = {
      facets: result.facets.map((facet, index) => ({
        field: keyByLabel.get(facet.field) ?? fields[index]?.key ?? facet.field,
        values: facet.values,
        otherCount: facet.otherCount,
      })),
    };
    await CacheManager.set(cacheKey, response, CACHE_TTL.QUERY);
    return response;
  }

  /**
   * Metadata keys seen in the most recent `sampleSize` logs of the projects
   * (top-level and one nested level, dot-joined). The beforeQuery hook runs
   * through prepare, so a hook narrows the project set and the window like
   * on search. Keys the query language reads as built-ins (level, service,
   * host, trace, session, span and their aliases) are dropped. Sorted by
   * occurrences desc, then key; at most FIELDS_MAX_RESULTS.
   */
  async discoverFields(params: {
    projectId: string | string[];
    from?: Date;
    to?: Date;
    sampleSize: number;
  }): Promise<LogFieldsResponse> {
    const { sampleSize, ...rest } = params;
    const prepared = await this.prepare(rest);
    const { filter } = prepared;
    if (filter.matchNothing) return { fields: [] };

    const scoped = prepared.params.projectId;
    const projectIds = [...new Set(Array.isArray(scoped) ? scoped : [scoped])].filter(
      (id): id is string => typeof id === 'string' && id !== '',
    );
    if (projectIds.length === 0) return { fields: [] };
    const projectId = projectIds.length === 1 ? projectIds[0] : projectIds;

    const cacheKey = CacheManager.queryKey(cacheProjectPart(projectId), {
      kind: 'fields',
      from: filter.from.toISOString(),
      to: filter.to.toISOString(),
      sampleSize,
    });
    const cached = await CacheManager.get<LogFieldsResponse>(cacheKey);
    if (cached && Array.isArray(cached.fields)) return cached;

    const keys = await reservoir.discoverMetadataKeys({ projectId, from: filter.from, to: filter.to, sampleSize });
    const fields = keys
      .filter(({ key }) => {
        const ref = resolveFieldKey(key);
        return !(ref && 'builtin' in ref);
      })
      .map(({ key, occurrences }) => ({ key, occurrences }))
      .sort((a, b) => b.occurrences - a.occurrences || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
      .slice(0, FIELDS_MAX_RESULTS);

    const response: LogFieldsResponse = { fields };
    await CacheManager.set(cacheKey, response, CACHE_TTL.STATS);
    return response;
  }

  /**
   * Get a single log by ID
   */
  async getLogById(logId: string, projectId: string): Promise<ApiLog | null> {
    const log = await reservoir.getById({ id: logId, projectId });
    return log ? mapApiLog(log) : null;
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

    const result = queryResult.logs.map(mapApiLog);

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

    return {
      before: beforeResult.logs.reverse().map(mapApiLog),
      current: currentResult.logs.length > 0 ? mapApiLog(currentResult.logs[0]) : null,
      after: afterResult.logs.map(mapApiLog),
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

      // Fast path: use continuous aggregate (TimescaleDB only). Split the window
      // at oneDayAgo: the historical part comes from logs_daily_stats, the recent
      // part from raw data. Both halves must honor the requested [from, to] bounds.
      const { sql } = await import('kysely');
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const toDate = to ?? new Date();

      // Historical upper bound is min(oneDayAgo, to); recent lower bound is
      // max(oneDayAgo, from). Either half may be empty for a fully-recent or
      // fully-historical window.
      const historicalUpper = toDate < oneDayAgo ? toDate : oneDayAgo;
      const recentFrom = effectiveFrom > oneDayAgo ? effectiveFrom : oneDayAgo;

      const historicalPromise =
        effectiveFrom < historicalUpper
          ? db
              .selectFrom('logs_daily_stats')
              .select(['service', sql<string>`SUM(log_count)`.as('count')])
              .where('project_id', '=', projectId)
              .where('bucket', '>=', effectiveFrom)
              .where('bucket', '<', historicalUpper)
              .groupBy('service')
              .execute()
          : Promise.resolve([] as Array<{ service: string; count: string }>);

      const recentPromise =
        toDate > recentFrom
          ? reservoir.topValues({ field: 'service', projectId, from: recentFrom, to: toDate, limit: 100 })
          : Promise.resolve({ values: [] as Array<{ value: string; count: number }> });

      const [historicalServices, recentServices] = await Promise.all([
        historicalPromise,
        recentPromise,
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
   * The window honors what the caller passes (default 24h, matching the log query
   * default) so the dropdown lists every host that has logs in the same range the
   * logs view shows. Previously it was clamped to 6h, which silently dropped hosts
   * that only logged 6-24h ago even though their logs were still visible. JSONB
   * distinct is O(rows), but hostnames are stable and the 5-minute cache means the
   * cost is paid at most once per window per cache period.
   */
  async getDistinctHostnames(
    projectId: string | string[],
    from?: Date,
    to?: Date
  ): Promise<string[]> {
    const effectiveFrom = from ?? new Date(Date.now() - 24 * 60 * 60 * 1000);

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
