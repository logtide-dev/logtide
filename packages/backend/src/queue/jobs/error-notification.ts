/**
 * Error Notification Job
 *
 * BullMQ job that sends notifications to organization members when a new exception occurs.
 * Notifications are sent for every occurrence EXCEPT if the error group status is 'ignored'.
 * Now supports notification channels for webhooks and custom email recipients.
 */

import nodemailer from 'nodemailer';
import type { IJob } from '../abstractions/types.js';
import { config, isSmtpConfigured } from '../../config/index.js';
import { db } from '../../database/connection.js';
import { notificationsService } from '../../modules/notifications/service.js';
import { notificationChannelsService } from '../../modules/notification-channels/index.js';
import { createQueue } from '../connection.js';
import { generateErrorEmail, getFrontendUrl } from '../../lib/email-templates.js';
import { webhookDispatcher, buildEnvelope } from '../../modules/webhooks/index.js';
import type { ExceptionLanguage } from '../../modules/exceptions/types.js';
import type { EmailChannelConfig, WebhookChannelConfig } from '@logtide/shared';

export interface ErrorNotificationJobData {
  exceptionId: string;
  organizationId: string;
  projectId: string | null;
  fingerprint: string;
  exceptionType: string;
  exceptionMessage: string | null;
  language: ExceptionLanguage;
  service: string;
  isNewErrorGroup: boolean;
  /** True when a previously resolved error group recurred (a regression). */
  isRegression?: boolean;
}

// Create the queue
export const errorNotificationQueue = createQueue<ErrorNotificationJobData>('error-notifications');

/**
 * Create the email transporter
 */
function createTransporter() {
  const opts: Record<string, unknown> = {
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure: config.SMTP_SECURE,
  };
  if (config.SMTP_USER && config.SMTP_PASS) {
    opts.auth = {
      user: config.SMTP_USER,
      pass: config.SMTP_PASS,
    };
  }
  return nodemailer.createTransport(opts as nodemailer.TransportOptions);
}


/**
 * Send webhook notification for error
 */
async function sendErrorWebhook(
  url: string,
  data: ErrorNotificationJobData,
  orgName: string,
  projectName: string,
  errorGroupId: string
): Promise<void> {
  const frontendUrl = getFrontendUrl();

  // Wrap in the unified envelope (WS3). organization{id,name} object stays in
  // data (it carries the org name). projectId moves to the envelope as well.
  // event_type/timestamp are superseded by envelope.type/occurredAt.
  const envelope = buildEnvelope({
    type: 'error.detected',
    organizationId: data.organizationId,
    projectId: data.projectId ?? null,
    data: {
      title: `${data.isRegression ? 'Regression' : data.isNewErrorGroup ? 'New Error' : 'Error'}: ${data.exceptionType}`,
      message: data.exceptionMessage || `An error occurred in ${data.service}`,
      severity: data.isRegression || data.isNewErrorGroup ? 'high' : 'medium',
      organization: {
        id: data.organizationId,
        name: orgName,
      },
      project: {
        id: data.projectId,
        name: projectName,
      },
      error_group_id: errorGroupId,
      exception_type: data.exceptionType,
      language: data.language,
      service: data.service,
      is_new: data.isNewErrorGroup,
      is_regression: data.isRegression ?? false,
      link: `${frontendUrl}/dashboard/errors/${errorGroupId}`,
    },
  });

  // Route through the centralized dispatcher (#218): SSRF guard, HMAC signing,
  // retry/backoff, DLQ, and delivery logging.
  await webhookDispatcher.enqueue({
    url,
    organizationId: data.organizationId,
    eventType: 'error.detected',
    eventId: `${errorGroupId}:${url}`,
    payload: envelope,
  });
}

/**
 * Process error notification job
 */
