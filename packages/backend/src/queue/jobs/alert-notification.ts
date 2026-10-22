import { alertsService } from '../../modules/alerts/index.js';
import { notificationsService } from '../../modules/notifications/index.js';
import { notificationChannelsService } from '../../modules/notification-channels/index.js';
import { db } from '../../database/connection.js';
import nodemailer, { type Transporter, type TransportOptions } from 'nodemailer';
import { config } from '../../config/index.js';
import { generateAlertEmail, getFrontendUrl } from '../../lib/email-templates.js';
import { webhookDispatcher, buildEnvelope } from '../../modules/webhooks/index.js';
import type {
  EmailChannelConfig,
  NotificationChannel,
  WebhookChannelConfig,
  WebhookEnvelope,
} from '@logtide/shared';
import type {
  AlertNotificationData,
  AlertNotificationJobData,
  AlertResolvedNotificationData,
} from '../../modules/alerts/types.js';

export type {
  AlertNotificationData,
  AlertNotificationJobData,
  AlertResolvedNotificationData,
} from '../../modules/alerts/types.js';

/*
 * Jobs on the `alert-notifications` queue:
 * - `kind: 'triggered' | 'renotify'` (alert rules, 1.6): in-app for every
 *   member, email and webhook destinations (rule channels, else the org
 *   defaults for `alert`, else an email to the owners and admins when SMTP
 *   is configured), webhook `alert.triggered`.
 * - `kind: 'resolved'`: only webhook `alert.resolved` to the same
 *   destinations; no email, no in-app, no history row.
 * - no `kind` (Sigma detections, jobs left by a pre-1.6 worker): processed as
 *   before, triggered copy, rule channels only, markAsNotified only when
 *   historyId is set.
 * Dispatch is on `job.data`, never on `job.name` (graphile reports the queue
 * name as the job name).
 */

// Create email transporter (reused across notifications)
let emailTransporter: Transporter | null = null;

function smtpConfigured(): boolean {
  return !!config.SMTP_HOST;
}

function getEmailTransporter() {
  if (!emailTransporter) {
    // Check if SMTP is configured
    if (!config.SMTP_HOST) {
      console.warn('SMTP not configured - email notifications disabled');
      return null;
    }

    const transportOpts: Record<string, unknown> = {
      host: config.SMTP_HOST,
      port: config.SMTP_PORT || 587,
      secure: config.SMTP_SECURE || false, // true for 465, false for other ports
    };
    if (config.SMTP_USER && config.SMTP_PASS) {
      transportOpts.auth = {
        user: config.SMTP_USER,
        pass: config.SMTP_PASS,
      };
    }

    emailTransporter = nodemailer.createTransport(transportOpts as TransportOptions);

    console.log(`Email transporter configured: ${config.SMTP_HOST}:${config.SMTP_PORT}`);
  }

  return emailTransporter;
}

function formatNumber(value: number): string {
  return value.toLocaleString('en-US');
}

function formatMinutes(minutes: number): string {
  return `${formatNumber(minutes)} minute${minutes === 1 ? '' : 's'}`;
}

function alertLink(incidentId: string | null | undefined): string {
  const frontendUrl = getFrontendUrl();
  return incidentId ? `${frontendUrl}/dashboard/incidents/${incidentId}` : `${frontendUrl}/dashboard/alerts`;
}

export async function processAlertNotification(job: { data: AlertNotificationJobData }): Promise<void> {
  const data = job.data;
  if (data.kind === 'resolved') {
    await processResolvedNotification(data);
    return;
  }
  await processFiringNotification(data);
}

/**
 * Destinations of an alert job: the rule's enabled channels; when there are
 * none and the job comes from an alert rule (`kind` set), the organization
 * defaults for `alert`. Jobs without `kind` (Sigma, pre-1.6) keep rule
 * channels only. Sigma jobs (event_type 'sigma') read the sigma rule channels
 * and the 'sigma' org defaults. When this is empty the firing path emails the owners and
 * admins (the shared fallback; W11 swaps this body for the shared resolver).
 */
export async function resolveAlertChannels(data: AlertNotificationJobData): Promise<NotificationChannel[]> {
  const isSigma = 'event_type' in data && data.event_type === 'sigma';
  const channels = isSigma
    ? await notificationChannelsService.getSigmaRuleChannels(data.rule_id, data.organization_id)
    : await notificationChannelsService.getAlertRuleChannels(data.rule_id, data.organization_id);
  if (channels.length > 0 || data.kind === undefined) return channels;
  return notificationChannelsService.getOrganizationDefaults(
    data.organization_id,
    isSigma ? 'sigma' : 'alert'
  );
}

