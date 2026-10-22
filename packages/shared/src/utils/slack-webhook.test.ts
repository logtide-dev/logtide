import { describe, it, expect } from 'vitest';
import { isSlackWebhookUrl } from './slack-webhook.js';

describe('isSlackWebhookUrl', () => {
  it('matches incoming webhook urls', () => {
    expect(isSlackWebhookUrl('https://hooks.slack.com/services/T0001/B0002/abcDEF')).toBe(true);
    expect(isSlackWebhookUrl('http://hooks.slack.com/services/T0001/B0002/abcDEF')).toBe(true);
    expect(isSlackWebhookUrl('https://hooks.slack-gov.com/services/T0001/B0002/abcDEF')).toBe(true);
  });

  it('rejects look-alikes, workflow triggers and garbage', () => {
    expect(isSlackWebhookUrl('https://hooks.slack.com.evil.example/services/T/B/x')).toBe(false);
    expect(isSlackWebhookUrl('https://evil.example/hooks.slack.com/services/T/B/x')).toBe(false);
    expect(isSlackWebhookUrl('https://hooks.slack.com/triggers/T/B/x')).toBe(false);
    expect(isSlackWebhookUrl('not a url')).toBe(false);
  });
});
