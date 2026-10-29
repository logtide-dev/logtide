import Redis from 'ioredis';
import {
  Reservoir,
  ReservoirBuffered,
  RedisStreamTransport,
  InMemoryTransport,
  PassthroughTransport,
  loadBufferFlushConfig,
  loadBreakerConfig,
  loadRetryConfig,
  selectTransportKind,
  loadShardCount,
  loadStreamPrefix,
  type BufferTransport,
  type IReservoir,
} from '@logtide/reservoir';
import { pool } from './connection.js';
import { STORAGE_ENGINE, getClickHouseConfig, getMongoDBConfig } from './storage-config.js';

/**
 * Optional ANALYTICS_TIMEOUT_MS override of the time limit on the log analytics
 * reads (count, histogram, facets, key discovery) of the ClickHouse and MongoDB
 * engines. Unset keeps the engine default (30 s); 0 disables the limit.
 */
export function readAnalyticsTimeoutMs(env: NodeJS.ProcessEnv = process.env): number | undefined {
  const raw = env.ANALYTICS_TIMEOUT_MS;
  if (raw === undefined || raw.trim() === '') return undefined;
  const ms = Number(raw);
  return Number.isFinite(ms) && ms >= 0 ? Math.floor(ms) : undefined;
}

function createBaseReservoir(): Reservoir {
  const analyticsTimeoutMs = readAnalyticsTimeoutMs();
  if (STORAGE_ENGINE === 'clickhouse') {
    return new Reservoir('clickhouse', getClickHouseConfig(), {
      tableName: 'logs',
      skipInitialize: false,
      ...(analyticsTimeoutMs !== undefined ? { analyticsTimeoutMs } : {}),
    });
  }
  if (STORAGE_ENGINE === 'mongodb') {
    return new Reservoir('mongodb', getMongoDBConfig(), {
      tableName: 'logs',
      skipInitialize: false,
      ...(analyticsTimeoutMs !== undefined ? { analyticsTimeoutMs } : {}),
    });
  }
  return new Reservoir(
    'timescale',
    { host: '', port: 0, database: '', username: '', password: '' },
    { pool, tableName: 'logs', skipInitialize: true, projectIdType: 'uuid' },
  );
}

let redisClient: Redis | null = null;

function createBufferTransport(baseReservoir: Reservoir): BufferTransport {
  const kind = selectTransportKind(process.env);
  const shards = loadShardCount(process.env);

  if (kind === 'redis') {
    if (!process.env.REDIS_URL) {
      console.warn('[Reservoir] RESERVOIR_BUFFER_TRANSPORT=redis but REDIS_URL missing, falling back to memory');
      return new InMemoryTransport({ shards });
    }
    redisClient = new Redis(process.env.REDIS_URL);
    return new RedisStreamTransport({
      redis: redisClient,
      streamPrefix: loadStreamPrefix(process.env),
      shards,
      consumerGroup: 'logtide-flush',
      consumerName: `backend-${process.pid}`,
    });
  }

  if (kind === 'passthrough') {
    return new PassthroughTransport(async (records) => {
      const logs = records.filter((r) => r.kind === 'log').map((r) => r.payload as never);
      const spans = records.filter((r) => r.kind === 'span').map((r) => r.payload as never);
      const metrics = records.filter((r) => r.kind === 'metric').map((r) => r.payload as never);
      if (logs.length > 0) await baseReservoir.ingest(logs);
      if (spans.length > 0) await baseReservoir.ingestSpans(spans);
      if (metrics.length > 0) await baseReservoir.ingestMetrics(metrics);
    });
  }

  console.warn('[Reservoir] Using in-memory buffer transport (single-instance only, not crash-safe)');
  return new InMemoryTransport({ shards });
}

const baseReservoir = createBaseReservoir();

const bufferEnabled = process.env.RESERVOIR_BUFFER_ENABLED === 'true';

if (bufferEnabled && STORAGE_ENGINE !== 'timescale') {
  console.warn(
    `[Reservoir] WARNING: RESERVOIR_BUFFER_ENABLED=true on STORAGE_ENGINE=${STORAGE_ENGINE}. ` +
    `Benchmarks show the buffer regresses p95 latency on ${STORAGE_ENGINE} under saturation ` +
    `(see https://logtide.dev/docs/async-buffer/). Consider disabling the buffer unless you ` +
    `have measured a benefit on your specific workload.`,
  );
}

export const reservoir: IReservoir = bufferEnabled
  ? new ReservoirBuffered(baseReservoir, {
      transport: createBufferTransport(baseReservoir),
      flush: loadBufferFlushConfig(process.env),
      circuitBreaker: loadBreakerConfig(process.env),
      retry: loadRetryConfig(process.env),
    })
  : baseReservoir;

const buffered: ReservoirBuffered | null = bufferEnabled ? (reservoir as ReservoirBuffered) : null;

// Initialize (and start buffered consumer pool if applicable)
export const reservoirReady = (async () => {
  try {
    await reservoir.initialize();
    if (buffered) await buffered.start();
    console.log(`[Reservoir] Ready (buffer=${bufferEnabled ? 'enabled' : 'disabled'})`);
  } catch (err) {
    if (bufferEnabled) {
      console.error('[Reservoir] CRITICAL: buffer start failed, ingestions will be lost until restart:', err);
      process.exit(1);
    }
    console.error('[Reservoir] Failed to initialize:', err);
    throw err;
  }
})();

export async function shutdownReservoir(): Promise<void> {
  if (buffered) {
    await buffered.stop();
  }
  if (redisClient) {
    await redisClient.quit().catch((err) => {
      console.error('[Reservoir] Error quitting Redis client during shutdown:', err);
    });
    redisClient = null;
  }
}
