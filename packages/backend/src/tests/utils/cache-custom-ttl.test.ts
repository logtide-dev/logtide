import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the config with custom TTL
vi.mock('../../config/index.js', () => ({
    config: {
        CACHE_ENABLED: true,
        CACHE_TTL: 120, // Custom TTL different from default 60
    },
}));

vi.mock('../../queue/connection.js', () => ({
    connection: null,
    isRedisAvailable: () => false,
}));

describe('Cache Utilities (Custom TTL)', () => {
    let getCacheTTL: any;

    beforeEach(async () => {
        vi.resetModules();
        const module = await import('../../utils/cache.js');
        getCacheTTL = module.getCacheTTL;
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    describe('getCacheTTL', () => {
        it('should return config TTL when it differs from default', () => {
            expect(getCacheTTL(300)).toBe(120);
        });
    });
});
