/**
 * Centralized Email Templates
 *
 * All email templates use inline styles for maximum compatibility with email clients.
 * Gmail, Outlook, Apple Mail, etc. all have different CSS support.
 */

import { config } from '../config/index.js';
import { getLogoUrl } from './logo.js';

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

export interface DigestEmailData {
  organizationName: string;
  frequency: 'daily' | 'weekly';
  periodLabel: string;
  logVolume: {
    current: number;
    previous: number;
    trend: string;
  };
  topErrorServices: Array<{
    service: string;
    errorCount: number;
    previousCount: number;
    delta: number;
  }>;
  newErrorGroups: Array<{
    exceptionType: string;
    exceptionMessage: string;
    occurrenceCount: number;
    language: string;
  }>;
  security: {
    totalDetections: number;
    topRules: Array<{ ruleTitle: string; severity: string; count: number }>;
    openIncidents: number;
  };
  uptime: {
    monitorCount: number;
    overallUptimePct: number;
    worstMonitors: Array<{ name: string; uptimePct: number }>;
  } | null;
  unsubscribeUrl: string;
  dashboardUrl: string;
}

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

export function generateDigestEmail(data: DigestEmailData): { html: string; text: string } {
  const frequencyLabel = data.frequency === 'daily' ? 'Daily' : 'Weekly';
  const title = `${frequencyLabel} Digest`;
  const quiet = data.logVolume.current === 0 && data.logVolume.previous === 0;

  const logVolumeSection = quiet
    ? alertBox('No activity during this period. Your systems have been quiet.', 'info')
    : infoBox([
        { label: 'Total Logs', value: data.logVolume.current.toLocaleString('en-US') },
        { label: 'Trend', value: data.logVolume.trend },
        { label: 'Previous Period', value: data.logVolume.previous.toLocaleString('en-US') },
      ]);

  const topServicesSection =
    data.topErrorServices.length > 0
      ? digestTable(
          ['Service', 'Errors', 'Previous', 'Delta'],
          data.topErrorServices.map((s) => [
            s.service,
            s.errorCount.toLocaleString('en-US'),
            s.previousCount.toLocaleString('en-US'),
            formatDelta(s.delta),
          ])
        )
      : digestEmptyLine('No errors recorded in this period.');

  const errorGroupsSection =
    data.newErrorGroups.length > 0
      ? digestTable(
          ['Error', 'Language', 'Occurrences'],
          data.newErrorGroups.map((g) => [
            `${g.exceptionType}${g.exceptionMessage ? ': ' + truncate(g.exceptionMessage, 60) : ''}`,
            g.language,
            g.occurrenceCount.toLocaleString('en-US'),
          ])
        )
      : digestEmptyLine('No new error groups appeared in this period.');

  const securityRows = [
    { label: 'Detections', value: data.security.totalDetections.toLocaleString('en-US') },
    { label: 'Open Incidents', value: data.security.openIncidents.toLocaleString('en-US') },
  ];
  const securitySection =
    data.security.topRules.length > 0
      ? infoBox(securityRows) +
        digestTable(
          ['Rule', 'Severity', 'Detections'],
          data.security.topRules.map((r) => [r.ruleTitle, r.severity, r.count.toLocaleString('en-US')])
        )
      : infoBox(securityRows);

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

  const html = baseTemplate(
    card(`
      ${header(title, { text: data.frequency, color: colors.info })}
      ${divider()}
      ${subtitle(`${data.organizationName} - ${data.periodLabel}`)}
      ${timestamp()}
      ${digestSectionTitle('Log Volume')}
      ${logVolumeSection}
      ${digestSectionTitle('Top Services by Errors')}
      ${topServicesSection}
      ${digestSectionTitle('New Error Groups')}
      ${errorGroupsSection}
      ${digestSectionTitle('Security')}
      ${securitySection}
      ${uptimeSection}
      ${cta('View Dashboard', data.dashboardUrl)}
    `),
    {
      preheader: quiet
        ? `Quiet period for ${data.organizationName}`
        : `${data.logVolume.current.toLocaleString('en-US')} logs, ${data.security.totalDetections.toLocaleString('en-US')} detections for ${data.organizationName}`,
      unsubscribeUrl: data.unsubscribeUrl,
    }
  );

  const lines: string[] = [];
  lines.push(`LogTide ${frequencyLabel} Digest`);
  lines.push(`Organization: ${data.organizationName}`);
  lines.push(`Period: ${data.periodLabel}`);
  lines.push('');
  lines.push('='.repeat(50));
  lines.push('');
  lines.push('LOG VOLUME');
  lines.push('-'.repeat(10));
  if (quiet) {
    lines.push('No activity during this period.');
    lines.push('Your systems have been quiet.');
  } else {
    lines.push(`Total logs: ${data.logVolume.current.toLocaleString('en-US')}`);
    lines.push(`Trend: ${data.logVolume.trend}`);
    lines.push(`Previous period: ${data.logVolume.previous.toLocaleString('en-US')}`);
  }
  lines.push('');
  lines.push('TOP SERVICES BY ERRORS');
  lines.push('-'.repeat(22));
  if (data.topErrorServices.length > 0) {
    for (const s of data.topErrorServices) {
      lines.push(
        `${s.service}: ${s.errorCount.toLocaleString('en-US')} errors (previous: ${s.previousCount.toLocaleString('en-US')}, delta: ${formatDelta(s.delta)})`
      );
    }
  } else {
    lines.push('No errors recorded in this period.');
  }
  lines.push('');
  lines.push('NEW ERROR GROUPS');
  lines.push('-'.repeat(16));
  if (data.newErrorGroups.length > 0) {
    for (const g of data.newErrorGroups) {
      const message = g.exceptionMessage ? `: ${truncate(g.exceptionMessage, 80)}` : '';
      lines.push(`${g.exceptionType}${message} (${g.language}, ${g.occurrenceCount.toLocaleString('en-US')} occurrences)`);
    }
  } else {
    lines.push('No new error groups appeared in this period.');
  }
  lines.push('');
  lines.push('SECURITY');
  lines.push('-'.repeat(8));
  lines.push(`Detections: ${data.security.totalDetections.toLocaleString('en-US')}`);
  lines.push(`Open incidents: ${data.security.openIncidents.toLocaleString('en-US')}`);
  for (const r of data.security.topRules) {
    lines.push(`${r.ruleTitle} [${r.severity}]: ${r.count.toLocaleString('en-US')} detections`);
  }
  if (data.uptime) {
    lines.push('');
    lines.push('UPTIME');
    lines.push('-'.repeat(6));
    lines.push(`Overall: ${data.uptime.overallUptimePct.toLocaleString('en-US')}% across ${data.uptime.monitorCount.toLocaleString('en-US')} monitor(s)`);
    for (const m of data.uptime.worstMonitors) {
      lines.push(`${m.name}: ${m.uptimePct.toLocaleString('en-US')}%`);
    }
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

