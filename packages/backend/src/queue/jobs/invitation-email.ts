import nodemailer from 'nodemailer';
import { config } from '../../config/index.js';

export interface InvitationEmailData {
  email: string;
  token: string;
  organizationId: string;
  organizationName: string;
  inviterName: string;
  role: string;
}

// Create email transporter (reused across notifications)
let emailTransporter: nodemailer.Transporter | null = null;

function getEmailTransporter() {
  if (!emailTransporter) {
    // Check if SMTP is configured
    if (!config.SMTP_HOST || !config.SMTP_USER || !config.SMTP_PASS) {
      console.warn('SMTP not configured - invitation emails disabled');
      return null;
    }

    emailTransporter = nodemailer.createTransport({
      host: config.SMTP_HOST,
      port: config.SMTP_PORT || 587,
      secure: config.SMTP_SECURE || false,
      auth: {
        user: config.SMTP_USER,
        pass: config.SMTP_PASS,
      },
    });

    console.log(`Email transporter configured: ${config.SMTP_HOST}:${config.SMTP_PORT}`);
  }

  return emailTransporter;
}

export async function processInvitationEmail(job: any) {
  const data: InvitationEmailData = job.data;

  console.log(`Processing invitation email for: ${data.email}`);

  try {
    await sendInvitationEmail(data);
    console.log(`Invitation email sent to: ${data.email}`);
  } catch (error) {
    console.error(`Failed to send invitation email to ${data.email}:`, error);
    throw error;
  }
}

async function sendInvitationEmail(data: InvitationEmailData) {
  const transporter = getEmailTransporter();

  if (!transporter) {
    throw new Error('Email transporter not configured');
  }

  // Build the invitation URL
  // In production, this should be configured. For now, use environment-based defaults.
  const baseUrl = process.env.FRONTEND_URL || (config.NODE_ENV === 'production' ? 'https://logward.dev' : 'http://localhost:5173');
  const inviteUrl = `${baseUrl}/invite/${data.token}`;

  const subject = `You've been invited to join ${data.organizationName} on LogWard`;
  const html = `
    <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background-color: #2563eb; color: white; padding: 20px; border-radius: 8px 8px 0 0; text-align: center; }
          .content { background-color: #f9fafb; padding: 30px; border: 1px solid #e5e7eb; border-top: none; }
          .footer { padding: 20px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px; font-size: 12px; color: #6b7280; text-align: center; }
          .button { display: inline-block; background-color: #2563eb; color: white !important; padding: 12px 30px; text-decoration: none; border-radius: 6px; font-weight: bold; margin: 20px 0; }
          .button:hover { background-color: #1d4ed8; }
          .role-badge { display: inline-block; background-color: #dbeafe; color: #1e40af; padding: 4px 12px; border-radius: 4px; font-size: 14px; font-weight: 500; }
          .info { background-color: #eff6ff; border-left: 4px solid #2563eb; padding: 15px; margin: 20px 0; border-radius: 4px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1 style="margin: 0;">You're Invited!</h1>
          </div>
          <div class="content">
            <p>Hi there,</p>

            <p><strong>${data.inviterName}</strong> has invited you to join <strong>${data.organizationName}</strong> on LogWard.</p>

            <div class="info">
              <p style="margin: 0;"><strong>Role:</strong> <span class="role-badge">${data.role}</span></p>
            </div>

            <div style="text-align: center;">
              <a href="${inviteUrl}" class="button">Accept Invitation</a>
            </div>

            <p style="font-size: 14px; color: #6b7280;">
              This invitation link will expire in 7 days. If you didn't expect this invitation, you can safely ignore this email.
            </p>

            <p style="font-size: 12px; color: #9ca3af; word-break: break-all;">
              Or copy and paste this link into your browser:<br>
              <a href="${inviteUrl}" style="color: #2563eb;">${inviteUrl}</a>
            </p>
          </div>
          <div class="footer">
            <p>This is an automated message from LogWard.</p>
            <p>&copy; ${new Date().getFullYear()} LogWard. All rights reserved.</p>
          </div>
        </div>
      </body>
    </html>
  `;

  const text = `
You're Invited to ${data.organizationName}!

${data.inviterName} has invited you to join ${data.organizationName} on LogWard as a ${data.role}.

Click the link below to accept the invitation:
${inviteUrl}

This invitation link will expire in 7 days.

If you didn't expect this invitation, you can safely ignore this email.

---
This is an automated message from LogWard.
  `.trim();

  await transporter.sendMail({
    from: `"LogWard" <${config.SMTP_FROM || config.SMTP_USER}>`,
    to: data.email,
    subject,
    text,
    html,
  });
}

// Queue and worker setup
import { createQueue, createWorker } from '../connection.js';

export const invitationEmailQueue = createQueue<InvitationEmailData>('invitation-email');

export function startInvitationEmailWorker() {
  const worker = createWorker<InvitationEmailData>('invitation-email', processInvitationEmail);

  worker.on('completed', (job) => {
    console.log(`Invitation email job ${job.id} completed`);
  });

  worker.on('failed', (job, err) => {
    console.error(`Invitation email job ${job?.id} failed:`, err);
  });

  console.log('Invitation email worker started');

  return worker;
}
