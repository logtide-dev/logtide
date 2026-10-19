import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const state = vi.hoisted(() => ({
    engine: 'timescale' as string,
    initError: null as Error | null,
    startError: null as Error | null,
    quitError: null as Error | null,
    instances: {
        reservoirs: [] as any[],
        buffered: [] as any[],
        redis: [] as any[],
        redisTransports: [] as any[],
        memoryTransports: [] as any[],
        passthroughTransports: [] as any[],
    },
}));

vi.mock('ioredis', () => ({
    default: vi.fn(function (this: any, url: string) {
        this.url = url;
        this.quit = vi.fn(async () => {
            if (state.quitError) throw state.quitError;
            return 'OK';
        });
        state.instances.redis.push(this);
    }),
}));

vi.mock('@logtide/reservoir', () => ({
    Reservoir: vi.fn(function (this: any, engine: string, config: unknown, options: unknown) {
        this.engine = engine;
        this.config = config;
        this.options = options;
        this.initialize = vi.fn(async () => {
            if (state.initError) throw state.initError;
        });
        this.ingest = vi.fn(async () => {});
        this.ingestSpans = vi.fn(async () => {});
        this.ingestMetrics = vi.fn(async () => {});
        state.instances.reservoirs.push(this);
    }),
    ReservoirBuffered: vi.fn(function (this: any, base: unknown, options: any) {
        this.base = base;
        this.options = options;
        this.initialize = vi.fn(async () => {
            if (state.initError) throw state.initError;
        });
        this.start = vi.fn(async () => {
            if (state.startError) throw state.startError;
        });
        this.stop = vi.fn(async () => {});
        state.instances.buffered.push(this);
    }),
    RedisStreamTransport: vi.fn(function (this: any, opts: unknown) {
        this.opts = opts;
        state.instances.redisTransports.push(this);
    }),
    InMemoryTransport: vi.fn(function (this: any, opts: unknown) {
        this.opts = opts;
        state.instances.memoryTransports.push(this);
    }),
    PassthroughTransport: vi.fn(function (this: any, sink: (records: any[]) => Promise<void>) {
        this.sink = sink;
        state.instances.passthroughTransports.push(this);
    }),
    loadBufferFlushConfig: vi.fn(() => ({ flush: true })),
    loadBreakerConfig: vi.fn(() => ({ breaker: true })),
    loadRetryConfig: vi.fn(() => ({ retry: true })),
    selectTransportKind: vi.fn((env: Record<string, string | undefined>) => {
        const explicit = (env.RESERVOIR_BUFFER_TRANSPORT ?? '').toLowerCase();
        if (explicit === 'redis' || explicit === 'memory' || explicit === 'passthrough') return explicit;
        return env.REDIS_URL ? 'redis' : 'memory';
    }),
    loadShardCount: vi.fn(() => 4),
    loadStreamPrefix: vi.fn(() => 'test:buffer'),
}));

vi.mock('../../database/connection.js', () => ({ pool: { fake: 'pool' } }));

vi.mock('../../database/storage-config.js', () => ({
    get STORAGE_ENGINE() {
        return state.engine;
    },
    getClickHouseConfig: vi.fn(() => ({ host: 'ch', port: 8123 })),
    getMongoDBConfig: vi.fn(() => ({ host: 'mongo', port: 27017 })),
}));

async function load() {
    vi.resetModules();
    return import('../../database/reservoir.js');
}