export async function processErrorNotification(job: IJob<ErrorNotificationJobData>): Promise<void> {
  const data = job.data;
  console.log(`[ErrorNotification] Processing notification for exception ${data.exceptionId}`);

  // Atomically claim the notification slot for this error group. Only one
  // occurrence per cooldown window gets to notify; the rest are throttled.
  // This is what stops thousands of identical emails when a single error
  // fires in a tight loop. The conditional UPDATE is race-safe: concurrent
  // jobs serialize on the row lock and re-check last_notified_at, so only the
  // first one inside the window matches and updates a row.
  const cooldownMinutes = config.ERROR_NOTIFICATION_COOLDOWN_MINUTES ?? 15;
  const cooldownCutoff = new Date(Date.now() - cooldownMinutes * 60_000);

  const claimed = await db
    .updateTable('error_groups')
    .set({ last_notified_at: new Date() })
    .where('fingerprint', '=', data.fingerprint)
    .where('organization_id', '=', data.organizationId)
    .where('status', '!=', 'ignored')
    .where((eb) =>
      eb.or([
        eb('last_notified_at', 'is', null),
        eb('last_notified_at', '<=', cooldownCutoff),
      ])
    )
    .returning('id')
    .executeTakeFirst();

  if (!claimed) {
    // Slot not claimed: group is missing, ignored, or already notified within
    // the cooldown window. Look up why purely for a useful log line, then skip.
    const existing = await db
      .selectFrom('error_groups')
      .select(['id', 'status'])
      .where('fingerprint', '=', data.fingerprint)
      .where('organization_id', '=', data.organizationId)
      .executeTakeFirst();

    if (!existing) {
      console.log(`[ErrorNotification] Error group not found for fingerprint ${data.fingerprint}, skipping`);
    } else if (existing.status === 'ignored') {
      console.log(`[ErrorNotification] Error group ${existing.id} is ignored, skipping notification`);
    } else {
      console.log(`[ErrorNotification] Error group ${existing.id} notified within last ${cooldownMinutes}m, throttling`);
    }
    return;
  }

  const errorGroup = { id: claimed.id };

  // Get organization details
  const org = await db
    .selectFrom('organizations')
    .select(['id', 'name'])
    .where('id', '=', data.organizationId)
    .executeTakeFirst();

  if (!org) {
    console.error(`[ErrorNotification] Organization ${data.organizationId} not found`);
    return;
  }

  // Get project details
  const project = await db
    .selectFrom('projects')
    .select(['id', 'name'])
    .where('id', '=', data.projectId)
    .executeTakeFirst();

  if (!project) {
    console.error(`[ErrorNotification] Project ${data.projectId} not found`);
    return;
  }

  // STEP 1: Get notification channels for this error group (or org defaults)
  let errorChannels = await notificationChannelsService.getErrorGroupChannels(errorGroup.id);

  // If no specific channels, use organization defaults for errors
  if (errorChannels.length === 0) {
    errorChannels = await notificationChannelsService.getOrganizationDefaults(data.organizationId, 'error');
  }

  // STEP 2: Collect email recipients and webhook URLs from channels
  const channelEmailRecipients = new Set<string>();
  const channelWebhookUrls = new Set<string>();

  errorChannels
    .filter((ch) => ch.enabled)
    .forEach((ch) => {
      if (ch.type === 'email') {
        const emailConfig = ch.config as EmailChannelConfig;
        emailConfig.recipients.forEach((email) => channelEmailRecipients.add(email));
      } else if (ch.type === 'webhook') {
        const webhookConfig = ch.config as WebhookChannelConfig;
        channelWebhookUrls.add(webhookConfig.url);
      }
    });

  // STEP 3: Get organization members (owners and admins) for in-app notifications
  const members = await db
    .selectFrom('organization_members')
    .innerJoin('users', 'users.id', 'organization_members.user_id')
    .select(['users.id', 'users.email', 'users.name'])
    .where('organization_members.organization_id', '=', data.organizationId)
    .where('organization_members.role', 'in', ['owner', 'admin'])
    .execute();

  if (members.length === 0) {
    console.log(`[ErrorNotification] No members to notify for org ${data.organizationId}`);
    return;
  }

  console.log(`[ErrorNotification] Notifying ${members.length} members`);

  const notificationTitle = data.isRegression
    ? `Regression: ${data.exceptionType}`
    : data.isNewErrorGroup
    ? `New Error: ${data.exceptionType}`
    : `Error: ${data.exceptionType}`;

  const notificationMessage = data.exceptionMessage
    ? `${data.exceptionMessage.substring(0, 100)}${data.exceptionMessage.length > 100 ? '...' : ''}`
    : `An error occurred in ${data.service}`;

  // STEP 4: Send in-app notifications to all relevant members
  const notificationPromises = members.map((member) =>
    notificationsService.createNotification({
      userId: member.id,
      title: notificationTitle,
      message: notificationMessage,
      type: 'alert',
      organizationId: data.organizationId,
      projectId: data.projectId ?? undefined,
      metadata: {
        exceptionId: data.exceptionId,
        errorGroupId: errorGroup.id,
        exceptionType: data.exceptionType,
        language: data.language,
        service: data.service,
        isNewErrorGroup: data.isNewErrorGroup,
        link: `/dashboard/errors/${errorGroup.id}`,
      },
    }).catch((err) => console.error(`[ErrorNotification] Failed to create notification for ${member.id}:`, err))
  );

  await Promise.all(notificationPromises);
  console.log(`[ErrorNotification] In-app notifications sent`);

  // STEP 5: Send email notifications
  // Use channel emails if configured, otherwise use member emails
  const emailRecipients =
    channelEmailRecipients.size > 0
      ? Array.from(channelEmailRecipients)
      : members.map((m) => m.email);

  if (isSmtpConfigured() && emailRecipients.length > 0) {
    const transporter = createTransporter();
    const { html, text } = generateErrorEmail({
      exceptionType: data.exceptionType,
      exceptionMessage: data.exceptionMessage,
      language: data.language,
      service: data.service,
      isNewErrorGroup: data.isNewErrorGroup,
      errorGroupId: errorGroup.id,
      organizationName: org.name,
      projectName: project.name,
      fingerprint: data.fingerprint,
    });
    const subject = data.isRegression
      ? `[Regression] ${data.exceptionType} in ${data.service}`
      : data.isNewErrorGroup
      ? `[New Error] ${data.exceptionType} in ${data.service}`
      : `[Error] ${data.exceptionType} in ${data.service}`;

    const emailPromises = emailRecipients.map((email) =>
      transporter.sendMail({
        from: config.SMTP_FROM,
        to: email,
        subject,
        html,
        text,
      }).catch((err) => console.error(`[ErrorNotification] Failed to send email to ${email}:`, err))
    );

    await Promise.all(emailPromises);
    console.log(`[ErrorNotification] Emails sent to ${emailRecipients.length} recipients`);
  } else if (!isSmtpConfigured()) {
    console.log(`[ErrorNotification] SMTP not configured, skipping email notifications`);
  }

  // STEP 6: Send webhook notifications (NEW - using channels)
  if (channelWebhookUrls.size > 0) {
    const webhookPromises = Array.from(channelWebhookUrls).map((url) =>
      sendErrorWebhook(url, data, org.name, project.name, errorGroup.id)
        .then(() => console.log(`[ErrorNotification] Webhook sent to ${url}`))
        .catch((err) => console.error(`[ErrorNotification] Webhook failed for ${url}:`, err))
    );

    await Promise.all(webhookPromises);
    console.log(`[ErrorNotification] Webhooks sent to ${channelWebhookUrls.size} URLs`);
  }
}
