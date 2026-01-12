import { alertsService } from '../../modules/alerts/index.js';
import { notificationsService } from '../../modules/notifications/index.js';
import { db } from '../../database/connection.js';
import nodemailer from 'nodemailer';
import { config } from '../../config/index.js';

export interface AlertNotificationData {
  historyId: string;
  rule_id: string;
  rule_name: string;
  organization_id: string;
  project_id: string | null;
  log_count: number;
  threshold: number;
  time_window: number;
  email_recipients: string[];
  webhook_url?: string;
}

// Create email transporter (reused across notifications)
let emailTransporter: nodemailer.Transporter | null = null;

function getEmailTransporter() {
  if (!emailTransporter) {
    // Check if SMTP is configured
    if (!config.SMTP_HOST || !config.SMTP_USER || !config.SMTP_PASS) {
      console.warn('⚠️  SMTP not configured - email notifications disabled');
      return null;
    }

    emailTransporter = nodemailer.createTransport({
      host: config.SMTP_HOST,
      port: config.SMTP_PORT || 587,
      secure: config.SMTP_SECURE || false, // true for 465, false for other ports
      auth: {
        user: config.SMTP_USER,
        pass: config.SMTP_PASS,
      },
    });

    console.log(`📧 Email transporter configured: ${config.SMTP_HOST}:${config.SMTP_PORT}`);
  }

  return emailTransporter;
}

