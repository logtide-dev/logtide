/**
 * Digest Scheduler
 *
 * Registers a single static hourly cron job ("digest-dispatch") at worker
 * startup. The dispatch job (src/queue/jobs/digest-dispatch.ts) scans the
 * active digest configs each hour and enqueues digest-generation jobs for the
 * ones due at that UTC hour.
 *
 * Earlier versions registered one cron job per organization at boot, but
 * graphile-worker cron items cannot change while the runner is up, so config
 * CRUD would have required a worker restart. A static dispatch cron plus a
 * due-check keeps schedule changes live on both queue backends (BullMQ and
 * graphile-worker) through the ICronRegistry interface - this service never
 * knows which is active.
 */

import { getCronRegistry } from '../../queue/queue-factory.js';
import { hub } from '@logtide/core';

export interface DigestJobPayload {
  organizationId: string;
  digestConfigId: string;
  frequency: 'daily' | 'weekly';
}

export const DIGEST_DISPATCH_CRON = '0 * * * *'; // every hour on the hour

export class DigestScheduler {
  /**
   * Register the hourly digest-dispatch cron job. Called once at worker boot.
   */
  async registerDispatchCron(): Promise<void> {
    await getCronRegistry('digest-dispatch').registerCronJobs([
      {
        task: 'digest-dispatch',
        cronExpression: DIGEST_DISPATCH_CRON,
        payload: {},
        // Stable identifier - prevents duplicate schedules on restart
        identifier: 'digest-dispatch',
      },
    ]);

    hub.captureLog('info', '[DigestScheduler] Registered hourly digest dispatch cron');
  }
}

export const digestScheduler = new DigestScheduler();
