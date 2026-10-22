import nodemailer, { type TransportOptions } from 'nodemailer';
import type { IJob } from '../abstractions/types.js';
import { config, isSmtpConfigured } from '../../config/index.js';
import { db } from '../../database/connection.js';
import { notificationsService } from '../../modules/notifications/service.js';
import { notificationChannelsService } from '../../modules/notification-channels/index.js';
import {
  resolveChannelsForEvent,
  resolveFallbackEmails,
  toDeliveryTargets,
  type DeliveryTargets,
} from '../../modules/notification-channels/resolver.js';
import { notifyPagerDutyTargets } from '../../modules/notification-channels/dispatch.js';
import { createQueue } from '../connection.js';
import { generateIncidentEmail, getFrontendUrl } from '../../lib/email-templates.js';
import { webhookDispatcher, buildEnvelope } from '../../modules/webhooks/index.js';
import type { Severity } from '../../database/types.js';

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


/** Host of a URL for logs (never the path, Slack and Discord tokens live there). */
function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return 'invalid url';
  }
}

/**
 * Send webhook notification for incident
 */
async function sendIncidentWebhook(target: DeliveryTargets['webhooks'][number], job: IncidentNotificationJob, orgName: string): Promise<void> {
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
      link: `${frontendUrl}/dashboard/incidents/${job.incidentId}`,
    },
  });

  // Route through the centralized dispatcher (#218): SSRF guard, HMAC signing,
  // retry/backoff, DLQ, and delivery logging.
  await webhookDispatcher.enqueue({
    url: target.url,
    channelId: target.channelId,
    method: target.method,
    headers: target.headers,
    organizationId: job.organizationId,
    eventType: 'incident.created',
    eventId: `${job.incidentId}:${target.url}`,
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

  // STEP 1: Resolve destinations with the shared rule: channels attached to the
  // incident, else organization defaults, else the owners and admins email
  // fallback (only when nothing resolved and SMTP is configured).
  const routing = await resolveChannelsForEvent({
    organizationId: data.organizationId,
    eventType: 'incident',
    explicitChannels: await notificationChannelsService.getIncidentChannels(data.incidentId),
  });
  const targets = toDeliveryTargets(routing.channels);

  // STEP 2: In-app notifications for organization members
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
    console.log(`[IncidentNotification] No members to notify in-app for org ${data.organizationId}`);
  } else {
    console.log(`[IncidentNotification] Notifying ${members.length} members`);

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
          link: `/dashboard/incidents/${data.incidentId}`,
        },
      }).catch((err) => console.error(`[IncidentNotification] Failed to create notification for ${member.id}:`, err))
    );

    await Promise.all(notificationPromises);
    console.log(`[IncidentNotification] In-app notifications sent`);
  }

  // STEP 3: Email. Email destinations when they resolved; owners and admins
  // only when nothing resolved at all.
  const emailRecipients = routing.fallback
    ? await resolveFallbackEmails(data.organizationId)
    : targets.emailRecipients;

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

  // STEP 4: Webhook destinations (Slack, Teams and Discord URLs are formatted by the dispatcher)
  if (targets.webhooks.length > 0) {
    const webhookPromises = targets.webhooks.map((target) =>
      sendIncidentWebhook(target, data, org.name)
        .then(() => console.log(`[IncidentNotification] Webhook sent to ${hostOf(target.url)}`))
        .catch((err) => console.error(`[IncidentNotification] Webhook failed for ${hostOf(target.url)}:`, err))
    );

    await Promise.all(webhookPromises);
    console.log(`[IncidentNotification] Webhooks sent to ${targets.webhooks.length} URLs`);
  }

  // STEP 5: PagerDuty destinations
  if (targets.pagerDuty.length > 0) {
    await notifyPagerDutyTargets(targets.pagerDuty, {
      organizationId: data.organizationId,
      action: 'trigger',
      dedupKey: `incident:${data.incidentId}`,
      eventType: 'incident.created',
      summary: data.title,
      severity: data.severity,
      link: `${getFrontendUrl()}/dashboard/incidents/${data.incidentId}`,
      details: {
        description: data.description,
        affected_services: data.affectedServices,
        organization: org.name,
      },
    });
  }
}
