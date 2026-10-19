import nodemailer, { type TransportOptions } from 'nodemailer';
import type { IJob } from '../abstractions/types.js';
import { config, isSmtpConfigured } from '../../config/index.js';
import { db } from '../../database/connection.js';
import { notificationsService } from '../../modules/notifications/service.js';
import { notificationChannelsService } from '../../modules/notification-channels/index.js';
import { createQueue } from '../connection.js';
import { generateIncidentEmail, getFrontendUrl } from '../../lib/email-templates.js';
import { webhookDispatcher, buildEnvelope } from '../../modules/webhooks/index.js';
import type { Severity } from '../../database/types.js';
import type { EmailChannelConfig, WebhookChannelConfig } from '@logtide/shared';

export interface IncidentNotificationJob {
  incidentId: string;
  organizationId: string;
  title: string;
  description: string | null;
  severity: Severity;
  affectedServices: string[] | null;
}

// Create the queue
export const incidentNotificationQueue = createQueue<IncidentNotificationJob>('incident-notifications');

// Severity labels for display
const severityLabels: Record<Severity, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  informational: 'Informational',
};

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
  return nodemailer.createTransport(opts as TransportOptions);
}


/**
 * Send webhook notification for incident
 */
async function sendIncidentWebhook(url: string, job: IncidentNotificationJob, orgName: string): Promise<void> {
  const frontendUrl = getFrontendUrl();

  // Wrap in the unified envelope (WS3). organization{id,name} object stays in
  // data. event_type/timestamp superseded by envelope.type/occurredAt.
  // No project on incidents, so projectId is null.
  const envelope = buildEnvelope({
    type: 'incident.created',
    organizationId: job.organizationId,
    projectId: null,
    data: {
      title: job.title,
      message: job.description || `Security incident: ${job.title}`,
      severity: job.severity,
      organization: {
        id: job.organizationId,
        name: orgName,
      },
      incident_id: job.incidentId,
      affected_services: job.affectedServices,
      link: `${frontendUrl}/dashboard/security/incidents/${job.incidentId}`,
    },
  });

  // Route through the centralized dispatcher (#218): SSRF guard, HMAC signing,
  // retry/backoff, DLQ, and delivery logging.
  await webhookDispatcher.enqueue({
    url,
    organizationId: job.organizationId,
    eventType: 'incident.created',
    eventId: `${job.incidentId}:${url}`,
    payload: envelope,
  });
}

/**
 * Process incident notification job
 */
export async function processIncidentNotification(job: IJob<IncidentNotificationJob>): Promise<void> {
  const data = job.data;
  console.log(`[IncidentNotification] Processing notification for incident ${data.incidentId}`);

  // Get organization details
  const org = await db
    .selectFrom('organizations')
    .select(['id', 'name'])
    .where('id', '=', data.organizationId)
    .executeTakeFirst();

  if (!org) {
    console.error(`[IncidentNotification] Organization ${data.organizationId} not found`);
    return;
  }

  // STEP 1: Get notification channels for this incident (or org defaults)
  let incidentChannels = await notificationChannelsService.getIncidentChannels(data.incidentId);

  // If no specific channels, use organization defaults for incidents
  if (incidentChannels.length === 0) {
    incidentChannels = await notificationChannelsService.getOrganizationDefaults(data.organizationId, 'incident');
  }

  // STEP 2: Collect email recipients and webhook URLs from channels
  const channelEmailRecipients = new Set<string>();
  const channelWebhookUrls = new Set<string>();

  incidentChannels
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

  // STEP 3: Get organization members for in-app notifications (legacy behavior)
  const shouldNotifyAll = data.severity === 'critical' || data.severity === 'high';

  let membersQuery = db
    .selectFrom('organization_members')
    .innerJoin('users', 'users.id', 'organization_members.user_id')
    .select(['users.id', 'users.email', 'users.name'])
    .where('organization_members.organization_id', '=', data.organizationId);

  if (!shouldNotifyAll) {
    // For medium/low/info, only notify owners and admins
    membersQuery = membersQuery.where('organization_members.role', 'in', ['owner', 'admin']);
  }

  const members = await membersQuery.execute();

  if (members.length === 0) {
    console.log(`[IncidentNotification] No members to notify for org ${data.organizationId}`);
    return;
  }

  console.log(`[IncidentNotification] Notifying ${members.length} members`);

  // STEP 4: Send in-app notifications to all relevant members
  const notificationPromises = members.map((member) =>
    notificationsService.createNotification({
      userId: member.id,
      title: data.title,
      message: `Security Incident [${severityLabels[data.severity]}]`,
      type: 'alert',
      organizationId: data.organizationId,
      metadata: {
        incidentId: data.incidentId,
        severity: data.severity,
        link: `/dashboard/security/incidents/${data.incidentId}`,
      },
    }).catch((err) => console.error(`[IncidentNotification] Failed to create notification for ${member.id}:`, err))
  );

  await Promise.all(notificationPromises);
  console.log(`[IncidentNotification] In-app notifications sent`);

  // STEP 5: Send email notifications
  // Combine channel emails with member emails (if no channels configured, use members)
  const emailRecipients =
    channelEmailRecipients.size > 0
      ? Array.from(channelEmailRecipients)
      : members.map((m) => m.email);

  if (isSmtpConfigured() && emailRecipients.length > 0) {
    const transporter = createTransporter();
    const { html, text } = generateIncidentEmail({
      incidentId: data.incidentId,
      title: data.title,
      description: data.description,
      severity: data.severity,
      affectedServices: data.affectedServices,
      organizationName: org.name,
    });

    const emailPromises = emailRecipients.map((email) =>
      transporter.sendMail({
        from: config.SMTP_FROM,
        to: email,
        subject: `[${severityLabels[data.severity]}] Security Incident: ${data.title}`,
        html,
        text,
      }).catch((err) => console.error(`[IncidentNotification] Failed to send email to ${email}:`, err))
    );

    await Promise.all(emailPromises);
    console.log(`[IncidentNotification] Emails sent to ${emailRecipients.length} recipients`);
  } else if (!isSmtpConfigured()) {
    console.log(`[IncidentNotification] SMTP not configured, skipping email notifications`);
  }

  // STEP 6: Send webhook notifications (NEW - using channels)
  if (channelWebhookUrls.size > 0) {
    const webhookPromises = Array.from(channelWebhookUrls).map((url) =>
      sendIncidentWebhook(url, data, org.name)
        .then(() => console.log(`[IncidentNotification] Webhook sent to ${url}`))
        .catch((err) => console.error(`[IncidentNotification] Webhook failed for ${url}:`, err))
    );

    await Promise.all(webhookPromises);
    console.log(`[IncidentNotification] Webhooks sent to ${channelWebhookUrls.size} URLs`);
  }
}
