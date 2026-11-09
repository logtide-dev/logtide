import { escapeHtml, getFrontendUrl } from '../../lib/email-templates.js';
import { renderEmail, type FooterKind } from '../../lib/email/layout.js';
import * as ui from '../../lib/email/components.js';
import { light } from '../../lib/email/tokens.js';

/**
 * Emails of the public status page (confirmation now, update notices in the
 * subscriber job), in the shared console layout under the page's own name.
 * Every dynamic value is HTML-escaped.
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

/** The page accent as button color when white text reads on it (4.5:1), else the LogTide violet. */
function buttonColor(accent: string | null | undefined): string {
  const color = safeAccent(accent);
  return ui.contrastWithWhite(color) >= 4.5 ? color : light.button;
}

/** lead renders above the heading (the status pill). */
function wrapStatusEmail(opts: { pageTitle: string; heading: string; lead?: string; body: string; footer: FooterKind }): string {
  return renderEmail({
    title: opts.heading,
    brand: opts.pageTitle,
    body: (opts.lead ?? '') + ui.title(opts.heading) + opts.body,
    footer: opts.footer,
  });
}

export function generateConfirmationEmail(data: {
  pageTitle: string;
  accentColor?: string | null;
  confirmUrl: string;
}): StatusEmail {
  const subject = `Confirm your subscription to ${data.pageTitle.replace(/[\r\n]+/g, ' ')}`;
  const body =
    ui.paragraph(`Confirm your email address to receive incident and maintenance updates from ${data.pageTitle}.`) +
    ui.button('Confirm subscription', data.confirmUrl, { color: buttonColor(data.accentColor) }) +
    ui.linkFallback(data.confirmUrl) +
    ui.paragraph('The link is valid for 48 hours. If you did not ask for this, you can ignore this email and nothing will be sent to you.');
  const html = wrapStatusEmail({
    pageTitle: data.pageTitle,
    heading: 'Confirm your subscription',
    body,
    footer: { kind: 'custom', html: `Sent for ${escapeHtml(data.pageTitle)}` },
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

export type StatusUpdateKind =
  | 'incident_created'
  | 'incident_updated'
  | 'incident_resolved'
  | 'maintenance_scheduled';

const KIND_LABELS: Record<StatusUpdateKind, { subject: string; heading: string }> = {
  incident_created: { subject: 'Incident', heading: 'New incident' },
  incident_updated: { subject: 'Update', heading: 'Incident update' },
  incident_resolved: { subject: 'Resolved', heading: 'Incident resolved' },
  maintenance_scheduled: { subject: 'Scheduled maintenance', heading: 'Scheduled maintenance' },
};

const STATUS_LABELS: Record<string, string> = {
  investigating: 'Investigating',
  identified: 'Identified',
  monitoring: 'Monitoring',
  resolved: 'Resolved',
};

const STATUS_TONES: Record<string, ui.Cell['tone']> = {
  investigating: 'error',
  identified: 'warning',
  monitoring: 'info',
  resolved: 'success',
};

export function generateStatusUpdateEmail(data: {
  kind: StatusUpdateKind;
  pageTitle: string;
  accentColor?: string | null;
  title: string;
  status?: string;
  message?: string;
  scheduledStart?: string;
  scheduledEnd?: string;
  pageUrl: string;
  unsubscribeUrl: string;
}): StatusEmail {
  const labels = KIND_LABELS[data.kind];
  const oneLine = (s: string) => s.replace(/[\r\n]+/g, ' ');
  const subject = `[${oneLine(data.pageTitle)}] ${labels.subject}: ${oneLine(data.title)}`;

  const parts: string[] = [];
  let lead = '';
  const textLines: string[] = [data.title, ''];
  if (data.status) {
    const label = STATUS_LABELS[data.status] ?? data.status;
    lead = ui.pill(label, STATUS_TONES[data.status] ?? 'neutral');
    textLines.push(`Status: ${label}`);
  }
  parts.push(ui.sectionTitle(data.title));
  if (data.scheduledStart && data.scheduledEnd) {
    const start = new Date(data.scheduledStart).toUTCString();
    const end = new Date(data.scheduledEnd).toUTCString();
    parts.push(ui.logBlock([
      { key: 'from', value: start },
      { key: 'to', value: end },
    ]));
    textLines.push(`From ${start} to ${end}`);
  }
  if (data.message) {
    parts.push(ui.paragraph(data.message, { muted: false, preWrap: true }));
    textLines.push('', data.message);
  }
  parts.push(ui.button('View the status page', data.pageUrl, { color: buttonColor(data.accentColor) }));
  textLines.push('', `Status page: ${data.pageUrl}`, '', `Unsubscribe: ${data.unsubscribeUrl}`);

  const footerHtml = `You receive this because you subscribed to ${escapeHtml(data.pageTitle)}. <a href="${escapeHtml(data.unsubscribeUrl)}" class="lt-muted" style="color:${light.muted};text-decoration:underline;">Unsubscribe</a>`;

  return {
    subject,
    html: wrapStatusEmail({
      pageTitle: data.pageTitle,
      heading: labels.heading,
      lead,
      body: parts.join(''),
      footer: { kind: 'custom', html: footerHtml },
    }),
    text: textLines.join('\n'),
  };
}
