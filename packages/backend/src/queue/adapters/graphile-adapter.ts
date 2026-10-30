/**
 * Graphile Worker Adapter
 *
 * Wraps graphile-worker (PostgreSQL-based) queue and worker behind the unified interface.
 */

import {
  quickAddJob,
  parseCronItems,
  run,
  type TaskList,
  type Runner,
  type Job as GraphileJob,
  type JobHelpers,
  type ParsedCronItem,
} from 'graphile-worker';
import type { Pool } from 'pg';
import { hub } from '@logtide/core';
import type {
  IQueueAdapter,
  IWorkerAdapter,
  ICronRegistry,
  CronJobDefinition,
  IJob,
  IJobOptions,
  JobProcessor,
} from '../abstractions/types.js';
import { attachContextToPayload } from '../../context/bullmq-context.js';

/**
 * Convert Graphile Job + payload to unified IJob interface
 */
function adaptGraphileJob<T>(
  taskIdentifier: string,
  payload: T,
  job: GraphileJob
): IJob<T> {
  return {
    id: String(job.id),
    data: payload,
    name: taskIdentifier,
    attemptsMade: job.attempts,
    timestamp: job.created_at ? new Date(job.created_at) : undefined,
  };
}

/**
 * Graphile Queue Adapter
 *
 * Uses quickAddJob to add jobs to the PostgreSQL-backed queue.
 */
export class GraphileQueueAdapter<T = unknown> implements IQueueAdapter<T>, ICronRegistry {
  constructor(
    public readonly name: string,
    private pool: Pool
  ) {}

  async add(_jobName: string, data: T, options?: IJobOptions): Promise<IJob<T>> {
    const payload = attachContextToPayload(data) as object;
    const job = await quickAddJob(
      { pgPool: this.pool },
      this.name,
      payload,
      {
        runAt: options?.delay ? new Date(Date.now() + options.delay) : undefined,
        maxAttempts: options?.maxAttempts ?? 3,
        priority: options?.priority,
        jobKey: options?.jobKey,
      }
    );

    return {
      id: String(job.id),
      data: data,
      name: this.name,
      timestamp: new Date(job.created_at),
    };
  }

  async close(): Promise<void> {
    // Graphile queues don't need explicit closing (pool handles it)
  }

  /**
   * Register repeating cron jobs using graphile-worker's native parsedCronItems.
   * Must be called before GraphileWorkerManager.start().
   */
  async registerCronJobs(items: CronJobDefinition[]): Promise<void> {
    const parsed: ParsedCronItem[] = parseCronItems(
      items.map(item => ({
        task: item.task,
        match: item.cronExpression,
        payload: item.payload as Record<string, unknown>,
        identifier: item.identifier,
      }))
    );
    const manager = GraphileWorkerManager.getInstance();
    manager.setCronItems(parsed);
    hub.captureLog('info', `[Graphile] Registered ${items.length} cron job(s)`);
  }