export async function processAlertNotification(job: any) {
  const data: AlertNotificationData = job.data;

  console.log(`Processing alert notification: ${data.rule_name}`);

  const errors: string[] = [];

  try {
    // Create in-app notifications for organization members
    try {
      await createInAppNotifications(data);
      console.log(`✅ In-app notifications created: ${data.rule_name}`);
    } catch (error) {
      const errMsg = `In-app notification failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
      console.error(`❌ ${errMsg}`);
      errors.push(errMsg);
    }

    // Send email notifications
    if (data.email_recipients && data.email_recipients.length > 0) {
      try {
        await sendEmailNotification(data);
        console.log(`✅ Email notifications sent: ${data.rule_name} (${data.email_recipients.length} recipients)`);
      } catch (error) {
        const errMsg = `Email failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
        console.error(`❌ ${errMsg}`);
        errors.push(errMsg);
      }
    } else {
      console.log(`⚠️  No email recipients configured for: ${data.rule_name}`);
    }

    // Send webhook notification
    if (data.webhook_url) {
      try {
        await sendWebhookNotification(data);
        console.log(`✅ Webhook notification sent: ${data.rule_name}`);
      } catch (error) {
        const errMsg = `Webhook failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
        console.error(`❌ ${errMsg}`);
        errors.push(errMsg);
      }
    } else {
      console.log(`⚠️  No webhook configured for: ${data.rule_name}`);
    }

    // Mark as notified (with errors if any)
    if (errors.length > 0) {
      await alertsService.markAsNotified(data.historyId, errors.join('; '));
    } else {
      await alertsService.markAsNotified(data.historyId);
    }

    console.log(`Alert notification processed: ${data.rule_name}`);
  } catch (error) {
    console.error(`Failed to process alert notification: ${data.rule_name}`, error);
    await alertsService.markAsNotified(
      data.historyId,
      error instanceof Error ? error.message : 'Unknown error'
    );
    throw error;
  }
}

async function sendEmailNotification(data: AlertNotificationData) {
  const transporter = getEmailTransporter();

  if (!transporter) {
    throw new Error('Email transporter not configured');
  }

  const subject = `🚨 Alert: ${data.rule_name}`;
  const html = `
    <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background-color: #dc2626; color: white; padding: 20px; border-radius: 8px 8px 0 0; }
          .content { background-color: #f9fafb; padding: 20px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px; }
          .metric { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #e5e7eb; }
          .metric:last-child { border-bottom: none; }
          .label { font-weight: bold; }
          .value { color: #dc2626; font-weight: bold; }
          .footer { margin-top: 20px; padding-top: 20px; border-top: 1px solid #e5e7eb; font-size: 12px; color: #6b7280; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1 style="margin: 0;">🚨 Alert Triggered</h1>
            <p style="margin: 10px 0 0 0;">${data.rule_name}</p>
          </div>
          <div class="content">
            <h2 style="margin-top: 0;">Alert Details</h2>

            <div class="metric">
              <span class="label">Log Count:</span>
              <span class="value">${data.log_count}</span>
            </div>

            <div class="metric">
              <span class="label">Threshold:</span>
              <span>${data.threshold}</span>
            </div>

            <div class="metric">
              <span class="label">Time Window:</span>
              <span>${data.time_window} minutes</span>
            </div>

            <div class="metric">
              <span class="label">Triggered At:</span>
              <span>${new Date().toLocaleString()}</span>
            </div>

            <div style="margin-top: 20px; padding: 15px; background-color: #fee2e2; border-left: 4px solid #dc2626; border-radius: 4px;">
              <strong>Action Required:</strong> Your application has generated <strong>${data.log_count}</strong> logs
              in the last <strong>${data.time_window}</strong> minutes, exceeding the threshold of <strong>${data.threshold}</strong>.
            </div>
          </div>

          <div class="footer">
            <p>This is an automated alert from LogTide.</p>
            <p>To manage your alerts, visit your LogTide dashboard.</p>
          </div>
        </div>
      </body>
    </html>
  `;

  const text = `
🚨 Alert Triggered: ${data.rule_name}

Alert Details:
- Log Count: ${data.log_count}
- Threshold: ${data.threshold}
- Time Window: ${data.time_window} minutes
- Triggered At: ${new Date().toLocaleString()}

Your application has generated ${data.log_count} logs in the last ${data.time_window} minutes, exceeding the threshold of ${data.threshold}.

This is an automated alert from LogTide.
  `.trim();

  // Send email to all recipients
  await transporter.sendMail({
    from: `"LogTide Alerts" <${config.SMTP_FROM || config.SMTP_USER}>`,
    to: data.email_recipients.join(', '),
    subject,
    text,
    html,
  });

  console.log(`Email sent to: ${data.email_recipients.join(', ')}`);
}

async function sendWebhookNotification(data: AlertNotificationData) {
  if (!data.webhook_url) return;

  const response = await fetch(data.webhook_url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      alert_name: data.rule_name,
      log_count: data.log_count,
      threshold: data.threshold,
      time_window: data.time_window,
      timestamp: new Date().toISOString(),
    }),
  });

  if (!response.ok) {
    throw new Error(`Webhook request failed: ${response.statusText}`);
  }

  console.log(`Webhook notification sent to: ${data.webhook_url}`);
}

async function createInAppNotifications(data: AlertNotificationData) {
  // Get all members of the organization
  const members = await db
    .selectFrom('organization_members')
    .select(['user_id'])
    .where('organization_id', '=', data.organization_id)
    .execute();

  if (members.length === 0) {
    console.log(`⚠️  No members found for organization: ${data.organization_id}`);
    return;
  }

  // Get project name if applicable
  let projectName: string | null = null;
  if (data.project_id) {
    const project = await db
      .selectFrom('projects')
      .select(['name'])
      .where('id', '=', data.project_id)
      .executeTakeFirst();
    projectName = project?.name || null;
  }

  // Create notification for each member
  const notificationPromises = members.map((member) => {
    const title = `🚨 Alert Triggered: ${data.rule_name}`;
    const message = projectName
      ? `${data.log_count} logs exceeded threshold of ${data.threshold} in ${data.time_window} minutes for project ${projectName}.`
      : `${data.log_count} logs exceeded threshold of ${data.threshold} in ${data.time_window} minutes.`;

    return notificationsService.createNotification({
      userId: member.user_id,
      type: 'alert',
      title,
      message,
      organizationId: data.organization_id,
      projectId: data.project_id || undefined,
      metadata: {
        alertRuleId: data.rule_id,
        historyId: data.historyId,
        logCount: data.log_count,
        threshold: data.threshold,
        timeWindow: data.time_window,
      },
    });
  });

  await Promise.all(notificationPromises);

  console.log(`📢 Created ${members.length} in-app notification(s) for alert: ${data.rule_name}`);
}
