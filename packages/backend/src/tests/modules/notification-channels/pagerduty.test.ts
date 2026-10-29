import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import crypto from 'crypto';

const { deliverOnceMock, enqueueMock } = vi.hoisted(() => ({
  deliverOnceMock: vi.fn(),
  enqueueMock: vi.fn(),
}));

vi.mock('../../../modules/webhooks/index.js', async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    deliverOnce: deliverOnceMock,
    webhookDispatcher: { ...actual.webhookDispatcher, enqueue: enqueueMock },
  };
});

import { db } from '../../../database/index.js';
import { contextPlugin } from '../../../context/index.js';
import { capabilities } from '../../../capabilities/index.js';
import { notificationChannelsRoutes } from '../../../modules/notification-channels/routes.js';
import { notificationChannelsService } from '../../../modules/notification-channels/service.js';
import {
  PAGERDUTY_EVENTS_URL,
  buildPagerDutyEvent,
  toPagerDutySeverity,
} from '../../../modules/notification-channels/providers/pagerduty-event.js';
import { PagerDutyProvider } from '../../../modules/notification-channels/providers/pagerduty-provider.js';
import {
  notifyPagerDuty,
  notifyPagerDutyTargets,
} from '../../../modules/notification-channels/dispatch.js';
import { createTestContext, createTestOrganization } from '../../helpers/factories.js';

const KEY = 'R0UTINGKEY1234567890abcdefghijkl';

describe('buildPagerDutyEvent', () => {
  it('resolve carries only routing_key, event_action and dedup_key', () => {
    const body = buildPagerDutyEvent({
      routingKey: KEY,
      action: 'resolve',
      dedupKey: 'k1',
      summary: 'ignored',
      details: { a: 1 },
    });
    expect(Object.keys(body).sort()).toEqual(['dedup_key', 'event_action', 'routing_key']);
    expect(body.event_action).toBe('resolve');
  });

  it('cuts a long summary to 1024 characters', () => {
    const body = buildPagerDutyEvent({
      routingKey: KEY,
      action: 'trigger',
      dedupKey: 'k',
      summary: 'x'.repeat(3000),
    }) as any;
    expect(body.payload.summary).toHaveLength(1024);
    expect(body.payload.source).toBe('LogTide');
    expect(body.client).toBe('LogTide');
  });

  it('caps dedup_key at 255 characters', () => {
    const body = buildPagerDutyEvent({ routingKey: KEY, action: 'trigger', dedupKey: 'd'.repeat(400) });
    expect((body.dedup_key as string).length).toBe(255);
  });

  it('maps severities', () => {
    expect(toPagerDutySeverity('critical')).toBe('critical');
    expect(toPagerDutySeverity('high')).toBe('error');
    expect(toPagerDutySeverity('medium')).toBe('warning');
    expect(toPagerDutySeverity('low')).toBe('info');
    expect(toPagerDutySeverity('informational')).toBe('info');
  });

  it('adds links only for http(s) urls', () => {
    const ok = buildPagerDutyEvent({
      routingKey: KEY,
      action: 'trigger',
      dedupKey: 'k',
      link: 'https://app.logtide.dev/x',
    }) as any;
    expect(ok.links).toEqual([{ href: 'https://app.logtide.dev/x', text: 'Open in LogTide' }]);
    expect(ok.client_url).toBe('https://app.logtide.dev/x');
    const bad = buildPagerDutyEvent({
      routingKey: KEY,
      action: 'trigger',
      dedupKey: 'k',
      link: 'javascript:alert(1)',
    }) as any;
    expect(bad.links).toBeUndefined();
    expect(bad.client_url).toBeUndefined();
  });

  it('survives circular or oversized details', () => {
    const loop: Record<string, unknown> = {};
    loop.self = loop;
    const body = buildPagerDutyEvent({ routingKey: KEY, action: 'trigger', dedupKey: 'k', details: loop }) as any;
    expect(body.payload.custom_details).toEqual({ truncated: true });
  });
});

