import { createWorker } from '../queue/connection.js';
import { getCronRegistry } from '../queue/queue-factory.js';
import type { IWorkerAdapter } from '../queue/abstractions/types.js';
import type { ExtensionRuntime } from './runtime.js';

/**
 * Worker process only: create one queue worker per registered extension job
 * and register all extension crons. Must run before startQueueWorkers():
 * graphile-worker cron items cannot change while the runner is up.
 */
export async function startExtensionJobs(
  runtime: Pick<ExtensionRuntime, 'jobs' | 'crons'>
): Promise<IWorkerAdapter<unknown>[]> {
  const workers = runtime.jobs.map((job) =>
    createWorker<unknown>(job.queue, async (j) => {
      await job.handler(j.data);
    })
  );
  // One call per queue, never one per cron: backends must not see a later
  // registration as a replacement of an earlier one.
  const byQueue = new Map<string, ExtensionRuntime['crons']>();
  for (const cron of runtime.crons) {
    byQueue.set(cron.task, [...(byQueue.get(cron.task) ?? []), cron]);
  }
  for (const [queue, crons] of byQueue) {
    await getCronRegistry(queue).registerCronJobs(crons);
  }
  return workers;
}
