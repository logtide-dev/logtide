import { describe, it, expect } from 'vitest';
import { detectWebhookFlavor, getChannelDisplayType } from './webhook-flavor.js';

const slack = 'https://hooks.slack.com/services/T1/B2/xyz';
const teams = 'https://contoso.webhook.office.com/webhookb2/a@b/IncomingWebhook/c/d';
const discord = 'https://discord.com/api/webhooks/1/abc';

describe('detectWebhookFlavor', () => {
  it('detects each vendor and falls back to generic', () => {
    expect(detectWebhookFlavor(slack)).toBe('slack');
    expect(detectWebhookFlavor(teams)).toBe('teams');
    expect(detectWebhookFlavor(discord)).toBe('discord');
    expect(detectWebhookFlavor('https://example.com/hook')).toBe('generic');
    expect(detectWebhookFlavor('garbage')).toBe('generic');
  });
});

describe('getChannelDisplayType', () => {
  it('derives the display type', () => {
    expect(getChannelDisplayType({ type: 'webhook', config: { url: slack } })).toBe('slack');
    expect(getChannelDisplayType({ type: 'webhook', config: { url: teams } })).toBe('teams');
    expect(getChannelDisplayType({ type: 'webhook', config: { url: discord } })).toBe('discord');
    expect(getChannelDisplayType({ type: 'webhook', config: { url: 'https://x.io/h' } })).toBe('webhook');
    expect(getChannelDisplayType({ type: 'email', config: { recipients: [] } })).toBe('email');
    expect(getChannelDisplayType({ type: 'pagerduty', config: { routingKey: 'k' } })).toBe('pagerduty');
  });

  it('treats a missing or non-string url as a plain webhook', () => {
    expect(getChannelDisplayType({ type: 'webhook', config: {} })).toBe('webhook');
    expect(getChannelDisplayType({ type: 'webhook', config: { url: 5 } })).toBe('webhook');
    expect(getChannelDisplayType({ type: 'webhook', config: null })).toBe('webhook');
  });
});
