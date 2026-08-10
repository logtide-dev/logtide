/**
 * Queued webhook delivery (#218). One attempt per job run; on a retryable
 * failure the job re-enqueues itself with the next backoff delay until
 * max_attempts, then the delivery goes to the DLQ (status='dead'). This manual
 * re-enqueue keeps retry behaviour identical on both queue backends.
 */
import type { IJob } from '../abstractions/types.js';
import { config } from '../../config/index.js';
import { createQueue } from '../connection.js';
import { deliverOnce, WEBHOOK_DELIVERY_QUEUE } from '../../modules/webhooks/dispatcher.js';
import { webhookDeliveryService } from '../../modules/webhooks/service.js';
import { OrgConcurrencyLimiter } from '../../modules/webhooks/concurrency.js';
import type { WebhookDeliveryJobData } from '../../modules/webhooks/types.js';

export const BACKOFF_SCHEDULE_MS = [1_000, 5_000, 25_000, 120_000, 600_000];

const limiter = new OrgConcurrencyLimiter({
  perOrg: config.WEBHOOK_PER_ORG_CONCURRENCY,
  global: config.WEBHOOK_GLOBAL_CONCURRENCY,
});

const queue = createQueue<WebhookDeliveryJobData>(WEBHOOK_DELIVERY_QUEUE);

export async function processWebhookDelivery(job: IJob<WebhookDeliveryJobData>): Promise<void> {
  const delivery = await webhookDeliveryService.getDelivery(job.data.deliveryId);
  if (!delivery) {
    console.warn(`[WebhookDelivery] delivery ${job.data.deliveryId} not found, skipping`);
    return;
  }
  if (delivery.status === 'delivered' || delivery.status === 'dead') {
    return; // idempotent: already terminal
  }

  const meta = (delivery.metadata ?? {}) as Record<string, unknown>;
  const attemptNumber = delivery.attempt_count + 1;

  const result = await limiter.run(delivery.organization_id, () =>
    deliverOnce({
      url: delivery.url,
      body: meta.payload,
      organizationId: delivery.organization_id,
      eventType: delivery.event_type,
      signingSecret: (meta.signingSecret as string) ?? undefined,
      headers: (meta.headers as Record<string, string>) ?? undefined,
      channelId: (meta.channelId as string) ?? undefined,
      ruleId: (meta.ruleId as string) ?? undefined,
    })
  );

  await webhookDeliveryService.recordAttempt(
    delivery.id,
    {
      attemptNumber,
      statusCode: result.statusCode ?? null,
      durationMs: result.durationMs,
      responseExcerpt: result.responseExcerpt ?? null,
      error: result.error ?? null,
    },
    config.WEBHOOK_DELIVERY_LOG_LIMIT
  );

  if (result.success) {
    await webhookDeliveryService.markDelivered(delivery.id);
    return;
  }

  const canRetry = result.retryable && attemptNumber < delivery.max_attempts;
  if (!canRetry) {
    await webhookDeliveryService.markDead(delivery.id, attemptNumber, result.error ?? 'delivery failed');
    return;
  }

  const delay = BACKOFF_SCHEDULE_MS[Math.min(attemptNumber - 1, BACKOFF_SCHEDULE_MS.length - 1)];
  const nextAttemptAt = new Date(Date.now() + delay);
  await webhookDeliveryService.markRetrying(delivery.id, attemptNumber, nextAttemptAt, result.error ?? 'delivery failed');
  // Per-attempt jobKey dedupes a retry if two workers race the same job.
  await queue.add('deliver', { deliveryId: delivery.id }, {
    delay,
    maxAttempts: 1,
    jobKey: `webhook-retry-${delivery.id}-${attemptNumber}`,
    removeOnComplete: true,
    removeOnFail: true,
  });
}
