import {
  getChannelDisplayType,
  isDiscordWebhookUrl,
  isSlackWebhookUrl,
  isTeamsWebhookUrl,
  type ChannelDisplayType,
  type NotificationChannelType,
} from '@logtide/shared';

export type DestinationTypeId = ChannelDisplayType;

export interface DestinationTypeInfo {
  id: DestinationTypeId;
  label: string;
  description: string;
  storedType: NotificationChannelType;
  urlPlaceholder?: string;
  validateUrl?: (url: string) => string | null;
}

function urlValidator(label: string, check: (url: string) => boolean) {
  return (url: string): string | null =>
    check(url.trim()) ? null : `This does not look like a ${label} webhook URL`;
}

export const DESTINATION_TYPES: DestinationTypeInfo[] = [
  {
    id: 'email',
    label: 'Email',
    description: 'Send notifications to a list of email addresses.',
    storedType: 'email',
  },
  {
    id: 'webhook',
    label: 'Webhook',
    description: 'Post a JSON event to any HTTP endpoint, with optional authentication.',
    storedType: 'webhook',
    urlPlaceholder: 'https://example.com/hooks/logtide',
  },
  {
    id: 'slack',
    label: 'Slack',
    description: 'Post formatted messages to a Slack channel through an incoming webhook.',
    storedType: 'webhook',
    urlPlaceholder: 'https://hooks.slack.com/services/T000/B000/XXXX',
    validateUrl: urlValidator('Slack', isSlackWebhookUrl),
  },
  {
    id: 'teams',
    label: 'Microsoft Teams',
    description: 'Post cards to a Teams channel through an incoming webhook or a Workflows URL.',
    storedType: 'webhook',
    urlPlaceholder: 'https://contoso.webhook.office.com/webhookb2/...',
    validateUrl: urlValidator('Microsoft Teams', isTeamsWebhookUrl),
  },
  {
    id: 'discord',
    label: 'Discord',
    description: 'Post embeds to a Discord channel through a webhook.',
    storedType: 'webhook',
    urlPlaceholder: 'https://discord.com/api/webhooks/...',
    validateUrl: urlValidator('Discord', isDiscordWebhookUrl),
  },
  {
    id: 'pagerduty',
    label: 'PagerDuty',
    description: 'Open and resolve incidents through the PagerDuty Events API v2.',
    storedType: 'pagerduty',
  },
];

export function getDestinationType(id: DestinationTypeId): DestinationTypeInfo {
  return DESTINATION_TYPES.find((t) => t.id === id) ?? DESTINATION_TYPES[1];
}

export function displayTypeOf(channel: {
  type: NotificationChannelType;
  config: unknown;
}): ChannelDisplayType {
  return getChannelDisplayType(channel);
}

export function destinationLabel(channel: {
  type: NotificationChannelType;
  config: unknown;
}): string {
  return getDestinationType(displayTypeOf(channel)).label;
}