describe('database/reservoir (unit)', () => {
    let warn: ReturnType<typeof vi.spyOn>;
    let error: ReturnType<typeof vi.spyOn>;
    let log: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        state.engine = 'timescale';
        state.initError = null;
        state.startError = null;
        state.quitError = null;
        for (const list of Object.values(state.instances)) list.length = 0;
        vi.stubEnv('RESERVOIR_BUFFER_ENABLED', '');
        vi.stubEnv('RESERVOIR_BUFFER_TRANSPORT', '');
        vi.stubEnv('REDIS_URL', '');
        warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        error = vi.spyOn(console, 'error').mockImplementation(() => {});
        log = vi.spyOn(console, 'log').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.unstubAllEnvs();
        vi.restoreAllMocks();
    });

    describe('engine selection', () => {
        it('uses timescale with the shared pool by default and no buffer', async () => {
            const mod = await load();
            await mod.reservoirReady;

            expect(state.instances.reservoirs).toHaveLength(1);
            const base = state.instances.reservoirs[0];
            expect(base.engine).toBe('timescale');
            expect(base.options).toEqual({
                pool: { fake: 'pool' },
                tableName: 'logs',
                skipInitialize: true,
                projectIdType: 'uuid',
            });
            expect(mod.reservoir).toBe(base);
            expect(state.instances.buffered).toHaveLength(0);
            expect(log).toHaveBeenCalledWith('[Reservoir] Ready (buffer=disabled)');
        });

        it('uses clickhouse config when STORAGE_ENGINE=clickhouse', async () => {
            state.engine = 'clickhouse';
            const mod = await load();
            await mod.reservoirReady;

            const base = state.instances.reservoirs[0];
            expect(base.engine).toBe('clickhouse');
            expect(base.config).toEqual({ host: 'ch', port: 8123 });
            expect(base.options).toEqual({ tableName: 'logs', skipInitialize: false });
            // No buffer, so no saturation warning
            expect(warn).not.toHaveBeenCalled();
        });

        it('uses mongodb config when STORAGE_ENGINE=mongodb', async () => {
            state.engine = 'mongodb';
            const mod = await load();
            await mod.reservoirReady;

            const base = state.instances.reservoirs[0];
            expect(base.engine).toBe('mongodb');
            expect(base.config).toEqual({ host: 'mongo', port: 27017 });
        });
    });

    describe('buffered mode', () => {
        beforeEach(() => {
            vi.stubEnv('RESERVOIR_BUFFER_ENABLED', 'true');
        });

        it('wraps the base reservoir with an in-memory transport and starts it', async () => {
            const mod = await load();
            await mod.reservoirReady;

            expect(state.instances.buffered).toHaveLength(1);
            const buffered = state.instances.buffered[0];
            expect(mod.reservoir).toBe(buffered);
            expect(buffered.base).toBe(state.instances.reservoirs[0]);
            expect(buffered.options.transport).toBe(state.instances.memoryTransports[0]);
            expect(state.instances.memoryTransports[0].opts).toEqual({ shards: 4 });
            expect(buffered.options.flush).toEqual({ flush: true });
            expect(buffered.options.circuitBreaker).toEqual({ breaker: true });
            expect(buffered.options.retry).toEqual({ retry: true });
            expect(buffered.start).toHaveBeenCalled();
            expect(warn).toHaveBeenCalledWith(expect.stringContaining('in-memory buffer transport'));
            expect(log).toHaveBeenCalledWith('[Reservoir] Ready (buffer=enabled)');

            await mod.shutdownReservoir();
            expect(buffered.stop).toHaveBeenCalled();
        });

        it('warns that the buffer regresses latency on non-timescale engines', async () => {
            state.engine = 'clickhouse';
            const mod = await load();
            await mod.reservoirReady;
            expect(warn).toHaveBeenCalledWith(
                expect.stringContaining('RESERVOIR_BUFFER_ENABLED=true on STORAGE_ENGINE=clickhouse'),
            );
        });

        it('falls back to memory when redis transport is requested without REDIS_URL', async () => {
            vi.stubEnv('RESERVOIR_BUFFER_TRANSPORT', 'redis');
            const mod = await load();
            await mod.reservoirReady;

            expect(state.instances.redis).toHaveLength(0);
            expect(state.instances.memoryTransports).toHaveLength(1);
            expect(warn).toHaveBeenCalledWith(expect.stringContaining('REDIS_URL missing'));
        });

        it('creates a redis stream transport and quits the client on shutdown', async () => {
            vi.stubEnv('RESERVOIR_BUFFER_TRANSPORT', 'redis');
            vi.stubEnv('REDIS_URL', 'redis://cache:6379');
            const mod = await load();
            await mod.reservoirReady;

            expect(state.instances.redis).toHaveLength(1);
            const client = state.instances.redis[0];
            expect(client.url).toBe('redis://cache:6379');
            const transport = state.instances.redisTransports[0];
            expect(transport.opts).toMatchObject({
                redis: client,
                streamPrefix: 'test:buffer',
                shards: 4,
                consumerGroup: 'logtide-flush',
                consumerName: `backend-${process.pid}`,
            });

            await mod.shutdownReservoir();
            expect(client.quit).toHaveBeenCalledTimes(1);

            // Second shutdown: client already cleared
            await mod.shutdownReservoir();
            expect(client.quit).toHaveBeenCalledTimes(1);
        });

        it('logs but does not throw when quitting redis fails on shutdown', async () => {
            vi.stubEnv('RESERVOIR_BUFFER_TRANSPORT', 'redis');
            vi.stubEnv('REDIS_URL', 'redis://cache:6379');
            state.quitError = new Error('conn reset');
            const mod = await load();
            await mod.reservoirReady;

            await expect(mod.shutdownReservoir()).resolves.toBeUndefined();
            expect(error).toHaveBeenCalledWith(
                '[Reservoir] Error quitting Redis client during shutdown:',
                state.quitError,
            );
        });

        it('passthrough transport routes records by kind to the base reservoir', async () => {
            vi.stubEnv('RESERVOIR_BUFFER_TRANSPORT', 'passthrough');
            const mod = await load();
            await mod.reservoirReady;

            const base = state.instances.reservoirs[0];
            const sink = state.instances.passthroughTransports[0].sink;

            await sink([
                { kind: 'log', payload: { id: 'l1' } },
                { kind: 'span', payload: { id: 's1' } },
                { kind: 'metric', payload: { id: 'm1' } },
                { kind: 'log', payload: { id: 'l2' } },
            ]);
            expect(base.ingest).toHaveBeenCalledWith([{ id: 'l1' }, { id: 'l2' }]);
            expect(base.ingestSpans).toHaveBeenCalledWith([{ id: 's1' }]);
            expect(base.ingestMetrics).toHaveBeenCalledWith([{ id: 'm1' }]);

            base.ingest.mockClear();
            base.ingestSpans.mockClear();
            base.ingestMetrics.mockClear();
            await sink([]);
            expect(base.ingest).not.toHaveBeenCalled();
            expect(base.ingestSpans).not.toHaveBeenCalled();
            expect(base.ingestMetrics).not.toHaveBeenCalled();
        });

        it('exits the process when the buffered consumer fails to start', async () => {
            state.startError = new Error('stream unavailable');
            const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
            const mod = await load();
            // process.exit is stubbed here, so execution continues to the rethrow
            await expect(mod.reservoirReady).rejects.toThrow('stream unavailable');

            expect(error).toHaveBeenCalledWith(
                expect.stringContaining('CRITICAL: buffer start failed'),
                state.startError,
            );
            expect(exit).toHaveBeenCalledWith(1);
        });
    });

    describe('initialization failure without buffer', () => {
        it('rejects reservoirReady and does not exit', async () => {
            state.initError = new Error('cannot connect');
            const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
            const mod = await load();

            await expect(mod.reservoirReady).rejects.toThrow('cannot connect');
            expect(exit).not.toHaveBeenCalled();
            expect(error).toHaveBeenCalledWith('[Reservoir] Failed to initialize:', state.initError);

            // Shutdown is a no-op without buffer or redis
            await expect(mod.shutdownReservoir()).resolves.toBeUndefined();
        });
    });
});
