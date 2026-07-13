/**
 * Digest Dispatch Job Processor
 *
 * Runs hourly (single static cron registered at worker boot). Scans the active
 * digest configs, decides which ones are due at the current UTC hour and
 * enqueues one digest-generation job per due config.
 *
 * This indirection exists because graphile-worker cron items are fixed at
 * runner start: per-org cron jobs cannot be added or removed while the worker
 * is running, so config CRUD would need a worker restart to take effect. A
 * single static dispatch cron plus a due-check keeps schedule changes live on
 * both queue backends.
 */

import { db } from '../../database/connection.js';
import { createQueue } from '../connection.js';
import { hub } from '@logtide/core';
import type { IJob } from '../abstractions/types.js';
import type { DigestJobPayload } from '../../modules/digests/scheduler.js';

interface DispatchableConfig {
  frequency: 'daily' | 'weekly';
  delivery_hour: number;
  delivery_day_of_week: number | null;
  last_sent_at: Date | null;
}

// A digest fires at most once per delivery slot; anything sent less than two
// hours ago is a duplicate trigger (worker restart, overlapping cron tick).
const DOUBLE_FIRE_GUARD_MS = 2 * 60 * 60 * 1000;

export function isConfigDue(config: DispatchableConfig, now: Date): boolean {
  if (now.getUTCHours() !== config.delivery_hour) {
    return false;
  }

  if (config.frequency === 'weekly' && now.getUTCDay() !== config.delivery_day_of_week) {
    return false;
  }

  if (
    config.last_sent_at &&
    now.getTime() - new Date(config.last_sent_at).getTime() < DOUBLE_FIRE_GUARD_MS
  ) {
    return false;
  }

  return true;
}

export async function processDigestDispatch(_job: IJob<Record<string, never>>): Promise<void> {
  const now = new Date();

  // tenant-scope-ok: system dispatch cron sweeps every org's digest config by design
  const configs = await db
    .selectFrom('digest_configs')
    .select([
      'id',
      'organization_id',
      'frequency',
      'delivery_hour',
      'delivery_day_of_week',
      'last_sent_at',
    ])
    .where('enabled', '=', true)
    .execute();

  const due = configs.filter((config) =>
    isConfigDue(
      {
        frequency: config.frequency,
        delivery_hour: config.delivery_hour,
        delivery_day_of_week: config.delivery_day_of_week,
        last_sent_at: config.last_sent_at ? new Date(config.last_sent_at as unknown as string) : null,
      },
      now
    )
  );

  if (due.length === 0) {
    return;
  }

  hub.captureLog('info', `[DigestDispatch] ${due.length} digest(s) due at ${now.toISOString()}`);

  const queue = createQueue<DigestJobPayload>('digest-generation');
  const hourKey = now.toISOString().slice(0, 13); // YYYY-MM-DDTHH (UTC)

  for (const config of due) {
    await queue.add(
      'digest-generation',
      {
        organizationId: config.organization_id,
        digestConfigId: config.id,
        frequency: config.frequency,
      },
      {
        // Hour-keyed so a duplicate dispatch within the same slot dedupes
        jobKey: `digest:${config.id}:${hourKey}`,
        removeOnComplete: true,
      }
    );

    // tenant-scope-ok: id comes from the enabled-configs sweep above; system cron has no org context
    await db
      .updateTable('digest_configs')
      .set({ last_sent_at: now })
      .where('id', '=', config.id)
      .execute();
  }
}
