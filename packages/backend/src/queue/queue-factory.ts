/**
 * Queue Factory
 *
 * Creates queue and worker instances based on environment configuration.
 * Automatically selects between BullMQ (Redis) and graphile-worker (PostgreSQL).
 */

import Redis from 'ioredis';
import pg from 'pg';
import type {
  IQueueAdapter,
  IWorkerAdapter,
  JobProcessor,
  QueueBackend,
  QueueSystemStatus,
} from './abstractions/types.js';
import { BullMQQueueAdapter, BullMQWorkerAdapter } from './adapters/bullmq-adapter.js';
import {
  GraphileQueueAdapter,
  GraphileWorkerAdapter,
  GraphileWorkerManager,
} from './adapters/graphile-adapter.js';

const { Pool } = pg;

/**
 * Queue configuration from environment
 */
interface QueueConfig {
  backend: QueueBackend;
  redisUrl?: string;
  databaseUrl: string;
}

/**
 * Queue System Manager (Singleton)
 *
 * Manages connections and factory functions for the queue system.
 */
class QueueSystemManager {
  private static instance: QueueSystemManager | null = null;

  private config: QueueConfig | null = null;
  private redisConnection: Redis | null = null;
  private pgPool: pg.Pool | null = null;
  private initialized = false;

  // Cache for queue and worker instances to prevent resource leaks
  private queueCache: Map<string, IQueueAdapter<unknown>> = new Map();
  private workerCache: Map<string, IWorkerAdapter<unknown>> = new Map();

  private constructor() {}

  static getInstance(): QueueSystemManager {
    if (!QueueSystemManager.instance) {
      QueueSystemManager.instance = new QueueSystemManager();
    }
    return QueueSystemManager.instance;
  }

  /**
   * Initialize the queue system
   *
   * @param config Queue configuration (backend, URLs)
   */
  initialize(config: QueueConfig): void {
    if (this.initialized) {
      console.warn('[QueueSystem] Already initialized');
      return;
    }

    this.config = config;

    if (config.backend === 'bullmq') {
      if (!config.redisUrl) {
        throw new Error('[QueueSystem] Redis URL required for BullMQ backend');
      }

      this.redisConnection = new Redis(config.redisUrl, {
        maxRetriesPerRequest: null,
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
      });

      this.setupRedisEventHandlers();
      console.log('[QueueSystem] Using BullMQ (Redis) backend');
    } else {
      this.pgPool = new Pool({
        connectionString: config.databaseUrl,
        max: 10, // Separate pool for queue operations
      });
      console.log('[QueueSystem] Using graphile-worker (PostgreSQL) backend');
    }

    this.initialized = true;
  }

  /**
   * Setup Redis connection event handlers
   */
  private setupRedisEventHandlers(): void {
    if (!this.redisConnection) return;

    this.redisConnection.on('connect', () => {
      console.log('[Redis:queue] Connected');
    });

    this.redisConnection.on('ready', () => {
      console.log('[Redis:queue] Ready');
    });

    this.redisConnection.on('error', (err) => {
      console.error('[Redis:queue] Error:', err.message);
    });

    this.redisConnection.on('close', () => {
      console.log('[Redis:queue] Connection closed');
    });

    this.redisConnection.on('reconnecting', () => {
      console.log('[Redis:queue] Reconnecting...');
    });
  }

  /**
   * Get the configured backend type
   */
  getBackend(): QueueBackend {
    if (!this.config) {
      throw new Error('[QueueSystem] Not initialized. Call initialize() first.');
    }
    return this.config.backend;
  }

  /**
   * Get Redis connection (BullMQ only)
   */
  getRedisConnection(): Redis {
    if (!this.redisConnection) {
      throw new Error('[QueueSystem] Redis connection not available. Using graphile backend?');
    }
    return this.redisConnection;
  }

  /**
   * Get PostgreSQL pool (graphile only)
   */
  getPgPool(): pg.Pool {
    if (!this.pgPool) {
      throw new Error('[QueueSystem] PostgreSQL pool not available. Using bullmq backend?');
    }
    return this.pgPool;
  }

  /**
   * Create or get a cached queue adapter
   *
   * Queue instances are cached by name to prevent resource leaks.
   * Multiple calls with the same name return the same instance.
   */
  createQueue<T = unknown>(name: string): IQueueAdapter<T> {
    if (!this.config) {
      throw new Error('[QueueSystem] Not initialized. Call initialize() first.');
    }

    // Return cached instance if available
    const cached = this.queueCache.get(name);
    if (cached) {
      return cached as IQueueAdapter<T>;
    }

    // Create new instance
    let queue: IQueueAdapter<T>;
    if (this.config.backend === 'bullmq') {
      queue = new BullMQQueueAdapter<T>(name, this.getRedisConnection());
    } else {
      queue = new GraphileQueueAdapter<T>(name, this.getPgPool());
    }

    // Cache the instance
    this.queueCache.set(name, queue as IQueueAdapter<unknown>);
    return queue;
  }

