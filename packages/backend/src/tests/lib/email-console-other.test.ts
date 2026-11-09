import { describe, it, expect } from 'vitest';
import { generateConfirmationEmail, generateStatusUpdateEmail } from '../../modules/monitoring/status-emails.js';
import { renderChannelEmail } from '../../modules/notification-channels/providers/email-provider.js';
import { renderNoticeEmail } from '../../lib/email/layout.js';
import { contrastWithWhite } from '../../lib/email/components.js';
import { LOGO_DARK_URL } from '../../lib/logo.js';

const XSS = '<img src=x onerror=alert(1)>';

describe('status page emails', () => {
  it('confirmation uses the console layout with the page name instead of the LogTide logo', () => {
    const { html } = generateConfirmationEmail({
      pageTitle: `Northwind Status ${XSS}`,
      accentColor: '#1d4ed8',
      confirmUrl: 'https://status.northwind.example/confirm?t=1',
    });
    expect(html).toContain('<meta name="color-scheme" content="light dark">');
    expect(html).toContain('Northwind Status &lt;img');
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain(LOGO_DARK_URL);
    expect(html).toContain('bgcolor="#1d4ed8"');
    expect(html).toContain('Confirm subscription');
  });

  it('falls back to the LogTide violet when white text would not read on the accent', () => {
    const { html } = generateConfirmationEmail({
      pageTitle: 'Northwind Status',
      accentColor: '#ffff00',
      confirmUrl: 'https://status.northwind.example/confirm?t=1',
    });
    expect(html).toContain('bgcolor="#7c3aed"');
    expect(html).not.toContain('bgcolor="#ffff00"');
  });

  it('update notice shows the status and the unsubscribe link', () => {
    const { html } = generateStatusUpdateEmail({
      kind: 'incident_updated',
      pageTitle: 'Northwind Status',
      title: 'Checkout errors',
      status: 'monitoring',
      message: 'A fix is deployed.',
      pageUrl: 'https://status.northwind.example',
      unsubscribeUrl: 'https://status.northwind.example/unsubscribe?t=2',
    });
    expect(html).toContain('@media (prefers-color-scheme: dark)');
    expect(html).toContain('Monitoring');
    expect(html).toContain('A fix is deployed.');
    expect(html).toContain('https://status.northwind.example/unsubscribe?t=2');
  });
});

describe('notification channel email', () => {
  it('escapes the title and message and uses the console layout', () => {
    const html = renderChannelEmail({
      organizationId: 'o1',
      organizationName: 'Northwind',
      eventType: 'alert',
      title: XSS,
      message: XSS,
      severity: 'high',
    });
    expect(html).toContain('@media (prefers-color-scheme: dark)');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('lt-fill-error');
  });
});

describe('renderNoticeEmail', () => {
  it('wraps plain text paragraphs and escapes them', () => {
    const html = renderNoticeEmail({ subject: `Retention ${XSS}`, text: `First line ${XSS}\n\nSecond paragraph` });
    expect(html).toContain('@media (prefers-color-scheme: dark)');
    expect(html).toContain('Second paragraph');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('Retention &lt;img');
  });
});

describe('contrastWithWhite', () => {
  it('measures white text contrast', () => {
    expect(contrastWithWhite('#7c3aed')).toBeGreaterThan(4.5);
    expect(contrastWithWhite('#ffff00')).toBeLessThan(2);
    expect(contrastWithWhite('nope')).toBe(0);
  });
});