/**
 * The single fan-out of an alert envelope to non-email destinations, today
 * webhook channels only (dedup by URL, first channel wins for hook
 * attribution). Event id `${eventIdPrefix}:${url}`. Returns the errors.
 */
export async function dispatchAlertEnvelope(
  envelope: WebhookEnvelope,
  channels: NotificationChannel[],
  ids: { ruleId: string; eventIdPrefix: string }
): Promise<string[]> {
  const errors: string[] = [];
  const ruleName = String((envelope.data as { alert_name?: unknown }).alert_name ?? ids.ruleId);
  const webhookTargets = new Map<string, string>();

  for (const ch of channels) {
    if (!ch.enabled) continue;
    if (ch.type === 'webhook') {
      const webhookConfig = ch.config as WebhookChannelConfig;
      if (webhookConfig.url && !webhookTargets.has(webhookConfig.url)) {
        webhookTargets.set(webhookConfig.url, ch.id);
      }
    }
    // SEAM:W11 pagerduty branch (trigger on alert.triggered, resolve on
    // alert.resolved, dedup key `alert:${data.alert_rule_id}`).
  }

  // Route through the centralized dispatcher (#218): SSRF guard, HMAC signing,
  // retry/backoff, DLQ, delivery logging, and the beforeWebhookDispatch hook
  // (#216) all live in one place.
  for (const [url, channelId] of webhookTargets) {
    try {
      await webhookDispatcher.enqueue({
        url,
        organizationId: envelope.organizationId,
        eventType: envelope.type,
        eventId: `${ids.eventIdPrefix}:${url}`,
        channelId,
        ruleId: ids.ruleId,
        metadata: { ruleName },
        payload: envelope,
      });
      console.log(`Webhook notification sent: ${ruleName} -> ${url}`);
    } catch (error) {
      const errMsg = `Webhook failed (${url}): ${error instanceof Error ? error.message : 'Unknown error'}`;
      console.error(errMsg);
      errors.push(errMsg);
    }
  }

  if (webhookTargets.size === 0) {
    console.log(`No webhook configured for: ${ruleName}`);
  }

  return errors;
}

async function processFiringNotification(data: AlertNotificationData) {
  console.log(`Processing alert notification: ${data.rule_name}`);

  const errors: string[] = [];

  try {
    // Get organization details
    const org = await db
      .selectFrom('organizations')
      .select(['name'])
      .where('id', '=', data.organization_id)
      .executeTakeFirst();

    // Get project name if applicable
    let projectName: string | null = null;
    if (data.project_id) {
      const project = await db
        .selectFrom('projects')
        .select(['name'])
        .where('id', '=', data.project_id)
        .where('organization_id', '=', data.organization_id)
        .executeTakeFirst();
      projectName = project?.name || null;
    }

    // STEP 1: Create in-app notifications for organization members
    try {
      await createInAppNotifications(data, projectName);
      console.log(`In-app notifications created: ${data.rule_name}`);
    } catch (error) {
      const errMsg = `In-app notification failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
      console.error(errMsg);
      errors.push(errMsg);
    }

    // STEP 2: Destinations (rule channels, else org defaults for alert rules)
    const channels = await resolveAlertChannels(data);

    // STEP 3: Collect email recipients from notification channels
    const emailRecipients = new Set<string>();

    channels
      .filter((ch) => ch.type === 'email' && ch.enabled)
      .forEach((ch) => {
        const emailConfig = ch.config as EmailChannelConfig;
        emailConfig.recipients.forEach((email: string) => emailRecipients.add(email));
      });

    // Shared fallback: an alert rule job with no destination at all emails
    // the organization owners and admins (never every member) when SMTP is
    // configured. Jobs without kind keep "rule channels only".
    if (channels.length === 0 && data.kind !== undefined && smtpConfigured()) {
      for (const email of await getOwnerAndAdminEmails(data.organization_id)) {
        emailRecipients.add(email);
      }
    }

    // STEP 4: Send emails if there are recipients
    if (emailRecipients.size > 0) {
      try {
        await sendEmailNotification({
          ...data,
          email_recipients: Array.from(emailRecipients),
          organizationName: org?.name,
          projectName,
        });
        console.log(`Email notifications sent: ${data.rule_name} (${emailRecipients.size} recipients)`);
      } catch (error) {
        const errMsg = `Email failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
        console.error(errMsg);
        errors.push(errMsg);
      }
    } else {
      console.log(`No email recipients configured for: ${data.rule_name}`);
    }

    // STEP 5: Webhook alert.triggered to every webhook destination
    errors.push(
      ...(await dispatchAlertEnvelope(buildTriggeredEnvelope(data), channels, {
        ruleId: data.rule_id,
        eventIdPrefix: data.historyId || data.rule_id,
      }))
    );

    // Mark as notified (with errors if any) - skip for Sigma rules (no history entry)
    if (data.historyId) {
      if (errors.length > 0) {
        await alertsService.markAsNotified(data.historyId, errors.join('; '));
      } else {
        await alertsService.markAsNotified(data.historyId);
      }
    }

    console.log(`Alert notification processed: ${data.rule_name}`);
  } catch (error) {
    console.error(`Failed to process alert notification: ${data.rule_name}`, error);
    if (data.historyId) {
      await alertsService.markAsNotified(
        data.historyId,
        error instanceof Error ? error.message : 'Unknown error'
      );
    }
    throw error;
  }
}

