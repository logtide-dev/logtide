import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock Redis connection that throws errors
const mockConnection = {
    get: vi.fn().mockRejectedValue(new Error('Redis error')),
    setex: vi.fn().mockRejectedValue(new Error('Redis error')),
    del: vi.fn().mockRejectedValue(new Error('Redis error')),
    scan: vi.fn().mockRejectedValue(new Error('Redis error')),
    unlink: vi.fn().mockRejectedValue(new Error('Redis error')),
    info: vi.fn().mockRejectedValue(new Error('Redis error')),
    dbsize: vi.fn().mockRejectedValue(new Error('Redis error')),
};

vi.mock('../../config/index.js', () => ({
    config: {
        CACHE_ENABLED: true,
        CACHE_TTL: 60,
    },
}));

vi.mock('../../queue/connection.js', () => ({
    connection: mockConnection,
    isRedisAvailable: () => true,
}));

describe('Cache Utilities (Error Handling)', () => {
    let CacheManager: any;
    let consoleSpy: any;

    beforeEach(async () => {
        vi.resetModules();
        consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const module = await import('../../utils/cache.js');
        CacheManager = module.CacheManager;
    });

    afterEach(() => {
        vi.clearAllMocks();
        consoleSpy.mockRestore();
    });

    describe('CacheManager.get', () => {
        it('should return null and log error on Redis failure', async () => {
            const result = await CacheManager.get('test:key');
            expect(result).toBeNull();
            expect(consoleSpy).toHaveBeenCalled();
        });
    });

    describe('CacheManager.set', () => {
        it('should log error on Redis failure', async () => {
            await CacheManager.set('test:key', { data: 'value' }, 60);
            expect(consoleSpy).toHaveBeenCalled();
        });
    });

    describe('CacheManager.delete', () => {
        it('should log error on Redis failure', async () => {
            await CacheManager.delete('test:key');
            expect(consoleSpy).toHaveBeenCalled();
        });
    });

    describe('CacheManager.deletePattern', () => {
        it('should return 0 and log error on Redis failure', async () => {
            const result = await CacheManager.deletePattern('test:*');
            expect(result).toBe(0);
            expect(consoleSpy).toHaveBeenCalled();
        });
    });

    describe('CacheManager.getStats', () => {
        it('should return default stats on Redis failure', async () => {
            const stats = await CacheManager.getStats();
            expect(stats.keyCount).toBe(0);
            expect(stats.memoryUsage).toBe('unknown');
            expect(consoleSpy).toHaveBeenCalled();
        });
    });
});
