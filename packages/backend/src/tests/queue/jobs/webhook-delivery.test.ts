import { describe, it, expect, vi, beforeEach } from 'vitest';

const { addMock, svc, deliverOnceMock } = vi.hoisted(() => ({
  addMock: vi.fn(),
  svc: {
    getDelivery: vi.fn(),
    recordAttempt: vi.fn(),
    markDelivered: vi.fn(),
    markRetrying: vi.fn(),
    markDead: vi.fn(),
  },
  deliverOnceMock: vi.fn(),
}));

vi.mock('../../../config/index.js', () => ({
  config: { WEBHOOK_MAX_ATTEMPTS: 5, WEBHOOK_PER_ORG_CONCURRENCY: 5, WEBHOOK_GLOBAL_CONCURRENCY: 50, WEBHOOK_DELIVERY_LOG_LIMIT: 1000 },
}));
vi.mock('../../../queue/connection.js', () => ({ createQueue: vi.fn(() => ({ add: addMock, close: vi.fn() })) }));
vi.mock('../../../modules/webhooks/service.js', () => ({ webhookDeliveryService: svc }));
vi.mock('../../../modules/webhooks/dispatcher.js', () => ({ deliverOnce: deliverOnceMock, WEBHOOK_DELIVERY_QUEUE: 'webhook-delivery' }));

import { processWebhookDelivery, BACKOFF_SCHEDULE_MS } from '../../../queue/jobs/webhook-delivery.js';
import type { IJob } from '../../../queue/abstractions/types.js';
import type { WebhookDeliveryJobData } from '../../../modules/webhooks/types.js';

function delivery(over = {}) {
  return { id: 'del-1', organization_id: 'org-1', event_type: 'alert', event_id: 'e', url: 'https://e.com', status: 'pending', attempt_count: 0, max_attempts: 5, metadata: { payload: { a: 1 } }, ...over };
}

beforeEach(() => {
  Object.values(svc).forEach((m) => m.mockReset().mockResolvedValue(undefined));
  addMock.mockReset().mockResolvedValue({ id: 'job' });
  deliverOnceMock.mockReset();
});

describe('processWebhookDelivery', () => {
  it('marks delivered on success', async () => {
    svc.getDelivery.mockResolvedValue(delivery());
    deliverOnceMock.mockResolvedValue({ success: true, statusCode: 200, durationMs: 5, retryable: false });
    await processWebhookDelivery({ id: 'j', name: 'deliver', data: { deliveryId: 'del-1' } } as IJob<WebhookDeliveryJobData>);
    expect(svc.markDelivered).toHaveBeenCalledWith('del-1');
    expect(svc.recordAttempt).toHaveBeenCalledWith('del-1', expect.objectContaining({ attemptNumber: 1, statusCode: 200 }), 1000);
  });

  it('passes the stored method and headers to deliverOnce', async () => {
    svc.getDelivery.mockResolvedValue(delivery({ metadata: { payload: {}, method: 'PUT', headers: { Authorization: 'Bearer t' } } }));
    deliverOnceMock.mockResolvedValue({ success: true, statusCode: 200, durationMs: 5, retryable: false });
    await processWebhookDelivery({ id: 'j', name: 'deliver', data: { deliveryId: 'del-1' } } as IJob<WebhookDeliveryJobData>);
    expect(deliverOnceMock).toHaveBeenCalledWith(expect.objectContaining({ method: 'PUT', headers: { Authorization: 'Bearer t' } }));
  });

  it('re-enqueues with backoff on a retryable failure', async () => {
    svc.getDelivery.mockResolvedValue(delivery({ attempt_count: 0 }));
    deliverOnceMock.mockResolvedValue({ success: false, statusCode: 503, durationMs: 5, error: 'HTTP 503', retryable: true });
    await processWebhookDelivery({ id: 'j', name: 'deliver', data: { deliveryId: 'del-1' } } as IJob<WebhookDeliveryJobData>);
    expect(svc.markRetrying).toHaveBeenCalledWith('del-1', 1, expect.any(Date), 'HTTP 503');
    expect(addMock).toHaveBeenCalledWith('deliver', { deliveryId: 'del-1' }, expect.objectContaining({ delay: BACKOFF_SCHEDULE_MS[0] }));
  });

  it('marks dead when attempts are exhausted', async () => {
    svc.getDelivery.mockResolvedValue(delivery({ attempt_count: 4, max_attempts: 5 }));
    deliverOnceMock.mockResolvedValue({ success: false, statusCode: 503, durationMs: 5, error: 'HTTP 503', retryable: true });
    await processWebhookDelivery({ id: 'j', name: 'deliver', data: { deliveryId: 'del-1' } } as IJob<WebhookDeliveryJobData>);
    expect(svc.markDead).toHaveBeenCalledWith('del-1', 5, 'HTTP 503');
    expect(addMock).not.toHaveBeenCalled();
  });

  it('marks dead immediately on a non-retryable failure', async () => {
    svc.getDelivery.mockResolvedValue(delivery({ attempt_count: 0 }));
    deliverOnceMock.mockResolvedValue({ success: false, statusCode: 400, durationMs: 5, error: 'HTTP 400', retryable: false });
    await processWebhookDelivery({ id: 'j', name: 'deliver', data: { deliveryId: 'del-1' } } as IJob<WebhookDeliveryJobData>);
    expect(svc.markDead).toHaveBeenCalledWith('del-1', 1, 'HTTP 400');
  });

  it('skips a delivery already delivered or dead (idempotent)', async () => {
    svc.getDelivery.mockResolvedValue(delivery({ status: 'delivered' }));
    await processWebhookDelivery({ id: 'j', name: 'deliver', data: { deliveryId: 'del-1' } } as IJob<WebhookDeliveryJobData>);
    expect(deliverOnceMock).not.toHaveBeenCalled();
  });
});
