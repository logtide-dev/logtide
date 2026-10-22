import { describe, it, expect } from 'vitest';
import {
  DESTINATION_TYPES,
  destinationLabel,
  displayTypeOf,
  getDestinationType,
} from './destination-types';

const SLACK = 'https://hooks.slack.com/services/T0001/B0002/abcDEF';

describe('destination catalog', () => {
  it('lists the six types in order with exact labels', () => {
    expect(DESTINATION_TYPES.map((t) => t.label)).toEqual([
      'Email',
      'Webhook',
      'Slack',
      'Microsoft Teams',
      'Discord',
      'PagerDuty',
    ]);
    expect(DESTINATION_TYPES.map((t) => t.id)).toEqual([
      'email',
      'webhook',
      'slack',
      'teams',
      'discord',
      'pagerduty',
    ]);
  });

  it('maps vendor webhooks to the stored webhook type', () => {
    expect(getDestinationType('slack').storedType).toBe('webhook');
    expect(getDestinationType('teams').storedType).toBe('webhook');
    expect(getDestinationType('discord').storedType).toBe('webhook');
    expect(getDestinationType('pagerduty').storedType).toBe('pagerduty');
    expect(getDestinationType('email').storedType).toBe('email');
  });

  it('derives the display type from the url', () => {
    expect(displayTypeOf({ type: 'webhook', config: { url: SLACK } })).toBe('slack');
    expect(displayTypeOf({ type: 'webhook', config: { url: 'https://example.com/x' } })).toBe('webhook');
    expect(displayTypeOf({ type: 'pagerduty', config: { routingKey: 'x' } })).toBe('pagerduty');
    expect(destinationLabel({ type: 'webhook', config: { url: SLACK } })).toBe('Slack');
  });

  it('validates vendor urls', () => {
    const slack = getDestinationType('slack');
    expect(slack.validateUrl?.('https://example.com/x')).toBe(
      'This does not look like a Slack webhook URL'
    );
    expect(slack.validateUrl?.(SLACK)).toBeNull();
    expect(getDestinationType('teams').validateUrl?.('https://example.com/x')).toBe(
      'This does not look like a Microsoft Teams webhook URL'
    );
    expect(
      getDestinationType('discord').validateUrl?.('https://discord.com/api/webhooks/1/abc')
    ).toBeNull();
    expect(getDestinationType('discord').validateUrl?.('nope')).toBe(
      'This does not look like a Discord webhook URL'
    );
  });
});

describe('displayTypeOf server type', () => {
  it('prefers the server-computed type over the reduced member URL', () => {
    const channel = {
      type: 'webhook' as const,
      config: { url: 'https://hooks.slack.com/...' },
      displayType: 'slack' as const,
    };
    expect(displayTypeOf(channel)).toBe('slack');
    expect(displayTypeOf({ type: 'webhook', config: { url: 'https://hooks.slack.com/...' } })).toBe('webhook');
  });
});
