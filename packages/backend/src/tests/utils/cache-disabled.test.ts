import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the config to disable cache
vi.mock('../../config/index.js', () => ({
    config: {
        CACHE_ENABLED: false,
        CACHE_TTL: 60,
    },
}));

// Mock connection to be null
vi.mock('../../queue/connection.js', () => ({
    connection: null,
    isRedisAvailable: () => false,
}));

describe('Cache Utilities (Disabled)', () => {
    let CacheManager: any;
    let isCacheEnabled: any;
    let getCacheTTL: any;
    let hashParams: any;

    beforeEach(async () => {
        vi.resetModules();
        const module = await import('../../utils/cache.js');
        CacheManager = module.CacheManager;
        isCacheEnabled = module.isCacheEnabled;
        getCacheTTL = module.getCacheTTL;
        hashParams = module.hashParams;
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    describe('isCacheEnabled', () => {
        it('should return false when cache is disabled', () => {
            expect(isCacheEnabled()).toBe(false);
        });
    });

    describe('getCacheTTL', () => {
        it('should return default TTL when config TTL is default (60)', () => {
            expect(getCacheTTL(300)).toBe(300);
        });
    });

    describe('hashParams', () => {
        it('should still work when cache is disabled', () => {
            const hash = hashParams({ key: 'value' });
            expect(hash).toHaveLength(16);
        });
    });

    describe('CacheManager.get', () => {
        it('should return null when cache is disabled', async () => {
            const result = await CacheManager.get('any:key');
            expect(result).toBeNull();
        });
    });

    describe('CacheManager.set', () => {
        it('should do nothing when cache is disabled', async () => {
            // Should not throw
            await CacheManager.set('any:key', { data: 'value' }, 60);
        });
    });

    describe('CacheManager.delete', () => {
        it('should do nothing when connection is null', async () => {
            // Should not throw
            await CacheManager.delete('any:key');
        });
    });

    describe('CacheManager.deletePattern', () => {
        it('should return 0 when connection is null', async () => {
            const result = await CacheManager.deletePattern('test:*');
            expect(result).toBe(0);
        });
    });

    describe('CacheManager.invalidateProjectQueries', () => {
        it('should not throw when cache is disabled', async () => {
            await CacheManager.invalidateProjectQueries('project-123');
        });
    });

    describe('CacheManager.invalidateOrgCache', () => {
        it('should not throw when cache is disabled', async () => {
            await CacheManager.invalidateOrgCache('org-123');
        });
    });

    describe('CacheManager.invalidateProjectCache', () => {
        it('should not throw when cache is disabled', async () => {
            await CacheManager.invalidateProjectCache('project-123');
        });
    });

    describe('CacheManager.invalidateSession', () => {
        it('should not throw when cache is disabled', async () => {
            await CacheManager.invalidateSession('token-123');
        });
    });

    describe('CacheManager.invalidateApiKey', () => {
        it('should not throw when cache is disabled', async () => {
            await CacheManager.invalidateApiKey('keyhash-123');
        });
    });

    describe('CacheManager.invalidateSigmaRules', () => {
        it('should not throw when cache is disabled', async () => {
            await CacheManager.invalidateSigmaRules('org-123');
        });
    });

    describe('CacheManager.invalidateSettings', () => {
        it('should not throw when cache is disabled', async () => {
            await CacheManager.invalidateSettings();
        });
    });

    describe('CacheManager.clearAll', () => {
        it('should return 0 when cache is disabled', async () => {
            const result = await CacheManager.clearAll();
            expect(result).toBe(0);
        });
    });

    describe('CacheManager.getStats', () => {
        it('should return stats with not available message when no connection', async () => {
            const stats = await CacheManager.getStats();
            expect(stats.hits).toBe(0);
            expect(stats.misses).toBe(0);
            expect(stats.hitRate).toBe(0);
            expect(stats.keyCount).toBe(0);
            expect(stats.memoryUsage).toContain('not available');
        });
    });

    describe('CacheManager.resetStats', () => {
        it('should reset counters', () => {
            CacheManager.resetStats();
            // Should not throw
        });
    });

    describe('CacheManager key builders', () => {
        it('should build settingsKey correctly', () => {
            const key = CacheManager.settingsKey('smtp');
            expect(key).toBe('settings:smtp');
        });
    });
});
