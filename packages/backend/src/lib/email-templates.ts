/**
 * Centralized Email Templates
 *
 * All email templates use inline styles for maximum compatibility with email clients.
 * Gmail, Outlook, Apple Mail, etc. all have different CSS support.
 */

import type { DigestReportData } from '../modules/digests/generator.js';

// ============================================================================
// HELPERS
// ============================================================================

export { getFrontendUrl, formatEmailDate, escapeHtml, truncate } from './email/util.js';
import { getFrontendUrl, formatEmailDate, truncate } from './email/util.js';
import { renderEmail } from './email/layout.js';
import * as ui from './email/components.js';
import { severityTone } from './email/tokens.js';

/** The mono label next to the logo: organization, and project when there is one. */
function emailContext(organizationName?: string | null, projectName?: string | null): string | undefined {
  if (!organizationName) return projectName ?? undefined;
  return projectName ? `${organizationName} / ${projectName}` : organizationName;
}

/** Filters of an alert rule as log-style key=value lines. */
function alertRows(data: { service?: string | null; levels?: string[] }): Array<{ key: string; value: string }> {
  return [
    ...(data.service ? [{ key: 'service', value: data.service }] : []),
    ...(data.levels?.length ? [{ key: 'levels', value: data.levels.join(',') }] : []),
  ];
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

    const html = renderEmail({
      title: `Anomaly: ${data.ruleName}`,
      preheader: `${bm.deviation_ratio}x above baseline`,
      context: emailContext(data.organizationName, data.projectName),
      body:
        ui.pill('Anomaly', 'warning') +
        ui.title(data.ruleName) +
        ui.bigNumber(
          `${bm.deviation_ratio}x`,
          `above normal: current ${Math.round(bm.current_value).toLocaleString('en-US')} logs/hr, baseline ${Math.round(bm.baseline_value).toLocaleString('en-US')} logs/hr (${baselineLabel})`,
          'warning'
        ) +
        ui.logBlock(alertRows(data)) +
        ui.button('View alert history', dashboardUrl),
      footer: { kind: 'notifications' },
    });

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
Manage notifications: ${frontendUrl}/dashboard/settings/notifications/destinations
`.trim();

    return { html, text };
  }

  // Standard threshold alert email
  const html = renderEmail({
    title: `Alert: ${data.ruleName}`,
    preheader: `${data.logCount} logs exceeded threshold of ${data.threshold}`,
    context: emailContext(data.organizationName, data.projectName),
    body:
      ui.pill('Alert triggered', 'error') +
      ui.title(data.ruleName) +
      ui.bigNumber(
        data.logCount.toLocaleString('en-US'),
        `logs matched in the last ${data.timeWindow} minute${data.timeWindow === 1 ? '' : 's'}`,
        'error'
      ) +
      ui.meter({ value: data.logCount, threshold: data.threshold, label: `threshold ${data.threshold.toLocaleString('en-US')}` }) +
      ui.logBlock(alertRows(data)) +
      ui.button('View alert history', dashboardUrl),
    footer: { kind: 'notifications' },
  });

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
Manage notifications: ${frontendUrl}/dashboard/settings/notifications/destinations
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
  /** A previously resolved error group recurred. */
  isRegression?: boolean;
  /** An ignored error group reopened because its ignore limit was reached. */
  isEscalating?: boolean;
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

  const state = data.isRegression
    ? { label: 'Regression', tone: 'warning' as const, note: 'This error was resolved and is now a regression: it has occurred again.' }
    : data.isEscalating
      ? { label: 'Escalating', tone: 'warning' as const, note: 'This error was ignored and is now escalating: its ignore limit was reached.' }
      : data.isNewErrorGroup
        ? { label: 'New error', tone: 'error' as const, note: 'This error has not been seen before.' }
        : { label: 'Error', tone: 'error' as const, note: null };
  const html = renderEmail({
    title,
    preheader: `${data.isNewErrorGroup ? 'New ' : ''}${data.exceptionType} in ${data.service}`,
    context: emailContext(data.organizationName, data.projectName),
    body:
      ui.pill(state.label, state.tone) +
      ui.title(data.exceptionType) +
      (state.note ? ui.paragraph(state.note) : '') +
      (data.exceptionMessage ? ui.codeBlock(truncate(data.exceptionMessage, 500)) : '') +
      ui.logBlock([
        { key: 'service', value: data.service },
        { key: 'language', value: languageLabel },
      ]) +
      ui.button('View error details', errorUrl),
    footer: { kind: 'notifications' },
  });

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

${data.isRegression ? 'REGRESSION: this error was resolved and has occurred again.\n\n' : ''}${data.isEscalating ? 'ESCALATING: this error was ignored and its ignore limit was reached.\n\n' : ''}Occurred: ${formatEmailDate()}

View details: ${errorUrl}

--
Sent by LogTide
Manage notifications: ${frontendUrl}/dashboard/settings/notifications/destinations
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

const severityLabels: Record<string, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  informational: 'Info',
};

export function generateIncidentEmail(data: IncidentEmailData): { html: string; text: string } {
  const frontendUrl = getFrontendUrl();
  const incidentUrl = `${frontendUrl}/dashboard/incidents/${data.incidentId}`;
  const severityLabel = severityLabels[data.severity] || data.severity;

  const html = renderEmail({
    title: `Security incident: ${data.title}`,
    preheader: `[${severityLabel}] ${data.title}`,
    context: data.organizationName,
    body:
      ui.pill(severityLabel, severityTone(data.severity)) +
      ui.title(data.title) +
      (data.description ? ui.paragraph(truncate(data.description, 500)) : '') +
      (data.severity === 'critical' || data.severity === 'high'
        ? ui.notice('This incident requires immediate attention.', data.severity === 'critical' ? 'critical' : 'error')
        : '') +
      ui.logBlock(data.affectedServices?.length ? [{ key: 'services', value: data.affectedServices.join(', ') }] : []) +
      ui.button('View incident', incidentUrl),
    footer: { kind: 'notifications' },
  });

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
Manage notifications: ${frontendUrl}/dashboard/settings/notifications/destinations
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
  /** Incident the detection opened or joined; the call to action links here when set. */
  incidentId?: string | null;
  /** Sigma rule id; the call to action falls back to the rule page without an incident. */
  ruleId?: string | null;
}

export function generateSigmaDetectionEmail(data: SigmaDetectionEmailData): { html: string; text: string } {
  const frontendUrl = getFrontendUrl();
  const detectionUrl = data.incidentId
    ? `${frontendUrl}/dashboard/incidents/${data.incidentId}`
    : data.ruleId
      ? `${frontendUrl}/dashboard/security/rules/${data.ruleId}`
      : `${frontendUrl}/dashboard/security`;
  const ctaLabel = data.incidentId ? 'View incident' : data.ruleId ? 'View rule' : 'View in Security Dashboard';
  const severityLabel = severityLabels[data.severity] || data.severity;

  const html = renderEmail({
    title: `Detection: ${data.ruleTitle}`,
    preheader: `[${severityLabel}] Sigma detection: ${data.ruleTitle}`,
    context: data.organizationName,
    body:
      ui.pill(severityLabel, severityTone(data.severity)) +
      ui.title(data.ruleTitle) +
      (data.ruleDescription ? ui.paragraph(truncate(data.ruleDescription, 500)) : '') +
      (data.severity === 'critical' || data.severity === 'high'
        ? ui.notice(
            'A Sigma rule has detected potentially malicious activity.',
            data.severity === 'critical' ? 'critical' : 'error'
          )
        : '') +
      ui.logBlock([{ key: 'service', value: data.service }]) +
      (data.matchedFields && Object.keys(data.matchedFields).length > 0
        ? ui.codeBlock(JSON.stringify(data.matchedFields, null, 2))
        : '') +
      ui.button(ctaLabel, detectionUrl),
    footer: { kind: 'notifications' },
  });

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
Manage notifications: ${frontendUrl}/dashboard/settings/notifications/destinations
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

  const html = renderEmail({
    title: `Join ${data.organizationName}`,
    preheader: `${data.inviterName} invited you to join ${data.organizationName}`,
    body:
      ui.title(`Join ${data.organizationName}`) +
      ui.paragraph(`${data.inviterName} has invited you to join ${data.organizationName} on LogTide as ${roleLabel}.`) +
      ui.logBlock([
        { key: 'organization', value: data.organizationName },
        { key: 'role', value: roleLabel },
        { key: 'email', value: data.email },
      ]) +
      ui.button('Accept invitation', inviteUrl) +
      ui.linkFallback(inviteUrl) +
      ui.paragraph('This invitation expires in 7 days.'),
    footer: { kind: 'account' },
  });

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
// EMAIL VERIFICATION
// ============================================================================

export interface EmailVerificationEmailData {
  name: string;
  token: string;
}

export function generateEmailVerificationEmail(data: EmailVerificationEmailData): { html: string; text: string } {
  const frontendUrl = getFrontendUrl();
  const verifyUrl = `${frontendUrl}/verify-email?token=${encodeURIComponent(data.token)}`;

  const html = renderEmail({
    title: 'Verify your email',
    preheader: 'Confirm your email address for LogTide',
    body:
      ui.title('Verify your email') +
      ui.paragraph(`Hi ${data.name}, confirm your email address to finish setting up your LogTide account.`) +
      ui.button('Verify email', verifyUrl) +
      ui.linkFallback(verifyUrl) +
      ui.paragraph('This link expires in 24 hours and can be used once. If you did not create a LogTide account, you can ignore this email.'),
    footer: { kind: 'account' },
  });

  const text = `
VERIFY YOUR EMAIL
${'='.repeat(50)}

Hi ${data.name}, confirm your email address to finish setting up your LogTide account.

Verify email: ${verifyUrl}

This link expires in 24 hours and can be used once. If you did not create a
LogTide account, you can ignore this email.

--
Sent by LogTide
`.trim();

  return { html, text };
}

// ============================================================================
// PASSWORD RESET
// ============================================================================

export interface PasswordResetEmailData {
  name: string;
  token: string;
}

export function generatePasswordResetEmail(data: PasswordResetEmailData): { html: string; text: string } {
  const frontendUrl = getFrontendUrl();
  const resetUrl = `${frontendUrl}/reset-password?token=${encodeURIComponent(data.token)}`;

  const html = renderEmail({
    title: 'Reset your password',
    preheader: 'Reset your LogTide password',
    body:
      ui.title('Reset your password') +
      ui.paragraph(`Hi ${data.name}, we received a request to reset the password of your LogTide account.`) +
      ui.button('Reset password', resetUrl) +
      ui.linkFallback(resetUrl) +
      ui.paragraph('This link expires in 1 hour and can be used once. If you did not ask for this, you can ignore this email and your password stays the same.'),
    footer: { kind: 'account' },
  });

  const text = `
RESET YOUR PASSWORD
${'='.repeat(50)}

Hi ${data.name}, we received a request to reset the password of your LogTide account.

Reset password: ${resetUrl}

This link expires in 1 hour and can be used once. If you did not ask for a
password reset, you can ignore this email and your password stays the same.

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
  /** Shared incident opened for this outage; the email deep links to it when set. */
  incidentId?: string | null;
}

