import { describe, it, expect, beforeEach } from 'vitest';
import {
    CacheManager,
    CACHE_TTL,
    CACHE_PREFIX,
    isCacheEnabled,
    getCacheTTL,
    hashParams
} from '../../utils/cache.js';
import { connection } from '../../queue/connection.js';

describe('Cache Utilities', () => {
    beforeEach(async () => {
        // Clear all cache keys before each test
        const patterns = Object.values(CACHE_PREFIX).map(p => `${p}:*`);
        for (const pattern of patterns) {
            const keys = await connection.keys(pattern);
            if (keys.length > 0) {
                await connection.del(...keys);
            }
        }
        CacheManager.resetStats();
    });

    describe('CACHE_TTL constants', () => {
        it('should have correct TTL values', () => {
            expect(CACHE_TTL.SESSION).toBe(30 * 60);
            expect(CACHE_TTL.API_KEY).toBe(60);
            expect(CACHE_TTL.METADATA).toBe(5 * 60);
            expect(CACHE_TTL.QUERY).toBe(60);
            expect(CACHE_TTL.STATS).toBe(5 * 60);
            expect(CACHE_TTL.TRACE).toBe(5 * 60);
            expect(CACHE_TTL.SIGMA_RULES).toBe(60 * 60);
            expect(CACHE_TTL.ADMIN).toBe(60);
        });
    });

    describe('CACHE_PREFIX constants', () => {
        it('should have correct prefix values', () => {
            expect(CACHE_PREFIX.SESSION).toBe('session');
            expect(CACHE_PREFIX.API_KEY).toBe('api-key');
            expect(CACHE_PREFIX.ORG).toBe('org');
            expect(CACHE_PREFIX.PROJECT).toBe('project');
            expect(CACHE_PREFIX.QUERY).toBe('query');
            expect(CACHE_PREFIX.TRACE).toBe('trace');
            expect(CACHE_PREFIX.STATS).toBe('stats');
            expect(CACHE_PREFIX.SIGMA).toBe('sigma');
            expect(CACHE_PREFIX.ADMIN).toBe('admin');
        });
    });

    describe('isCacheEnabled', () => {
        it('should return true when cache is enabled', () => {
            expect(isCacheEnabled()).toBe(true);
        });
    });

    describe('getCacheTTL', () => {
        it('should return default TTL when config TTL is 60', () => {
            expect(getCacheTTL(300)).toBe(300);
        });
    });

    describe('hashParams', () => {
        it('should generate consistent hash for same params', () => {
            const params = { service: 'api', level: 'error' };
            const hash1 = hashParams(params);
            const hash2 = hashParams(params);
            expect(hash1).toBe(hash2);
        });

        it('should generate same hash regardless of key order', () => {
            const params1 = { a: 1, b: 2, c: 3 };
            const params2 = { c: 3, a: 1, b: 2 };
            expect(hashParams(params1)).toBe(hashParams(params2));
        });

        it('should generate different hash for different params', () => {
            const params1 = { a: 1 };
            const params2 = { a: 2 };
            expect(hashParams(params1)).not.toBe(hashParams(params2));
        });

        it('should return 16 character hash', () => {
            const hash = hashParams({ test: 'value' });
            expect(hash).toHaveLength(16);
        });
    });

    describe('CacheManager key builders', () => {
        it('should build session key correctly', () => {
            const key = CacheManager.sessionKey('token123');
            expect(key).toBe('session:token123');
        });

        it('should build API key correctly', () => {
            const key = CacheManager.apiKeyKey('hash123');
            expect(key).toBe('api-key:hash123');
        });

        it('should build org key correctly', () => {
            const key = CacheManager.orgKey('org-id');
            expect(key).toBe('org:org-id');
        });

        it('should build userOrgs key correctly', () => {
            const key = CacheManager.userOrgsKey('user-id');
            expect(key).toBe('org:user:user-id');
        });

        it('should build project key correctly', () => {
            const key = CacheManager.projectKey('project-id');
            expect(key).toBe('project:project-id');
        });

        it('should build orgProjects key correctly', () => {
            const key = CacheManager.orgProjectsKey('org-id');
            expect(key).toBe('project:org:org-id');
        });

        it('should build query key correctly for single project', () => {
            const key = CacheManager.queryKey('project-id', { level: 'error' });
            expect(key).toMatch(/^query:project-id:[a-f0-9]{16}$/);
        });

        it('should build query key correctly for multiple projects', () => {
            const key = CacheManager.queryKey(['proj1', 'proj2'], { level: 'error' });
            expect(key).toMatch(/^query:proj1,proj2:[a-f0-9]{16}$/);
        });

        it('should build trace key correctly', () => {
            const key = CacheManager.traceKey('project-id', 'trace-id');
            expect(key).toBe('trace:project-id:trace-id');
        });

        it('should build stats key correctly without params', () => {
            const key = CacheManager.statsKey('project-id', 'overview');
            expect(key).toBe('stats:project-id:overview');
        });

        it('should build stats key correctly with params', () => {
            const key = CacheManager.statsKey('project-id', 'timeseries', { interval: '1h' });
            expect(key).toMatch(/^stats:project-id:timeseries:[a-f0-9]{16}$/);
        });

        it('should build sigmaRules key correctly', () => {
            const key = CacheManager.sigmaRulesKey('org-id');
            expect(key).toBe('sigma:rules:org-id');
        });

        it('should build adminStats key correctly', () => {
            const key = CacheManager.adminStatsKey('system');
            expect(key).toBe('admin:system');
        });
    });

    describe('CacheManager.get and set', () => {
        it('should set and get a value', async () => {
            const key = 'test:key1';
            const value = { foo: 'bar', num: 42 };

            await CacheManager.set(key, value, 60);
            const result = await CacheManager.get<typeof value>(key);

            expect(result).toEqual(value);
        });

        it('should return null for non-existent key', async () => {
            const result = await CacheManager.get('non:existent:key');
            expect(result).toBeNull();
        });

        it('should track cache hits', async () => {
            const key = 'test:hits';
            await CacheManager.set(key, 'value', 60);

            await CacheManager.get(key);
            await CacheManager.get(key);

            const stats = await CacheManager.getStats();
            expect(stats.hits).toBeGreaterThanOrEqual(2);
        });

        it('should track cache misses', async () => {
            await CacheManager.get('missing:key1');
            await CacheManager.get('missing:key2');

            const stats = await CacheManager.getStats();
            expect(stats.misses).toBeGreaterThanOrEqual(2);
        });
    });

    describe('CacheManager.delete', () => {
        it('should delete a key', async () => {
            const key = 'test:delete';
            await CacheManager.set(key, 'value', 60);

            await CacheManager.delete(key);
            const result = await CacheManager.get(key);

            expect(result).toBeNull();
        });
    });

    describe('CacheManager.deletePattern', () => {
        it('should delete keys matching pattern', async () => {
            await CacheManager.set('test:pattern:1', 'value1', 60);
            await CacheManager.set('test:pattern:2', 'value2', 60);
            await CacheManager.set('test:other:1', 'value3', 60);

            const deleted = await CacheManager.deletePattern('test:pattern:*');

            expect(deleted).toBe(2);
            expect(await CacheManager.get('test:pattern:1')).toBeNull();
            expect(await CacheManager.get('test:pattern:2')).toBeNull();
            expect(await CacheManager.get('test:other:1')).not.toBeNull();
        });

        it('should return 0 when no keys match', async () => {
            const deleted = await CacheManager.deletePattern('nonexistent:*');
            expect(deleted).toBe(0);
        });
    });

    describe('CacheManager.invalidateProjectQueries', () => {
        it('should invalidate all query caches for a project', async () => {
            const projectId = 'test-project';
            await CacheManager.set(`query:${projectId}:abc123`, 'data', 60);
            await CacheManager.set(`stats:${projectId}:overview`, 'stats', 60);
            await CacheManager.set(`trace:${projectId}:trace1`, 'trace', 60);

            await CacheManager.invalidateProjectQueries(projectId);

            expect(await CacheManager.get(`query:${projectId}:abc123`)).toBeNull();
            expect(await CacheManager.get(`stats:${projectId}:overview`)).toBeNull();
            expect(await CacheManager.get(`trace:${projectId}:trace1`)).toBeNull();
        });
    });

    describe('CacheManager.invalidateOrgCache', () => {
        it('should invalidate organization cache', async () => {
            const orgId = 'test-org';
            await CacheManager.set(CacheManager.orgKey(orgId), 'org-data', 60);
            await CacheManager.set(CacheManager.orgProjectsKey(orgId), 'projects', 60);

            await CacheManager.invalidateOrgCache(orgId);

            expect(await CacheManager.get(CacheManager.orgKey(orgId))).toBeNull();
            expect(await CacheManager.get(CacheManager.orgProjectsKey(orgId))).toBeNull();
        });
    });

    describe('CacheManager.invalidateProjectCache', () => {
        it('should invalidate project cache and queries', async () => {
            const projectId = 'test-project';
            await CacheManager.set(CacheManager.projectKey(projectId), 'project-data', 60);
            await CacheManager.set(`query:${projectId}:abc`, 'query-data', 60);

            await CacheManager.invalidateProjectCache(projectId);

            expect(await CacheManager.get(CacheManager.projectKey(projectId))).toBeNull();
            expect(await CacheManager.get(`query:${projectId}:abc`)).toBeNull();
        });
    });

    describe('CacheManager.invalidateSession', () => {
        it('should invalidate session cache', async () => {
            const token = 'test-token';
            await CacheManager.set(CacheManager.sessionKey(token), 'session-data', 60);

            await CacheManager.invalidateSession(token);

            expect(await CacheManager.get(CacheManager.sessionKey(token))).toBeNull();
        });
    });

    describe('CacheManager.invalidateApiKey', () => {
        it('should invalidate API key cache', async () => {
            const keyHash = 'test-hash';
            await CacheManager.set(CacheManager.apiKeyKey(keyHash), 'key-data', 60);

            await CacheManager.invalidateApiKey(keyHash);

            expect(await CacheManager.get(CacheManager.apiKeyKey(keyHash))).toBeNull();
        });
    });

    describe('CacheManager.invalidateSigmaRules', () => {
        it('should invalidate Sigma rules cache', async () => {
            const orgId = 'test-org';
            await CacheManager.set(CacheManager.sigmaRulesKey(orgId), 'rules-data', 60);

            await CacheManager.invalidateSigmaRules(orgId);

            expect(await CacheManager.get(CacheManager.sigmaRulesKey(orgId))).toBeNull();
        });
    });

    describe('CacheManager.clearAll', () => {
        it('should clear all caches and reset counters', async () => {
            // Set some data
            await CacheManager.set('session:test', 'data', 60);
            await CacheManager.set('query:test', 'data', 60);
            await CacheManager.set('stats:test', 'data', 60);

            // Generate some hits
            await CacheManager.get('session:test');

            const deleted = await CacheManager.clearAll();

            expect(deleted).toBeGreaterThanOrEqual(3);

            const stats = await CacheManager.getStats();
            expect(stats.hits).toBe(0);
            expect(stats.misses).toBe(0);
        });
    });

    describe('CacheManager.getStats', () => {
        it('should return cache statistics', async () => {
            await CacheManager.set('test:stat1', 'value', 60);
            await CacheManager.get('test:stat1'); // hit
            await CacheManager.get('test:missing'); // miss

            const stats = await CacheManager.getStats();

            expect(stats).toHaveProperty('hits');
            expect(stats).toHaveProperty('misses');
            expect(stats).toHaveProperty('hitRate');
            expect(stats).toHaveProperty('keyCount');
            expect(stats).toHaveProperty('memoryUsage');
            expect(stats.hits).toBeGreaterThanOrEqual(1);
            expect(stats.misses).toBeGreaterThanOrEqual(1);
        });

        it('should calculate hit rate correctly', async () => {
            CacheManager.resetStats();
            await CacheManager.set('test:rate', 'value', 60);

            // 3 hits
            await CacheManager.get('test:rate');
            await CacheManager.get('test:rate');
            await CacheManager.get('test:rate');
            // 1 miss
            await CacheManager.get('test:missing');

            const stats = await CacheManager.getStats();
            expect(stats.hitRate).toBe(75); // 3/4 = 75%
        });
    });

    describe('CacheManager.resetStats', () => {
        it('should reset hit and miss counters', async () => {
            await CacheManager.set('test:reset', 'value', 60);
            await CacheManager.get('test:reset');
            await CacheManager.get('test:missing');

            CacheManager.resetStats();
            const stats = await CacheManager.getStats();

            expect(stats.hits).toBe(0);
            expect(stats.misses).toBe(0);
        });
    });
});
