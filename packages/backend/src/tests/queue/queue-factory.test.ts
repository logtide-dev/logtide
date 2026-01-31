import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock Redis before importing the module
vi.mock('ioredis', () => {
    const mockRedis = vi.fn().mockImplementation(() => ({
        status: 'ready',
        on: vi.fn(),
        quit: vi.fn().mockResolvedValue(undefined),
    }));
    return { default: mockRedis };
});

// Mock pg Pool
vi.mock('pg', () => ({
    default: {
        Pool: vi.fn().mockImplementation(() => ({
            end: vi.fn().mockResolvedValue(undefined),
        })),
    },
}));

// Mock adapters
vi.mock('../../queue/adapters/bullmq-adapter.js', () => ({
    BullMQQueueAdapter: vi.fn().mockImplementation((name) => ({
        name,
        close: vi.fn().mockResolvedValue(undefined),
    })),
    BullMQWorkerAdapter: vi.fn().mockImplementation((name) => ({
        name,
        close: vi.fn().mockResolvedValue(undefined),
    })),
}));

vi.mock('../../queue/adapters/graphile-adapter.js', () => ({
    GraphileQueueAdapter: vi.fn().mockImplementation((name) => ({
        name,
        close: vi.fn().mockResolvedValue(undefined),
    })),
    GraphileWorkerAdapter: vi.fn().mockImplementation((name) => ({
        name,
        close: vi.fn().mockResolvedValue(undefined),
    })),
    GraphileWorkerManager: {
        getInstance: vi.fn().mockReturnValue({
            start: vi.fn().mockResolvedValue(undefined),
            stop: vi.fn().mockResolvedValue(undefined),
            isActive: vi.fn().mockReturnValue(true),
            getWorkerCount: vi.fn().mockReturnValue(2),
        }),
    },
}));

// We need to dynamically import after mocks are set up
let queueFactory: typeof import('../../queue/queue-factory.js');

