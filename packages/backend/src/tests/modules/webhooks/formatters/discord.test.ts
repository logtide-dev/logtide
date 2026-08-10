import { describe, it, expect } from 'vitest';
import { formatOutbound } from '../../../../modules/webhooks/formatters/index.js';

const DISCORD_URL = 'https://discord.com/api/webhooks/153199955952022743/token';
const OTHER_URL = 'https://hooks.example.com/webhook';

function envelope(type: string, data: Record<string, unknown>) {
  return {
    id: 'evt_a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    type,
    version: 1,
    occurredAt: '2026-08-10T09:19:12.000Z',
    organizationId: '00000000-0000-0000-0000-000000000001',
    projectId: null,
    data,
  };
}

const monitorDown = envelope('monitor.status_changed', {
  monitor_id: 'mon-1',
  monitor_name: 'api-prod',
  status: 'down',
  severity: 'critical',
  title: 'Monitor down: api-prod',
  message: 'api-prod is not responding (ECONNREFUSED)',
  organization: { id: '00000000-0000-0000-0000-000000000001', name: 'Acme' },
  target: 'https://api.example.com/health',
  error_code: 'ECONNREFUSED',
  consecutive_failures: 3,
  link: 'https://app.logtide.dev/dashboard/monitoring',
});

describe('formatOutbound', () => {
  it('leaves non-discord destinations untouched', () => {
    expect(formatOutbound(OTHER_URL, monitorDown)).toBe(monitorDown);
  });

  it('turns a monitor down event into a single embed', () => {
    const body = formatOutbound(DISCORD_URL, monitorDown) as any;
    expect(body.embeds).toHaveLength(1);
    const embed = body.embeds[0];
    expect(embed.title).toBe('Monitor down: api-prod');
    expect(embed.description).toBe('api-prod is not responding (ECONNREFUSED)');
    expect(embed.color).toBe(0xdc2626);
    expect(embed.url).toBe('https://app.logtide.dev/dashboard/monitoring');
    expect(embed.timestamp).toBe('2026-08-10T09:19:12.000Z');
    expect(embed.footer.text).toBe('LogTide - Acme');
    const names = embed.fields.map((f: any) => f.name);
    expect(names).toContain('Status');
    expect(names).toContain('Target');
    expect(names).toContain('Consecutive failures');
  });

  it('colors a monitor recovery green regardless of severity', () => {
    const recovered = envelope('monitor.status_changed', {
      ...monitorDown.data,
      status: 'up',
      title: 'Monitor recovered: api-prod',
      message: 'api-prod is back online after 4m',
    });
    const body = formatOutbound(DISCORD_URL, recovered) as any;
    expect(body.embeds[0].color).toBe(0x16a34a);
  });

  it('builds a title and description for alert.triggered, which carries neither', () => {
    const alert = envelope('alert.triggered', {
      alert_name: 'High error rate',
      log_count: 120,
      threshold: 50,
      time_window: 300,
      baseline_metadata: null,
      link: 'https://app.logtide.dev/dashboard/alerts',
    });
    const embed = (formatOutbound(DISCORD_URL, alert) as any).embeds[0];
    expect(embed.title).toBe('Alert triggered: High error rate');
    expect(embed.description).toContain('120');
    expect(embed.description).toContain('300s');
    expect(embed.description).toContain('50');
  });

  it('maps error.detected fields', () => {
    const error = envelope('error.detected', {
      title: 'TypeError: undefined is not a function',
      message: 'New error group in checkout',
      severity: 'high',
      organization: { id: '00000000-0000-0000-0000-000000000001', name: 'Acme' },
      project: { id: '00000000-0000-0000-0000-000000000002', name: 'checkout' },
      error_group_id: 'grp-1',
      exception_type: 'TypeError',
      language: 'javascript',
      service: 'web',
      is_new: true,
      link: 'https://app.logtide.dev/dashboard/errors',
    });
    const embed = (formatOutbound(DISCORD_URL, error) as any).embeds[0];
    expect(embed.color).toBe(0xea580c);
    const fields = Object.fromEntries(embed.fields.map((f: any) => [f.name, f.value]));
    expect(fields.Project).toBe('checkout');
    expect(fields.Exception).toBe('TypeError');
    expect(fields.Service).toBe('web');
  });

  it('renders a channel test as a plain titled embed', () => {
    const test = envelope('channel.test', {
      title: 'Test Notification',
      message: 'This is a test notification from LogTide to verify your webhook configuration.',
      severity: 'informational',
      organization: { id: '00000000-0000-0000-0000-000000000001', name: 'Acme' },
    });
    const embed = (formatOutbound(DISCORD_URL, test) as any).embeds[0];
    expect(embed.title).toBe('Test Notification');
    expect(embed.color).toBe(0x6b7280);
  });

  it('truncates long values to Discord limits', () => {
    const long = envelope('channel.notification', {
      title: 'T'.repeat(400),
      message: 'M'.repeat(5000),
      severity: 'low',
    });
    const embed = (formatOutbound(DISCORD_URL, long) as any).embeds[0];
    expect(embed.title.length).toBe(256);
    expect(embed.description.length).toBeLessThanOrEqual(4096);
    expect(JSON.stringify(embed).length).toBeLessThanOrEqual(6000);
  });

  it('caps the number of fields at ten', () => {
    const metadata: Record<string, unknown> = {};
    for (let i = 0; i < 30; i++) metadata[`key_${i}`] = `value_${i}`;
    const noisy = envelope('channel.notification', {
      title: 'Noisy',
      message: 'lots of metadata',
      metadata,
    });
    const embed = (formatOutbound(DISCORD_URL, noisy) as any).embeds[0];
    expect(embed.fields.length).toBeLessThanOrEqual(10);
  });

  it('falls back to a content block for a non-envelope body', () => {
    const body = formatOutbound(DISCORD_URL, { hello: 'world' }) as any;
    expect(typeof body.content).toBe('string');
    expect(body.content).toContain('hello');
    expect(body.content.length).toBeLessThanOrEqual(2000);
  });

  it('never returns an unsendable body for junk input', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const body = formatOutbound(DISCORD_URL, cyclic) as any;
    expect(body.content ?? body.embeds).toBeTruthy();
  });
});
