/**
 * Centralized Email Templates
 *
 * All email templates use inline styles for maximum compatibility with email clients.
 * Gmail, Outlook, Apple Mail, etc. all have different CSS support.
 */

import { config } from '../config/index.js';
import { getLogoUrl } from './logo.js';
import type { DigestReportData } from '../modules/digests/generator.js';

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Get the frontend URL from config, with a sensible fallback.
 * In production, FRONTEND_URL should always be set.
 */
export function getFrontendUrl(): string {
  if (config.FRONTEND_URL) {
    return config.FRONTEND_URL.replace(/\/$/, ''); // Remove trailing slash
  }

  // Log warning in production if FRONTEND_URL is not set
  if (config.NODE_ENV === 'production') {
    console.warn('[Email] FRONTEND_URL not set in production - email links will be broken');
  }

  return 'http://localhost:5173';
}

/**
 * Format a date for display in emails
 */
export function formatEmailDate(date: Date = new Date()): string {
  return date.toLocaleString('en-US', {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  });
}

/**
 * Escape HTML to prevent XSS in email content
 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Truncate text with ellipsis
 */
export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength - 3) + '...';
}

// ============================================================================
// SHARED STYLES
// ============================================================================

const colors = {
  background: '#f4f4f5',
  cardBg: '#ffffff',
  text: '#18181b',
  textMuted: '#71717a',
  textLight: '#a1a1aa',
  border: '#e4e4e7',
  primary: '#18181b',
  error: '#dc2626',
  errorBg: '#fef2f2',
  warning: '#ca8a04',
  warningBg: '#fefce8',
  success: '#16a34a',
  successBg: '#f0fdf4',
  info: '#2563eb',
  infoBg: '#eff6ff',
  critical: '#dc2626',
  high: '#ea580c',
  medium: '#ca8a04',
  low: '#2563eb',
  informational: '#6b7280',
};

// ============================================================================
// BASE TEMPLATE
// ============================================================================

interface BaseEmailOptions {
  preheader?: string; // Preview text shown in email clients
  // When set, the footer swaps the channel-settings link for a one-click
  // unsubscribe link (used by digest emails, where recipients may have no account)
  unsubscribeUrl?: string;
}