async function processResolvedNotification(data: AlertResolvedNotificationData) {
  console.log(`Processing alert resolution: ${data.rule_name}`);

  const channels = await resolveAlertChannels(data);

  const durationSeconds = Math.max(
    0,
    Math.round((Date.parse(data.resolved_at) - Date.parse(data.firing_since)) / 1000)
  );
  const duration = formatMinutes(Math.round(durationSeconds / 60));
  const message =
    data.alert_type === 'rate_of_change'
      ? `${data.rule_name} log volume is back to its baseline after ${duration}`
      : `${data.rule_name} is back to normal after ${duration}`;

  // Wrap in the unified envelope; data matches alertResolvedDataSchema.
  const envelope = buildEnvelope({
    type: 'alert.resolved',
    organizationId: data.organization_id,
    projectId: data.project_id ?? null,
    data: {
      alert_rule_id: data.rule_id,
      alert_name: data.rule_name,
      alert_type: data.alert_type,
      title: `Alert resolved: ${data.rule_name}`,
      message,
      log_count: data.log_count,
      threshold: data.threshold,
      time_window: data.time_window,
      firing_since: data.firing_since,
      resolved_at: data.resolved_at,
      duration_seconds: durationSeconds,
      incident_id: data.incident_id,
      link: alertLink(data.incident_id),
    },
  });

  const errors = await dispatchAlertEnvelope(envelope, channels, {
    ruleId: data.rule_id,
    eventIdPrefix: `${data.rule_id}:${data.firing_since}:resolved`,
  });
  if (errors.length > 0) {
    console.error(`Alert resolution partially failed: ${data.rule_name}: ${errors.join('; ')}`);
  }

  console.log(`Alert resolution processed: ${data.rule_name}`);
}

/** Enabled owners and admins of the organization (the shared email fallback). */
async function getOwnerAndAdminEmails(organizationId: string): Promise<string[]> {
  const rows = await db
    .selectFrom('organization_members')
    .innerJoin('users', 'users.id', 'organization_members.user_id')
    .select(['users.email'])
    .where('organization_members.organization_id', '=', organizationId)
    .where('organization_members.role', 'in', ['owner', 'admin'])
    .where('users.disabled', '=', false)
    .execute();
  return [...new Set(rows.map((r) => r.email).filter((email): email is string => !!email))];
}

function minutesSince(iso: string | undefined): number | null {
  if (!iso) return null;
  const since = Date.parse(iso);
  if (Number.isNaN(since)) return null;
  return Math.max(0, Math.round((Date.now() - since) / 60_000));
}

function buildTriggeredEnvelope(data: AlertNotificationData): WebhookEnvelope {
  // Both plain threshold and anomaly (rate-of-change) alerts use type
  // 'alert.triggered'; anomaly is distinguished by data.baseline_metadata
  // !== null. organization_id/project_id live on the envelope.
  const lifecycle =
    data.kind !== undefined
      ? {
          alert_rule_id: data.rule_id,
          renotify: data.kind === 'renotify',
          ...(data.firing_since ? { firing_since: data.firing_since } : {}),
          incident_id: data.incident_id ?? null,
        }
      : {};

  return buildEnvelope({
    type: 'alert.triggered',
    organizationId: data.organization_id,
    projectId: data.project_id ?? null,
    data: {
      alert_name: data.rule_name,
      log_count: data.log_count,
      threshold: data.threshold,
      time_window: data.time_window,
      baseline_metadata: data.baseline_metadata || null,
      link: alertLink(data.incident_id),
      ...lifecycle,
    },
  });
}

