/**
 * Hardware health notifications: one per worsening (degraded) and one per
 * recovery (recovered) of a host.
 *
 * Routing goes through the shared resolver (org defaults for `hardware` ->
 * owners/admins email fallback). The caller (the evaluation pass) has already
 * won the compare-and-set on the stored status, so this module never decides
 * WHETHER to send, only WHERE and WHAT. Every channel is best effort: a failed
 * delivery is logged and never throws.
 */
import nodemailer, { type TransportOptions } from 'nodemailer';
import type { HardwareFinding } from '@logtide/shared';
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
import { generateHardwareHealthEmail, getFrontendUrl } from '../../lib/email-templates.js';

export type HardwareNotificationKind = 'degraded' | 'recovered';

export interface NotifiableHardwareHost {
  id: string;
  hostName: string;
  projectId: string;
  projectName: string;
  organizationId: string;
}

export interface HardwareNotification {
  kind: HardwareNotificationKind;
  /** New status: warning or critical when degraded, ok when recovered. */
  status: 'ok' | 'warning' | 'critical';
  previousStatus: string;
  findings: HardwareFinding[];
  incidentId: string | null;
  changedAt: Date;
}

/** Findings named in a summary line (the host page lists them all). */
const SUMMARY_FINDINGS = 3;

export function hardwareHostLink(hostId: string): string {
  return `/dashboard/hardware/${hostId}`;
}

export function hardwareTitle(status: string, hostName: string): string {
  return status === 'ok' ? `Hardware recovered: ${hostName}` : `Hardware ${status}: ${hostName}`;
}

/** Plain summary: the worst findings, or the recovery line. */
export function describeHardwareChange(host: NotifiableHardwareHost, n: HardwareNotification): string {
  if (n.kind === 'recovered') return `${host.hostName} reports no hardware problems anymore.`;
  const top = n.findings.slice(0, SUMMARY_FINDINGS).map((f) => f.message);
  const more = n.findings.length - top.length;
  const tail = more > 0 ? ` (+${more.toLocaleString('en-US')} more)` : '';
  return top.length > 0 ? `${top.join('; ')}${tail}` : `${host.hostName} is ${n.status}.`;
}

export function buildHardwareHealthData(host: NotifiableHardwareHost, n: HardwareNotification) {
  return {
    host_id: host.id,
    host_name: host.hostName,
    project_id: host.projectId,
    project_name: host.projectName,
    status: n.status,
    previous_status: n.previousStatus,
    severity: n.status,
    title: hardwareTitle(n.status, host.hostName),
    message: describeHardwareChange(host, n),
    findings: n.kind === 'recovered' ? [] : n.findings.map(({ hwId, ...f }) => ({ ...f, hw_id: hwId })),
    incident_id: n.incidentId,
    changed_at: n.changedAt.toISOString(),
    link: `${getFrontendUrl()}${hardwareHostLink(host.id)}`,
  };
}

