import nodemailer, { type TransportOptions } from 'nodemailer';
import type { IJob } from '../abstractions/types.js';
import { config, isSmtpConfigured } from '../../config/index.js';
import { db } from '../../database/connection.js';
import { notificationsService } from '../../modules/notifications/service.js';
import { notificationChannelsService } from '../../modules/notification-channels/index.js';
import { createQueue } from '../connection.js';
import { generateMonitorEmail, getFrontendUrl } from '../../lib/email-templates.js';
import { webhookDispatcher, buildEnvelope } from '../../modules/webhooks/index.js';
import type { Severity, EmailChannelConfig, WebhookChannelConfig } from '@logtide/shared';

export interface MonitorNotificationJob {
  monitorId: string;
  monitorName: string;
  organizationId: string;
  projectId: string;
  status: 'down' | 'up';
  severity: Severity;
  target?: string | null;
  errorCode?: string | null;
  responseTimeMs?: number | null;
  consecutiveFailures?: number;
  downtimeDuration?: string | null;
}

export const monitorNotificationQueue = createQueue<MonitorNotificationJob>('monitor-notifications');

const severityLabels: Record<Severity, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  informational: 'Informational',
};

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
  return nodemailer.createTransport(opts as TransportOptions);
}

async function sendMonitorWebhook(url: string, job: MonitorNotificationJob, orgName: string): Promise<void> {
  const frontendUrl = getFrontendUrl();
  const isDown = job.status === 'down';

  // Wrap in the unified envelope (WS3). organization{id,name} object stays in
  // data. event_type/timestamp superseded by envelope.type/occurredAt.
  // No project on monitors, so projectId is null.
  const envelope = buildEnvelope({
    type: 'monitor.status_changed',
    organizationId: job.organizationId,
    projectId: null,
    data: {
      monitor_id: job.monitorId,
      monitor_name: job.monitorName,
      status: job.status,
      severity: job.severity,
      title: isDown ? `Monitor down: ${job.monitorName}` : `Monitor recovered: ${job.monitorName}`,
      message: isDown
        ? `${job.monitorName} is not responding${job.errorCode ? ` (${job.errorCode})` : ''}`
        : `${job.monitorName} is back online${job.downtimeDuration ? ` after ${job.downtimeDuration}` : ''}`,
      organization: {
        id: job.organizationId,
        name: orgName,
      },
      target: job.target,
      error_code: job.errorCode,
      response_time_ms: job.responseTimeMs,
      consecutive_failures: job.consecutiveFailures,
      downtime_duration: job.downtimeDuration,
      link: `${frontendUrl}/dashboard/monitoring`,
    },
  });

  // Route through the centralized dispatcher (#218): SSRF guard, HMAC signing,
  // retry/backoff, DLQ, and delivery logging.
  await webhookDispatcher.enqueue({
    url,
    organizationId: job.organizationId,
    eventType: 'monitor.status_changed',
    eventId: `${job.monitorId}:${job.status}:${url}`,
    payload: envelope,
  });
}

export async function processMonitorNotification(job: IJob<MonitorNotificationJob>): Promise<void> {
  const data = job.data;
  const isDown = data.status === 'down';
  console.log(`[MonitorNotification] Processing ${data.status} notification for monitor ${data.monitorName}`);

  // Get organization details
  const org = await db
    .selectFrom('organizations')
    .select(['id', 'name'])
    .where('id', '=', data.organizationId)
    .executeTakeFirst();

  if (!org) {
    console.error(`[MonitorNotification] Organization ${data.organizationId} not found`);
    return;
  }

  // Get notification channels: monitor-specific → org defaults for 'monitoring'
  let channels = await notificationChannelsService.getMonitorChannels(data.monitorId);
  if (channels.length === 0) {
    channels = await notificationChannelsService.getOrganizationDefaults(data.organizationId, 'monitoring');
  }

  const channelEmailRecipients = new Set<string>();
  const channelWebhookUrls = new Set<string>();

  channels
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

  // Get org members for in-app notifications
  const shouldNotifyAll = data.severity === 'critical' || data.severity === 'high';

  let membersQuery = db
    .selectFrom('organization_members')
    .innerJoin('users', 'users.id', 'organization_members.user_id')
    .select(['users.id', 'users.email', 'users.name'])
    .where('organization_members.organization_id', '=', data.organizationId);

  if (!shouldNotifyAll) {
    membersQuery = membersQuery.where('organization_members.role', 'in', ['owner', 'admin']);
  }

  const members = await membersQuery.execute();

  if (members.length === 0) {
    console.log(`[MonitorNotification] No members to notify for org ${data.organizationId}`);
    return;
  }

  // In-app notifications
  const title = isDown
    ? `Monitor down: ${data.monitorName}`
    : `Monitor recovered: ${data.monitorName}`;

  const message = isDown
    ? `${data.monitorName} is not responding${data.errorCode ? ` (${data.errorCode})` : ''}`
    : `${data.monitorName} is back online${data.downtimeDuration ? ` after ${data.downtimeDuration}` : ''}`;

  const notificationPromises = members.map((member) =>
    notificationsService.createNotification({
      userId: member.id,
      title,
      message,
      type: 'monitoring',
      organizationId: data.organizationId,
      projectId: data.projectId,
      metadata: {
        monitorId: data.monitorId,
        status: data.status,
        severity: data.severity,
        link: '/dashboard/monitoring',
      },
    }).catch((err) => console.error(`[MonitorNotification] Failed to create notification for ${member.id}:`, err))
  );

  await Promise.all(notificationPromises);
  console.log(`[MonitorNotification] In-app notifications sent to ${members.length} members`);

  // Email notifications
  const emailRecipients =
    channelEmailRecipients.size > 0
      ? Array.from(channelEmailRecipients)
      : members.map((m) => m.email);

  if (isSmtpConfigured() && emailRecipients.length > 0) {
    const transporter = createTransporter();
    const { html, text } = generateMonitorEmail({
      monitorId: data.monitorId,
      monitorName: data.monitorName,
      status: data.status,
      severity: data.severity,
      organizationName: org.name,
      target: data.target,
      errorCode: data.errorCode,
      responseTimeMs: data.responseTimeMs,
      consecutiveFailures: data.consecutiveFailures,
      downtimeDuration: data.downtimeDuration,
    });

    const subjectPrefix = isDown ? 'DOWN' : 'RECOVERED';
    const emailPromises = emailRecipients.map((email) =>
      transporter.sendMail({
        from: config.SMTP_FROM,
        to: email,
        subject: `[${subjectPrefix}] ${data.monitorName} - ${severityLabels[data.severity]}`,
        html,
        text,
      }).catch((err) => console.error(`[MonitorNotification] Failed to send email to ${email}:`, err))
    );

    await Promise.all(emailPromises);
    console.log(`[MonitorNotification] Emails sent to ${emailRecipients.length} recipients`);
  }

  // Webhook notifications
  if (channelWebhookUrls.size > 0) {
    const webhookPromises = Array.from(channelWebhookUrls).map((url) =>
      sendMonitorWebhook(url, data, org.name)
        .then(() => console.log(`[MonitorNotification] Webhook sent to ${url}`))
        .catch((err) => console.error(`[MonitorNotification] Webhook failed for ${url}:`, err))
    );

    await Promise.all(webhookPromises);
  }
}
