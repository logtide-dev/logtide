import crypto from 'crypto';
import { connection } from '../queue/connection.js';
import { config } from '../config/index.js';

/**
 * Cache TTL constants (in seconds)
 */
export const CACHE_TTL = {
  SESSION: 30 * 60, // 30 minutes
  API_KEY: 60, // 1 minute
  METADATA: 5 * 60, // 5 minutes
  QUERY: 60, // 1 minute
  STATS: 5 * 60, // 5 minutes
  TRACE: 5 * 60, // 5 minutes
  SIGMA_RULES: 60 * 60, // 1 hour
  ADMIN: 60, // 1 minute
} as const;

/**
 * Cache key prefixes for namespacing
 */
export const CACHE_PREFIX = {
  SESSION: 'session',
  API_KEY: 'api-key',
  ORG: 'org',
  PROJECT: 'project',
  QUERY: 'query',
  TRACE: 'trace',
  STATS: 'stats',
  SIGMA: 'sigma',
  ADMIN: 'admin',
} as const;

/**
 * Cache statistics for monitoring
 */
export interface CacheStats {
  hits: number;
  misses: number;
  hitRate: number;
  keyCount: number;
  memoryUsage: string;
}

/**
 * In-memory hit/miss counters (reset on restart)
 */
let cacheHits = 0;
let cacheMisses = 0;

/**
 * Check if caching is enabled via config
 */
export function isCacheEnabled(): boolean {
  return config.CACHE_ENABLED;
}

/**
 * Get custom TTL from config or use default
 */
export function getCacheTTL(defaultTTL: number): number {
  // If a global TTL override is set and different from default, use it
  if (config.CACHE_TTL && config.CACHE_TTL !== 60) {
    return config.CACHE_TTL;
  }
  return defaultTTL;
}

/**
 * Generate a deterministic hash for cache key params
 */
export function hashParams(params: Record<string, unknown>): string {
  // Sort keys for deterministic output
  const sorted = Object.keys(params)
    .sort()
    .reduce((acc, key) => {
      acc[key] = params[key];
      return acc;
    }, {} as Record<string, unknown>);

  return crypto
    .createHash('sha256')
    .update(JSON.stringify(sorted))
    .digest('hex')
    .substring(0, 16);
}

/**
 * CacheManager - Type-safe Redis caching utility
 */
