/**
 * Shell of every LogTide email in the "Console" design: light by default
 * (inline styles, what Gmail and Outlook render), dark through
 * prefers-color-scheme where the mail app supports it (Apple Mail, Outlook
 * for Mac, iOS) and Outlook.com's data-ogsc/data-ogsb hooks.
 */
import { escapeHtml, getFrontendUrl } from './util.js';
import { dark, light, TONES, toneColors, FONT_MONO, FONT_SANS } from './tokens.js';
import { LOGO_DARK_URL, LOGO_WHITE_URL } from '../logo.js';
import { title } from './components.js';

export type FooterKind =
  | { kind: 'notifications' }
  | { kind: 'unsubscribe'; url: string }
  | { kind: 'account' }
  /** Trusted HTML: the caller escapes anything dynamic. */
  | { kind: 'custom'; html: string };

export interface RenderEmailOptions {
  title: string;
  preheader?: string;
  /** Short mono label on the right of the logo row: org, project, status page. */
  context?: string;
  /**
   * Shows this name instead of the LogTide logo, for mail sent on behalf of a
   * customer's public status page.
   */
  brand?: string;
  body: string;
  footer: FooterKind;
}

const L = light;

/** color / background rules the dark block applies to each class. */
function darkRules(): Array<[selector: string, declarations: string]> {
  const d = dark;
  const rules: Array<[string, string]> = [
    ['.lt-ground', `background-color:${d.ground} !important;`],
    ['.lt-card', `background-color:${d.card} !important;border-color:${d.border} !important;`],
    ['.lt-text', `color:${d.text} !important;`],
    ['.lt-muted', `color:${d.muted} !important;`],
    ['.lt-border', `border-color:${d.border} !important;`],
    ['.lt-key', `color:${d.key} !important;`],
    ['.lt-track', `background-color:${d.track} !important;`],
    ['.lt-mark', `background-color:${d.text} !important;`],
    ['.lt-btn', `color:${d.buttonText} !important;`],
  ];
  for (const tone of TONES) {
    const c = toneColors(d, tone);
    rules.push([`.lt-tone-${tone}`, `color:${c.text} !important;`]);
    rules.push([`.lt-fill-${tone}`, `background-color:${c.fill} !important;border-color:${c.line} !important;`]);
    rules.push([`.lt-solid-${tone}`, `background-color:${c.solid} !important;`]);
  }
  return rules;
}

function styleBlock(): string {
  const rules = darkRules();
  const media = rules.map(([sel, decl]) => `${sel}{${decl}}`).join('\n');
  // Outlook.com marks dark mode with data-ogsc (text) and data-ogsb (backgrounds).
  const ogsc = rules
    .filter(([, decl]) => decl.startsWith('color'))
    .map(([sel, decl]) => `[data-ogsc] ${sel}{${decl}}`)
    .join('\n');
  const ogsb = rules
    .filter(([, decl]) => decl.startsWith('background'))
    .map(([sel, decl]) => `[data-ogsb] ${sel}{${decl}}`)
    .join('\n');
  return `<style>
:root{color-scheme:light dark;supported-color-schemes:light dark;}
.lt-logo-dark{display:none;}
@media (prefers-color-scheme: dark) {
${media}
.lt-logo-light{display:none !important;}
.lt-logo-dark{display:block !important;}
}
${ogsc}
${ogsb}
@media only screen and (max-width: 480px) {
.lt-pad{padding:24px 16px !important;}
}
</style>`;
}

function footerHtml(footer: FooterKind): string {
  const link = (href: string, text: string) =>
    `<a href="${escapeHtml(href)}" class="lt-muted" style="color:${L.muted};text-decoration:underline;">${escapeHtml(text)}</a>`;
  switch (footer.kind) {
    case 'notifications':
      return `Sent by LogTide. ${link(`${getFrontendUrl()}/dashboard/settings/notifications/destinations`, 'Manage notification settings')}`;
    case 'unsubscribe':
      return `Sent by LogTide. ${link(footer.url, 'Unsubscribe from these reports')}`;
    case 'account':
      return 'Sent by LogTide';
    case 'custom':
      return footer.html;
  }
}

export function renderEmail(opts: RenderEmailOptions): string {
  const frontendUrl = getFrontendUrl();
  const preheader = opts.preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${escapeHtml(opts.preheader)}</div>`
    : '';
  const logo = opts.brand
    ? `<span class="lt-text" style="font-family:${FONT_SANS};font-size:16px;line-height:28px;font-weight:600;color:${L.text};">${escapeHtml(opts.brand)}</span>`
    : `<a href="${escapeHtml(frontendUrl)}" style="text-decoration:none;"><img class="lt-logo-light" src="${LOGO_DARK_URL}" alt="LogTide" width="89" height="28" style="display:block;border:0;width:89px;height:28px;"><img class="lt-logo-dark" src="${LOGO_WHITE_URL}" alt="LogTide" width="89" height="28" style="display:none;mso-hide:all;border:0;width:89px;height:28px;"></a>`;
  const context = opts.context
    ? `<td align="right" class="lt-muted" style="font-family:${FONT_MONO};font-size:12px;line-height:16px;color:${L.muted};">${escapeHtml(opts.context)}</td>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${escapeHtml(opts.title)}</title>
${styleBlock()}
</head>
<body class="lt-ground" style="margin:0;padding:0;width:100%;background-color:${L.ground};-webkit-font-smoothing:antialiased;">
${preheader}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${L.ground}" class="lt-ground" style="background-color:${L.ground};">
<tr><td align="center" class="lt-pad" style="padding:32px 24px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;">
<tr><td class="lt-border" style="padding:0 0 20px;border-bottom:1px solid ${L.border};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td align="left">${logo}</td>
${context}
</tr></table>
</td></tr>
<tr><td class="lt-text" style="padding:32px 0 0;font-family:${FONT_SANS};color:${L.text};">
${opts.body}
</td></tr>
<tr><td class="lt-muted lt-border" style="padding:16px 0 0;border-top:1px solid ${L.border};font-family:${FONT_SANS};font-size:12px;line-height:16px;color:${L.muted};">
${footerHtml(opts.footer)}
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

/**
 * A plain-text notice (quota warnings, extension mail without its own HTML)
 * in the same shell: the subject as title, each blank-line-separated block of
 * the text as a paragraph.
 */
export function renderNoticeEmail(opts: { subject: string; text: string; context?: string }): string {
  const blocks = (opts.text ?? '')
    .split(/\r?\n\s*\r?\n/)
    .map((b) => b.trim())
    .filter(Boolean);
  const body =
    title(opts.subject) +
    blocks
      .map(
        (b) =>
          `<p class="lt-text" style="margin:0 0 16px;font-family:${FONT_SANS};font-size:14px;line-height:20px;color:${L.text};white-space:pre-wrap;word-break:break-word;">${escapeHtml(b)}</p>`,
      )
      .join('');
  return renderEmail({ title: opts.subject, context: opts.context, body, footer: { kind: 'account' } });
}
