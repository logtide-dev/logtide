import type { NotificationChannelType } from '../types/notification-channel.js';
import { isDiscordWebhookUrl } from './discord-webhook.js';
import { isSlackWebhookUrl } from './slack-webhook.js';
import { isTeamsWebhookUrl } from './teams-webhook.js';

export type WebhookFlavor = 'slack' | 'teams' | 'discord' | 'generic';

export type ChannelDisplayType = 'email' | 'webhook' | 'slack' | 'teams' | 'discord' | 'pagerduty';

export function detectWebhookFlavor(url: string): WebhookFlavor {
  if (isDiscordWebhookUrl(url)) return 'discord';
  if (isSlackWebhookUrl(url)) return 'slack';
  if (isTeamsWebhookUrl(url)) return 'teams';
  return 'generic';
}

export function getChannelDisplayType(channel: {
  type: NotificationChannelType;
  config: unknown;
}): ChannelDisplayType {
  if (channel.type === 'email') return 'email';
  if (channel.type === 'pagerduty') return 'pagerduty';
  const url = (channel.config as { url?: unknown } | null | undefined)?.url;
  if (typeof url !== 'string') return 'webhook';
  const flavor = detectWebhookFlavor(url);
  return flavor === 'generic' ? 'webhook' : flavor;
}
