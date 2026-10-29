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
import { notifyPagerDutyTargets, hostOf } from '../../modules/notification-channels/dispatch.js';
import { createQueue } from '../connection.js';
import { generateMonitorEmail, getFrontendUrl } from '../../lib/email-templates.js';
import { webhookDispatcher, buildEnvelope } from '../../modules/webhooks/index.js';
import type { Severity } from '@logtide/shared';

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
  /** Shared incident opened for this outage (F4), when there is one. */
  incidentId?: string | null;
  /** Set when a user disabled or deleted the monitor while it was down. */
  resolvedBy?: 'disabled' | 'deleted';
  /** Channels the monitor had when this was queued (a delete removes the links). */
  channelIds?: string[];
}

/**
 * Where a monitor notification points: the shared incident when one exists,
 * otherwise the monitor detail page. Relative; callers prefix the frontend URL.
 */
function monitorNotificationLink(job: Pick<MonitorNotificationJob, 'monitorId' | 'incidentId'>): string {
  return job.incidentId
    ? `/dashboard/incidents/${job.incidentId}`
    : `/dashboard/uptime/${job.monitorId}`;
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

async function sendMonitorWebhook(target: DeliveryTargets['webhooks'][number], job: MonitorNotificationJob, orgName: string): Promise<void> {
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
      incident_id: job.incidentId ?? null,
      link: `${frontendUrl}${monitorNotificationLink(job)}`,
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
    eventType: 'monitor.status_changed',
    eventId: `${job.monitorId}:${job.status}:${target.url}`,
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

  // Resolve destinations with the shared rule: channels attached to the
  // monitor, else organization defaults for monitoring, else the owners and
  // admins email fallback (only when nothing resolved and SMTP is configured).
  const routing = await resolveChannelsForEvent({
    organizationId: data.organizationId,
    eventType: 'monitoring',
    ...(data.channelIds && data.channelIds.length > 0
      ? { explicitChannelIds: data.channelIds }
      : { explicitChannels: await notificationChannelsService.getMonitorChannels(data.monitorId) }),
  });
  const targets = toDeliveryTargets(routing.channels);

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
    console.log(`[MonitorNotification] No members to notify in-app for org ${data.organizationId}`);
  }

  // In-app notifications
  const title = isDown
    ? `Monitor down: ${data.monitorName}`
    : `Monitor recovered: ${data.monitorName}`;

  const message = isDown
    ? `${data.monitorName} is not responding${data.errorCode ? ` (${data.errorCode})` : ''}`
    : data.resolvedBy
      ? `${data.monitorName} was ${data.resolvedBy} while it was down`
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
        incidentId: data.incidentId ?? null,
        link: monitorNotificationLink(data),
      },
    }).catch((err) => console.error(`[MonitorNotification] Failed to create notification for ${member.id}:`, err))
  );

  await Promise.all(notificationPromises);
  console.log(`[MonitorNotification] In-app notifications sent to ${members.length} members`);

  // Email notifications
  const emailRecipients = routing.fallback
    ? await resolveFallbackEmails(data.organizationId)
    : targets.emailRecipients;

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
      incidentId: data.incidentId,
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
  if (targets.webhooks.length > 0) {
    const webhookPromises = targets.webhooks.map((target) =>
      sendMonitorWebhook(target, data, org.name)
        .then(() => console.log(`[MonitorNotification] Webhook sent to ${hostOf(target.url)}`))
        .catch((err) => console.error(`[MonitorNotification] Webhook failed for ${hostOf(target.url)}:`, err))
    );

    await Promise.all(webhookPromises);
  }

  // PagerDuty: trigger on down, resolve on recovery, one dedup key per monitor.
  if (targets.pagerDuty.length > 0) {
    await notifyPagerDutyTargets(targets.pagerDuty, {
      organizationId: data.organizationId,
      action: isDown ? 'trigger' : 'resolve',
      dedupKey: `monitor:${data.monitorId}`,
      eventType: 'monitor.status_changed',
      summary: title,
      severity: data.severity,
      link: `${getFrontendUrl()}${monitorNotificationLink(data)}`,
      details: {
        message,
        target: data.target,
        error_code: data.errorCode,
        consecutive_failures: data.consecutiveFailures,
        incident_id: data.incidentId ?? null,
        organization: org.name,
      },
    });
  }
}