async function sendEmailNotification(data: AlertNotificationData & { organizationName?: string; projectName?: string | null }) {
  const transporter = getEmailTransporter();

  if (!transporter) {
    throw new Error('Email transporter not configured');
  }

  const isRateOfChange = !!data.baseline_metadata;
  const renotify = data.kind === 'renotify';

  const { html, text } = generateAlertEmail({
    ruleName: data.rule_name,
    logCount: data.log_count,
    threshold: data.threshold,
    timeWindow: data.time_window,
    organizationName: data.organizationName,
    projectName: data.projectName,
    historyId: data.historyId,
    baselineMetadata: data.baseline_metadata,
  });

  let subject: string;
  if (isRateOfChange) {
    const ratio = formatNumber(data.baseline_metadata!.deviation_ratio);
    subject = renotify
      ? `[Anomaly] Still active: ${data.rule_name} - ${ratio}x above baseline`
      : `[Anomaly] ${data.rule_name} - ${ratio}x above baseline`;
  } else {
    const count = formatNumber(data.log_count);
    subject = renotify
      ? `[Alert] Still firing: ${data.rule_name} - ${count} logs`
      : `[Alert] ${data.rule_name} - ${count} logs exceeded threshold`;
  }

  await transporter.sendMail({
    from: `"LogTide" <${config.SMTP_FROM || config.SMTP_USER}>`,
    to: data.email_recipients.join(', '),
    subject,
    text,
    html,
  });

  console.log(`Email sent to: ${data.email_recipients.join(', ')}`);
}

function inAppCopy(data: AlertNotificationData, projectName: string | null): { title: string; message: string } {
  const renotify = data.kind === 'renotify';
  const projectSuffix = projectName ? ` for project ${projectName}` : '';
  const firingMinutes = renotify ? minutesSince(data.firing_since) : null;
  const firingFor = firingMinutes !== null ? `, firing for ${formatMinutes(firingMinutes)}` : '';

  if (data.baseline_metadata) {
    const bm = data.baseline_metadata;
    return {
      title: renotify ? `Anomaly still active: ${data.rule_name}` : `Anomaly detected: ${data.rule_name}`,
      message:
        `Log volume is ${formatNumber(bm.deviation_ratio)}x above baseline ` +
        `(${formatNumber(Math.round(bm.current_value))} vs ${formatNumber(Math.round(bm.baseline_value))} logs/hr)` +
        `${projectSuffix}${firingFor}.`,
    };
  }

  return {
    title: renotify ? `Alert still firing: ${data.rule_name}` : `Alert triggered: ${data.rule_name}`,
    message:
      `${formatNumber(data.log_count)} logs exceeded threshold of ${formatNumber(data.threshold)} ` +
      `in ${formatNumber(data.time_window)} minutes${projectSuffix}${firingFor}.`,
  };
}

async function createInAppNotifications(data: AlertNotificationData, projectName: string | null) {
  // Get all members of the organization
  const members = await db
    .selectFrom('organization_members')
    .select(['user_id'])
    .where('organization_id', '=', data.organization_id)
    .execute();

  if (members.length === 0) {
    console.log(`No members found for organization: ${data.organization_id}`);
    return;
  }

  const { title, message } = inAppCopy(data, projectName);

  // Create notification for each member
  const notificationPromises = members.map((member) =>
    notificationsService.createNotification({
      userId: member.user_id,
      type: 'alert',
      title,
      message,
      organizationId: data.organization_id,
      projectId: data.project_id || undefined,
      metadata: {
        alertRuleId: data.rule_id,
        historyId: data.historyId,
        logCount: data.log_count,
        threshold: data.threshold,
        timeWindow: data.time_window,
        kind: data.kind ?? 'triggered',
        incidentId: data.incident_id ?? null,
      },
    })
  );

  await Promise.all(notificationPromises);

  console.log(`Created ${members.length} in-app notification(s) for alert: ${data.rule_name}`);
}