  /**
   * Create or get a cached worker adapter
   *
   * Worker instances are cached by name. Once a worker is created for a task,
   * subsequent calls return the same instance (processor is ignored on cache hit).
   */
  createWorker<T = unknown>(name: string, processor: JobProcessor<T>): IWorkerAdapter<T> {
    if (!this.config) {
      throw new Error('[QueueSystem] Not initialized. Call initialize() first.');
    }

    // Return cached instance if available
    const cached = this.workerCache.get(name);
    if (cached) {
      return cached as IWorkerAdapter<T>;
    }

    // Create new instance
    let worker: IWorkerAdapter<T>;
    if (this.config.backend === 'bullmq') {
      worker = new BullMQWorkerAdapter<T>(name, processor, this.getRedisConnection());
    } else {
      worker = new GraphileWorkerAdapter<T>(name, processor, this.getPgPool());
    }

    // Cache the instance
    this.workerCache.set(name, worker as IWorkerAdapter<unknown>);
    return worker;
  }

  /**
   * Start the graphile worker runner (only for graphile backend)
   */
  async startWorkers(): Promise<void> {
    if (this.config?.backend === 'graphile') {
      const manager = GraphileWorkerManager.getInstance();
      await manager.start();
    }
    // BullMQ workers start automatically on creation
  }

  /**
   * Get queue system status
   */
  getStatus(): QueueSystemStatus {
    if (!this.config) {
      return { backend: 'bullmq', connected: false, workerCount: 0 };
    }

    if (this.config.backend === 'graphile') {
      const manager = GraphileWorkerManager.getInstance();
      return {
        backend: 'graphile',
        connected: manager.isActive(),
        workerCount: manager.getWorkerCount(),
      };
    }

    return {
      backend: 'bullmq',
      connected: this.redisConnection?.status === 'ready',
      workerCount: 0, // BullMQ doesn't track this centrally
    };
  }

  /**
   * Shutdown the queue system
   *
   * Closes all cached queues and workers, then closes connections.
   */
  async shutdown(): Promise<void> {
    console.log('[QueueSystem] Shutting down...');

    // Close all cached workers first
    for (const [name, worker] of this.workerCache) {
      try {
        await worker.close();
        console.log(`[QueueSystem] Worker '${name}' closed`);
      } catch (error) {
        console.error(`[QueueSystem] Error closing worker '${name}':`, error);
      }
    }
    this.workerCache.clear();

    // Close all cached queues
    for (const [name, queue] of this.queueCache) {
      try {
        await queue.close();
        console.log(`[QueueSystem] Queue '${name}' closed`);
      } catch (error) {
        console.error(`[QueueSystem] Error closing queue '${name}':`, error);
      }
    }
    this.queueCache.clear();

    if (this.config?.backend === 'graphile') {
      const manager = GraphileWorkerManager.getInstance();
      await manager.stop();

      if (this.pgPool) {
        await this.pgPool.end();
        this.pgPool = null;
      }
    }

    if (this.redisConnection) {
      await this.redisConnection.quit();
      this.redisConnection = null;
    }

    this.initialized = false;
    console.log('[QueueSystem] Shutdown complete');
  }
}

// Singleton instance
const queueSystem = QueueSystemManager.getInstance();

/**
 * Initialize the queue system
 *
 * Call once at application startup with environment configuration.
 */
export function initializeQueueSystem(config: QueueConfig): void {
  queueSystem.initialize(config);
}

/**
 * Create a queue for adding jobs
 *
 * @param name Queue/task name
 * @returns Queue adapter instance
 */
export function createQueue<T = unknown>(name: string): IQueueAdapter<T> {
  return queueSystem.createQueue<T>(name);
}

/**
 * Create a worker to process jobs
 *
 * @param name Queue/task name
 * @param processor Job processor function
 * @returns Worker adapter instance
 */
export function createWorker<T = unknown>(
  name: string,
  processor: JobProcessor<T>
): IWorkerAdapter<T> {
  return queueSystem.createWorker<T>(name, processor);
}

/**
 * Start workers (required for graphile backend)
 */
export async function startQueueWorkers(): Promise<void> {
  await queueSystem.startWorkers();
}

/**
 * Get queue system status
 */
export function getQueueSystemStatus(): QueueSystemStatus {
  return queueSystem.getStatus();
}

/**
 * Get current backend type
 */
export function getQueueBackend(): QueueBackend {
  return queueSystem.getBackend();
}

/**
 * Shutdown the queue system
 */
export async function shutdownQueueSystem(): Promise<void> {
  await queueSystem.shutdown();
}

/**
 * Get Redis connection (for backwards compatibility)
 *
 * @deprecated Use createQueue/createWorker instead
 */
export function getRedisConnection(): Redis | null {
  try {
    return queueSystem.getRedisConnection();
  } catch {
    return null;
  }
}
