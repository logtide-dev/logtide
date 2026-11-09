import { describe, it, expect } from 'vitest';
import { renderEmail } from '../../lib/email/layout.js';
import {
  pill,
  title,
  paragraph,
  bigNumber,
  meter,
  logBlock,
  codeBlock,
  dataTable,
  sectionTitle,
  emptyLine,
  button,
  linkFallback,
  notice,
} from '../../lib/email/components.js';
import { light, dark, severityTone } from '../../lib/email/tokens.js';
import { LOGO_DARK_URL, LOGO_WHITE_URL } from '../../lib/logo.js';

const XSS = '<img src=x onerror=alert(1)>';

function page(body = title('Hello')) {
  return renderEmail({ title: 'Hello', preheader: 'Preview', context: 'northwind/production', body, footer: { kind: 'notifications' } });
}

describe('renderEmail', () => {
  it('declares both color schemes and carries the dark block', () => {
    const html = page();
    expect(html).toContain('<meta name="color-scheme" content="light dark">');
    expect(html).toContain('<meta name="supported-color-schemes" content="light dark">');
    expect(html).toContain('@media (prefers-color-scheme: dark)');
    expect(html).toContain(light.ground);
    expect(html).toContain(dark.ground);
  });

  it('includes both logos', () => {
    const html = page();
    expect(html).toContain(LOGO_DARK_URL);
    expect(html).toContain(LOGO_WHITE_URL);
  });

  it('uses no flex or grid layout and no em dash', () => {
    const html = page(
      pill('Alert triggered', 'error') +
        bigNumber('1,284', 'logs matched', 'error') +
        meter({ value: 1284, threshold: 500, label: 'threshold 500' }) +
        logBlock([{ key: 'service', value: 'payments-api' }]) +
        dataTable(['Service', 'Errors'], [[{ text: 'payments-api' }, { text: '1,842', tone: 'error' }]]) +
        button('View alert history', 'https://example.com') +
        linkFallback('https://example.com/x') +
        notice('Quiet period', 'info'),
    );
    expect(html).not.toMatch(/display:\s*(flex|grid)/);
    expect(html).not.toContain('—');
  });

  it('escapes the context and preheader', () => {
    const html = renderEmail({ title: XSS, preheader: XSS, context: XSS, body: '', footer: { kind: 'account' } });
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x');
  });

  it('links to notification settings only for notification emails', () => {
    expect(page()).toContain('/dashboard/settings/notifications/destinations');
    const account = renderEmail({ title: 'Reset', body: '', footer: { kind: 'account' } });
    expect(account).not.toContain('/dashboard/settings/notifications/destinations');
    const unsub = renderEmail({ title: 'Digest', body: '', footer: { kind: 'unsubscribe', url: 'https://x.test/u?t=1' } });
    expect(unsub).toContain('https://x.test/u?t=1');
    expect(unsub).toContain('Unsubscribe');
  });
});

describe('components escape their text', () => {
  it.each([
    ['pill', () => pill(XSS, 'error')],
    ['title', () => title(XSS)],
    ['paragraph', () => paragraph(XSS)],
    ['bigNumber', () => bigNumber(XSS, XSS)],
    ['logBlock', () => logBlock([{ key: XSS, value: XSS }])],
    ['codeBlock', () => codeBlock(XSS)],
    ['dataTable', () => dataTable([XSS], [[{ text: XSS }]])],
    ['sectionTitle', () => sectionTitle(XSS)],
    ['emptyLine', () => emptyLine(XSS)],
    ['button', () => button(XSS, 'https://example.com/"onmouseover="x')],
    ['linkFallback', () => linkFallback('https://example.com/<b>')],
    ['notice', () => notice(XSS, 'warning')],
  ])('%s', (_name, render) => {
    const html = render();
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('"onmouseover="');
    expect(html).not.toContain('<b>');
  });
});

describe('meter', () => {
  it('renders nothing unless the value is over a positive threshold', () => {
    expect(meter({ value: 500, threshold: 500, label: 'x' })).toBe('');
    expect(meter({ value: 10, threshold: 0, label: 'x' })).toBe('');
    expect(meter({ value: 0, threshold: 0, label: 'x' })).toBe('');
    expect(meter({ value: 3, threshold: 10, label: 'x' })).toBe('');
  });

  it('places the threshold mark proportionally', () => {
    const html = meter({ value: 1284, threshold: 500, label: 'threshold 500' });
    expect(html).toContain('39%');
    expect(html).not.toContain('NaN');
    expect(html).toContain('threshold 500');
  });
});

describe('severityTone', () => {
  it('maps the five severities', () => {
    expect(severityTone('critical')).toBe('critical');
    expect(severityTone('high')).toBe('error');
    expect(severityTone('medium')).toBe('warning');
    expect(severityTone('low')).toBe('info');
    expect(severityTone('informational')).toBe('neutral');
  });
});

describe('boxes render as tables for Outlook', () => {
  it.each([
    ['pill', () => pill('Alert triggered', 'error')],
    ['logBlock', () => logBlock([{ key: 'service', value: 'payments-api' }])],
    ['codeBlock', () => codeBlock('trace')],
    ['linkFallback', () => linkFallback('https://example.com/x')],
    ['notice', () => notice('Quiet period', 'info')],
  ])('%s puts padding and background on a table cell, not a div or span', (_name, render) => {
    const html = render();
    expect(html).toMatch(/<td[^>]*bgcolor="#[0-9a-f]{6}"[^>]*style="[^"]*padding:/);
    expect(html).not.toMatch(/<(div|span)[^>]*style="[^"]*padding:/);
  });
});

describe('Outlook details', () => {
  it('pins the width to 600px in Outlook for Windows with a ghost table', () => {
    const html = page();
    expect(html).toContain('<!--[if mso]><table role="presentation" width="600" align="center" cellpadding="0" cellspacing="0"><tr><td><![endif]-->');
    expect(html).toContain('<!--[if mso]></td></tr></table><![endif]-->');
  });

  it('recolors hairlines in Outlook.com dark mode too', () => {
    expect(page()).toMatch(/\[data-ogsb\] \.lt-border\{border-color:/);
  });

  it('keeps the meter bar 8px tall and places its label with a cell, not a percent padding', () => {
    const html = meter({ value: 1284, threshold: 500, label: 'threshold 500' });
    expect(html).toContain('mso-line-height-rule:exactly');
    expect(html).not.toMatch(/padding-left:\d+%/);
    expect(html).toMatch(/<td width="39%"[^>]*>&nbsp;<\/td><td[^>]*>threshold 500<\/td>/);
  });
});
