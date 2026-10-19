import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('Queue Connection Module', () => {
    describe('without Redis', () => {
        beforeEach(async () => {
            vi.resetModules();

            // Mock config without Redis
            vi.doMock('../../config/index.js', () => ({
                config: {
                    REDIS_URL: undefined,
                    DATABASE_URL: 'postgresql://test@localhost/test',
                },
            }));

            // Mock queue-factory
            vi.doMock('../../queue/queue-factory.js', () => ({
                initializeQueueSystem: vi.fn(),
                createQueue: vi.fn().mockReturnValue({ name: 'test' }),
                createWorker: vi.fn().mockReturnValue({ name: 'test' }),
                startQueueWorkers: vi.fn(),
                shutdownQueueSystem: vi.fn(),
                getQueueBackend: vi.fn().mockReturnValue('graphile'),
                getQueueSystemStatus: vi.fn().mockReturnValue({ backend: 'graphile', connected: true }),
            }));
        });

        afterEach(() => {
            vi.clearAllMocks();
        });

        it('should export isRedisAvailable as false when no Redis', async () => {
            const module = await import('../../queue/connection.js');
            expect(module.isRedisAvailable()).toBe(false);
        });

        it('should return null from getConnection when no Redis', async () => {
            const module = await import('../../queue/connection.js');
            expect(module.getConnection()).toBeNull();
        });

        it('should return null from getPublisher when no Redis', async () => {
            const module = await import('../../queue/connection.js');
            expect(module.getPublisher()).toBeNull();
        });

        it('should export createQueue function', async () => {
            const module = await import('../../queue/connection.js');
            expect(typeof module.createQueue).toBe('function');
        });

        it('should export createWorker function', async () => {
            const module = await import('../../queue/connection.js');
            expect(typeof module.createWorker).toBe('function');
        });

        it('should export closeConnections function', async () => {
            const module = await import('../../queue/connection.js');
            expect(typeof module.closeConnections).toBe('function');

            // Should not throw
            await module.closeConnections();
        });
    });

    describe('with Redis', () => {
        let mockRedis: any;

        beforeEach(async () => {
            vi.resetModules();

            // Create mock Redis instance
            mockRedis = {
                on: vi.fn(),
                quit: vi.fn().mockResolvedValue('OK'),
                status: 'ready',
            };

            // Mock ioredis
            vi.doMock('ioredis', () => ({
                default: vi.fn().mockImplementation(function () { return mockRedis; }),
            }));

            // Mock config with Redis
            vi.doMock('../../config/index.js', () => ({
                config: {
                    REDIS_URL: 'redis://localhost:6379',
                    DATABASE_URL: 'postgresql://test@localhost/test',
                },
            }));

            // Mock queue-factory
            vi.doMock('../../queue/queue-factory.js', () => ({
                initializeQueueSystem: vi.fn(),
                createQueue: vi.fn().mockReturnValue({ name: 'test' }),
                createWorker: vi.fn().mockReturnValue({ name: 'test' }),
                startQueueWorkers: vi.fn(),
                shutdownQueueSystem: vi.fn(),
                getQueueBackend: vi.fn().mockReturnValue('bullmq'),
                getQueueSystemStatus: vi.fn().mockReturnValue({ backend: 'bullmq', connected: true }),
            }));
        });

        afterEach(() => {
            vi.clearAllMocks();
        });

        it('should export isRedisAvailable as true when Redis configured', async () => {
            const module = await import('../../queue/connection.js');
            expect(module.isRedisAvailable()).toBe(true);
        });

        it('should return non-null from getConnection when Redis configured', async () => {
            const module = await import('../../queue/connection.js');
            expect(module.getConnection()).not.toBeNull();
        });

        it('should return non-null from getPublisher when Redis configured', async () => {
            const module = await import('../../queue/connection.js');
            expect(module.getPublisher()).not.toBeNull();
        });

        it('should setup Redis event handlers', async () => {
            const module = await import('../../queue/connection.js');
            // Trigger lazy initialization
            module.getConnection();

            // Verify event handlers were set up
            expect(mockRedis.on).toHaveBeenCalledWith('connect', expect.any(Function));
            expect(mockRedis.on).toHaveBeenCalledWith('ready', expect.any(Function));
            expect(mockRedis.on).toHaveBeenCalledWith('error', expect.any(Function));
            expect(mockRedis.on).toHaveBeenCalledWith('close', expect.any(Function));
            expect(mockRedis.on).toHaveBeenCalledWith('reconnecting', expect.any(Function));
            expect(mockRedis.on).toHaveBeenCalledWith('end', expect.any(Function));
        });

        it('should close connections properly', async () => {
            const module = await import('../../queue/connection.js');
            // Trigger lazy initialization so there's something to close
            module.getConnection();

            await module.closeConnections();

            expect(mockRedis.quit).toHaveBeenCalled();
        });
    });
});