export const CacheManager = {
  /**
   * Build cache key for sessions
   */
  sessionKey(token: string): string {
    return `${CACHE_PREFIX.SESSION}:${token}`;
  },

  /**
   * Build cache key for API keys
   */
  apiKeyKey(keyHash: string): string {
    return `${CACHE_PREFIX.API_KEY}:${keyHash}`;
  },

  /**
   * Build cache key for organization metadata
   */
  orgKey(orgId: string): string {
    return `${CACHE_PREFIX.ORG}:${orgId}`;
  },

  /**
   * Build cache key for user's organizations list
   */
  userOrgsKey(userId: string): string {
    return `${CACHE_PREFIX.ORG}:user:${userId}`;
  },

  /**
   * Build cache key for project metadata
   */
  projectKey(projectId: string): string {
    return `${CACHE_PREFIX.PROJECT}:${projectId}`;
  },

  /**
   * Build cache key for org's projects list
   */
  orgProjectsKey(orgId: string): string {
    return `${CACHE_PREFIX.PROJECT}:org:${orgId}`;
  },

  /**
   * Build cache key for query results
   */
  queryKey(projectId: string | string[], params: Record<string, unknown>): string {
    const projectPart = Array.isArray(projectId) ? projectId.sort().join(',') : projectId;
    return `${CACHE_PREFIX.QUERY}:${projectPart}:${hashParams(params)}`;
  },

  /**
   * Build cache key for trace queries
   */
  traceKey(projectId: string, traceId: string): string {
    return `${CACHE_PREFIX.TRACE}:${projectId}:${traceId}`;
  },

  /**
   * Build cache key for statistics
   */
  statsKey(projectId: string, type: string, params?: Record<string, unknown>): string {
    const base = `${CACHE_PREFIX.STATS}:${projectId}:${type}`;
    return params ? `${base}:${hashParams(params)}` : base;
  },

  /**
   * Build cache key for Sigma rules
   */
  sigmaRulesKey(orgId: string): string {
    return `${CACHE_PREFIX.SIGMA}:rules:${orgId}`;
  },

  /**
   * Build cache key for admin stats
   */
  adminStatsKey(type: string): string {
    return `${CACHE_PREFIX.ADMIN}:${type}`;
  },

  /**
   * Get a cached value
   */
  async get<T>(key: string): Promise<T | null> {
    if (!isCacheEnabled()) {
      return null;
    }

    try {
      const cached = await connection.get(key);
      if (cached) {
        cacheHits++;
        return JSON.parse(cached) as T;
      }
      cacheMisses++;
      return null;
    } catch (error) {
      console.error('[Cache] Error getting key:', key, error);
      cacheMisses++;
      return null;
    }
  },

  /**
   * Set a cached value with TTL
   */
  async set<T>(key: string, value: T, ttl: number = CACHE_TTL.QUERY): Promise<void> {
    if (!isCacheEnabled()) {
      return;
    }

    try {
      await connection.setex(key, getCacheTTL(ttl), JSON.stringify(value));
    } catch (error) {
      console.error('[Cache] Error setting key:', key, error);
    }
  },

  /**
   * Delete a specific key
   */
  async delete(key: string): Promise<void> {
    try {
      await connection.del(key);
    } catch (error) {
      console.error('[Cache] Error deleting key:', key, error);
    }
  },

  /**
   * Delete keys matching a pattern using SCAN (non-blocking)
   * IMPORTANT: Uses SCAN instead of KEYS to avoid blocking Redis
   */
  async deletePattern(pattern: string): Promise<number> {
    try {
      let cursor = '0';
      let totalDeleted = 0;

      do {
        // SCAN is O(1) per call, iterates incrementally
        const [nextCursor, keys] = await connection.scan(
          cursor,
          'MATCH', pattern,
          'COUNT', 100  // Process 100 keys per iteration
        );
        cursor = nextCursor;

        if (keys.length > 0) {
          // Use UNLINK for async deletion (non-blocking)
          await connection.unlink(...keys);
          totalDeleted += keys.length;
        }
      } while (cursor !== '0');

      return totalDeleted;
    } catch (error) {
      console.error('[Cache] Error deleting pattern:', pattern, error);
      return 0;
    }
  },

  /**
   * Invalidate all query caches for a project
   * Called when new logs are ingested
   */
  async invalidateProjectQueries(projectId: string): Promise<void> {
    await this.deletePattern(`${CACHE_PREFIX.QUERY}:*${projectId}*`);
    await this.deletePattern(`${CACHE_PREFIX.STATS}:${projectId}:*`);
    await this.deletePattern(`${CACHE_PREFIX.TRACE}:${projectId}:*`);
  },

  /**
   * Invalidate organization-related caches
   */
  async invalidateOrgCache(orgId: string): Promise<void> {
    await this.delete(this.orgKey(orgId));
    await this.delete(this.orgProjectsKey(orgId));
  },

  /**
   * Invalidate project-related caches
   */
  async invalidateProjectCache(projectId: string): Promise<void> {
    await this.delete(this.projectKey(projectId));
    await this.invalidateProjectQueries(projectId);
  },

  /**
   * Invalidate session cache
   */
  async invalidateSession(token: string): Promise<void> {
    await this.delete(this.sessionKey(token));
  },

  /**
   * Invalidate API key cache
   */
  async invalidateApiKey(keyHash: string): Promise<void> {
    await this.delete(this.apiKeyKey(keyHash));
  },

  /**
   * Invalidate Sigma rules cache for an organization
   */
  async invalidateSigmaRules(orgId: string): Promise<void> {
    await this.delete(this.sigmaRulesKey(orgId));
  },

  /**
   * Clear all caches (admin function)
   */
  async clearAll(): Promise<number> {
    const patterns = Object.values(CACHE_PREFIX).map(p => `${p}:*`);
    let total = 0;
    for (const pattern of patterns) {
      total += await this.deletePattern(pattern);
    }
    // Reset counters
    cacheHits = 0;
    cacheMisses = 0;
    return total;
  },

  /**
   * Get cache statistics
   * Uses DBSIZE instead of KEYS for key count (O(1) vs O(N))
   */
  async getStats(): Promise<CacheStats> {
    try {
      const info = await connection.info('memory');
      const memoryMatch = info.match(/used_memory_human:(\S+)/);
      const memoryUsage = memoryMatch ? memoryMatch[1] : 'unknown';

      // Use DBSIZE for total key count - O(1) operation
      const keyCount = await connection.dbsize();

      const total = cacheHits + cacheMisses;
      const hitRate = total > 0 ? (cacheHits / total) * 100 : 0;

      return {
        hits: cacheHits,
        misses: cacheMisses,
        hitRate: Math.round(hitRate * 100) / 100,
        keyCount,
        memoryUsage,
      };
    } catch (error) {
      console.error('[Cache] Error getting stats:', error);
      return {
        hits: cacheHits,
        misses: cacheMisses,
        hitRate: 0,
        keyCount: 0,
        memoryUsage: 'unknown',
      };
    }
  },

  /**
   * Reset hit/miss counters
   */
  resetStats(): void {
    cacheHits = 0;
    cacheMisses = 0;
  },
};

export default CacheManager;
