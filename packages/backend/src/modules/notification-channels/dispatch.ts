/**
 * PagerDuty dispatch helpers for the notification jobs.
 *
 * Jobs resolve their channels, then hand PagerDuty targets here. Deliveries go
 * through the webhook dispatcher (persisted, retried with backoff, DLQ), so a
 * 429 or 5xx from PagerDuty is retried and a 400 is not.
 */

import type { WebhookEventType } from '@logtide/shared';
import { webhookDispatcher } from '../webhooks/index.js';
import {
  PAGERDUTY_EVENTS_URL,
  buildPagerDutyEvent,
  type PagerDutyAction,
  type PagerDutyInputSeverity,
} from './providers/pagerduty-event.js';

export interface PagerDutyNotify {
  organizationId: string;
  action: PagerDutyAction;
  dedupKey: string;
  eventType: WebhookEventType;
  summary?: string;
  severity?: PagerDutyInputSeverity;
  link?: string;
  details?: Record<string, unknown>;
  ruleId?: string;
}

export interface PagerDutyTarget {
  channelId: string;
  routingKey: string;
}

export async function notifyPagerDuty(target: PagerDutyTarget, event: PagerDutyNotify): Promise<void> {
  await webhookDispatcher.enqueue({
    url: PAGERDUTY_EVENTS_URL,
    organizationId: event.organizationId,
    eventType: event.eventType,
    eventId: `${event.dedupKey}:${event.action}:${target.channelId}`,
    channelId: target.channelId,
    ruleId: event.ruleId,
    payload: buildPagerDutyEvent({
      routingKey: target.routingKey,
      action: event.action,
      dedupKey: event.dedupKey,
      summary: event.summary,
      severity: event.severity,
      link: event.link,
      details: event.details,
    }),
  });
}

/** Fan out to every target; one failing key never blocks the others and nothing throws. */
export async function notifyPagerDutyTargets(
  targets: PagerDutyTarget[],
  event: PagerDutyNotify
): Promise<void> {
  const results = await Promise.allSettled(targets.map((t) => notifyPagerDuty(t, event)));
  results.forEach((result, i) => {
    if (result.status === 'rejected') {
      console.error(
        `[PagerDuty] enqueue failed for channel ${targets[i].channelId}:`,
        result.reason instanceof Error ? result.reason.message : result.reason
      );
    }
  });
}

/** Host of a webhook URL for logs and stored errors; the path often carries the secret. */
export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return 'webhook';
  }
}
