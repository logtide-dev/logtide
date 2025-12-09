import nodemailer from 'nodemailer';
import type { Job } from 'bullmq';
import { config, isSmtpConfigured } from '../../config/index.js';
import { db } from '../../database/connection.js';
import { notificationsService } from '../../modules/notifications/service.js';
import { createQueue } from '../connection.js';
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

// Severity colors for email
const severityColors: Record<Severity, string> = {
  critical: '#dc2626',
  high: '#ea580c',
  medium: '#ca8a04',
  low: '#2563eb',
  informational: '#6b7280',
};

/**
 * Create the email transporter
 */
function createTransporter() {
  return nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure: config.SMTP_SECURE,
    auth: {
      user: config.SMTP_USER,
      pass: config.SMTP_PASS,
    },
  });
}

/**
 * Generate HTML email for incident notification
 */
function generateIncidentEmailHtml(job: IncidentNotificationJob, orgName: string): string {
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
  const incidentUrl = `${frontendUrl}/dashboard/security/incidents/${job.incidentId}`;
  const severityColor = severityColors[job.severity];
  const severityLabel = severityLabels[job.severity];

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Security Incident Alert</title>
    </head>
    <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f4f4f5;">
      <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f4f5; padding: 40px 20px;">
        <tr>
          <td align="center">
            <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 600px; background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
              <!-- Header -->
              <tr>
                <td style="padding: 32px 32px 24px; border-bottom: 1px solid #e4e4e7;">
                  <table width="100%" cellpadding="0" cellspacing="0">
                    <tr>
                      <td>
                        <span style="font-size: 24px; font-weight: 700; color: #18181b;">🚨 Security Incident</span>
                      </td>
                      <td align="right">
                        <span style="display: inline-block; padding: 6px 12px; background-color: ${severityColor}; color: white; border-radius: 4px; font-size: 12px; font-weight: 600; text-transform: uppercase;">
                          ${severityLabel}
                        </span>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>

              <!-- Content -->
              <tr>
                <td style="padding: 32px;">
                  <h2 style="margin: 0 0 16px; font-size: 20px; font-weight: 600; color: #18181b;">
                    ${job.title}
                  </h2>

                  ${job.description ? `
                    <p style="margin: 0 0 24px; font-size: 14px; color: #52525b; line-height: 1.6;">
                      ${job.description}
                    </p>
                  ` : ''}

                  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f4f5; border-radius: 6px; margin-bottom: 24px;">
                    <tr>
                      <td style="padding: 16px;">
                        <table width="100%" cellpadding="0" cellspacing="0">
                          <tr>
                            <td style="padding-bottom: 8px;">
                              <span style="font-size: 12px; color: #71717a;">Organization</span><br>
                              <span style="font-size: 14px; font-weight: 500; color: #18181b;">${orgName}</span>
                            </td>
                          </tr>
                          ${job.affectedServices && job.affectedServices.length > 0 ? `
                            <tr>
                              <td style="padding-top: 8px;">
                                <span style="font-size: 12px; color: #71717a;">Affected Services</span><br>
                                <span style="font-size: 14px; font-weight: 500; color: #18181b;">${job.affectedServices.join(', ')}</span>
                              </td>
                            </tr>
                          ` : ''}
                        </table>
                      </td>
                    </tr>
                  </table>

                  <table width="100%" cellpadding="0" cellspacing="0">
                    <tr>
                      <td align="center">
                        <a href="${incidentUrl}" style="display: inline-block; padding: 12px 24px; background-color: #18181b; color: #ffffff; text-decoration: none; border-radius: 6px; font-size: 14px; font-weight: 500;">
                          View Incident Details
                        </a>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>

              <!-- Footer -->
              <tr>
                <td style="padding: 24px 32px; background-color: #f4f4f5; border-radius: 0 0 8px 8px;">
                  <p style="margin: 0; font-size: 12px; color: #71717a; text-align: center;">
                    This is an automated security alert from LogWard.<br>
                    <a href="${frontendUrl}/dashboard/settings" style="color: #18181b;">Manage notification preferences</a>
                  </p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `;
}

/**
 * Process incident notification job
 */
export async function processIncidentNotification(job: Job<IncidentNotificationJob>): Promise<void> {
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

  // Get all members of the organization (owners and admins for critical/high, all for others)
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

  // Send in-app notifications to all relevant members
  const notificationPromises = members.map((member) =>
    notificationsService.createNotification({
      userId: member.id,
      title: `Security Incident: ${severityLabels[data.severity]}`,
      message: data.title,
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

  // Send email notifications if SMTP is configured
  if (isSmtpConfigured()) {
    const transporter = createTransporter();
    const emailHtml = generateIncidentEmailHtml(data, org.name);

    const emailPromises = members.map((member) =>
      transporter.sendMail({
        from: config.SMTP_FROM,
        to: member.email,
        subject: `[${severityLabels[data.severity]}] Security Incident: ${data.title}`,
        html: emailHtml,
      }).catch((err) => console.error(`[IncidentNotification] Failed to send email to ${member.email}:`, err))
    );

    await Promise.all(emailPromises);
    console.log(`[IncidentNotification] Emails sent to ${members.length} members`);
  } else {
    console.log(`[IncidentNotification] SMTP not configured, skipping email notifications`);
  }
}
