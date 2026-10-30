/**
 * Shared default-destination resolution.
 *
 * ONE rule for every event type (alert, sigma, incident, monitoring, error):
 *   1. explicit enabled channels of the organization win;
 *   2. else the organization default channels for the event type;
 *   3. else, when SMTP is configured, the fallback is an email to the
 *      organization owners and admins; otherwise nobody is notified.
 *
 * The notification jobs and the routing preview endpoint both go through
 * resolveChannelsForEvent so they cannot disagree.
 */

import type {
  ChannelDisplayType,
  EmailChannelConfig,
  NotificationChannel,
  NotificationEventType,
  PagerDutyChannelConfig,
  WebhookChannelConfig,
} from '@logtide/shared';
import { getChannelDisplayType } from '@logtide/shared';
import { isSmtpConfigured } from '../../config/index.js';
import { db } from '../../database/connection.js';
import { notificationChannelsService } from './service.js';
import { buildWebhookRequestSettings } from './webhook-request.js';

export interface ResolveChannelsInput {
  organizationId: string;
  eventType: NotificationEventType;
  explicitChannels?: NotificationChannel[];
  explicitChannelIds?: string[];
  /**
   * Project the event belongs to. Routing stays per event type; per-project
   * overrides (project_health) arrive as explicitChannelIds from the caller.
   */
  projectId?: string | null;
}

export interface ResolvedRouting {
  channels: NotificationChannel[];
  source: 'explicit' | 'org_default' | 'none';
  fallback: 'owners_admins_email' | null;
}

export async function resolveChannelsForEvent(
  input: ResolveChannelsInput
): Promise<ResolvedRouting> {
  const { organizationId, eventType } = input;

  let explicit: NotificationChannel[] = [];
  if (input.explicitChannels) {
    explicit = input.explicitChannels.filter(
      (c) => c.enabled && c.organizationId === organizationId
    );
  } else if (input.explicitChannelIds && input.explicitChannelIds.length > 0) {
    explicit = await notificationChannelsService.getEnabledChannelsByIds(
      input.explicitChannelIds,
      organizationId
    );
  }

  if (explicit.length > 0) {
    return { channels: explicit, source: 'explicit', fallback: null };
  }

  const defaults = (
    await notificationChannelsService.getOrganizationDefaults(organizationId, eventType)
  ).filter((c) => c.enabled && c.organizationId === organizationId);

  if (defaults.length > 0) {
    return { channels: defaults, source: 'org_default', fallback: null };
  }

  return {
    channels: [],
    source: 'none',
    fallback: isSmtpConfigured() ? 'owners_admins_email' : null,
  };
}

export interface DeliveryTargets {
  emailRecipients: string[];
  webhooks: {
    channelId: string;
    name: string;
    url: string;
    displayType: ChannelDisplayType;
    /** Method and merged headers (custom + auth) so queued sends match the Test button. */
    method?: string;
    headers: Record<string, string>;
  }[];
  pagerDuty: { channelId: string; name: string; routingKey: string }[];
}

export function toDeliveryTargets(channels: NotificationChannel[]): DeliveryTargets {
  const emails = new Map<string, string>();
  const webhooks = new Map<string, DeliveryTargets['webhooks'][number]>();
  const pagerDuty = new Map<string, DeliveryTargets['pagerDuty'][number]>();

  for (const channel of channels) {
    if (channel.type === 'email') {
      const recipients = (channel.config as EmailChannelConfig).recipients ?? [];
      for (const email of recipients) {
        const key = email.toLowerCase();
        if (!emails.has(key)) emails.set(key, email);
      }
    } else if (channel.type === 'webhook') {
      const webhookConfig = channel.config as WebhookChannelConfig;
      const url = webhookConfig.url;
      if (typeof url === 'string' && !webhooks.has(url)) {
        const request = buildWebhookRequestSettings(channel.id, webhookConfig);
        webhooks.set(url, {
          channelId: channel.id,
          name: channel.name,
          url,
          displayType: getChannelDisplayType(channel),
          method: request.method,
          headers: request.headers,
        });
      }
    } else if (channel.type === 'pagerduty') {
      const routingKey = (channel.config as PagerDutyChannelConfig).routingKey;
      if (typeof routingKey === 'string' && !pagerDuty.has(routingKey)) {
        pagerDuty.set(routingKey, { channelId: channel.id, name: channel.name, routingKey });
      }
    }
  }

  return {
    emailRecipients: Array.from(emails.values()),
    webhooks: Array.from(webhooks.values()),
    pagerDuty: Array.from(pagerDuty.values()),
  };
}

/** Emails of the organization owners and admins (the single email fallback audience). */
export async function resolveFallbackEmails(organizationId: string): Promise<string[]> {
  const rows = await db
    .selectFrom('organization_members')
    .innerJoin('users', 'users.id', 'organization_members.user_id')
    .select('users.email')
    .where('organization_members.organization_id', '=', organizationId)
    .where('organization_members.role', 'in', ['owner', 'admin'])
    .where('users.disabled', '=', false)
    .execute();

  const emails = new Map<string, string>();
  for (const row of rows) {
    if (!row.email) continue;
    const key = row.email.toLowerCase();
    if (!emails.has(key)) emails.set(key, row.email);
  }
  return Array.from(emails.values());
}

export interface RoutingPreviewResult {
  destinations: { id: string; name: string; type: ChannelDisplayType }[];
  fallback: ResolvedRouting['fallback'];
}

export function toPreview(routing: ResolvedRouting): RoutingPreviewResult {
  const destinations = routing.channels
    .map((c) => ({ id: c.id, name: c.name, type: getChannelDisplayType(c) }))
    .sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0
    );
  return { destinations, fallback: routing.fallback };
}
