/**
 * PagerDuty Notification Provider
 * Sends Events API v2 trigger events through the shared webhook delivery primitive.
 */

import { createHash, randomUUID } from 'node:crypto';
import type { NotificationProvider, NotificationContext, DeliveryResult } from './interface.js';
import type { ChannelConfig, NotificationEventType, PagerDutyChannelConfig } from '@logtide/shared';
import { deliverOnce } from '../../webhooks/index.js';
import {
  PAGERDUTY_EVENTS_URL,
  buildPagerDutyEvent,
  type PagerDutyAction,
} from './pagerduty-event.js';

const ROUTING_KEY_PATTERN = /^[A-Za-z0-9]{20,40}$/;

export class PagerDutyProvider implements NotificationProvider {
  readonly type = 'pagerduty' as const;

  validateConfig(config: unknown): config is PagerDutyChannelConfig {
    const c = config as PagerDutyChannelConfig | null;
    return (
      typeof c === 'object' &&
      c !== null &&
      typeof c.routingKey === 'string' &&
      ROUTING_KEY_PATTERN.test(c.routingKey)
    );
  }

  async send(context: NotificationContext, channelConfig: ChannelConfig): Promise<DeliveryResult> {
    if (!this.validateConfig(channelConfig)) {
      return { success: false, error: 'Invalid PagerDuty configuration' };
    }
    const dedupKey = `logtide:${context.eventType}:${createHash('sha256')
      .update(context.title ?? '')
      .digest('hex')
      .slice(0, 16)}`;
    return this.deliver(context, channelConfig.routingKey, 'trigger', dedupKey);
  }

  async test(channelConfig: ChannelConfig, organizationId: string): Promise<DeliveryResult> {
    if (!this.validateConfig(channelConfig)) {
      return { success: false, error: 'Invalid PagerDuty configuration' };
    }
    const dedupKey = `logtide-test-${randomUUID()}`;
    const context: NotificationContext = {
      organizationId,
      organizationName: 'Test Organization',
      eventType: 'test' as NotificationEventType,
      title: 'LogTide test notification',
      message: 'This is a test notification from LogTide to verify your PagerDuty integration.',
      severity: 'informational',
    };
    const triggered = await this.deliver(context, channelConfig.routingKey, 'trigger', dedupKey);
    // Resolve right away so the test never leaves an open incident behind.
    if (triggered.success) {
      await this.deliver(context, channelConfig.routingKey, 'resolve', dedupKey);
    }
    return triggered;
  }

  private async deliver(
    context: NotificationContext,
    routingKey: string,
    action: PagerDutyAction,
    dedupKey: string
  ): Promise<DeliveryResult> {
    const body = buildPagerDutyEvent({
      routingKey,
      action,
      dedupKey,
      summary: context.title,
      severity: context.severity,
      link: context.link,
      details: {
        message: context.message,
        organization: context.organizationName,
        ...(context.metadata ?? {}),
      },
    });

    const result = await deliverOnce({
      url: PAGERDUTY_EVENTS_URL,
      body,
      organizationId: context.organizationId ?? null,
      eventType: 'channel.notification',
      channelId: context.channelId,
    });

    if (result.success) {
      return { success: true, metadata: { statusCode: result.statusCode } };
    }
    return { success: false, error: result.error };
  }
}
