/**
 * Vitest global setup: auto-detect infrastructure availability.
 *
 * Sets SKIP_REDIS_TESTS=1 when a Redis server is not reachable so that
 * integration tests degrade gracefully to "skipped" instead of "failed".
 */
import Redis from 'ioredis';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6380';

export async function setup() {
  const redis = new Redis(REDIS_URL, {
    maxRetriesPerRequest: 0,
    lazyConnect: true,
    connectTimeout: 1500,
    enableReadyCheck: false,
  });

  try {
    await redis.connect();
    await redis.ping();
  } catch {
    process.env.SKIP_REDIS_TESTS = '1';
  } finally {
    redis.disconnect(false);
  }
}
