import { describe, it, expect, vi, beforeEach } from 'vitest';

const { enqueueMock } = vi.hoisted(() => ({ enqueueMock: vi.fn() }));

vi.mock('../../../modules/webhooks/index.js', async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    webhookDispatcher: { ...actual.webhookDispatcher, enqueue: enqueueMock },
  };
});

import { db } from '../../../database/index.js';
import { webhookDeliveryService } from '../../../modules/webhooks/service.js';
import { notifyPagerDuty } from '../../../modules/notification-channels/dispatch.js';
import { createTestContext } from '../../helpers/factories.js';

const KEY = 'a'.repeat(32);
const CH = '00000000-0000-4000-8000-0000000000c1';

async function seedDelivery(organizationId: string, eventId: string, status: 'pending' | 'failed' | 'delivered') {
  const row = await webhookDeliveryService.createDelivery({
    organizationId,
    eventType: 'monitor.status_changed',
    eventId,
    url: 'https://events.pagerduty.com/v2/enqueue',
    maxAttempts: 5,
  });
  if (status === 'failed') {
    await webhookDeliveryService.markRetrying(row.id, 1, new Date(Date.now() + 60_000), 'HTTP 429');
  } else if (status === 'delivered') {
    await webhookDeliveryService.markDelivered(row.id);
  }
  return row.id;
}

async function statusOf(id: string) {
  const row = await db.selectFrom('webhook_deliveries').select(['status', 'last_error']).where('id', '=', id).executeTakeFirstOrThrow();
  return row;
}

describe('pagerduty trigger and resolve ordering', () => {
  beforeEach(() => {
    enqueueMock.mockReset().mockResolvedValue({ deliveryId: 'd' });
  });

  it('a resolve supersedes a trigger that is still retrying', async () => {
    const { organization } = await createTestContext();
    const pending = await seedDelivery(organization.id, `monitor:m1:trigger:${CH}`, 'pending');
    const failed = await seedDelivery(organization.id, `monitor:m1:trigger:${CH}`, 'failed');
    const delivered = await seedDelivery(organization.id, `monitor:m1:trigger:${CH}`, 'delivered');
    const otherKey = await seedDelivery(organization.id, `monitor:m2:trigger:${CH}`, 'failed');

    await notifyPagerDuty(
      { channelId: CH, routingKey: KEY },
      { organizationId: organization.id, action: 'resolve', dedupKey: 'monitor:m1', eventType: 'monitor.status_changed' }
    );

    expect((await statusOf(pending)).status).toBe('dead');
    expect((await statusOf(failed)).status).toBe('dead');
    expect((await statusOf(failed)).last_error).toBe('superseded by resolve');
    expect((await statusOf(delivered)).status).toBe('delivered');
    expect((await statusOf(otherKey)).status).toBe('failed');
    expect(enqueueMock).toHaveBeenCalledTimes(1);
  });

  it('a trigger supersedes a resolve that is still retrying', async () => {
    const { organization } = await createTestContext();
    const resolve = await seedDelivery(organization.id, `monitor:m1:resolve:${CH}`, 'failed');

    await notifyPagerDuty(
      { channelId: CH, routingKey: KEY },
      { organizationId: organization.id, action: 'trigger', dedupKey: 'monitor:m1', eventType: 'monitor.status_changed' }
    );

    expect((await statusOf(resolve)).status).toBe('dead');
    expect((await statusOf(resolve)).last_error).toBe('superseded by trigger');
  });

  it('does not touch another organization', async () => {
    const a = await createTestContext();
    const b = await createTestContext();
    const foreign = await seedDelivery(b.organization.id, `monitor:m1:trigger:${CH}`, 'failed');

    await notifyPagerDuty(
      { channelId: CH, routingKey: KEY },
      { organizationId: a.organization.id, action: 'resolve', dedupKey: 'monitor:m1', eventType: 'monitor.status_changed' }
    );

    expect((await statusOf(foreign)).status).toBe('failed');
  });
});
