import { describe, it, expect } from 'vitest';
import {
  formatOutbound,
  discordFormatter,
  slackFormatter,
  teamsFormatter,
} from '../../../../modules/webhooks/formatters/index.js';

const WORKFLOW_URL =
  'https://prod-12.westeurope.logic.azure.com:443/workflows/abc/triggers/manual/paths/invoke?api-version=2016-06-01';
const CONNECTOR_URL = 'https://contoso.webhook.office.com/webhookb2/g@g/IncomingWebhook/abc/g';
const OTHER_URL = 'https://hooks.example.com/webhook';

function envelope(type: string, data: Record<string, unknown>) {
  return {
    id: 'evt_1',
    type,
    version: 1,
    occurredAt: '2026-08-10T09:19:12.000Z',
    organizationId: 'org-1',
    projectId: null,
    data,
  };
}

const monitor = (status: string, severity = 'critical') =>
  envelope('monitor.status_changed', {
    status,
    severity,
    title: `Monitor ${status}: api-prod`,
    message: 'details',
    organization: { name: 'Acme' },
    target: 'https://api.example.com/health',
    link: 'https://app.logtide.dev/dashboard/uptime',
  });

describe('teams formatter', () => {
  it.each([WORKFLOW_URL, CONNECTOR_URL])('wraps an adaptive card for %s', (url) => {
    const body = formatOutbound(url, monitor('down')) as any;
    expect(body.type).toBe('message');
    expect(body.attachments).toHaveLength(1);
    expect(body.attachments[0].contentType).toBe('application/vnd.microsoft.card.adaptive');
    expect(body.attachments[0].content.version).toBe('1.4');
    expect(body.attachments[0].content.actions[0].url).toBe('https://app.logtide.dev/dashboard/uptime');
  });

  it('colors the title by tone and lists facts', () => {
    const down = formatOutbound(CONNECTOR_URL, monitor('down')) as any;
    expect(down.attachments[0].content.body[0].color).toBe('Attention');
    expect(down.attachments[0].content.body[0].wrap).toBe(true);
    const factSet = down.attachments[0].content.body.find((b: any) => b.type === 'FactSet');
    expect(factSet.facts.map((f: any) => f.title)).toContain('Target');
    const up = formatOutbound(CONNECTOR_URL, monitor('up')) as any;
    expect(up.attachments[0].content.body[0].color).toBe('Good');
    const medium = formatOutbound(CONNECTOR_URL, envelope('x.y', { severity: 'medium' })) as any;
    expect(medium.attachments[0].content.body[0].color).toBe('Warning');
  });

  it('stays under the byte budget with a huge description and many facts', () => {
    const metadata: Record<string, string> = {};
    for (let i = 0; i < 50; i++) metadata[`k${i}`] = 'v'.repeat(5000);
    const body = formatOutbound(
      CONNECTOR_URL,
      envelope('x.y', { message: 'd'.repeat(60000), metadata })
    );
    expect(Buffer.byteLength(JSON.stringify(body))).toBeLessThanOrEqual(24000);
  });

  it('leaves generic urls untouched', () => {
    const body = monitor('down');
    expect(formatOutbound(OTHER_URL, body)).toBe(body);
  });

  it('does not claim look-alike hosts', () => {
    const body = monitor('down');
    expect(formatOutbound('https://webhook.office.com.evil.example/webhookb2/x', body)).toBe(body);
  });

  it('skips the action for non-http links', () => {
    const body = formatOutbound(
      CONNECTOR_URL,
      envelope('x.y', { title: 'T', link: 'javascript:alert(1)' })
    ) as any;
    expect(body.attachments[0].content.actions).toBeUndefined();
  });

  it('wraps non-envelope bodies instead of throwing', () => {
    const body = formatOutbound(CONNECTOR_URL, { hello: 'world' }) as any;
    expect(body.attachments[0].content.body[1].text).toContain('"hello"');
  });
});

describe('formatter registry', () => {
  it('never lets two formatters claim the same url', () => {
    const urls = [
      WORKFLOW_URL,
      CONNECTOR_URL,
      'https://hooks.slack.com/services/T1/B2/xyz',
      'https://discord.com/api/webhooks/1/abc',
      OTHER_URL,
    ];
    for (const url of urls) {
      const parsed = new URL(url);
      const claimed = [discordFormatter, slackFormatter, teamsFormatter].filter((f) =>
        f.matches(parsed)
      );
      expect(claimed.length).toBeLessThanOrEqual(1);
    }
  });

  it('renders alert.triggered time window in minutes', () => {
    const body = formatOutbound(
      WORKFLOW_URL,
      envelope('alert.triggered', { alert_name: 'API 5xx', log_count: 12, threshold: 10, time_window: 5 })
    );
    const text = JSON.stringify(body);
    expect(text).toContain('5 min');
    expect(text).not.toContain('5s');
  });
});