describe('QueueFactory', () => {
    beforeEach(async () => {
        vi.resetModules();
        queueFactory = await import('../../queue/queue-factory.js');
    });

    afterEach(async () => {
        try {
            await queueFactory.shutdownQueueSystem();
        } catch {
            // Ignore shutdown errors in tests
        }
        vi.clearAllMocks();
    });

    describe('initializeQueueSystem', () => {
        it('should initialize with BullMQ backend', () => {
            queueFactory.initializeQueueSystem({
                backend: 'bullmq',
                redisUrl: 'redis://localhost:6379',
                databaseUrl: 'postgresql://localhost:5432',
            });

            const status = queueFactory.getQueueSystemStatus();
            expect(status.backend).toBe('bullmq');
        });

        it('should initialize with graphile backend', () => {
            queueFactory.initializeQueueSystem({
                backend: 'graphile',
                databaseUrl: 'postgresql://localhost:5432',
            });

            const status = queueFactory.getQueueSystemStatus();
            expect(status.backend).toBe('graphile');
        });

        it('should throw error if Redis URL missing for BullMQ', () => {
            expect(() =>
                queueFactory.initializeQueueSystem({
                    backend: 'bullmq',
                    databaseUrl: 'postgresql://localhost:5432',
                })
            ).toThrow('Redis URL required for BullMQ backend');
        });

        it('should warn if already initialized', () => {
            const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

            queueFactory.initializeQueueSystem({
                backend: 'graphile',
                databaseUrl: 'postgresql://localhost:5432',
            });

            // Second initialization
            queueFactory.initializeQueueSystem({
                backend: 'graphile',
                databaseUrl: 'postgresql://localhost:5432',
            });

            expect(consoleSpy).toHaveBeenCalledWith('[QueueSystem] Already initialized');
            consoleSpy.mockRestore();
        });
    });

    describe('createQueue', () => {
        it('should create queue for BullMQ backend', () => {
            queueFactory.initializeQueueSystem({
                backend: 'bullmq',
                redisUrl: 'redis://localhost:6379',
                databaseUrl: 'postgresql://localhost:5432',
            });

            const queue = queueFactory.createQueue('test-queue');

            expect(queue).toBeDefined();
            expect(queue.name).toBe('test-queue');
        });

        it('should create queue for graphile backend', () => {
            queueFactory.initializeQueueSystem({
                backend: 'graphile',
                databaseUrl: 'postgresql://localhost:5432',
            });

            const queue = queueFactory.createQueue('test-queue');

            expect(queue).toBeDefined();
            expect(queue.name).toBe('test-queue');
        });

        it('should return cached queue instance for same name', () => {
            queueFactory.initializeQueueSystem({
                backend: 'graphile',
                databaseUrl: 'postgresql://localhost:5432',
            });

            const queue1 = queueFactory.createQueue('test-queue');
            const queue2 = queueFactory.createQueue('test-queue');

            expect(queue1).toBe(queue2);
        });

        it('should throw error if not initialized', async () => {
            vi.resetModules();
            const freshFactory = await import('../../queue/queue-factory.js');

            expect(() => freshFactory.createQueue('test')).toThrow('Not initialized');
        });
    });

    describe('createWorker', () => {
        it('should create worker for BullMQ backend', () => {
            queueFactory.initializeQueueSystem({
                backend: 'bullmq',
                redisUrl: 'redis://localhost:6379',
                databaseUrl: 'postgresql://localhost:5432',
            });

            const processor = vi.fn();
            const worker = queueFactory.createWorker('test-worker', processor);

            expect(worker).toBeDefined();
            expect(worker.name).toBe('test-worker');
        });

        it('should create worker for graphile backend', () => {
            queueFactory.initializeQueueSystem({
                backend: 'graphile',
                databaseUrl: 'postgresql://localhost:5432',
            });

            const processor = vi.fn();
            const worker = queueFactory.createWorker('test-worker', processor);

            expect(worker).toBeDefined();
            expect(worker.name).toBe('test-worker');
        });

        it('should return cached worker instance for same name', () => {
            queueFactory.initializeQueueSystem({
                backend: 'graphile',
                databaseUrl: 'postgresql://localhost:5432',
            });

            const processor1 = vi.fn();
            const processor2 = vi.fn();

            const worker1 = queueFactory.createWorker('test-worker', processor1);
            const worker2 = queueFactory.createWorker('test-worker', processor2);

            // Should return same instance, ignoring second processor
            expect(worker1).toBe(worker2);
        });

        it('should throw error if not initialized', async () => {
            vi.resetModules();
            const freshFactory = await import('../../queue/queue-factory.js');

            expect(() => freshFactory.createWorker('test', vi.fn())).toThrow('Not initialized');
        });
    });

    describe('startQueueWorkers', () => {
        it('should start workers for graphile backend', async () => {
            queueFactory.initializeQueueSystem({
                backend: 'graphile',
                databaseUrl: 'postgresql://localhost:5432',
            });

            await expect(queueFactory.startQueueWorkers()).resolves.not.toThrow();
        });

        it('should be no-op for BullMQ backend', async () => {
            queueFactory.initializeQueueSystem({
                backend: 'bullmq',
                redisUrl: 'redis://localhost:6379',
                databaseUrl: 'postgresql://localhost:5432',
            });

            await expect(queueFactory.startQueueWorkers()).resolves.not.toThrow();
        });
    });

    describe('getQueueSystemStatus', () => {
        it('should return status for graphile backend', () => {
            queueFactory.initializeQueueSystem({
                backend: 'graphile',
                databaseUrl: 'postgresql://localhost:5432',
            });

            const status = queueFactory.getQueueSystemStatus();

            expect(status.backend).toBe('graphile');
            expect(status.connected).toBe(true);
            expect(status.workerCount).toBe(2);
        });

        it('should return status for BullMQ backend', () => {
            queueFactory.initializeQueueSystem({
                backend: 'bullmq',
                redisUrl: 'redis://localhost:6379',
                databaseUrl: 'postgresql://localhost:5432',
            });

            const status = queueFactory.getQueueSystemStatus();

            expect(status.backend).toBe('bullmq');
            expect(status.connected).toBe(true);
            expect(status.workerCount).toBe(0); // BullMQ doesn't track this
        });

        it('should return disconnected status if not initialized', async () => {
            vi.resetModules();
            const freshFactory = await import('../../queue/queue-factory.js');

            const status = freshFactory.getQueueSystemStatus();

            expect(status.connected).toBe(false);
        });
    });

    describe('getQueueBackend', () => {
        it('should return configured backend', () => {
            queueFactory.initializeQueueSystem({
                backend: 'graphile',
                databaseUrl: 'postgresql://localhost:5432',
            });

            expect(queueFactory.getQueueBackend()).toBe('graphile');
        });

        it('should throw error if not initialized', async () => {
            vi.resetModules();
            const freshFactory = await import('../../queue/queue-factory.js');

            expect(() => freshFactory.getQueueBackend()).toThrow('Not initialized');
        });
    });

    describe('shutdownQueueSystem', () => {
        it('should shutdown graphile system', async () => {
            queueFactory.initializeQueueSystem({
                backend: 'graphile',
                databaseUrl: 'postgresql://localhost:5432',
            });

            // Create some resources
            queueFactory.createQueue('test-queue');
            queueFactory.createWorker('test-worker', vi.fn());

            await expect(queueFactory.shutdownQueueSystem()).resolves.not.toThrow();
        });

        it('should shutdown BullMQ system', async () => {
            queueFactory.initializeQueueSystem({
                backend: 'bullmq',
                redisUrl: 'redis://localhost:6379',
                databaseUrl: 'postgresql://localhost:5432',
            });

            // Create some resources
            queueFactory.createQueue('test-queue');
            queueFactory.createWorker('test-worker', vi.fn());

            await expect(queueFactory.shutdownQueueSystem()).resolves.not.toThrow();
        });

        it('should close all cached queues and workers', async () => {
            queueFactory.initializeQueueSystem({
                backend: 'graphile',
                databaseUrl: 'postgresql://localhost:5432',
            });

            const queue = queueFactory.createQueue('test-queue');
            const worker = queueFactory.createWorker('test-worker', vi.fn());

            await queueFactory.shutdownQueueSystem();

            expect(queue.close).toHaveBeenCalled();
            expect(worker.close).toHaveBeenCalled();
        });

        it('should handle errors during worker close gracefully', async () => {
            queueFactory.initializeQueueSystem({
                backend: 'graphile',
                databaseUrl: 'postgresql://localhost:5432',
            });

            const worker = queueFactory.createWorker('test-worker', vi.fn());
            (worker.close as any).mockRejectedValueOnce(new Error('Close failed'));

            const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

            await expect(queueFactory.shutdownQueueSystem()).resolves.not.toThrow();

            expect(consoleSpy).toHaveBeenCalled();
            consoleSpy.mockRestore();
        });

        it('should handle errors during queue close gracefully', async () => {
            queueFactory.initializeQueueSystem({
                backend: 'graphile',
                databaseUrl: 'postgresql://localhost:5432',
            });

            const queue = queueFactory.createQueue('test-queue');
            (queue.close as any).mockRejectedValueOnce(new Error('Close failed'));

            const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

            await expect(queueFactory.shutdownQueueSystem()).resolves.not.toThrow();

            expect(consoleSpy).toHaveBeenCalled();
            consoleSpy.mockRestore();
        });
    });

    describe('getRedisConnection', () => {
        it('should return Redis connection for BullMQ', () => {
            queueFactory.initializeQueueSystem({
                backend: 'bullmq',
                redisUrl: 'redis://localhost:6379',
                databaseUrl: 'postgresql://localhost:5432',
            });

            const connection = queueFactory.getRedisConnection();

            expect(connection).not.toBeNull();
        });

        it('should return null for graphile backend', () => {
            queueFactory.initializeQueueSystem({
                backend: 'graphile',
                databaseUrl: 'postgresql://localhost:5432',
            });

            const connection = queueFactory.getRedisConnection();

            expect(connection).toBeNull();
        });

        it('should return null if not initialized', async () => {
            vi.resetModules();
            const freshFactory = await import('../../queue/queue-factory.js');

            const connection = freshFactory.getRedisConnection();

            expect(connection).toBeNull();
        });
    });
});
