import { escapeHtml, getFrontendUrl } from '../../lib/email-templates.js';

/**
 * Self-contained emails of the public status page (confirmation now, update
 * notices in the subscriber job). Every dynamic value is HTML-escaped.
 */

export interface StatusEmail {
  subject: string;
  html: string;
  text: string;
}

export function statusPageUrl(orgSlug: string, projectSlug: string): string {
  return `${getFrontendUrl()}/status/${encodeURIComponent(orgSlug)}/${encodeURIComponent(projectSlug)}`;
}

/** Accent colours come from user config: only a strict #rrggbb reaches inline CSS. */
export function safeAccent(accent: string | null | undefined): string {
  return accent && /^#[0-9a-fA-F]{6}$/.test(accent) ? accent : '#2563eb';
}

export function wrapStatusEmail(opts: {
  pageTitle: string;
  accent?: string | null;
  heading: string;
  bodyHtml: string;
  footerHtml?: string;
}): string {
  const accent = safeAccent(opts.accent);
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;padding:24px;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#18181b;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:8px;overflow:hidden;border:1px solid #e4e4e7;">
    <div style="height:4px;background:${accent};"></div>
    <div style="padding:24px;">
      <p style="margin:0 0 4px;font-size:13px;color:#71717a;">${escapeHtml(opts.pageTitle)}</p>
      <h1 style="margin:0 0 16px;font-size:20px;line-height:1.3;">${escapeHtml(opts.heading)}</h1>
      ${opts.bodyHtml}
    </div>
    ${opts.footerHtml ? `<div style="padding:16px 24px;border-top:1px solid #e4e4e7;font-size:12px;color:#71717a;">${opts.footerHtml}</div>` : ''}
  </div>
</body>
</html>`;
}

export function generateConfirmationEmail(data: {
  pageTitle: string;
  accentColor?: string | null;
  confirmUrl: string;
}): StatusEmail {
  const subject = `Confirm your subscription to ${data.pageTitle.replace(/[\r\n]+/g, ' ')}`;
  const bodyHtml = `
      <p style="margin:0 0 16px;font-size:14px;line-height:1.6;">Confirm your email address to receive incident and maintenance updates from ${escapeHtml(data.pageTitle)}.</p>
      <p style="margin:0 0 16px;"><a href="${escapeHtml(data.confirmUrl)}" style="display:inline-block;padding:10px 18px;background:${safeAccent(data.accentColor)};color:#ffffff;text-decoration:none;border-radius:6px;font-size:14px;font-weight:600;">Confirm subscription</a></p>
      <p style="margin:0;font-size:13px;color:#52525b;">The link is valid for 48 hours. If you did not ask for this, you can ignore this email and nothing will be sent to you.</p>`;
  const html = wrapStatusEmail({
    pageTitle: data.pageTitle,
    accent: data.accentColor,
    heading: 'Confirm your subscription',
    bodyHtml,
  });
  const text = [
    `Confirm your email address to receive incident and maintenance updates from ${data.pageTitle}.`,
    '',
    `Confirm: ${data.confirmUrl}`,
    '',
    'The link is valid for 48 hours. If you did not ask for this, you can ignore this email and nothing will be sent to you.',
  ].join('\n');
  return { subject, html, text };
}
