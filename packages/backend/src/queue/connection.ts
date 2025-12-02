import { Queue, Worker } from 'bullmq';
import Redis from 'ioredis';
import { config } from '../config/index.js';

// Parse Redis URL to extract password if present
const redisUrl = new URL(config.REDIS_URL);
const redisOptions: any = {
  maxRetriesPerRequest: null,
  // Retry strategy with exponential backoff
  retryStrategy: (times: number) => {
    const maxDelay = 30000; // Max 30 seconds
    const delay = Math.min(times * 1000, maxDelay);
    console.log(`[Redis] Reconnecting... attempt ${times}, waiting ${delay}ms`);
    return delay;
  },
  // Reconnect on connection errors
  reconnectOnError: (err: Error) => {
    const targetErrors = ['READONLY', 'ECONNRESET', 'ECONNREFUSED'];
    if (targetErrors.some(e => err.message.includes(e))) {
      console.log(`[Redis] Reconnecting due to error: ${err.message}`);
      return true;
    }
    return false;
  },
  // Keep commands in queue while reconnecting
  enableOfflineQueue: true,
  // Connection timeout
  connectTimeout: 10000,
  // Keep alive
  keepAlive: 10000,
};

// Add password if present in URL
if (redisUrl.password) {
  redisOptions.password = redisUrl.password;
}

function setupRedisEventHandlers(redis: Redis, name: string) {
  redis.on('connect', () => {
    console.log(`[Redis:${name}] Connected`);
  });

  redis.on('ready', () => {
    console.log(`[Redis:${name}] Ready`);
  });

  redis.on('error', (err) => {
    console.error(`[Redis:${name}] Error:`, err.message);
  });

  redis.on('close', () => {
    console.log(`[Redis:${name}] Connection closed`);
  });

  redis.on('reconnecting', () => {
    console.log(`[Redis:${name}] Reconnecting...`);
  });

  redis.on('end', () => {
    console.log(`[Redis:${name}] Connection ended`);
  });
}

export const connection = new Redis(config.REDIS_URL, redisOptions);
setupRedisEventHandlers(connection, 'main');

// Create a dedicated publisher connection for pub/sub
export const publisher = new Redis(config.REDIS_URL, redisOptions);
setupRedisEventHandlers(publisher, 'publisher');

/**
 * Default job options for cleanup
 * CRITICAL: Without these, job records accumulate forever in Redis
 */
const defaultJobOptions = {
  // Remove completed jobs, keep only last 100 for debugging
  removeOnComplete: {
    count: 100,
    age: 3600, // Remove jobs older than 1 hour
  },
  // Remove failed jobs, keep only last 50 for debugging
  removeOnFail: {
    count: 50,
    age: 86400, // Remove failed jobs older than 24 hours
  },
};

export function createQueue<T = any>(name: string) {
  return new Queue<T>(name, {
    connection,
    defaultJobOptions,
  });
}

export function createWorker<T = any>(
  name: string,
  processor: (job: any) => Promise<void>
) {
  return new Worker<T>(name, processor, { connection });
}
