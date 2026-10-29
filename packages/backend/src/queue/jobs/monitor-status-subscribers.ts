import type { IJob } from '../abstractions/types.js';
import { config, isSmtpConfigured } from '../../config/index.js';
import { db } from '../../database/connection.js';
import { getMailer } from '../../lib/mailer.js';
import { createQueue } from '../connection.js';
import { StatusPageService } from '../../modules/monitoring/status-page.js';
import { makeUnsubscribeToken } from '../../modules/monitoring/subscribers.js';
import {
  generateStatusUpdateEmail,
  statusPageUrl,
  type StatusUpdateKind,
} from '../../modules/monitoring/status-emails.js';

/**
 * Emails the confirmed subscribers of a public status page when a status
 * update or a maintenance is published. Enqueueing is best effort: a broken
 * queue must never fail the request that published the update.
 */

export interface StatusSubscriberJob {
  kind: StatusUpdateKind;
  organizationId: string;
  projectId: string;
  title: string;
  status?: string;
  message?: string;
  scheduledStart?: string;
  scheduledEnd?: string;
}

export const statusSubscriberQueue = createQueue<StatusSubscriberJob>('status-subscriber-notifications');

const BATCH_SIZE = 50;

export async function enqueueStatusSubscriberNotification(job: StatusSubscriberJob): Promise<void> {
  try {
    await statusSubscriberQueue.add(`status-subscriber-${job.kind}`, job);
  } catch (err) {
    console.error('[StatusSubscribers] failed to enqueue notification:', err instanceof Error ? err.message : err);
  }
}

export async function processStatusSubscriberNotification(
  job: IJob<StatusSubscriberJob>
): Promise<void> {
  const data = job.data;
  if (!isSmtpConfigured()) return;
  const mailer = getMailer();
  if (!mailer) return;

  // Tenant-scoped load: the page must belong to the organization of the job
  // and still be public, otherwise nothing is sent.
  const project = await db
    .selectFrom('projects')
    .innerJoin('organizations', 'organizations.id', 'projects.organization_id')
    .select([
      'projects.id',
      'projects.name',
      'projects.slug',
      'projects.status_page_visibility',
      'organizations.slug as org_slug',
    ])
    .where('projects.id', '=', data.projectId)
    .where('projects.organization_id', '=', data.organizationId)
    .executeTakeFirst();
  if (!project || project.status_page_visibility !== 'public') return;

  const cfg = await new StatusPageService(db).getConfig(project.id, data.organizationId);
  const pageTitle = cfg.title ?? project.name;
  const pageUrl = statusPageUrl(project.org_slug, project.slug);

  const subscribers = await db
    .selectFrom('status_page_subscribers')
    .select(['id', 'email'])
    .where('organization_id', '=', data.organizationId)
    .where('project_id', '=', project.id)
    .where('confirmed_at', 'is not', null)
    .orderBy('created_at', 'asc')
    .orderBy('id', 'asc')
    .execute();

  let failed = 0;
  for (let i = 0; i < subscribers.length; i += BATCH_SIZE) {
    const batch = subscribers.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map((sub) => {
        const unsubscribeUrl = `${pageUrl}/unsubscribe?token=${encodeURIComponent(makeUnsubscribeToken(sub.id))}`;
        const mail = generateStatusUpdateEmail({
          kind: data.kind,
          pageTitle,
          accentColor: cfg.accentColor,
          title: data.title,
          status: data.status,
          message: data.message,
          scheduledStart: data.scheduledStart,
          scheduledEnd: data.scheduledEnd,
          pageUrl,
          unsubscribeUrl,
        });
        return mailer.sendMail({
          from: config.SMTP_FROM || 'noreply@logtide.local',
          to: sub.email,
          subject: mail.subject,
          html: mail.html,
          text: mail.text,
          headers: { 'List-Unsubscribe': `<${unsubscribeUrl}>` },
        });
      })
    );
    failed += results.filter((r) => r.status === 'rejected').length;
  }

  if (failed > 0) {
    console.error(`[StatusSubscribers] ${failed} of ${subscribers.length} emails failed for ${project.slug}`);
  }
}