function baseTemplate(content: string, options: BaseEmailOptions = {}): string {
  const { preheader, unsubscribeUrl } = options;
  const frontendUrl = getFrontendUrl();
  const logoUrl = getLogoUrl();

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>LogTide Notification</title>
  <!--[if mso]>
  <noscript>
    <xml>
      <o:OfficeDocumentSettings>
        <o:PixelsPerInch>96</o:PixelsPerInch>
      </o:OfficeDocumentSettings>
    </xml>
  </noscript>
  <![endif]-->
</head>
<body style="margin: 0; padding: 0; width: 100%; background-color: ${colors.background}; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; -webkit-font-smoothing: antialiased;">
  ${preheader ? `<div style="display: none; max-height: 0; overflow: hidden;">${escapeHtml(preheader)}</div>` : ''}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: ${colors.background};">
    <tr>
      <td align="center" style="padding: 40px 16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width: 600px;">
          <!-- Logo -->
          <tr>
            <td align="center" style="padding: 0 0 24px;">
              <a href="${frontendUrl}" style="text-decoration: none;">
                <img src="${logoUrl}" alt="LogTide" width="140" height="auto" style="display: block; max-width: 140px; height: auto;" />
              </a>
            </td>
          </tr>
          ${content}
          <!-- Footer -->
          <tr>
            <td style="padding: 24px 0; text-align: center;">
              <p style="margin: 0 0 8px; font-size: 12px; color: ${colors.textLight};">
                Sent by <a href="${frontendUrl}" style="color: ${colors.textMuted}; text-decoration: none;">LogTide</a>
              </p>
              <p style="margin: 0; font-size: 11px; color: ${colors.textLight};">
                ${unsubscribeUrl
                  ? `<a href="${unsubscribeUrl}" style="color: ${colors.textMuted}; text-decoration: underline;">Unsubscribe from these reports</a>`
                  : `<a href="${frontendUrl}/dashboard/settings/channels" style="color: ${colors.textMuted}; text-decoration: underline;">Manage notification settings</a>`}
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ============================================================================
// COMPONENTS
// ============================================================================

function card(content: string): string {
  return `<tr>
    <td style="background-color: ${colors.cardBg}; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
      ${content}
    </td>
  </tr>`;
}

function header(title: string, badge?: { text: string; color: string }): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
    <tr>
      <td style="padding: 24px 24px 16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="vertical-align: middle;">
              <h1 style="margin: 0; font-size: 20px; font-weight: 600; color: ${colors.text}; line-height: 1.3;">
                ${escapeHtml(title)}
              </h1>
            </td>
            ${badge ? `<td align="right" style="vertical-align: middle;">
              <span style="display: inline-block; padding: 4px 10px; background-color: ${badge.color}; color: white; border-radius: 4px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">
                ${escapeHtml(badge.text)}
              </span>
            </td>` : ''}
          </tr>
        </table>
      </td>
    </tr>
  </table>`;
}

function divider(): string {
  return `<tr><td style="padding: 0 24px;"><hr style="border: none; border-top: 1px solid ${colors.border}; margin: 0;"></td></tr>`;
}

function infoRow(label: string, value: string, isCode = false): string {
  const valueStyle = isCode
    ? `font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace; font-size: 13px; background-color: ${colors.background}; padding: 2px 6px; border-radius: 4px;`
    : '';

  return `<tr>
    <td style="padding: 8px 0;">
      <span style="font-size: 12px; color: ${colors.textMuted}; text-transform: uppercase; letter-spacing: 0.5px;">${escapeHtml(label)}</span><br>
      <span style="font-size: 14px; color: ${colors.text}; font-weight: 500; ${valueStyle}">${escapeHtml(value)}</span>
    </td>
  </tr>`;
}

function infoBox(rows: Array<{ label: string; value: string; isCode?: boolean }>): string {
  return `<tr>
    <td style="padding: 16px 24px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: ${colors.background}; border-radius: 8px;">
        <tr>
          <td style="padding: 16px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
              ${rows.map(r => infoRow(r.label, r.value, r.isCode)).join('')}
            </table>
          </td>
        </tr>
      </table>
    </td>
  </tr>`;
}

function alertBox(message: string, type: 'error' | 'warning' | 'success' | 'info' = 'error'): string {
  const bgColors = {
    error: colors.errorBg,
    warning: colors.warningBg,
    success: colors.successBg,
    info: colors.infoBg,
  };
  const borderColors = {
    error: colors.error,
    warning: colors.warning,
    success: colors.success,
    info: colors.info,
  };

  return `<tr>
    <td style="padding: 0 24px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: ${bgColors[type]}; border-left: 4px solid ${borderColors[type]}; border-radius: 4px;">
        <tr>
          <td style="padding: 12px 16px; font-size: 14px; color: ${colors.text}; line-height: 1.5;">
            ${message}
          </td>
        </tr>
      </table>
    </td>
  </tr>`;
}

function cta(text: string, url: string): string {
  return `<tr>
    <td style="padding: 8px 24px 24px;" align="center">
      <a href="${url}" style="display: inline-block; padding: 12px 24px; background-color: ${colors.primary}; color: #ffffff; text-decoration: none; border-radius: 6px; font-size: 14px; font-weight: 500;">
        ${escapeHtml(text)}
      </a>
    </td>
  </tr>`;
}

function codeBlock(code: string): string {
  return `<tr>
    <td style="padding: 0 24px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #1e1e1e; border-radius: 8px;">
        <tr>
          <td style="padding: 16px; font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace; font-size: 13px; color: #d4d4d4; line-height: 1.5; white-space: pre-wrap; word-break: break-word;">
            ${escapeHtml(code)}
          </td>
        </tr>
      </table>
    </td>
  </tr>`;
}

function subtitle(text: string): string {
  return `<tr>
    <td style="padding: 16px 24px 8px;">
      <p style="margin: 0; font-size: 14px; color: ${colors.textMuted}; line-height: 1.5;">
        ${escapeHtml(text)}
      </p>
    </td>
  </tr>`;
}

function timestamp(): string {
  return `<tr>
    <td style="padding: 0 24px 8px;">
      <p style="margin: 0; font-size: 12px; color: ${colors.textLight};">
        ${formatEmailDate()}
      </p>
    </td>
  </tr>`;
}

// ============================================================================
// ALERT NOTIFICATION EMAIL
// ============================================================================

export interface AlertEmailData {
  ruleName: string;
  logCount: number;
  threshold: number;
  timeWindow: number;
  service?: string | null;
  levels?: string[];
  organizationName?: string;
  projectName?: string | null;
  historyId?: string;
  baselineMetadata?: {
    baseline_value: number;
    current_value: number;
    deviation_ratio: number;
    baseline_type: string;
  };
}

const baselineTypeLabels: Record<string, string> = {
  same_time_yesterday: 'Same time yesterday',
  same_day_last_week: 'Same day last week',
  rolling_7d_avg: '7-day rolling average',
  percentile_p95: '95th percentile (7 days)',
};

export function generateAlertEmail(data: AlertEmailData): { html: string; text: string } {
  const frontendUrl = getFrontendUrl();
  const dashboardUrl = `${frontendUrl}/dashboard/alerts`;
  const isRateOfChange = !!data.baselineMetadata;

  if (isRateOfChange) {
    const bm = data.baselineMetadata!;
    const baselineLabel = baselineTypeLabels[bm.baseline_type] || bm.baseline_type;

    const html = baseTemplate(
      card(`
        ${header(`Anomaly: ${data.ruleName}`, { text: `${bm.deviation_ratio}x above normal`, color: colors.warning })}
        ${divider()}
        ${subtitle(`Unusual log volume detected compared to baseline.`)}
        ${timestamp()}
        ${alertBox(
          `Current rate: <strong>${Math.round(bm.current_value).toLocaleString('en-US')}</strong> logs/hr &mdash; Baseline: <strong>${Math.round(bm.baseline_value).toLocaleString('en-US')}</strong> logs/hr &mdash; <strong>${bm.deviation_ratio}x</strong> above normal`,
          'warning'
        )}
        ${infoBox([
          { label: 'Rule Name', value: data.ruleName },
          { label: 'Baseline Method', value: baselineLabel },
          { label: 'Current Rate', value: `${Math.round(bm.current_value).toLocaleString('en-US')} logs/hr` },
          { label: 'Baseline Rate', value: `${Math.round(bm.baseline_value).toLocaleString('en-US')} logs/hr` },
          { label: 'Deviation', value: `${bm.deviation_ratio}x` },
          ...(data.service ? [{ label: 'Service Filter', value: data.service, isCode: true }] : []),
          ...(data.organizationName ? [{ label: 'Organization', value: data.organizationName }] : []),
          ...(data.projectName ? [{ label: 'Project', value: data.projectName }] : []),
        ])}
        ${cta('View Alert History', dashboardUrl)}
      `),
      { preheader: `${bm.deviation_ratio}x above baseline for "${data.ruleName}"` }
    );

    const text = `
ANOMALY DETECTED: ${data.ruleName}
${'='.repeat(50)}

Log volume is ${bm.deviation_ratio}x above the baseline.

Current Rate: ${Math.round(bm.current_value).toLocaleString('en-US')} logs/hr
Baseline (${baselineLabel}): ${Math.round(bm.baseline_value).toLocaleString('en-US')} logs/hr
Deviation: ${bm.deviation_ratio}x above normal

DETAILS
-------
Rule Name: ${data.ruleName}
${data.service ? `Service: ${data.service}` : ''}
${data.organizationName ? `Organization: ${data.organizationName}` : ''}
${data.projectName ? `Project: ${data.projectName}` : ''}

Triggered: ${formatEmailDate()}

View details: ${dashboardUrl}

--
Sent by LogTide
Manage notifications: ${frontendUrl}/dashboard/settings/channels
`.trim();

    return { html, text };
  }

  // Standard threshold alert email
  const html = baseTemplate(
    card(`
      ${header(`Alert: ${data.ruleName}`, { text: 'Triggered', color: colors.error })}
      ${divider()}
      ${subtitle(`Your alert threshold was exceeded.`)}
      ${timestamp()}
      ${alertBox(
        `<strong>${data.logCount.toLocaleString('en-US')}</strong> logs matched in the last <strong>${data.timeWindow}</strong> minute${data.timeWindow > 1 ? 's' : ''}, exceeding your threshold of <strong>${data.threshold.toLocaleString('en-US')}</strong>.`,
        'error'
      )}
      ${infoBox([
        { label: 'Rule Name', value: data.ruleName },
        ...(data.service ? [{ label: 'Service Filter', value: data.service, isCode: true }] : []),
        ...(data.levels?.length ? [{ label: 'Log Levels', value: data.levels.join(', ') }] : []),
        ...(data.organizationName ? [{ label: 'Organization', value: data.organizationName }] : []),
        ...(data.projectName ? [{ label: 'Project', value: data.projectName }] : []),
      ])}
      ${cta('View Alert History', dashboardUrl)}
    `),
    { preheader: `${data.logCount} logs exceeded threshold of ${data.threshold} for "${data.ruleName}"` }
  );

  const text = `
ALERT TRIGGERED: ${data.ruleName}
${'='.repeat(50)}

${data.logCount.toLocaleString('en-US')} logs matched in the last ${data.timeWindow} minute${data.timeWindow > 1 ? 's' : ''}, exceeding your threshold of ${data.threshold.toLocaleString('en-US')}.

DETAILS
-------
Rule Name: ${data.ruleName}
${data.service ? `Service: ${data.service}` : ''}
${data.levels?.length ? `Log Levels: ${data.levels.join(', ')}` : ''}
${data.organizationName ? `Organization: ${data.organizationName}` : ''}
${data.projectName ? `Project: ${data.projectName}` : ''}

Triggered: ${formatEmailDate()}

View details: ${dashboardUrl}

--
Sent by LogTide
Manage notifications: ${frontendUrl}/dashboard/settings/channels
`.trim();

  return { html, text };
}

// ============================================================================
// ERROR NOTIFICATION EMAIL
// ============================================================================

export interface ErrorEmailData {
  exceptionType: string;
  exceptionMessage?: string | null;
  language: string;
  service: string;
  isNewErrorGroup: boolean;
  errorGroupId: string;
  organizationName: string;
  projectName: string;
  fingerprint?: string;
}

const languageLabels: Record<string, string> = {
  nodejs: 'Node.js',
  python: 'Python',
  java: 'Java',
  go: 'Go',
  php: 'PHP',
  kotlin: 'Kotlin',
  csharp: 'C#',
  rust: 'Rust',
  ruby: 'Ruby',
  unknown: 'Unknown',
};

export function generateErrorEmail(data: ErrorEmailData): { html: string; text: string } {
  const frontendUrl = getFrontendUrl();
  const errorUrl = `${frontendUrl}/dashboard/errors/${data.errorGroupId}`;
  const languageLabel = languageLabels[data.language] || data.language;

  const title = data.isNewErrorGroup
    ? `New Error: ${data.exceptionType}`
    : `Error: ${data.exceptionType}`;

  const html = baseTemplate(
    card(`
      ${header(title, { text: languageLabel, color: colors.error })}
      ${divider()}
      ${data.exceptionMessage ? subtitle(truncate(data.exceptionMessage, 200)) : ''}
      ${timestamp()}
      ${data.exceptionMessage ? codeBlock(truncate(data.exceptionMessage, 500)) : ''}
      ${infoBox([
        { label: 'Exception Type', value: data.exceptionType, isCode: true },
        { label: 'Service', value: data.service, isCode: true },
        { label: 'Language', value: languageLabel },
        { label: 'Organization', value: data.organizationName },
        { label: 'Project', value: data.projectName },
      ])}
      ${data.isNewErrorGroup ? alertBox('This is a <strong>new error</strong> that hasn\'t been seen before.', 'warning') : ''}
      ${cta('View Error Details', errorUrl)}
    `),
    { preheader: `${data.isNewErrorGroup ? 'New ' : ''}${data.exceptionType} in ${data.service}` }
  );

  const text = `
${data.isNewErrorGroup ? 'NEW ' : ''}ERROR: ${data.exceptionType}
${'='.repeat(50)}

${data.exceptionMessage ? `Message: ${truncate(data.exceptionMessage, 300)}` : ''}

DETAILS
-------
Exception Type: ${data.exceptionType}
Service: ${data.service}
Language: ${languageLabel}
Organization: ${data.organizationName}
Project: ${data.projectName}

Occurred: ${formatEmailDate()}

View details: ${errorUrl}

--
Sent by LogTide
Manage notifications: ${frontendUrl}/dashboard/settings/channels
`.trim();

  return { html, text };
}

// ============================================================================
// INCIDENT NOTIFICATION EMAIL
// ============================================================================

export interface IncidentEmailData {
  incidentId: string;
  title: string;
  description?: string | null;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'informational';
  affectedServices?: string[] | null;
  organizationName: string;
}

const severityColors: Record<string, string> = {
  critical: colors.critical,
  high: colors.high,
  medium: colors.medium,
  low: colors.low,
  informational: colors.informational,
};

const severityLabels: Record<string, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  informational: 'Info',
};

export function generateIncidentEmail(data: IncidentEmailData): { html: string; text: string } {
  const frontendUrl = getFrontendUrl();
  const incidentUrl = `${frontendUrl}/dashboard/security/incidents/${data.incidentId}`;
  const severityColor = severityColors[data.severity] || colors.informational;
  const severityLabel = severityLabels[data.severity] || data.severity;

  const html = baseTemplate(
    card(`
      ${header(`Security Incident: ${data.title}`, { text: severityLabel, color: severityColor })}
      ${divider()}
      ${data.description ? subtitle(truncate(data.description, 200)) : ''}
      ${timestamp()}
      ${(data.severity === 'critical' || data.severity === 'high') ?
        alertBox('This incident requires <strong>immediate attention</strong>.', data.severity === 'critical' ? 'error' : 'warning')
        : ''
      }
      ${infoBox([
        { label: 'Incident', value: data.title },
        { label: 'Severity', value: severityLabel },
        { label: 'Organization', value: data.organizationName },
        ...(data.affectedServices?.length ? [{ label: 'Affected Services', value: data.affectedServices.join(', '), isCode: true }] : []),
      ])}
      ${cta('View Incident', incidentUrl)}
    `),
    { preheader: `[${severityLabel}] ${data.title}` }
  );

  const text = `
SECURITY INCIDENT: ${data.title}
${'='.repeat(50)}
Severity: ${severityLabel.toUpperCase()}

${data.description || ''}

DETAILS
-------
Organization: ${data.organizationName}
${data.affectedServices?.length ? `Affected Services: ${data.affectedServices.join(', ')}` : ''}

Detected: ${formatEmailDate()}

View details: ${incidentUrl}

--
Sent by LogTide
Manage notifications: ${frontendUrl}/dashboard/settings/channels
`.trim();

  return { html, text };
}

// ============================================================================
// SIGMA DETECTION EMAIL
// ============================================================================

export interface SigmaDetectionEmailData {
  ruleTitle: string;
  ruleDescription?: string | null;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'informational';
  service: string;
  matchedFields?: Record<string, unknown>;
  organizationName: string;
  detectionId: string;
}

export function generateSigmaDetectionEmail(data: SigmaDetectionEmailData): { html: string; text: string } {
  const frontendUrl = getFrontendUrl();
  const detectionUrl = `${frontendUrl}/dashboard/security`;
  const severityColor = severityColors[data.severity] || colors.informational;
  const severityLabel = severityLabels[data.severity] || data.severity;

  const html = baseTemplate(
    card(`
      ${header(`Detection: ${data.ruleTitle}`, { text: severityLabel, color: severityColor })}
      ${divider()}
      ${data.ruleDescription ? subtitle(truncate(data.ruleDescription, 200)) : ''}
      ${timestamp()}
      ${(data.severity === 'critical' || data.severity === 'high') ?
        alertBox('A Sigma rule has detected potentially <strong>malicious activity</strong>.', data.severity === 'critical' ? 'error' : 'warning')
        : ''
      }
      ${infoBox([
        { label: 'Rule', value: data.ruleTitle },
        { label: 'Severity', value: severityLabel },
        { label: 'Service', value: data.service, isCode: true },
        { label: 'Organization', value: data.organizationName },
      ])}
      ${data.matchedFields && Object.keys(data.matchedFields).length > 0 ?
        codeBlock(JSON.stringify(data.matchedFields, null, 2))
        : ''
      }
      ${cta('View in Security Dashboard', detectionUrl)}
    `),
    { preheader: `[${severityLabel}] Sigma detection: ${data.ruleTitle}` }
  );

  const text = `
SIGMA DETECTION: ${data.ruleTitle}
${'='.repeat(50)}
Severity: ${severityLabel.toUpperCase()}

${data.ruleDescription || ''}

DETAILS
-------
Service: ${data.service}
Organization: ${data.organizationName}
${data.matchedFields ? `Matched: ${JSON.stringify(data.matchedFields)}` : ''}

Detected: ${formatEmailDate()}

View details: ${detectionUrl}

--
Sent by LogTide
Manage notifications: ${frontendUrl}/dashboard/settings/channels
`.trim();

  return { html, text };
}

// ============================================================================
// INVITATION EMAIL
// ============================================================================

export interface InvitationEmailData {
  email: string;
  token: string;
  organizationName: string;
  inviterName: string;
  role: string;
}

const roleLabels: Record<string, string> = {
  owner: 'Owner',
  admin: 'Admin',
  member: 'Member',
};

export function generateInvitationEmail(data: InvitationEmailData): { html: string; text: string } {
  const frontendUrl = getFrontendUrl();
  const inviteUrl = `${frontendUrl}/invite/${data.token}`;
  const roleLabel = roleLabels[data.role] || data.role;

  const html = baseTemplate(
    card(`
      ${header(`Join ${data.organizationName}`, { text: 'Invitation', color: colors.info })}
      ${divider()}
      ${subtitle(`${data.inviterName} has invited you to join their organization on LogTide.`)}
      ${alertBox(`You've been invited as <strong>${roleLabel}</strong>. This invitation expires in 7 days.`, 'info')}
      ${infoBox([
        { label: 'Organization', value: data.organizationName },
        { label: 'Invited By', value: data.inviterName },
        { label: 'Role', value: roleLabel },
        { label: 'Email', value: data.email },
      ])}
      ${cta('Accept Invitation', inviteUrl)}
    `),
    { preheader: `${data.inviterName} invited you to join ${data.organizationName}` }
  );

  const text = `
INVITATION: Join ${data.organizationName}
${'='.repeat(50)}

${data.inviterName} has invited you to join ${data.organizationName} on LogTide as a ${roleLabel}.

DETAILS
-------
Organization: ${data.organizationName}
Invited By: ${data.inviterName}
Role: ${roleLabel}
Email: ${data.email}

This invitation expires in 7 days.

Accept invitation: ${inviteUrl}

--
Sent by LogTide
`.trim();

  return { html, text };
}

// ============================================================================
// MONITOR NOTIFICATION EMAIL
// ============================================================================

export interface MonitorEmailData {
  monitorId: string;
  monitorName: string;
  status: 'down' | 'up';
  severity: 'critical' | 'high' | 'medium' | 'low' | 'informational';
  organizationName: string;
  target?: string | null;
  errorCode?: string | null;
  responseTimeMs?: number | null;
  consecutiveFailures?: number;
  downtimeDuration?: string | null;
}

export function generateMonitorEmail(data: MonitorEmailData): { html: string; text: string } {
  const frontendUrl = getFrontendUrl();
  const monitorUrl = `${frontendUrl}/dashboard/monitoring`;
  const isDown = data.status === 'down';
  const severityLabel = severityLabels[data.severity] || data.severity;

  const statusLabel = isDown ? 'Down' : 'Recovered';
  const statusColor = isDown ? colors.error : colors.success;

  const infoRows: Array<{ label: string; value: string; isCode?: boolean }> = [
    { label: 'Monitor', value: data.monitorName },
    { label: 'Status', value: statusLabel },
    { label: 'Severity', value: severityLabel },
    { label: 'Organization', value: data.organizationName },
  ];

  if (data.target) {
    infoRows.push({ label: 'Target', value: data.target, isCode: true });
  }
  if (isDown && data.errorCode) {
    infoRows.push({ label: 'Error', value: data.errorCode, isCode: true });
  }
  if (data.responseTimeMs !== undefined && data.responseTimeMs !== null) {
    infoRows.push({ label: 'Response Time', value: `${data.responseTimeMs}ms` });
  }
  if (isDown && data.consecutiveFailures) {
    infoRows.push({ label: 'Consecutive Failures', value: String(data.consecutiveFailures) });
  }
  if (!isDown && data.downtimeDuration) {
    infoRows.push({ label: 'Downtime Duration', value: data.downtimeDuration });
  }

  const title = isDown
    ? `Monitor down: ${data.monitorName}`
    : `Monitor recovered: ${data.monitorName}`;

  const html = baseTemplate(
    card(`
      ${header(title, { text: statusLabel, color: statusColor })}
      ${divider()}
      ${timestamp()}
      ${isDown
        ? alertBox(
            `<strong>${escapeHtml(data.monitorName)}</strong> is not responding.${data.errorCode ? ` Error: <strong>${escapeHtml(data.errorCode)}</strong>` : ''}`,
            data.severity === 'critical' ? 'error' : 'warning'
          )
        : alertBox(
            `<strong>${escapeHtml(data.monitorName)}</strong> is back online.${data.downtimeDuration ? ` Downtime: <strong>${escapeHtml(data.downtimeDuration)}</strong>` : ''}`,
            'success'
          )
      }
      ${infoBox(infoRows)}
      ${cta('View Monitor', monitorUrl)}
    `),
    { preheader: `[${statusLabel}] ${data.monitorName}` }
  );

  const text = `
MONITOR ${statusLabel.toUpperCase()}: ${data.monitorName}
${'='.repeat(50)}

${isDown ? `${data.monitorName} is not responding.` : `${data.monitorName} is back online.`}

DETAILS
-------
Organization: ${data.organizationName}
${data.target ? `Target: ${data.target}` : ''}
${isDown && data.errorCode ? `Error: ${data.errorCode}` : ''}
${data.responseTimeMs !== undefined && data.responseTimeMs !== null ? `Response Time: ${data.responseTimeMs}ms` : ''}
${isDown && data.consecutiveFailures ? `Consecutive Failures: ${data.consecutiveFailures}` : ''}
${!isDown && data.downtimeDuration ? `Downtime Duration: ${data.downtimeDuration}` : ''}

Detected: ${formatEmailDate()}

View details: ${monitorUrl}

--
Sent by LogTide
Manage notifications: ${frontendUrl}/dashboard/settings/channels
`.trim();

  return { html, text };
}

// ============================================================================
// DIGEST REPORT EMAIL (#154)
// ============================================================================

/**
 * The email is a pure projection of the generator's report: the section shapes
 * live there and are imported as TYPES ONLY, so nothing of the generator (db,
 * reservoir, nodemailer) is pulled into this module at runtime and the
 * generator -> template import stays a one-way edge.
 */
export type DigestEmailData = DigestReportData & {
  unsubscribeUrl: string;
  dashboardUrl: string;
};

function digestSectionTitle(title: string): string {
  return `<tr>
    <td style="padding: 20px 24px 4px;">
      <h2 style="margin: 0; font-size: 14px; font-weight: 600; color: ${colors.text}; text-transform: uppercase; letter-spacing: 0.5px;">
        ${escapeHtml(title)}
      </h2>
    </td>
  </tr>`;
}

function digestEmptyLine(message: string): string {
  return `<tr>
    <td style="padding: 4px 24px 8px;">
      <p style="margin: 0; font-size: 13px; color: ${colors.textMuted};">${escapeHtml(message)}</p>
    </td>
  </tr>`;
}

function digestTable(headers: string[], rows: string[][]): string {
  const headerCells = headers
    .map(
      (h, i) =>
        `<th align="${i === 0 ? 'left' : 'right'}" style="padding: 6px 8px; font-size: 11px; color: ${colors.textMuted}; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid ${colors.border};">${escapeHtml(h)}</th>`
    )
    .join('');
  const bodyRows = rows
    .map(
      (cells) =>
        `<tr>${cells
          .map(
            (c, i) =>
              `<td align="${i === 0 ? 'left' : 'right'}" style="padding: 6px 8px; font-size: 13px; color: ${colors.text}; border-bottom: 1px solid ${colors.border};">${escapeHtml(c)}</td>`
          )
          .join('')}</tr>`
    )
    .join('');

  return `<tr>
    <td style="padding: 4px 24px 8px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr>${headerCells}</tr>
        ${bodyRows}
      </table>
    </td>
  </tr>`;
}

function formatDelta(delta: number): string {
  if (delta > 0) return `+${delta.toLocaleString('en-US')}`;
  return delta.toLocaleString('en-US');
}

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

/** Human-readable byte size: whole bytes, one decimal from KB up (1.5 GB). */
function formatBytes(bytes: number): string {
  let value = Math.max(0, bytes);
  let unit = 0;

  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }

  const rendered = unit === 0 ? Math.round(value).toLocaleString('en-US') : value.toFixed(1);
  return `${rendered} ${BYTE_UNITS[unit]}`;
}

/**
 * Durations in ms, or a dash when there is nothing to show. Heartbeat monitors
 * record no response time and surface as 0, which means "not timed" and must
 * never be printed as an instant 0ms response.
 */
function formatMs(ms: number | null): string {
  if (ms === null || ms <= 0) return '-';
  return `${ms.toLocaleString('en-US')}ms`;
}

/** Percentages carry at most one decimal and are never fixed-width. */
function formatPct(value: number): string {
  return `${value.toLocaleString('en-US')}%`;
}

/**
 * Inbox preview line. Every part is conditional on its section being present,
 * so a disabled section never shows up as a zero. The logs + detections pair is
 * the original wording and stays byte-identical with the default sections on
 * and no expanded section present; alerts and incidents are appended only when
 * their sections carry data.
 */
function buildPreheader(data: DigestEmailData): string {
  const parts: string[] = [];

  if (data.logVolume) {
    parts.push(`${data.logVolume.current.toLocaleString('en-US')} logs`);
  }

  if (data.security) {
    parts.push(`${data.security.totalDetections.toLocaleString('en-US')} detections`);
  }

  if (data.alerts) {
    parts.push(`${data.alerts.total.toLocaleString('en-US')} alerts`);
  }

  if (data.securityActivity) {
    const opened = data.securityActivity.openedBySeverity.reduce((sum, s) => sum + s.count, 0);
    parts.push(`${opened.toLocaleString('en-US')} incidents`);
  }

  // Every counted section is off: there is no number worth previewing.
  if (parts.length === 0) {
    return `Digest for ${data.organizationName}`;
  }

  return `${parts.join(', ')} for ${data.organizationName}`;
}

export function generateDigestEmail(data: DigestEmailData): { html: string; text: string } {
  const frequencyLabel = data.frequency === 'daily' ? 'Daily' : 'Weekly';
  const title = `${frequencyLabel} Digest`;
  // A period is only quiet when nothing arrived at all: an org that ships no
  // logs but does ship traces is not quiet, so spans veto the message. With the
  // log volume section disabled there is no volume to call quiet at all.
  const quiet =
    !!data.logVolume &&
    data.logVolume.current === 0 &&
    data.logVolume.previous === 0 &&
    (!data.traces || data.traces.spanCount + data.traces.previousSpanCount === 0);

  // --------------------------------------------------------------------------
  // The five original sections. Each carries its own title so a disabled one
  // (undefined) leaves nothing behind; enabled but empty still renders with the
  // zeros and empty-state lines it has always shown.
  // --------------------------------------------------------------------------

  const logVolumeSection = data.logVolume
    ? digestSectionTitle('Log Volume') +
      (quiet
        ? alertBox('No activity during this period. Your systems have been quiet.', 'info')
        : infoBox([
            { label: 'Total Logs', value: data.logVolume.current.toLocaleString('en-US') },
            { label: 'Trend', value: data.logVolume.trend },
            { label: 'Previous Period', value: data.logVolume.previous.toLocaleString('en-US') },
          ]))
    : '';

  const topServicesSection = data.topErrorServices
    ? digestSectionTitle('Top Services by Errors') +
      (data.topErrorServices.length > 0
        ? digestTable(
            ['Service', 'Errors', 'Previous', 'Delta'],
            data.topErrorServices.map((s) => [
              s.service,
              s.errorCount.toLocaleString('en-US'),
              s.previousCount.toLocaleString('en-US'),
              formatDelta(s.delta),
            ])
          )
        : digestEmptyLine('No errors recorded in this period.'))
    : '';

  const errorGroupsSection = data.newErrorGroups
    ? digestSectionTitle('New Error Groups') +
      (data.newErrorGroups.length > 0
        ? digestTable(
            ['Error', 'Language', 'Occurrences'],
            data.newErrorGroups.map((g) => [
              `${g.exceptionType}${g.exceptionMessage ? ': ' + truncate(g.exceptionMessage, 60) : ''}`,
              g.language,
              g.occurrenceCount.toLocaleString('en-US'),
            ])
          )
        : digestEmptyLine('No new error groups appeared in this period.'))
    : '';

  const securitySection = data.security
    ? digestSectionTitle('Security') +
      infoBox([
        { label: 'Detections', value: data.security.totalDetections.toLocaleString('en-US') },
        { label: 'Open Incidents', value: data.security.openIncidents.toLocaleString('en-US') },
      ]) +
      (data.security.topRules.length > 0
        ? digestTable(
            ['Rule', 'Severity', 'Detections'],
            data.security.topRules.map((r) => [
              r.ruleTitle,
              r.severity,
              r.count.toLocaleString('en-US'),
            ])
          )
        : '')
    : '';

  const uptimeSection = data.uptime
    ? digestSectionTitle('Uptime') +
      infoBox([
        { label: 'Overall', value: `${data.uptime.overallUptimePct.toLocaleString('en-US')}%` },
        { label: 'Monitors', value: data.uptime.monitorCount.toLocaleString('en-US') },
      ]) +
      (data.uptime.worstMonitors.length > 0
        ? digestTable(
            ['Monitor', 'Uptime'],
            data.uptime.worstMonitors.map((m) => [m.name, `${m.uptimePct.toLocaleString('en-US')}%`])
          )
        : '')
    : '';

  // --------------------------------------------------------------------------
  // Expanded sections. Each one is undefined when disabled OR empty, and then
  // renders nothing at all: no title, no empty-state line.
  // (digestEmptyLine doubles as the muted one-liner for short section notes.)
  // --------------------------------------------------------------------------

  const logBreakdownSection = data.logBreakdown
    ? digestSectionTitle('Log Breakdown') +
      digestTable(
        ['Level', 'Logs', 'Previous'],
        data.logBreakdown.levels.map((l) => [
          l.level,
          l.current.toLocaleString('en-US'),
          l.previous.toLocaleString('en-US'),
        ])
      ) +
      infoBox([
        { label: 'Error Rate', value: formatPct(data.logBreakdown.errorRatePct) },
        { label: 'Previous Error Rate', value: formatPct(data.logBreakdown.previousErrorRatePct) },
      ]) +
      (data.logBreakdown.daily?.length
        ? digestTable(
            ['Day', 'Logs'],
            data.logBreakdown.daily.map((d) => [d.date, d.count.toLocaleString('en-US')])
          )
        : '')
    : '';

  const topErrorMessagesSection = data.topErrorMessages
    ? digestSectionTitle('Top Error Messages') +
      digestTable(
        ['Message', 'Count'],
        data.topErrorMessages.map((m) => [
          truncate(m.message, 120),
          m.count.toLocaleString('en-US'),
        ])
      )
    : '';

  const tracesSection = data.traces
    ? digestSectionTitle('Traces') +
      infoBox([
        { label: 'Spans', value: data.traces.spanCount.toLocaleString('en-US') },
        { label: 'Span Trend', value: data.traces.trend },
        { label: 'Previous Period', value: data.traces.previousSpanCount.toLocaleString('en-US') },
        { label: 'Error Spans', value: data.traces.errorSpanCount.toLocaleString('en-US') },
      ]) +
      (data.traces.services.length > 0
        ? digestEmptyLine(
            'Top services by calls. p95 is the worst project value, not a merged percentile.'
          ) +
          digestTable(
            ['Service', 'Calls', 'Error Rate', 'p95 (worst)'],
            data.traces.services.map((s) => [
              s.service,
              s.calls.toLocaleString('en-US'),
              formatPct(s.errorRatePct),
              formatMs(s.p95Ms),
            ])
          )
        : '') +
      (data.traces.slowestSpans.length > 0
        ? digestEmptyLine('Slowest spans in the period.') +
          digestTable(
            ['Operation', 'Service', 'Duration'],
            data.traces.slowestSpans.map((s) => [
              s.operation,
              s.service,
              formatMs(s.durationMs),
            ])
          )
        : '')
    : '';

  const metricsSection = data.metrics
    ? digestSectionTitle('Metrics') +
      infoBox([
        { label: 'Datapoints', value: data.metrics.datapoints.toLocaleString('en-US') },
        { label: 'Datapoint Trend', value: data.metrics.trend },
        {
          label: 'Previous Period',
          value: data.metrics.previousDatapoints.toLocaleString('en-US'),
        },
      ])
    : '';

  const alertsSection = data.alerts
    ? digestSectionTitle('Alerts') +
      infoBox([
        { label: 'Triggers', value: data.alerts.total.toLocaleString('en-US') },
        { label: 'Alert Trend', value: data.alerts.trend },
        { label: 'Previous Period', value: data.alerts.previousTotal.toLocaleString('en-US') },
      ]) +
      // Nothing fired this period but something fired in the previous one: the
      // totals still matter, the (empty) ranking does not.
      (data.alerts.topRules.length > 0
        ? digestTable(
            ['Rule', 'Triggers'],
            data.alerts.topRules.map((r) => [r.name, r.count.toLocaleString('en-US')])
          )
        : '')
    : '';

  const incidentsOpened = data.securityActivity
    ? data.securityActivity.openedBySeverity.reduce((sum, s) => sum + s.count, 0)
    : 0;

  const securityActivitySection = data.securityActivity
    ? digestSectionTitle('Security Activity') +
      infoBox([
        { label: 'Incidents Opened', value: incidentsOpened.toLocaleString('en-US') },
        {
          label: 'Incidents Resolved',
          value: data.securityActivity.resolvedCount.toLocaleString('en-US'),
        },
      ]) +
      (data.securityActivity.openedBySeverity.length > 0
        ? digestTable(
            ['Severity', 'Opened'],
            data.securityActivity.openedBySeverity.map((s) => [
              s.severity,
              s.count.toLocaleString('en-US'),
            ])
          )
        : '') +
      (data.securityActivity.topTechniques.length > 0
        ? digestTable(
            ['MITRE Technique', 'Detections'],
            data.securityActivity.topTechniques.map((t) => [
              t.technique,
              t.count.toLocaleString('en-US'),
            ])
          )
        : '')
    : '';

  const monitorPerformanceSection = data.monitorPerformance
    ? digestSectionTitle('Monitor Performance') +
      digestEmptyLine('Monitors without response timing (heartbeats) show a dash.') +
      digestTable(
        ['Monitor', 'Avg', 'p95', 'Failed'],
        data.monitorPerformance.map((m) => [
          m.name,
          formatMs(m.avgMs),
          formatMs(m.p95Ms),
          m.failedChecks.toLocaleString('en-US'),
        ])
      )
    : '';

  const usageSection = data.usage
    ? digestSectionTitle('Usage') +
      infoBox([
        { label: 'Log Events', value: data.usage.logEvents.toLocaleString('en-US') },
        { label: 'Log Volume', value: formatBytes(data.usage.logBytes) },
        { label: 'Spans', value: data.usage.spans.toLocaleString('en-US') },
      ]) +
      (data.usage.topProjects.length > 0
        ? digestTable(
            ['Project', 'Events'],
            data.usage.topProjects.map((p) => [p.name, p.events.toLocaleString('en-US')])
          )
        : '') +
      // Quota windows are month-to-date, not period-scoped: say so.
      (data.usage.quotaWarnings.length > 0
        ? alertBox(
            `Month-to-date usage above 80% of limit: ${data.usage.quotaWarnings
              .map((w) => `<strong>${escapeHtml(w.capability)}</strong> ${w.usedPct}%`)
              .join(', ')}`,
            'warning'
          )
        : '')
    : '';

  const webhooksSection = data.webhooks
    ? digestSectionTitle('Webhooks') +
      infoBox([
        { label: 'Delivered', value: data.webhooks.delivered.toLocaleString('en-US') },
        { label: 'Failed', value: data.webhooks.failed.toLocaleString('en-US') },
        { label: 'Dead', value: data.webhooks.dead.toLocaleString('en-US') },
      ]) +
      (data.webhooks.dead > 0
        ? alertBox(
            `<strong>${data.webhooks.dead.toLocaleString('en-US')}</strong> deliver${data.webhooks.dead === 1 ? 'y' : 'ies'} reached the dead-letter queue and need attention.`,
            'warning'
          )
        : '')
    : '';

  const teamActivitySection = data.teamActivity
    ? digestSectionTitle('Team Activity') +
      infoBox([
        { label: 'Members Added', value: data.teamActivity.membersAdded.toLocaleString('en-US') },
        {
          label: 'Members Removed',
          value: data.teamActivity.membersRemoved.toLocaleString('en-US'),
        },
        { label: 'Config Changes', value: data.teamActivity.configChanges.toLocaleString('en-US') },
        { label: 'Failed Logins', value: data.teamActivity.failedLogins.toLocaleString('en-US') },
      ])
    : '';

  const html = baseTemplate(
    card(`
      ${header(title, { text: data.frequency, color: colors.info })}
      ${divider()}
      ${subtitle(`${data.organizationName} - ${data.periodLabel}`)}
      ${timestamp()}
      ${logVolumeSection}
      ${logBreakdownSection}
      ${topServicesSection}
      ${topErrorMessagesSection}
      ${errorGroupsSection}
      ${tracesSection}
      ${metricsSection}
      ${alertsSection}
      ${securitySection}
      ${securityActivitySection}
      ${uptimeSection}
      ${monitorPerformanceSection}
      ${usageSection}
      ${webhooksSection}
      ${teamActivitySection}
      ${cta('View Dashboard', data.dashboardUrl)}
    `),
    {
      preheader: quiet ? `Quiet period for ${data.organizationName}` : buildPreheader(data),
      unsubscribeUrl: data.unsubscribeUrl,
    }
  );

  const lines: string[] = [];
  // Same shape as before: a blank line, the heading, then a rule of its length.
  const heading = (text: string): void => {
    lines.push('');
    lines.push(text);
    lines.push('-'.repeat(text.length));
  };

  lines.push(`LogTide ${frequencyLabel} Digest`);
  lines.push(`Organization: ${data.organizationName}`);
  lines.push(`Period: ${data.periodLabel}`);
  lines.push('');
  lines.push('='.repeat(50));
  if (data.logVolume) {
    heading('LOG VOLUME');
    if (quiet) {
      lines.push('No activity during this period.');
      lines.push('Your systems have been quiet.');
    } else {
      lines.push(`Total logs: ${data.logVolume.current.toLocaleString('en-US')}`);
      lines.push(`Trend: ${data.logVolume.trend}`);
      lines.push(`Previous period: ${data.logVolume.previous.toLocaleString('en-US')}`);
    }
  }
  if (data.logBreakdown) {
    heading('LOG BREAKDOWN');
    for (const l of data.logBreakdown.levels) {
      lines.push(
        `${l.level}: ${l.current.toLocaleString('en-US')} (previous: ${l.previous.toLocaleString('en-US')})`
      );
    }
    lines.push(
      `Error rate: ${formatPct(data.logBreakdown.errorRatePct)} (previous: ${formatPct(data.logBreakdown.previousErrorRatePct)})`
    );
    if (data.logBreakdown.daily?.length) {
      lines.push('Per day:');
      for (const d of data.logBreakdown.daily) {
        lines.push(`${d.date}: ${d.count.toLocaleString('en-US')}`);
      }
    }
  }
  if (data.topErrorServices) {
    heading('TOP SERVICES BY ERRORS');
    if (data.topErrorServices.length > 0) {
      for (const s of data.topErrorServices) {
        lines.push(
          `${s.service}: ${s.errorCount.toLocaleString('en-US')} errors (previous: ${s.previousCount.toLocaleString('en-US')}, delta: ${formatDelta(s.delta)})`
        );
      }
    } else {
      lines.push('No errors recorded in this period.');
    }
  }
  if (data.topErrorMessages) {
    heading('TOP ERROR MESSAGES');
    for (const m of data.topErrorMessages) {
      lines.push(`${truncate(m.message, 120)}: ${m.count.toLocaleString('en-US')}`);
    }
  }
  if (data.newErrorGroups) {
    heading('NEW ERROR GROUPS');
    if (data.newErrorGroups.length > 0) {
      for (const g of data.newErrorGroups) {
        const message = g.exceptionMessage ? `: ${truncate(g.exceptionMessage, 80)}` : '';
        lines.push(`${g.exceptionType}${message} (${g.language}, ${g.occurrenceCount.toLocaleString('en-US')} occurrences)`);
      }
    } else {
      lines.push('No new error groups appeared in this period.');
    }
  }
  if (data.traces) {
    heading('TRACES');
    lines.push(`Spans: ${data.traces.spanCount.toLocaleString('en-US')}`);
    lines.push(`Span trend: ${data.traces.trend}`);
    lines.push(`Previous spans: ${data.traces.previousSpanCount.toLocaleString('en-US')}`);
    lines.push(`Error spans: ${data.traces.errorSpanCount.toLocaleString('en-US')}`);
    if (data.traces.services.length > 0) {
      lines.push('Top services by calls (p95 is the worst project value):');
      for (const s of data.traces.services) {
        lines.push(
          `${s.service}: ${s.calls.toLocaleString('en-US')} calls, ${formatPct(s.errorRatePct)} errors, p95 ${formatMs(s.p95Ms)}`
        );
      }
    }
    if (data.traces.slowestSpans.length > 0) {
      lines.push('Slowest spans:');
      for (const s of data.traces.slowestSpans) {
        lines.push(`${s.operation} (${s.service}): ${formatMs(s.durationMs)}`);
      }
    }
  }
  if (data.metrics) {
    heading('METRICS');
    lines.push(`Datapoints: ${data.metrics.datapoints.toLocaleString('en-US')}`);
    lines.push(`Datapoint trend: ${data.metrics.trend}`);
    lines.push(`Previous datapoints: ${data.metrics.previousDatapoints.toLocaleString('en-US')}`);
  }
  if (data.alerts) {
    heading('ALERTS');
    lines.push(`Triggers: ${data.alerts.total.toLocaleString('en-US')}`);
    lines.push(`Alert trend: ${data.alerts.trend}`);
    lines.push(`Previous triggers: ${data.alerts.previousTotal.toLocaleString('en-US')}`);
    for (const r of data.alerts.topRules) {
      lines.push(`${r.name}: ${r.count.toLocaleString('en-US')} triggers`);
    }
  }
  if (data.security) {
    heading('SECURITY');
    lines.push(`Detections: ${data.security.totalDetections.toLocaleString('en-US')}`);
    lines.push(`Open incidents: ${data.security.openIncidents.toLocaleString('en-US')}`);
    for (const r of data.security.topRules) {
      lines.push(`${r.ruleTitle} [${r.severity}]: ${r.count.toLocaleString('en-US')} detections`);
    }
  }
  if (data.securityActivity) {
    heading('SECURITY ACTIVITY');
    lines.push(`Incidents opened: ${incidentsOpened.toLocaleString('en-US')}`);
    lines.push(
      `Incidents resolved: ${data.securityActivity.resolvedCount.toLocaleString('en-US')}`
    );
    if (data.securityActivity.openedBySeverity.length > 0) {
      lines.push('Opened by severity:');
      for (const s of data.securityActivity.openedBySeverity) {
        lines.push(`${s.severity}: ${s.count.toLocaleString('en-US')}`);
      }
    }
    if (data.securityActivity.topTechniques.length > 0) {
      lines.push('Top MITRE techniques:');
      for (const t of data.securityActivity.topTechniques) {
        lines.push(`${t.technique}: ${t.count.toLocaleString('en-US')}`);
      }
    }
  }
  if (data.uptime) {
    heading('UPTIME');
    lines.push(`Overall: ${data.uptime.overallUptimePct.toLocaleString('en-US')}% across ${data.uptime.monitorCount.toLocaleString('en-US')} monitor(s)`);
    for (const m of data.uptime.worstMonitors) {
      lines.push(`${m.name}: ${m.uptimePct.toLocaleString('en-US')}%`);
    }
  }
  if (data.monitorPerformance) {
    heading('MONITOR PERFORMANCE');
    lines.push('Monitors without response timing (heartbeats) show a dash.');
    for (const m of data.monitorPerformance) {
      lines.push(
        `${m.name}: avg ${formatMs(m.avgMs)}, p95 ${formatMs(m.p95Ms)}, ${m.failedChecks.toLocaleString('en-US')} failed checks`
      );
    }
  }
  if (data.usage) {
    heading('USAGE');
    lines.push(`Log events: ${data.usage.logEvents.toLocaleString('en-US')}`);
    lines.push(`Log volume: ${formatBytes(data.usage.logBytes)}`);
    lines.push(`Spans: ${data.usage.spans.toLocaleString('en-US')}`);
    if (data.usage.topProjects.length > 0) {
      lines.push('Top projects:');
      for (const p of data.usage.topProjects) {
        lines.push(`${p.name}: ${p.events.toLocaleString('en-US')} events`);
      }
    }
    if (data.usage.quotaWarnings.length > 0) {
      lines.push('Month-to-date usage above 80% of limit:');
      for (const w of data.usage.quotaWarnings) {
        lines.push(`${w.capability}: ${w.usedPct}%`);
      }
    }
  }
  if (data.webhooks) {
    heading('WEBHOOKS');
    lines.push(`Delivered: ${data.webhooks.delivered.toLocaleString('en-US')}`);
    lines.push(`Failed: ${data.webhooks.failed.toLocaleString('en-US')}`);
    lines.push(`Dead: ${data.webhooks.dead.toLocaleString('en-US')}`);
    if (data.webhooks.dead > 0) {
      lines.push('Dead-lettered deliveries need attention.');
    }
  }
  if (data.teamActivity) {
    heading('TEAM ACTIVITY');
    lines.push(`Members added: ${data.teamActivity.membersAdded.toLocaleString('en-US')}`);
    lines.push(`Members removed: ${data.teamActivity.membersRemoved.toLocaleString('en-US')}`);
    lines.push(`Config changes: ${data.teamActivity.configChanges.toLocaleString('en-US')}`);
    lines.push(`Failed logins: ${data.teamActivity.failedLogins.toLocaleString('en-US')}`);
  }
  lines.push('');
  lines.push(`View your dashboard: ${data.dashboardUrl}`);
  lines.push('');
  lines.push('To unsubscribe from these reports, click:');
  lines.push(data.unsubscribeUrl);
  lines.push('');
  lines.push('--');
  lines.push('Sent by LogTide');

  return { html, text: lines.join('\n') };
}