export function generateMonitorEmail(data: MonitorEmailData): { html: string; text: string } {
  const frontendUrl = getFrontendUrl();
  const monitorUrl = data.incidentId
    ? `${frontendUrl}/dashboard/incidents/${data.incidentId}`
    : `${frontendUrl}/dashboard/uptime/${data.monitorId}`;
  const isDown = data.status === 'down';
  const severityLabel = severityLabels[data.severity] || data.severity;

  const statusLabel = isDown ? 'Down' : 'Recovered';

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

  const html = renderEmail({
    title,
    preheader: `[${statusLabel}] ${data.monitorName}`,
    context: data.organizationName,
    body:
      ui.pill(isDown ? 'Down' : 'Up', isDown ? (data.severity === 'critical' ? 'error' : 'warning') : 'success') +
      ui.title(data.monitorName) +
      ui.paragraph(
        isDown
          ? `${data.monitorName} is not responding.${data.errorCode ? ` Error: ${data.errorCode}` : ''}`
          : `${data.monitorName} is back online.${data.downtimeDuration ? ` Downtime: ${data.downtimeDuration}` : ''}`
      ) +
      ui.logBlock(
        infoRows
          .filter((r) => !['Monitor', 'Status', 'Organization'].includes(r.label))
          .map((r) => ({ key: r.label.toLowerCase().replace(/ /g, '_'), value: r.value }))
      ) +
      ui.button('View monitor', monitorUrl),
    footer: { kind: 'notifications' },
  });

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
Manage notifications: ${frontendUrl}/dashboard/settings/notifications/destinations
`.trim();

  return { html, text };
}

// ============================================================================
// PROJECT HEALTH EMAIL
// ============================================================================

export interface ProjectHealthEmailData {
  projectName: string;
  organizationName: string;
  kind: 'opened' | 'resolved';
  severity: 'critical' | 'warning';
  title: string;
  message: string;
  openedAt: string;
  resolvedAt: string | null;
  link: string;
}

export function generateProjectHealthEmail(data: ProjectHealthEmailData): { html: string; text: string } {
  const frontendUrl = getFrontendUrl();
  const isOpen = data.kind === 'opened';
  const badge = isOpen
    ? { text: data.severity === 'critical' ? 'Critical' : 'Warning' }
    : { text: 'Resolved' };
  const heading = isOpen ? `${data.title}: ${data.projectName}` : `Resolved: ${data.title} (${data.projectName})`;

  const infoRows: Array<{ label: string; value: string }> = [
    { label: 'Project', value: data.projectName },
    { label: 'Organization', value: data.organizationName },
    { label: 'Opened', value: data.openedAt },
  ];
  if (data.resolvedAt) infoRows.push({ label: 'Resolved', value: data.resolvedAt });

  const tone = !isOpen ? 'success' : data.severity === 'critical' ? 'error' : 'warning';
  const html = renderEmail({
    title: heading,
    preheader: `[${badge.text}] ${data.projectName}: ${data.title}`,
    context: emailContext(data.organizationName, data.projectName),
    body:
      ui.pill(badge.text, tone) +
      ui.title(data.title) +
      ui.notice(data.message, tone) +
      ui.logBlock(
        infoRows
          .filter((r) => r.label === 'Opened' || r.label === 'Resolved')
          .map((r) => ({ key: r.label.toLowerCase(), value: r.value }))
      ) +
      ui.button('View project health', data.link),
    footer: { kind: 'notifications' },
  });

  const text = `
PROJECT HEALTH ${isOpen ? badge.text.toUpperCase() : 'RESOLVED'}: ${data.title}
${'='.repeat(50)}

${data.message}

DETAILS
-------
Project: ${data.projectName}
Organization: ${data.organizationName}
Opened: ${data.openedAt}
${data.resolvedAt ? `Resolved: ${data.resolvedAt}` : ''}

View details: ${data.link}

--
Sent by LogTide
Manage notifications: ${frontendUrl}/dashboard/settings/notifications/destinations
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

/** Section titles in sentence case; all-caps words such as MITRE stay as they are. */
function digestSectionTitle(title: string): string {
  const words = title.split(' ');
  const sentence = words
    .map((w, i) => (i === 0 || (w.length > 1 && w === w.toUpperCase()) ? w : w.toLowerCase()))
    .join(' ');
  return ui.sectionTitle(sentence);
}

function digestEmptyLine(message: string): string {
  return ui.emptyLine(message);
}

function digestTable(headers: string[], rows: string[][]): string {
  return ui.dataTable(
    headers,
    rows.map((cells) => cells.map((text) => ({ text }))),
    { alignRight: headers.map((_, i) => i).filter((i) => i > 0) }
  );
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
        ? ui.notice('No activity during this period. Your systems have been quiet.', 'info')
        : ui.bigNumber(
            data.logVolume.current.toLocaleString('en-US'),
            `logs, ${data.logVolume.trend} compared to the previous period (${data.logVolume.previous.toLocaleString('en-US')})`
          ))
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
      ui.statRows([
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
      ui.statRows([
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
      ui.statRows([
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
      ui.statRows([
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
      ui.statRows([
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
      ui.statRows([
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
      ui.statRows([
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
      ui.statRows([
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
        ? ui.notice(
            `Month-to-date usage above 80% of limit: ${data.usage.quotaWarnings
              .map((w) => `${w.capability} ${w.usedPct}%`)
              .join(', ')}`,
            'warning'
          )
        : '')
    : '';

  const webhooksSection = data.webhooks
    ? digestSectionTitle('Webhooks') +
      ui.statRows([
        { label: 'Delivered', value: data.webhooks.delivered.toLocaleString('en-US') },
        { label: 'Failed', value: data.webhooks.failed.toLocaleString('en-US') },
        { label: 'Dead', value: data.webhooks.dead.toLocaleString('en-US') },
      ]) +
      (data.webhooks.dead > 0
        ? ui.notice(
            `${data.webhooks.dead.toLocaleString('en-US')} deliver${data.webhooks.dead === 1 ? 'y' : 'ies'} reached the dead-letter queue and need attention.`,
            'warning'
          )
        : '')
    : '';

  const teamActivitySection = data.teamActivity
    ? digestSectionTitle('Team Activity') +
      ui.statRows([
        { label: 'Members Added', value: data.teamActivity.membersAdded.toLocaleString('en-US') },
        {
          label: 'Members Removed',
          value: data.teamActivity.membersRemoved.toLocaleString('en-US'),
        },
        { label: 'Config Changes', value: data.teamActivity.configChanges.toLocaleString('en-US') },
        { label: 'Failed Logins', value: data.teamActivity.failedLogins.toLocaleString('en-US') },
      ])
    : '';

  const html = renderEmail({
    title: `${frequencyLabel} digest`,
    preheader: quiet ? `Quiet period for ${data.organizationName}` : buildPreheader(data),
    context: data.organizationName,
    body:
      ui.title(`${frequencyLabel} digest`) +
      ui.paragraph(`${data.organizationName}, ${data.periodLabel}`) +
      logVolumeSection +
      logBreakdownSection +
      topServicesSection +
      topErrorMessagesSection +
      errorGroupsSection +
      tracesSection +
      metricsSection +
      alertsSection +
      securitySection +
      securityActivitySection +
      uptimeSection +
      monitorPerformanceSection +
      usageSection +
      webhooksSection +
      teamActivitySection +
      ui.button('View dashboard', data.dashboardUrl),
    footer: { kind: 'unsubscribe', url: data.unsubscribeUrl },
  });

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