function eventTypeOf(kind: HardwareNotificationKind) {
  return kind === 'degraded' ? ('hardware.health.degraded' as const) : ('hardware.health.recovered' as const);
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

async function sendWebhook(
  target: DeliveryTargets['webhooks'][number],
  host: NotifiableHardwareHost,
  n: HardwareNotification
): Promise<void> {
  const type = eventTypeOf(n.kind);
  const envelope = buildEnvelope({
    type,
    organizationId: host.organizationId,
    projectId: host.projectId,
    data: buildHardwareHealthData(host, n),
  });
  await webhookDispatcher.enqueue({
    url: target.url,
    channelId: target.channelId,
    method: target.method,
    headers: target.headers,
    organizationId: host.organizationId,
    eventType: type,
    eventId: `hardware:${host.id}:${n.status}:${n.changedAt.toISOString()}:${target.url}`,
    payload: envelope,
  });
}

/** Send one hardware notification to every resolved destination. Never throws per channel. */
export async function notifyHardware(host: NotifiableHardwareHost, n: HardwareNotification): Promise<void> {
  const org = await db
    .selectFrom('organizations')
    .select(['id', 'name'])
    .where('id', '=', host.organizationId)
    .executeTakeFirst();
  if (!org) return;

  const routing = await resolveChannelsForEvent({
    organizationId: host.organizationId,
    eventType: 'hardware',
    projectId: host.projectId,
  });
  const targets = toDeliveryTargets(routing.channels);
  const data = buildHardwareHealthData(host, n);

  // In-app bell: on degradation only, for owners and admins, independent of routing.
  if (n.kind === 'degraded') {
    const members = await db
      .selectFrom('organization_members')
      .innerJoin('users', 'users.id', 'organization_members.user_id')
      .select(['users.id'])
      .where('organization_members.organization_id', '=', host.organizationId)
      .where('organization_members.role', 'in', ['owner', 'admin'])
      .execute();
    await Promise.all(
      members.map((m) =>
        notificationsService
          .createNotification({
            userId: m.id,
            title: data.title,
            message: data.message,
            type: 'hardware',
            organizationId: host.organizationId,
            projectId: host.projectId,
            metadata: {
              hostId: host.id,
              status: n.status,
              incidentId: n.incidentId,
              link: hardwareHostLink(host.id),
            },
          })
          .catch((err) => console.error(`[Hardware] in-app notification failed for ${m.id}:`, err))
      )
    );
  }

  const emailRecipients = routing.fallback
    ? await resolveFallbackEmails(host.organizationId)
    : targets.emailRecipients;
  if (isSmtpConfigured() && emailRecipients.length > 0) {
    const transporter = createTransporter();
    const { html, text } = generateHardwareHealthEmail({
      hostName: host.hostName,
      projectName: host.projectName,
      organizationName: org.name,
      kind: n.kind,
      status: n.status,
      previousStatus: n.previousStatus,
      findings: n.kind === 'degraded' ? n.findings.map((f) => f.message) : [],
      changedAt: data.changed_at,
      link: data.link,
    });
    const prefix = n.kind === 'recovered' ? 'RESOLVED' : n.status === 'critical' ? 'CRITICAL' : 'WARNING';
    await Promise.all(
      emailRecipients.map((email) =>
        transporter
          .sendMail({
            from: config.SMTP_FROM,
            to: email,
            subject: `[${prefix}] ${data.title}`,
            html,
            text,
          })
          .catch((err) => console.error(`[Hardware] email to ${email} failed:`, err))
      )
    );
  }

  await Promise.all(
    targets.webhooks.map((target) =>
      sendWebhook(target, host, n).catch((err) =>
        console.error(`[Hardware] webhook failed for ${hostOf(target.url)}:`, err)
      )
    )
  );

  if (targets.pagerDuty.length > 0) {
    await notifyPagerDutyTargets(targets.pagerDuty, {
      organizationId: host.organizationId,
      action: n.kind === 'degraded' ? 'trigger' : 'resolve',
      // One PagerDuty incident per LogTide incident (escalations update it).
      dedupKey: `hardware:${n.incidentId ?? host.id}`,
      eventType: eventTypeOf(n.kind),
      summary: data.title,
      severity: n.status === 'critical' ? 'critical' : n.status === 'warning' ? 'medium' : 'informational',
      link: data.link,
      details: {
        message: data.message,
        host: host.hostName,
        project: host.projectName,
        organization: org.name,
        previous_status: n.previousStatus,
      },
    });
  }
}

/**
 * PagerDuty resolve only, for the incident of a finished episode: sent on
 * recovery even when the LogTide incident was already resolved by hand or
 * the host is muted (mute suppresses triggers, never resolves), and when a
 * host is forgotten. Idempotent on the PagerDuty side (same dedup key as the
 * trigger). Never throws.
 */
export async function resolveHardwarePagerDuty(
  host: NotifiableHardwareHost,
  incidentId: string,
  reason: 'recovered' | 'forgotten'
): Promise<void> {
  try {
    const routing = await resolveChannelsForEvent({
      organizationId: host.organizationId,
      eventType: 'hardware',
      projectId: host.projectId,
    });
    const targets = toDeliveryTargets(routing.channels);
    if (targets.pagerDuty.length === 0) return;
    await notifyPagerDutyTargets(targets.pagerDuty, {
      organizationId: host.organizationId,
      action: 'resolve',
      dedupKey: `hardware:${incidentId}`,
      eventType: 'hardware.health.recovered',
      summary: reason === 'recovered' ? hardwareTitle('ok', host.hostName) : `Hardware host removed: ${host.hostName}`,
      severity: 'informational',
      link: `${getFrontendUrl()}${hardwareHostLink(host.id)}`,
      details: { host: host.hostName, project: host.projectName, reason },
    });
  } catch (error) {
    console.error(`[Hardware] PagerDuty resolve failed for host ${host.id}:`, error);
  }
}