describe('PagerDutyProvider', () => {
  const provider = new PagerDutyProvider();

  beforeEach(() => {
    deliverOnceMock.mockReset();
    deliverOnceMock.mockResolvedValue({ success: true, statusCode: 202, durationMs: 1, retryable: false });
  });

  it('validates the routing key', () => {
    expect(provider.validateConfig({ routingKey: '' })).toBe(false);
    expect(provider.validateConfig({ routingKey: 'short' })).toBe(false);
    expect(provider.validateConfig({ routingKey: 123 })).toBe(false);
    expect(provider.validateConfig({ routingKey: 'a'.repeat(21) + '-' })).toBe(false);
    expect(provider.validateConfig(null)).toBe(false);
    expect(provider.validateConfig({ routingKey: 'a'.repeat(32) })).toBe(true);
  });

  it('send triggers once with a stable dedup key', async () => {
    const ctx = {
      organizationId: 'org-1',
      organizationName: 'Acme',
      eventType: 'monitoring' as const,
      title: 'Monitor down',
      message: 'm',
      severity: 'critical' as const,
    };
    await provider.send(ctx, { routingKey: KEY });
    await provider.send(ctx, { routingKey: KEY });
    expect(deliverOnceMock).toHaveBeenCalledTimes(2);
    const [a, b] = deliverOnceMock.mock.calls.map((c) => c[0].body);
    expect(a.dedup_key).toBe(b.dedup_key);
    expect(a.dedup_key).toMatch(/^logtide:monitoring:[0-9a-f]{16}$/);
    expect(a.event_action).toBe('trigger');
    expect(deliverOnceMock.mock.calls[0][0].url).toBe(PAGERDUTY_EVENTS_URL);
  });

  it('test triggers then resolves with the same dedup key', async () => {
    const result = await provider.test({ routingKey: KEY }, 'org-1');
    expect(result.success).toBe(true);
    expect(deliverOnceMock).toHaveBeenCalledTimes(2);
    const [trigger, resolve] = deliverOnceMock.mock.calls.map((c) => c[0]);
    expect(trigger.url).toBe(PAGERDUTY_EVENTS_URL);
    expect(resolve.url).toBe(PAGERDUTY_EVENTS_URL);
    expect(trigger.body.event_action).toBe('trigger');
    expect(resolve.body.event_action).toBe('resolve');
    expect(trigger.body.dedup_key).toBe(resolve.body.dedup_key);
    expect(trigger.body.dedup_key).toMatch(/^logtide-test-/);
  });

  it('test does not resolve when the trigger failed', async () => {
    deliverOnceMock.mockResolvedValueOnce({ success: false, error: 'HTTP 400', durationMs: 1, retryable: false });
    const result = await provider.test({ routingKey: KEY }, 'org-1');
    expect(result.success).toBe(false);
    expect(deliverOnceMock).toHaveBeenCalledTimes(1);
  });
});

describe('notifyPagerDuty', () => {
  beforeEach(() => {
    enqueueMock.mockReset();
    enqueueMock.mockResolvedValue({ deliveryId: 'd' });
  });

  it('enqueues the event body with a stable event id', async () => {
    await notifyPagerDuty(
      { channelId: 'ch-1', routingKey: KEY },
      {
        organizationId: 'org-1',
        action: 'trigger',
        dedupKey: 'incident:1',
        eventType: 'incident.created',
        summary: 'Incident',
        severity: 'critical',
      }
    );
    expect(enqueueMock).toHaveBeenCalledTimes(1);
    const arg = enqueueMock.mock.calls[0][0];
    expect(arg.url).toBe(PAGERDUTY_EVENTS_URL);
    expect(arg.eventId).toBe('incident:1:trigger:ch-1');
    expect(arg.channelId).toBe('ch-1');
    expect(arg.payload.routing_key).toBe(KEY);
    expect(arg.payload.payload.severity).toBe('critical');
  });

  it('notifyPagerDutyTargets resolves when one target rejects', async () => {
    enqueueMock.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce({ deliveryId: 'd' });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(
      notifyPagerDutyTargets(
        [
          { channelId: 'a', routingKey: KEY },
          { channelId: 'b', routingKey: KEY },
        ],
        { organizationId: 'org-1', action: 'resolve', dedupKey: 'k', eventType: 'incident.created' }
      )
    ).resolves.toBeUndefined();
    expect(enqueueMock).toHaveBeenCalledTimes(2);
    errorSpy.mockRestore();
  });
});

describe('pagerduty channels in the database', () => {
  it('creates a pagerduty channel through the service', async () => {
    const org = await createTestOrganization({});
    const channel = await notificationChannelsService.createChannel(org.id, {
      name: 'On call',
      type: 'pagerduty',
      config: { routingKey: KEY },
    });
    expect(channel.type).toBe('pagerduty');
    expect(channel.config).toEqual({ routingKey: KEY });
  });

  it('rejects an invalid routing key at the service', async () => {
    const org = await createTestOrganization({});
    await expect(
      notificationChannelsService.createChannel(org.id, {
        name: 'Bad',
        type: 'pagerduty',
        config: { routingKey: 'short' },
      })
    ).rejects.toThrow(/Invalid configuration/);
  });

  it('keeps rejecting unknown types at the database', async () => {
    const org = await createTestOrganization({});
    await expect(
      db
        .insertInto('notification_channels')
        .values({
          organization_id: org.id,
          name: 'sms',
          type: 'sms' as any,
          config: { recipients: [] } as any,
        })
        .execute()
    ).rejects.toThrow();
  });
});

describe('notifications.max_channels counts pagerduty channels', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify();
    await app.register(contextPlugin);
    await app.register(notificationChannelsRoutes, { prefix: '/api/v1/notification-channels' });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('blocks a new channel when a pagerduty channel fills the limit', async () => {
    const ctx = await createTestContext();
    const orgId = ctx.organization.id;
    const token = crypto.randomBytes(32).toString('hex');
    await db
      .insertInto('sessions')
      .values({ user_id: ctx.user.id, token, expires_at: new Date(Date.now() + 86400000) })
      .execute();
    await db
      .insertInto('organization_entitlements')
      .values({ organization_id: orgId, capability: 'notifications.max_channels', enabled: null, limit_value: 1 })
      .execute();
    capabilities.invalidate(orgId);
    await notificationChannelsService.createChannel(orgId, {
      name: 'On call',
      type: 'pagerduty',
      config: { routingKey: KEY },
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/notification-channels?organizationId=${orgId}`,
      headers: { Authorization: `Bearer ${token}` },
      payload: { name: 'Mail', type: 'email', config: { recipients: ['a@example.com'] } },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('capability.notifications.max_channels.limit_reached');
  });
});
