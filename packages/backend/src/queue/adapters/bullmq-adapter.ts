/**
 * BullMQ Adapter
 *
 * Wraps BullMQ (Redis-based) queue and worker behind the unified interface.
 */

import { Queue, Worker, Job as BullJob } from 'bullmq';
import type Redis from 'ioredis';
import type {
  IQueueAdapter,
  IWorkerAdapter,
  IJob,
  IJobOptions,
  JobProcessor,
} from '../abstractions/types.js';

/**
 * Default job options for cleanup (prevents Redis memory bloat)
 */
const DEFAULT_JOB_OPTIONS = {
  removeOnComplete: {
    count: 100,
    age: 3600, // 1 hour
  },
  removeOnFail: {
    count: 50,
    age: 86400, // 24 hours
  },
};

/**
 * Convert BullMQ Job to unified IJob interface
 */
function adaptBullJob<T>(bullJob: BullJob<T>): IJob<T> {
  return {
    id: bullJob.id || '',
    data: bullJob.data,
    name: bullJob.name,
    attemptsMade: bullJob.attemptsMade,
    timestamp: bullJob.timestamp ? new Date(bullJob.timestamp) : undefined,
  };
}

/**
 * BullMQ Queue Adapter
 */
export class BullMQQueueAdapter<T = unknown> implements IQueueAdapter<T> {
  private queue: Queue<T>;

  constructor(
    public readonly name: string,
    connection: Redis
  ) {
    this.queue = new Queue<T>(name, {
      connection,
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    });
  }

  async add(jobName: string, data: T, options?: IJobOptions): Promise<IJob<T>> {
    // BullMQ has complex generic types, so we use `any` for the queue.add call
    // and return our properly typed IJob
    const bullJob = await (this.queue as any).add(jobName, data, {
      delay: options?.delay,
      attempts: options?.maxAttempts,
      priority: options?.priority,
      jobId: options?.jobKey,
    });

    return {
      id: bullJob.id || '',
      data: data, // Use the original data since bullJob.data has complex type
      name: bullJob.name,
      attemptsMade: bullJob.attemptsMade,
      timestamp: bullJob.timestamp ? new Date(bullJob.timestamp) : undefined,
    };
  }

  async close(): Promise<void> {
    await this.queue.close();
  }

  async getJobCounts(): Promise<{
    waiting: number;
    active: number;
    completed: number;
    failed: number;
  }> {
    const counts = await this.queue.getJobCounts('waiting', 'active', 'completed', 'failed');
    return {
      waiting: counts.waiting ?? 0,
      active: counts.active ?? 0,
      completed: counts.completed ?? 0,
      failed: counts.failed ?? 0,
    };
  }
}

/**
 * BullMQ Worker Adapter
 */
export class BullMQWorkerAdapter<T = unknown> implements IWorkerAdapter<T> {
  private worker: Worker<T>;
  private eventHandlers: {
    completed?: (job: IJob<T>) => void | Promise<void>;
    failed?: (job: IJob<T> | undefined, error: Error) => void | Promise<void>;
    error?: (error: Error) => void | Promise<void>;
  } = {};

  constructor(
    public readonly name: string,
    processor: JobProcessor<T>,
    connection: Redis
  ) {
    this.worker = new Worker<T>(
      name,
      async (bullJob: BullJob<T>) => {
        const adaptedJob = adaptBullJob(bullJob);
        await processor(adaptedJob);
      },
      { connection }
    );

    // Forward BullMQ events to our handlers
    this.worker.on('completed', (bullJob: BullJob<T>) => {
      if (this.eventHandlers.completed) {
        const adaptedJob = adaptBullJob(bullJob);
        Promise.resolve(this.eventHandlers.completed(adaptedJob)).catch((err) => {
          console.error(`[BullMQ:${name}] Error in completed handler:`, err);
        });
      }
    });

    this.worker.on('failed', (bullJob: BullJob<T> | undefined, error: Error) => {
      if (this.eventHandlers.failed) {
        const adaptedJob = bullJob ? adaptBullJob(bullJob) : undefined;
        Promise.resolve(this.eventHandlers.failed(adaptedJob, error)).catch((err) => {
          console.error(`[BullMQ:${name}] Error in failed handler:`, err);
        });
      }
    });

    this.worker.on('error', (error: Error) => {
      if (this.eventHandlers.error) {
        Promise.resolve(this.eventHandlers.error(error)).catch((err) => {
          console.error(`[BullMQ:${name}] Error in error handler:`, err);
        });
      }
    });
  }

  on(event: 'completed', handler: (job: IJob<T>) => void | Promise<void>): this;
  on(
    event: 'failed',
    handler: (job: IJob<T> | undefined, error: Error) => void | Promise<void>
  ): this;
  on(event: 'error', handler: (error: Error) => void | Promise<void>): this;
  on(
    event: 'completed' | 'failed' | 'error',
    handler: ((job: IJob<T>) => void | Promise<void>) | ((job: IJob<T> | undefined, error: Error) => void | Promise<void>) | ((error: Error) => void | Promise<void>)
  ): this {
    if (event === 'completed') {
      this.eventHandlers.completed = handler as (job: IJob<T>) => void | Promise<void>;
    } else if (event === 'failed') {
      this.eventHandlers.failed = handler as (
        job: IJob<T> | undefined,
        error: Error
      ) => void | Promise<void>;
    } else if (event === 'error') {
      this.eventHandlers.error = handler as (error: Error) => void | Promise<void>;
    }
    return this;
  }

  async close(): Promise<void> {
    await this.worker.close();
  }
}
