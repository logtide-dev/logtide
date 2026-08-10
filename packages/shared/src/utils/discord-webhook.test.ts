import { describe, it, expect } from 'vitest';
import { isDiscordWebhookUrl, isDiscordWebhookTarget } from './discord-webhook.js';

const TOKEN = '1531999559520227430/aBcDeF-token_123';

describe('isDiscordWebhookUrl', () => {
  it('matches the canonical webhook url', () => {
    expect(isDiscordWebhookUrl(`https://discord.com/api/webhooks/${TOKEN}`)).toBe(true);
  });

  it('matches versioned api paths', () => {
    expect(isDiscordWebhookUrl(`https://discord.com/api/v10/webhooks/${TOKEN}`)).toBe(true);
  });

  it('matches legacy and regional hosts', () => {
    expect(isDiscordWebhookUrl(`https://discordapp.com/api/webhooks/${TOKEN}`)).toBe(true);
    expect(isDiscordWebhookUrl(`https://ptb.discord.com/api/webhooks/${TOKEN}`)).toBe(true);
    expect(isDiscordWebhookUrl(`https://canary.discord.com/api/webhooks/${TOKEN}`)).toBe(true);
  });

  it('ignores host casing', () => {
    expect(isDiscordWebhookUrl(`https://DISCORD.COM/api/webhooks/${TOKEN}`)).toBe(true);
  });

  it('leaves the slack and github compatibility endpoints alone', () => {
    expect(isDiscordWebhookUrl(`https://discord.com/api/webhooks/${TOKEN}/slack`)).toBe(false);
    expect(isDiscordWebhookUrl(`https://discord.com/api/webhooks/${TOKEN}/github`)).toBe(false);
  });

  it('rejects other hosts and non-webhook paths', () => {
    expect(isDiscordWebhookUrl('https://hooks.slack.com/services/x/y/z')).toBe(false);
    expect(isDiscordWebhookUrl('https://discord.com/channels/123')).toBe(false);
    expect(isDiscordWebhookUrl('https://notdiscord.com/api/webhooks/1/2')).toBe(false);
  });

  it('rejects malformed input instead of throwing', () => {
    expect(isDiscordWebhookUrl('not a url')).toBe(false);
    expect(isDiscordWebhookUrl('')).toBe(false);
  });

  it('exposes a URL-object variant', () => {
    expect(isDiscordWebhookTarget(new URL(`https://discord.com/api/webhooks/${TOKEN}`))).toBe(true);
  });
});
