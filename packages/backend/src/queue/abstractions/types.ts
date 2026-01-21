/**
 * Queue Abstraction Types
 *
 * Unified interfaces for job queues that work with both:
 * - BullMQ (Redis-based)
 * - graphile-worker (PostgreSQL-based)
 */

/**
 * Unified job interface that both BullMQ and graphile-worker adapt to
 */
export interface IJob<T = unknown> {
  /** Unique job identifier */
  id: string;
  /** Job payload data */
  data: T;
  /** Job name/type (used for processing) */
  name: string;
  /** Number of retry attempts made */
  attemptsMade?: number;
  /** Job creation timestamp */
  timestamp?: Date;
}

/**
 * Job addition options (common subset of BullMQ & graphile-worker)
 */
export interface IJobOptions {
  /** Delay in milliseconds before job starts */
  delay?: number;
  /** Maximum number of retry attempts */
  maxAttempts?: number;
  /** Job priority (lower = higher priority) */
  priority?: number;
  /** Unique job key (for deduplication) */
  jobKey?: string;
}

/**
 * Queue adapter interface (common operations)
 */
export interface IQueueAdapter<T = unknown> {
  /** Queue name */
  readonly name: string;

  /** Add a job to the queue */
  add(jobName: string, data: T, options?: IJobOptions): Promise<IJob<T>>;

  /** Close the queue connection */
  close(): Promise<void>;

  /** Get job count by state (optional - for monitoring) */
  getJobCounts?(): Promise<{
    waiting: number;
    active: number;
    completed: number;
    failed: number;
  }>;
}

/**
 * Worker processor function signature
 */
export type JobProcessor<T = unknown> = (job: IJob<T>) => Promise<void>;

/**
 * Worker adapter interface (common operations)
 */
export interface IWorkerAdapter<T = unknown> {
  /** Worker name (queue name it processes) */
  readonly name: string;

  /** Register event handlers (chainable) */
  on(event: 'completed', handler: (job: IJob<T>) => void | Promise<void>): this;
  on(
    event: 'failed',
    handler: (job: IJob<T> | undefined, error: Error) => void | Promise<void>
  ): this;
  on(event: 'error', handler: (error: Error) => void | Promise<void>): this;

  /** Close the worker */
  close(): Promise<void>;
}

/**
 * Queue backend type
 */
export type QueueBackend = 'bullmq' | 'graphile';

/**
 * Queue system status
 */
export interface QueueSystemStatus {
  backend: QueueBackend;
  connected: boolean;
  workerCount: number;
}
