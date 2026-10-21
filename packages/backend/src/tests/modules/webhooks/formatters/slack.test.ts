import { describe, it, expect } from 'vitest';
import { formatOutbound } from '../../../../modules/webhooks/formatters/index.js';

const SLACK_URL = 'https://hooks.slack.com/services/T1/B2/xyz';
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

const monitorDown = envelope('monitor.status_changed', {
  status: 'down',
  severity: 'critical',
  title: 'Monitor down: api-prod',
  message: 'api-prod is not responding',
  organization: { name: 'Acme' },
  target: 'https://api.example.com/health',
  link: 'https://app.logtide.dev/dashboard/uptime',
});

describe('slack formatter', () => {
  it('renders a monitor down event as blocks', () => {
    const body = formatOutbound(SLACK_URL, monitorDown) as any;
    expect(body.text).toBe('Monitor down: api-prod');
    expect(body.blocks[0].type).toBe('header');
    const fieldsBlock = body.blocks.find((b: any) => b.fields);
    expect(fieldsBlock.fields.map((f: any) => f.text)).toContain('*Status*\ndown');
    const actions = body.blocks.find((b: any) => b.type === 'actions');
    expect(actions.elements[0].url).toBe('https://app.logtide.dev/dashboard/uptime');
    const context = body.blocks.find((b: any) => b.type === 'context');
    expect(context.elements[0].text).toContain('LogTide - Acme');
  });

  it('leaves generic urls untouched', () => {
    expect(formatOutbound(OTHER_URL, monitorDown)).toBe(monitorDown);
  });

  it('does not claim look-alike hosts', () => {
    for (const url of [
      'https://hooks.slack.com.evil.example/services/T/B/x',
      'https://evil.example/hooks.slack.com/services/T/B/x',
    ]) {
      expect(formatOutbound(url, monitorDown)).toBe(monitorDown);
    }
  });

  it('escapes mentions and entities', () => {
    const body = formatOutbound(
      SLACK_URL,
      envelope('x.y', { title: 'Hi <!channel>', message: '<!channel> & more' })
    ) as any;
    const section = body.blocks.find((b: any) => b.type === 'section' && b.text);
    expect(section.text.text).toBe('&lt;!channel&gt; &amp; more');
    expect(body.text).toBe('Hi &lt;!channel&gt;');
  });

  it('keeps hostile sizes inside the caps', () => {
    const metadata: Record<string, string> = {};
    for (let i = 0; i < 200; i++) metadata[`key${i}`] = 'v'.repeat(5000);
    const body = formatOutbound(
      SLACK_URL,
      envelope('x.y', { title: 'T'.repeat(5000), message: 'm'.repeat(9000), metadata })
    ) as any;
    expect(body.blocks.length).toBeLessThanOrEqual(50);
    expect(body.blocks[0].text.text.length).toBeLessThanOrEqual(150);
    const fieldsBlock = body.blocks.find((b: any) => b.fields);
    expect(fieldsBlock.fields.length).toBeLessThanOrEqual(10);
    for (const f of fieldsBlock.fields) expect(f.text.length).toBeLessThanOrEqual(2000);
    const desc = body.blocks.find((b: any) => b.type === 'section' && b.text);
    expect(desc.text.text.length).toBeLessThanOrEqual(3000);
  });

  it('does not cut an escape entity in half', () => {
    const body = formatOutbound(SLACK_URL, envelope('x.y', { message: '&'.repeat(3000) })) as any;
    const desc = body.blocks.find((b: any) => b.type === 'section' && b.text).text.text as string;
    expect(desc.length).toBeLessThanOrEqual(3000);
    expect(desc.replace(/&amp;/g, '').replace('...', '')).toBe('');
  });

  it('renders channel.test', () => {
    const body = formatOutbound(
      SLACK_URL,
      envelope('channel.test', { title: 'Test notification', message: 'It works' })
    ) as any;
    expect(body.text).toBe('Test notification');
  });

  it('wraps non-envelope bodies and never throws on odd data', () => {
    const raw = formatOutbound(SLACK_URL, { hello: '<b>' }) as any;
    expect(raw.text.startsWith('```')).toBe(true);
    expect(raw.text).toContain('&lt;b&gt;');
    expect(raw.text.length).toBeLessThanOrEqual(3000);
    const odd = formatOutbound(SLACK_URL, envelope('x.y', { title: 42, message: {}, metadata: 7 })) as any;
    expect(odd.text).toBe('42');
  });

  it('skips the button for non-http links', () => {
    const body = formatOutbound(
      SLACK_URL,
      envelope('x.y', { title: 'T', link: 'javascript:alert(1)' })
    ) as any;
    expect(body.blocks.some((b: any) => b.type === 'actions')).toBe(false);
  });
});
