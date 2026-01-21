/**
 * Queue Connection Module
 *
 * This module provides a unified interface for job queues.
 * It automatically selects between BullMQ (Redis) and graphile-worker (PostgreSQL)
 * based on environment configuration.
 *
 * When REDIS_URL is set:
 * - Uses BullMQ (Redis) for job queues
 * - Uses Redis for caching and rate limiting
 * - Uses PostgreSQL LISTEN/NOTIFY for live tail (always)
 *
 * When REDIS_URL is NOT set:
 * - Uses graphile-worker (PostgreSQL) for job queues
 * - Disables Redis-based caching (falls back to no cache)
 * - Uses in-memory rate limiting
 * - Uses PostgreSQL LISTEN/NOTIFY for live tail
 *
 * Migration from BullMQ:
 * - This is a drop-in replacement - existing code continues to work
 * - createQueue() and createWorker() have the same API
 * - Job processors receive the same job shape
 */

import Redis from 'ioredis';
import { config } from '../config/index.js';
import {
  initializeQueueSystem,
  createQueue as createQueueImpl,
  createWorker as createWorkerImpl,
  startQueueWorkers,
  shutdownQueueSystem,
  getQueueBackend,
  getQueueSystemStatus,
} from './queue-factory.js';
import type { IQueueAdapter, IWorkerAdapter, QueueBackend, JobProcessor } from './abstractions/types.js';

// Determine backend based on environment
const hasRedis = !!config.REDIS_URL;
const backend: QueueBackend = hasRedis ? 'bullmq' : 'graphile';

// Initialize queue system
initializeQueueSystem({
  backend,
  redisUrl: config.REDIS_URL || undefined,
  databaseUrl: config.DATABASE_URL,
});

console.log(`[Queue] Backend: ${backend} (Redis ${hasRedis ? 'available' : 'not configured'})`);

// Legacy Redis connections for backwards compatibility
// These are used by cache.ts, rate limiting, and other code that directly uses Redis
let connection: Redis | null = null;
let publisher: Redis | null = null;

if (hasRedis && config.REDIS_URL) {
  const redisUrl = config.REDIS_URL;
  const redisOptions = {
    maxRetriesPerRequest: null as null,
    retryStrategy: (times: number) => {
      const maxDelay = 30000;
      const delay = Math.min(times * 1000, maxDelay);
      console.log(`[Redis] Reconnecting... attempt ${times}, waiting ${delay}ms`);
      return delay;
    },
    reconnectOnError: (err: Error) => {
      const targetErrors = ['READONLY', 'ECONNRESET', 'ECONNREFUSED'];
      if (targetErrors.some((e) => err.message.includes(e))) {
        console.log(`[Redis] Reconnecting due to error: ${err.message}`);
        return true;
      }
      return false;
    },
    enableOfflineQueue: true,
    connectTimeout: 10000,
    keepAlive: 10000,
  };

  function setupRedisEventHandlers(redis: Redis, name: string) {
    redis.on('connect', () => console.log(`[Redis:${name}] Connected`));
    redis.on('ready', () => console.log(`[Redis:${name}] Ready`));
    redis.on('error', (err) => console.error(`[Redis:${name}] Error:`, err.message));
    redis.on('close', () => console.log(`[Redis:${name}] Connection closed`));
    redis.on('reconnecting', () => console.log(`[Redis:${name}] Reconnecting...`));
    redis.on('end', () => console.log(`[Redis:${name}] Connection ended`));
  }

  connection = new Redis(redisUrl, redisOptions);
  setupRedisEventHandlers(connection, 'main');

  publisher = new Redis(redisUrl, redisOptions);
  setupRedisEventHandlers(publisher, 'publisher');
}

/**
 * Create a queue for adding jobs
 *
 * Works with both BullMQ (Redis) and graphile-worker (PostgreSQL).
 *
 * @param name Queue/task name
 * @returns Queue adapter
 */
export function createQueue<T = unknown>(name: string): IQueueAdapter<T> {
  return createQueueImpl<T>(name);
}

/**
 * Create a worker to process jobs
 *
 * Works with both BullMQ (Redis) and graphile-worker (PostgreSQL).
 *
 * @param name Queue/task name
 * @param processor Job processor function
 * @returns Worker adapter
 */
export function createWorker<T = unknown>(
  name: string,
  processor: JobProcessor<T>
): IWorkerAdapter<T> {
  return createWorkerImpl<T>(name, processor);
}

/**
 * Start queue workers
 *
 * Required for graphile-worker backend. No-op for BullMQ.
 */
export { startQueueWorkers };

/**
 * Get queue system status
 */
export { getQueueSystemStatus };

/**
 * Get current backend type
 */
export { getQueueBackend };

/**
 * Shutdown the queue system
 */
export { shutdownQueueSystem };

/**
 * Check if Redis is available
 */
export function isRedisAvailable(): boolean {
  return hasRedis;
}

/**
 * Get Redis connection for caching and rate limiting
 *
 * Returns null if Redis is not configured.
 *
 * @deprecated Prefer using queue abstraction. This is for backwards compatibility.
 */
export { connection, publisher };

/**
 * Close all connections
 */
export async function closeConnections(): Promise<void> {
  await shutdownQueueSystem();

  if (connection) {
    await connection.quit();
  }
  if (publisher) {
    await publisher.quit();
  }
}
