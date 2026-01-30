/**
 * Error Notification Job
 *
 * BullMQ job that sends notifications to organization members when a new exception occurs.
 * Notifications are sent for every occurrence EXCEPT if the error group status is 'ignored'.
 */

import nodemailer from 'nodemailer';
import type { IJob } from '../abstractions/types.js';
import { config, isSmtpConfigured } from '../../config/index.js';
import { db } from '../../database/connection.js';
import { notificationsService } from '../../modules/notifications/service.js';
import { createQueue } from '../connection.js';
import type { ExceptionLanguage } from '../../modules/exceptions/types.js';

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
}

// Create the queue
export const errorNotificationQueue = createQueue<ErrorNotificationJobData>('error-notifications');

// Language display names
const languageLabels: Record<ExceptionLanguage, string> = {
  nodejs: 'Node.js',
  python: 'Python',
  java: 'Java',
  go: 'Go',
  php: 'PHP',
  kotlin: 'Kotlin',
  csharp: 'C#',
  rust: 'Rust',
  ruby: 'Ruby',
  unknown: 'Unknown',
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
 * Generate HTML email for error notification
 */
function generateErrorEmailHtml(
  data: ErrorNotificationJobData,
  orgName: string,
  projectName: string,
  errorGroupId: string
): string {
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
  const errorUrl = `${frontendUrl}/dashboard/errors/${errorGroupId}`;
  const languageLabel = languageLabels[data.language];
  const isNew = data.isNewErrorGroup;

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${isNew ? 'New Error Detected' : 'Error Occurred'}</title>
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
                        <span style="font-size: 24px; font-weight: 700; color: #18181b;">
                          ${isNew ? '🆕 New Error Detected' : '🐛 Error Occurred'}
                        </span>
                      </td>
                      <td align="right">
                        <span style="display: inline-block; padding: 6px 12px; background-color: #dc2626; color: white; border-radius: 4px; font-size: 12px; font-weight: 600;">
                          ${languageLabel}
                        </span>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>

              <!-- Content -->
              <tr>
                <td style="padding: 32px;">
                  <h2 style="margin: 0 0 8px; font-size: 18px; font-weight: 600; color: #dc2626; font-family: monospace;">
                    ${data.exceptionType}
                  </h2>

                  ${data.exceptionMessage ? `
                    <p style="margin: 0 0 24px; font-size: 14px; color: #52525b; line-height: 1.6; font-family: monospace; word-break: break-word;">
                      ${data.exceptionMessage.substring(0, 200)}${data.exceptionMessage.length > 200 ? '...' : ''}
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
                          <tr>
                            <td style="padding-bottom: 8px;">
                              <span style="font-size: 12px; color: #71717a;">Project</span><br>
                              <span style="font-size: 14px; font-weight: 500; color: #18181b;">${projectName}</span>
                            </td>
                          </tr>
                          <tr>
                            <td>
                              <span style="font-size: 12px; color: #71717a;">Service</span><br>
                              <span style="font-size: 14px; font-weight: 500; color: #18181b; font-family: monospace;">${data.service}</span>
                            </td>
                          </tr>
                        </table>
                      </td>
                    </tr>
                  </table>

                  <table width="100%" cellpadding="0" cellspacing="0">
                    <tr>
                      <td align="center">
                        <a href="${errorUrl}" style="display: inline-block; padding: 12px 24px; background-color: #18181b; color: #ffffff; text-decoration: none; border-radius: 6px; font-size: 14px; font-weight: 500;">
                          View Error Details
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
                    This is an automated error alert from LogTide.<br>
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
 * Process error notification job
 */
export async function processErrorNotification(job: IJob<ErrorNotificationJobData>): Promise<void> {
  const data = job.data;
  console.log(`[ErrorNotification] Processing notification for exception ${data.exceptionId}`);

  // Check if error group is ignored
  const errorGroup = await db
    .selectFrom('error_groups')
    .select(['id', 'status'])
    .where('fingerprint', '=', data.fingerprint)
    .where('organization_id', '=', data.organizationId)
    .executeTakeFirst();

  if (!errorGroup) {
    console.log(`[ErrorNotification] Error group not found for fingerprint ${data.fingerprint}, skipping`);
    return;
  }

  if (errorGroup.status === 'ignored') {
    console.log(`[ErrorNotification] Error group ${errorGroup.id} is ignored, skipping notification`);
    return;
  }

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

  // Get organization members (owners and admins)
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

  const notificationTitle = data.isNewErrorGroup
    ? `New Error: ${data.exceptionType}`
    : `Error: ${data.exceptionType}`;

  const notificationMessage = data.exceptionMessage
    ? `${data.exceptionMessage.substring(0, 100)}${data.exceptionMessage.length > 100 ? '...' : ''}`
    : `An error occurred in ${data.service}`;

  // Send in-app notifications to all relevant members
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

  // Send email notifications if SMTP is configured
  if (isSmtpConfigured()) {
    const transporter = createTransporter();
    const emailHtml = generateErrorEmailHtml(data, org.name, project.name, errorGroup.id);
    const subject = data.isNewErrorGroup
      ? `[New Error] ${data.exceptionType} in ${data.service}`
      : `[Error] ${data.exceptionType} in ${data.service}`;

    const emailPromises = members.map((member) =>
      transporter.sendMail({
        from: config.SMTP_FROM,
        to: member.email,
        subject,
        html: emailHtml,
      }).catch((err) => console.error(`[ErrorNotification] Failed to send email to ${member.email}:`, err))
    );

    await Promise.all(emailPromises);
    console.log(`[ErrorNotification] Emails sent to ${members.length} members`);
  } else {
    console.log(`[ErrorNotification] SMTP not configured, skipping email notifications`);
  }
}
