/**
 * Project health notifications: one open and one resolve per issue episode.
 *
 * Routing goes through the shared resolver (per-project override channels ->
 * org defaults for `project_health` -> owners/admins email fallback). The
 * caller (evaluator) claims the notification row before calling here, so this
 * module never decides WHETHER to send, only WHERE and WHAT.
 */

import nodemailer, { type TransportOptions } from 'nodemailer';
import {
  PROJECT_HEALTH_CHECKS,
  type ProjectHealthCheckKey,
  type ProjectHealthSeverity,
} from '@logtide/shared';
import { config, isSmtpConfigured } from '../../config/index.js';
import { db } from '../../database/connection.js';
import { notificationsService } from '../notifications/service.js';
import {
  resolveChannelsForEvent,
  resolveFallbackEmails,
  toDeliveryTargets,
  type DeliveryTargets,
} from '../notification-channels/resolver.js';
import { notifyPagerDutyTargets, hostOf } from '../notification-channels/dispatch.js';
import { webhookDispatcher, buildEnvelope } from '../webhooks/index.js';
import { generateProjectHealthEmail, getFrontendUrl } from '../../lib/email-templates.js';
import { getProjectHealthSettings } from './settings.js';

export type ProjectHealthNotificationKind = 'opened' | 'resolved';

export interface NotifiableIssue {
  id: string;
  checkKey: ProjectHealthCheckKey;
  severity: ProjectHealthSeverity;
  openedAt: Date;
  resolvedAt: Date | null;
  details: Record<string, unknown>;
}

export interface NotifiableProject {
  id: string;
  name: string;
  organizationId: string;
}

export interface NotifyOptions {
  /** Per-project override channels; loaded from the settings when omitted. */
  healthChannelIds?: string[];
}

function plural(n: number, singular: string, pluralForm: string): string {
  return `${n.toLocaleString('en-US')} ${n === 1 ? singular : pluralForm}`;
}

