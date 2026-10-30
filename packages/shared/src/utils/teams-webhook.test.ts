import { describe, it, expect } from 'vitest';
import { isTeamsWebhookUrl } from './teams-webhook.js';

describe('isTeamsWebhookUrl', () => {
  it('matches connector and workflow urls', () => {
    expect(
      isTeamsWebhookUrl('https://contoso.webhook.office.com/webhookb2/guid@guid/IncomingWebhook/abc/guid')
    ).toBe(true);
    expect(isTeamsWebhookUrl('https://outlook.office.com/webhook/abc/IncomingWebhook/x/y')).toBe(true);
    expect(
      isTeamsWebhookUrl(
        'https://prod-12.westeurope.logic.azure.com:443/workflows/abc/triggers/manual/paths/invoke?api-version=2016-06-01'
      )
    ).toBe(true);
    expect(
      isTeamsWebhookUrl(
        'https://default1234.12.environment.api.powerplatform.com/powerautomate/automations/direct/workflows/abc/triggers/manual/paths/invoke'
      )
    ).toBe(true);
  });

  it('rejects look-alikes and garbage', () => {
    expect(isTeamsWebhookUrl('https://webhook.office.com.evil.example/webhookb2/x')).toBe(false);
    expect(isTeamsWebhookUrl('https://evil.example/webhook.office.com/webhookb2/x')).toBe(false);
    expect(isTeamsWebhookUrl('https://contoso.webhook.office.com.evil.example/webhookb2/x')).toBe(false);
    expect(isTeamsWebhookUrl('https://contoso.webhook.office.com/other/x')).toBe(false);
    expect(isTeamsWebhookUrl('nope')).toBe(false);
  });
});
