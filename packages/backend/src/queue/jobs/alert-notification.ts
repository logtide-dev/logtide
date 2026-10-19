import { alertsService } from '../../modules/alerts/index.js';
import { notificationsService } from '../../modules/notifications/index.js';
import { notificationChannelsService } from '../../modules/notification-channels/index.js';
import { db } from '../../database/connection.js';
import nodemailer, { type Transporter, type TransportOptions } from 'nodemailer';
import { config } from '../../config/index.js';
import { generateAlertEmail, getFrontendUrl } from '../../lib/email-templates.js';
import { webhookDispatcher, buildEnvelope } from '../../modules/webhooks/index.js';
import type { EmailChannelConfig, WebhookChannelConfig } from '@logtide/shared';

export interface AlertNotificationData {
  historyId: string;
  rule_id: string;
  rule_name: string;
  organization_id: string;
  project_id: string | null;
  log_count: number;
  threshold: number;
  time_window: number;
  // Legacy fields (deprecated, use notification_channels instead)
  email_recipients: string[];
  webhook_url?: string;
  // Rate-of-change metadata (present only for rate_of_change alerts)
  baseline_metadata?: {
    baseline_value: number;
    current_value: number;
    deviation_ratio: number;
    baseline_type: string;
    evaluation_time: string;
  };
}

// Create email transporter (reused across notifications)
let emailTransporter: Transporter | null = null;

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

export async function processAlertNotification(job: any) {
  const data: AlertNotificationData = job.data;

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

    // STEP 2: Load notification channels for this alert rule
    const channels = await notificationChannelsService.getAlertRuleChannels(data.rule_id);

    // STEP 3: Collect email recipients from notification channels
    const emailRecipients = new Set<string>();

    // Add email recipients from channels
    channels
      .filter((ch) => ch.type === 'email' && ch.enabled)
      .forEach((ch) => {
        const emailConfig = ch.config as EmailChannelConfig;
        emailConfig.recipients.forEach((email: string) => emailRecipients.add(email));
      });

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

    // STEP 5: Collect webhook targets from notification channels
    // (dedup by URL; first channel wins for hook attribution)
    const webhookTargets = new Map<string, string>();

    channels
      .filter((ch) => ch.type === 'webhook' && ch.enabled)
      .forEach((ch) => {
        const webhookConfig = ch.config as WebhookChannelConfig;
        if (!webhookTargets.has(webhookConfig.url)) {
          webhookTargets.set(webhookConfig.url, ch.id);
        }
      });

    // STEP 6: Send webhooks
    for (const [url, channelId] of webhookTargets) {
      try {
        await sendWebhookNotification({ ...data, webhook_url: url }, channelId);
        console.log(`Webhook notification sent: ${data.rule_name} -> ${url}`);
      } catch (error) {
        const errMsg = `Webhook failed (${url}): ${error instanceof Error ? error.message : 'Unknown error'}`;
        console.error(errMsg);
        errors.push(errMsg);
      }
    }

    if (webhookTargets.size === 0) {
      console.log(`No webhook configured for: ${data.rule_name}`);
    }

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

async function sendEmailNotification(data: AlertNotificationData & { organizationName?: string; projectName?: string | null }) {
  const transporter = getEmailTransporter();

  if (!transporter) {
    throw new Error('Email transporter not configured');
  }

  const isRateOfChange = !!data.baseline_metadata;

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

  const subject = isRateOfChange
    ? `[Anomaly] ${data.rule_name} - ${data.baseline_metadata!.deviation_ratio}x above baseline`
    : `[Alert] ${data.rule_name} - ${data.log_count} logs exceeded threshold`;

  await transporter.sendMail({
    from: `"LogTide" <${config.SMTP_FROM || config.SMTP_USER}>`,
    to: data.email_recipients.join(', '),
    subject,
    text,
    html,
  });

  console.log(`Email sent to: ${data.email_recipients.join(', ')}`);
}

async function sendWebhookNotification(data: AlertNotificationData, channelId?: string) {
  if (!data.webhook_url) return;

  const frontendUrl = getFrontendUrl();

  // Wrap in the unified envelope (WS3). Both plain threshold and anomaly
  // (rate-of-change) alerts use type 'alert.triggered'; anomaly is
  // distinguished by data.baseline_metadata !== null.
  // organization_id/project_id move to the envelope; event_type/timestamp
  // are superseded by envelope.type/occurredAt.
  const envelope = buildEnvelope({
    type: 'alert.triggered',
    organizationId: data.organization_id,
    projectId: data.project_id ?? null,
    data: {
      alert_name: data.rule_name,
      log_count: data.log_count,
      threshold: data.threshold,
      time_window: data.time_window,
      baseline_metadata: data.baseline_metadata || null,
      link: `${frontendUrl}/dashboard/alerts`,
    },
  });

  // Route through the centralized dispatcher (#218): SSRF guard, HMAC signing,
  // retry/backoff, DLQ, delivery logging, and the beforeWebhookDispatch hook
  // (#216) all live in one place now.
  await webhookDispatcher.enqueue({
    url: data.webhook_url,
    organizationId: data.organization_id,
    eventType: 'alert.triggered',
    eventId: `${data.historyId || data.rule_id}:${data.webhook_url}`,
    channelId,
    ruleId: data.rule_id,
    metadata: { ruleName: data.rule_name },
    payload: envelope,
  });
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

  // Create notification for each member
  const notificationPromises = members.map((member) => {
    const isRateOfChange = !!data.baseline_metadata;
    const title = isRateOfChange
      ? `Anomaly Detected: ${data.rule_name}`
      : `Alert Triggered: ${data.rule_name}`;
    const message = isRateOfChange
      ? `Log volume is ${data.baseline_metadata!.deviation_ratio}x above baseline (${Math.round(data.baseline_metadata!.current_value)} vs ${Math.round(data.baseline_metadata!.baseline_value)} logs/hr)${projectName ? ` for project ${projectName}` : ''}.`
      : projectName
        ? `${data.log_count} logs exceeded threshold of ${data.threshold} in ${data.time_window} minutes for project ${projectName}.`
        : `${data.log_count} logs exceeded threshold of ${data.threshold} in ${data.time_window} minutes.`;

    return notificationsService.createNotification({
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
      },
    });
  });

  await Promise.all(notificationPromises);

  console.log(`Created ${members.length} in-app notification(s) for alert: ${data.rule_name}`);
}