function humanizeMs(ms: number): string {
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return plural(minutes, 'minute', 'minutes');
  const hours = Math.round(ms / 3600000);
  if (hours < 48) return plural(hours, 'hour', 'hours');
  return plural(Math.round(hours / 24), 'day', 'days');
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

const SKEW_NOUN: Record<string, { singular: string; plural: string }> = {
  timestamp_skew_logs: { singular: 'log', plural: 'logs' },
  timestamp_skew_spans: { singular: 'span', plural: 'spans' },
  timestamp_skew_metrics: { singular: 'metric', plural: 'metrics' },
};

/** Plain-language explanation of an open issue (skew wording follows IngestionSkewBanner). */
export function describeIssue(issue: NotifiableIssue, projectName: string, now: Date = new Date()): string {
  const d = issue.details;
  switch (issue.checkKey) {
    case 'silent': {
      const last = typeof d.lastEventAt === 'string' ? new Date(d.lastEventAt) : null;
      const since = last ? ` for ${humanizeMs(now.getTime() - last.getTime())}` : '';
      return `${projectName} has not sent any logs, spans or metrics${since}. Check that the shipper or SDK is running and can reach LogTide.`;
    }
    case 'pii_rejected': {
      const count = num(d.count60m) ?? 0;
      return `In the last 60 minutes, ${plural(count, 'record was', 'records were')} rejected because PII masking failed on them. Rejected records are not stored.`;
    }
    case 'revoked_key':
      return `In the last 60 minutes, ingest requests for ${projectName} used a revoked API key and were rejected. Update the sender with an active key.`;
    case 'timestamp_skew_logs':
    case 'timestamp_skew_spans':
    case 'timestamp_skew_metrics': {
      const count = num(d.count24h) ?? 0;
      const noun = SKEW_NOUN[issue.checkKey];
      const past = num(d.maxPastHours);
      const future = num(d.maxFutureHours);
      let direction = '';
      if (past !== null && (future === null || past >= future)) {
        direction = ` up to ${humanizeMs(past * 3_600_000)} in the past`;
      } else if (future !== null) {
        direction = ` up to ${humanizeMs(future * 3_600_000)} ahead of the server clock`;
      }
      return `In the last 24 hours, ${count.toLocaleString('en-US')} ${count === 1 ? noun.singular : noun.plural} arrived with a timestamp${direction}. This usually means the sender clock or the time field it sends is wrong.`;
    }
  }
}

function messageFor(issue: NotifiableIssue, project: NotifiableProject, kind: ProjectHealthNotificationKind): string {
  if (kind === 'resolved') {
    return issue.checkKey === 'silent'
      ? `${project.name} is sending data again.`
      : `${PROJECT_HEALTH_CHECKS[issue.checkKey].title} is resolved for ${project.name}.`;
  }
  return describeIssue(issue, project.name);
}

function createTransporter() {
  const opts: Record<string, unknown> = {
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure: config.SMTP_SECURE,
  };
  if (config.SMTP_USER && config.SMTP_PASS) {
    opts.auth = { user: config.SMTP_USER, pass: config.SMTP_PASS };
  }
  return nodemailer.createTransport(opts as TransportOptions);
}

export function projectHealthLink(projectId: string): string {
  return `/dashboard/projects/${projectId}`;
}

export function buildProjectHealthData(
  issue: NotifiableIssue,
  project: NotifiableProject,
  kind: ProjectHealthNotificationKind
) {
  return {
    project_id: project.id,
    project_name: project.name,
    check_key: issue.checkKey,
    severity: issue.severity,
    title: PROJECT_HEALTH_CHECKS[issue.checkKey].title,
    message: messageFor(issue, project, kind),
    opened_at: issue.openedAt.toISOString(),
    resolved_at: kind === 'resolved' && issue.resolvedAt ? issue.resolvedAt.toISOString() : null,
    details: issue.details,
    link: `${getFrontendUrl()}${projectHealthLink(project.id)}`,
  };
}

async function sendWebhook(
  target: DeliveryTargets['webhooks'][number],
  issue: NotifiableIssue,
  project: NotifiableProject,
  kind: ProjectHealthNotificationKind
): Promise<void> {
  const type = kind === 'opened' ? 'project.health.opened' : 'project.health.resolved';
  const envelope = buildEnvelope({
    type,
    organizationId: project.organizationId,
    projectId: project.id,
    data: buildProjectHealthData(issue, project, kind),
  });
  await webhookDispatcher.enqueue({
    url: target.url,
    channelId: target.channelId,
    method: target.method,
    headers: target.headers,
    organizationId: project.organizationId,
    eventType: type,
    eventId: `project-health:${issue.id}:${kind}:${target.url}`,
    payload: envelope,
  });
}

/** Send one project health notification to every resolved destination. Never throws per channel. */
export async function notifyProjectHealth(
  issue: NotifiableIssue,
  project: NotifiableProject,
  kind: ProjectHealthNotificationKind,
  opts: NotifyOptions = {}
): Promise<void> {
  const org = await db
    .selectFrom('organizations')
    .select(['id', 'name'])
    .where('id', '=', project.organizationId)
    .executeTakeFirst();
  if (!org) return;

  const healthChannelIds =
    opts.healthChannelIds ??
    (await getProjectHealthSettings(project.organizationId, project.id)).healthChannelIds;

  const routing = await resolveChannelsForEvent({
    organizationId: project.organizationId,
    eventType: 'project_health',
    explicitChannelIds: healthChannelIds,
    projectId: project.id,
  });
  const targets = toDeliveryTargets(routing.channels);
  const data = buildProjectHealthData(issue, project, kind);
  const title =
    kind === 'opened'
      ? `${data.title}: ${project.name}`
      : `Resolved: ${data.title} (${project.name})`;

  // In-app bell: on open only, for owners and admins, independent of routing.
  if (kind === 'opened') {
    const members = await db
      .selectFrom('organization_members')
      .innerJoin('users', 'users.id', 'organization_members.user_id')
      .select(['users.id'])
      .where('organization_members.organization_id', '=', project.organizationId)
      .where('organization_members.role', 'in', ['owner', 'admin'])
      .execute();
    await Promise.all(
      members.map((m) =>
        notificationsService
          .createNotification({
            userId: m.id,
            title,
            message: data.message,
            type: 'project_health',
            organizationId: project.organizationId,
            projectId: project.id,
            metadata: {
              issueId: issue.id,
              checkKey: issue.checkKey,
              severity: issue.severity,
              link: projectHealthLink(project.id),
            },
          })
          .catch((err) => console.error(`[ProjectHealth] in-app notification failed for ${m.id}:`, err))
      )
    );
  }

  const emailRecipients = routing.fallback
    ? await resolveFallbackEmails(project.organizationId)
    : targets.emailRecipients;
  if (isSmtpConfigured() && emailRecipients.length > 0) {
    const transporter = createTransporter();
    const { html, text } = generateProjectHealthEmail({
      projectName: project.name,
      organizationName: org.name,
      kind,
      severity: issue.severity,
      title: data.title,
      message: data.message,
      openedAt: data.opened_at,
      resolvedAt: data.resolved_at,
      link: data.link,
    });
    const prefix = kind === 'opened' ? (issue.severity === 'critical' ? 'CRITICAL' : 'WARNING') : 'RESOLVED';
    await Promise.all(
      emailRecipients.map((email) =>
        transporter
          .sendMail({
            from: config.SMTP_FROM,
            to: email,
            subject: `[${prefix}] ${project.name}: ${data.title}`,
            html,
            text,
          })
          .catch((err) => console.error(`[ProjectHealth] email to ${email} failed:`, err))
      )
    );
  }

  await Promise.all(
    targets.webhooks.map((target) =>
      sendWebhook(target, issue, project, kind).catch((err) =>
        console.error(`[ProjectHealth] webhook failed for ${hostOf(target.url)}:`, err)
      )
    )
  );

  if (targets.pagerDuty.length > 0) {
    await notifyPagerDutyTargets(targets.pagerDuty, {
      organizationId: project.organizationId,
      action: kind === 'opened' ? 'trigger' : 'resolve',
      dedupKey: `project-health:${issue.id}`,
      eventType: kind === 'opened' ? 'project.health.opened' : 'project.health.resolved',
      summary: title,
      severity: issue.severity === 'critical' ? 'critical' : 'medium',
      link: data.link,
      details: { message: data.message, project: project.name, check_key: issue.checkKey, organization: org.name },
    });
  }
}