  async getJobCounts(): Promise<{
    waiting: number;
    active: number;
    completed: number;
    failed: number;
  }> {
    // Query graphile_worker.jobs table for counts
    const result = await this.pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE locked_at IS NULL AND run_at <= NOW()) AS waiting,
        COUNT(*) FILTER (WHERE locked_at IS NOT NULL) AS active,
        0 AS completed,
        COUNT(*) FILTER (WHERE attempts >= max_attempts) AS failed
      FROM graphile_worker.jobs
      WHERE task_identifier = $1
    `, [this.name]);

    const row = result.rows[0] || {};
    return {
      waiting: parseInt(row.waiting || '0', 10),
      active: parseInt(row.active || '0', 10),
      completed: 0, // Graphile removes completed jobs
      failed: parseInt(row.failed || '0', 10),
    };
  }
}

/**
 * Graphile Worker Manager
 *
 * Manages a single graphile-worker runner that processes all registered tasks.
 * Uses singleton pattern because graphile-worker runs one runner per process.
 */
export class GraphileWorkerManager {
  private static instance: GraphileWorkerManager | null = null;

  private runner: Runner | null = null;
  private taskList: TaskList = {};
  private pool: Pool | null = null;
  private workers: Map<string, GraphileWorkerAdapter<unknown>> = new Map();
  private isRunning = false;
  private cronItems: ParsedCronItem[] = [];

  private constructor() {}

  static getInstance(): GraphileWorkerManager {
    if (!GraphileWorkerManager.instance) {
      GraphileWorkerManager.instance = new GraphileWorkerManager();
    }
    return GraphileWorkerManager.instance;
  }

  /**
   * Initialize with PostgreSQL pool
   */
  initialize(pool: Pool): void {
    this.pool = pool;
  }

  /**
   * Store parsed cron items to be passed to run() at startup. Additive:
   * items are merged by identifier, so a re-registered identifier replaces
   * only itself and crons registered by other callers are kept.
   */
  setCronItems(items: ParsedCronItem[]): void {
    const byId = new Map(this.cronItems.map((item) => [item.identifier, item]));
    for (const item of items) byId.set(item.identifier, item);
    this.cronItems = [...byId.values()];
  }

  /** Cron items that will be passed to run() at startup. */
  getCronItems(): readonly ParsedCronItem[] {
    return this.cronItems;
  }

  /**
   * Register a task processor
   */
  registerTask<T>(
    name: string,
    processor: JobProcessor<T>,
    worker: GraphileWorkerAdapter<T>
  ): void {
    this.workers.set(name, worker as GraphileWorkerAdapter<unknown>);

    this.taskList[name] = async (payload: unknown, helpers: JobHelpers) => {
      const adaptedJob = adaptGraphileJob(name, payload as T, helpers.job);

      try {
        await processor(adaptedJob);
        // Trigger completed handler
        worker.triggerCompleted(adaptedJob);
      } catch (error) {
        // Trigger failed handler
        worker.triggerFailed(adaptedJob, error as Error);
        throw error; // Re-throw to let graphile-worker handle retry
      }
    };
  }

  /**
   * Start the runner (call after all tasks are registered)
   */
  async start(): Promise<void> {
    if (this.isRunning || !this.pool) {
      return;
    }

    if (Object.keys(this.taskList).length === 0) {
      console.log('[Graphile] No tasks registered, skipping runner start');
      return;
    }

    if (this.cronItems.length === 0) {
      hub.captureLog('info', '[Graphile] No cron items registered — digest schedules will not run');
    }

    try {
      this.runner = await run({
        pgPool: this.pool,
        taskList: this.taskList,
        parsedCronItems: this.cronItems,
        concurrency: 5,
        pollInterval: 1000, // 1 second
        noHandleSignals: true, // We handle signals ourselves
      });

      this.isRunning = true;
      console.log(`[Graphile] Worker started with ${Object.keys(this.taskList).length} tasks`);
    } catch (error) {
      console.error('[Graphile] Failed to start worker:', error);
      throw error;
    }
  }

  /**
   * Stop the runner gracefully
   */
  async stop(): Promise<void> {
    if (!this.isRunning || !this.runner) {
      return;
    }

    try {
      await this.runner.stop();
      this.runner = null;
      this.isRunning = false;
      console.log('[Graphile] Worker stopped');
    } catch (error) {
      console.error('[Graphile] Error stopping worker:', error);
    }
  }

  /**
   * Check if runner is active
   */
  isActive(): boolean {
    return this.isRunning;
  }

  /**
   * Get registered worker count
   */
  getWorkerCount(): number {
    return this.workers.size;
  }
}

/**
 * Graphile Worker Adapter
 *
 * Represents a single task processor. Multiple adapters share one graphile runner.
 */
export class GraphileWorkerAdapter<T = unknown> implements IWorkerAdapter<T> {
  private eventHandlers: {
    completed?: (job: IJob<T>) => void | Promise<void>;
    failed?: (job: IJob<T> | undefined, error: Error) => void | Promise<void>;
    error?: (error: Error) => void | Promise<void>;
  } = {};

  constructor(
    public readonly name: string,
    processor: JobProcessor<T>,
    pool: Pool
  ) {
    const manager = GraphileWorkerManager.getInstance();
    manager.initialize(pool);
    manager.registerTask(name, processor, this);
  }

  /**
   * Called by GraphileWorkerManager when job completes
   */
  triggerCompleted(job: IJob<T>): void {
    if (this.eventHandlers.completed) {
      Promise.resolve(this.eventHandlers.completed(job)).catch((err) => {
        console.error(`[Graphile:${this.name}] Error in completed handler:`, err);
      });
    }
  }

  /**
   * Called by GraphileWorkerManager when job fails
   */
  triggerFailed(job: IJob<T> | undefined, error: Error): void {
    if (this.eventHandlers.failed) {
      Promise.resolve(this.eventHandlers.failed(job, error)).catch((err) => {
        console.error(`[Graphile:${this.name}] Error in failed handler:`, err);
      });
    }
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
    // Individual workers don't close - the manager handles shutdown
  }
}
